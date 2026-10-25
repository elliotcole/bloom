// bloom-mts: an MTS-ESP master that takes its tuning from Bloom.
//
// Bloom (in the browser) can't load ODDSound's libMTS, so this small program
// does: it opens a virtual MIDI input called "Bloom Tuning", reads MIDI Tuning
// Standard messages sent to it, and passes each tuning to every MTS-ESP client
// plugin (in Ableton or any other host) through libMTS.
//
// Understands:
//   F0 7F dd 08 02 pp nn [kk xx yy zz]... F7   real-time single note tuning change
//   F0 7E dd 08 01 pp <name 16> [xx yy zz]x128 cs F7   bulk tuning dump
//   F0 7D 62 6C 6D <name...> F7                Bloom's own: the tuning's name
//   F0 7D 62 6C 63 [pitch vel]... F7           Bloom's own: a tuning cue to play out
//   notes                                      a tuning cue played back (from the DAW)
//
// Tuning cues: so a take recorded in a DAW keeps its tunings, each tuning Bloom
// sends also comes out of a second virtual port, "Bloom Tuning Cues", as a chord
// of notes that hold it (the format is in Bloom's lib/tuning.ts and GUIDE.md).
// Record them on a MIDI track; play that track back into "Bloom Tuning" and the
// tunings change again where they did, without Bloom.
//
// Build: make        Run: ./bloom-mts   (--dry: no libMTS, just print; --reinit:
// clear a master left registered by a crash; --decode: read "pitch velocity"
// lines on stdin as one cue and print the table it makes, for testing)

#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <mach/mach_time.h>
#include <dlfcn.h>
#include <math.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ─── libMTS, loaded at run time (as ODDSound's libMTSMaster.cpp does) ─────────

static void (*mts_RegisterMaster)(void *);
static void (*mts_DeregisterMaster)(void);
static void (*mts_Reinitialize)(void);
static bool (*mts_HasMaster)(void);
static bool (*mts_HasIPC)(void);
static int (*mts_GetNumClients)(void);
static void (*mts_SetNoteTunings)(const double *);
static void (*mts_SetScaleName)(const char *);

static bool load_libmts(void) {
  void *h = dlopen("/Library/Application Support/MTS-ESP/libMTS.dylib", RTLD_NOW);
  if (!h) return false;
  mts_RegisterMaster = dlsym(h, "MTS_RegisterMaster");
  mts_DeregisterMaster = dlsym(h, "MTS_DeregisterMaster");
  mts_Reinitialize = dlsym(h, "MTS_Reinitialize");
  mts_HasMaster = dlsym(h, "MTS_HasMaster");
  mts_HasIPC = dlsym(h, "MTS_HasIPC");
  mts_GetNumClients = dlsym(h, "MTS_GetNumClients");
  mts_SetNoteTunings = dlsym(h, "MTS_SetNoteTunings");
  mts_SetScaleName = dlsym(h, "MTS_SetScaleName");
  return mts_RegisterMaster && mts_DeregisterMaster && mts_SetNoteTunings;
}

// ─── State ────────────────────────────────────────────────────────────────────

static bool dry = false;
static double freqs[128];
static char scaleName[65] = "12-TET";
static volatile sig_atomic_t quit = 0;
static dispatch_queue_t q;   // all of the state is touched only on it

static double mtsFreq(int xx, int yy, int zz) {
  return 440.0 * pow(2.0, (xx + ((yy << 7) | zz) / 16384.0 - 69.0) / 12.0);
}

static void publish(void) {
  if (!dry) {
    mts_SetNoteTunings(freqs);
    if (mts_SetScaleName) mts_SetScaleName(scaleName);
  }
}

static void report(const char *from) {
  // the twelve notes from middle C, in cents from 12-TET
  printf("%-24s", scaleName);
  for (int k = 60; k < 72; k++) {
    double c = 1200.0 * log2(freqs[k] / (440.0 * pow(2.0, (k - 69) / 12.0)));
    printf(" %+4.0f", c);
  }
  if (!dry && mts_GetNumClients) printf("   (%d client%s)", mts_GetNumClients(), mts_GetNumClients() == 1 ? "" : "s");
  if (from) printf("   %s", from);
  printf("\n");
  fflush(stdout);
}

static void playCue(const unsigned char *pairs, size_t count);
static void cueNoteIn(unsigned char k, unsigned char v);

// ─── SysEx ────────────────────────────────────────────────────────────────────

static void handleSysex(const unsigned char *m, size_t n) {
  if (n < 6 || m[0] != 0xF0 || m[n - 1] != 0xF7) return;
  if (m[1] == 0x7F && n >= 8 && m[3] == 0x08 && m[4] == 0x02) {
    // real-time single note tuning change: count, then key + 3 bytes each
    size_t count = m[6];
    for (size_t i = 0; i < count && 7 + 4 * i + 3 < n - 1; i++) {
      const unsigned char *e = m + 7 + 4 * i;
      if (e[1] == 0x7F && e[2] == 0x7F && e[3] == 0x7F) continue;   // "no change"
      freqs[e[0] & 0x7F] = mtsFreq(e[1], e[2], e[3]);
    }
    publish();
    if (m[7] + count > 127) report(NULL);   // after the message that reaches the top note
  } else if (m[1] == 0x7E && n >= 408 && m[3] == 0x08 && m[4] == 0x01) {
    // bulk dump: 16-character name, then three bytes for each of the 128 notes
    memcpy(scaleName, m + 6, 16);
    scaleName[16] = 0;
    for (int k = 0; k < 128; k++) {
      const unsigned char *e = m + 22 + 3 * k;
      if (!(e[0] == 0x7F && e[1] == 0x7F && e[2] == 0x7F)) freqs[k] = mtsFreq(e[0], e[1], e[2]);
    }
    publish();
    report(NULL);
  } else if (m[1] == 0x7D && n >= 6 && m[2] == 0x62 && m[3] == 0x6C && m[4] == 0x6D) {
    size_t len = n - 6 < 64 ? n - 6 : 64;
    memcpy(scaleName, m + 5, len);
    scaleName[len] = 0;
    publish();
  } else if (m[1] == 0x7D && n >= 6 && m[2] == 0x62 && m[3] == 0x6C && m[4] == 0x63) {
    playCue(m + 5, (n - 6) / 2);
  }
}

// SysEx can arrive split across packets, with real-time bytes in between; notes
// may come with running status. Whole messages go on to the queue.
static unsigned char buf[4096];
static size_t bufLen = 0;
static bool inSysex = false;
static unsigned char status = 0, data1 = 0;
static int have = 0;

static void readPackets(const MIDIPacketList *list) {
  const MIDIPacket *p = &list->packet[0];
  for (UInt32 i = 0; i < list->numPackets; i++) {
    for (UInt16 j = 0; j < p->length; j++) {
      unsigned char b = p->data[j];
      if (b >= 0xF8) continue;                       // real-time: clock, active sensing …
      if (b == 0xF0) { inSysex = true; bufLen = 0; status = 0; }
      if (inSysex) {
        if (b & 0x80 && b != 0xF0 && b != 0xF7) inSysex = false;   // a status byte cut it short
        else {
          if (bufLen < sizeof buf) buf[bufLen++] = b;
          if (b == 0xF7) {
            inSysex = false;
            size_t n = bufLen;
            unsigned char *copy = malloc(n);
            memcpy(copy, buf, n);
            dispatch_async(q, ^{ handleSysex(copy, n); free(copy); });
          }
          continue;
        }
      }
      if (b & 0x80) { status = b < 0xF0 ? b : 0; have = 0; continue; }
      if (!status) continue;
      if ((status & 0xF0) == 0xC0 || (status & 0xF0) == 0xD0) continue;   // one data byte: not ours
      if (!have) { data1 = b; have = 1; continue; }
      have = 0;
      if ((status & 0xF0) == 0x90 && b) {
        unsigned char k = data1, v = b;
        dispatch_async(q, ^{ cueNoteIn(k, v); });
      }
    }
    p = MIDIPacketNext(p);
  }
}

// ─── Tuning cues ──────────────────────────────────────────────────────────────
// A cue is a chord: the pitch says what a note holds, its velocity the value
// (see Bloom's lib/tuning.ts). Out: played on "Bloom Tuning Cues" as Bloom
// sends them. In: notes arriving on "Bloom Tuning" are gathered until they stop
// for a moment, then read as one cue.

enum { CUE_FORMAT = 0, CUE_ROOT = 1, CUE_PERIOD = 2, CUE_DEGREES = 5, CUE_NAME = 64, CUE_NAME_LEN = 32 };

static MIDIEndpointRef cueSource;
static bool sounding[128];           // cue notes still held on the cue port
static unsigned outGen = 0, inGen = 0;
static double lastOut = -1e9;        // when a cue last went out, in seconds
static unsigned char pending[128];   // cue notes coming in

static double now(void) {
  static mach_timebase_info_data_t tb;
  if (!tb.denom) mach_timebase_info(&tb);
  return (double)mach_absolute_time() * tb.numer / tb.denom / 1e9;
}

static void sendNotes(const unsigned char *bytes, size_t n) {
  if (!n) return;
  Byte buf[1024];
  MIDIPacketList *list = (MIDIPacketList *)buf;
  MIDIPacket *p = MIDIPacketListInit(list);
  for (size_t i = 0; i < n; i += 3) {
    p = MIDIPacketListAdd(list, sizeof buf, p, 0, 3, bytes + i);
    if (!p) {   // full: send what there is and start again
      MIDIReceived(cueSource, list);
      p = MIDIPacketListAdd(list, sizeof buf, MIDIPacketListInit(list), 0, 3, bytes + i);
    }
  }
  MIDIReceived(cueSource, list);
}

static void cueOff(void) {
  unsigned char out[3 * 128];
  size_t n = 0;
  for (int k = 0; k < 128; k++) if (sounding[k]) {
    out[n++] = 0x80; out[n++] = k; out[n++] = 0;
    sounding[k] = false;
  }
  sendNotes(out, n);
}

static void playCue(const unsigned char *pairs, size_t count) {
  unsigned char out[3 * 128];
  size_t n = 0;
  cueOff();   // the last one, if it's still held
  for (size_t i = 0; i < count && i < 128; i++) {
    unsigned char k = pairs[2 * i] & 0x7F, v = pairs[2 * i + 1] & 0x7F;
    if (!v) continue;
    out[n++] = 0x90; out[n++] = k; out[n++] = v;
    sounding[k] = true;
  }
  sendNotes(out, n);
  lastOut = now();
  unsigned gen = ++outGen;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC), q, ^{ if (gen == outGen) cueOff(); });
}

static bool cueValue(const unsigned char *v, int at, double *out) {
  if (!v[at] || !v[at + 1] || !v[at + 2]) return false;
  *out = ((v[at] - 1) * 16129.0 + (v[at + 1] - 1) * 127.0 + (v[at + 2] - 1) - 1000000.0) / 1000.0;
  return true;
}

/** A cue's table (as Bloom's freqTable makes it) and name; false if it's incomplete */
static bool readCue(const unsigned char *v, double *table, char *name) {
  double period, cents[12];
  if (v[CUE_FORMAT] != 1 || !v[CUE_ROOT] || !cueValue(v, CUE_PERIOD, &period)) return false;
  for (int d = 0; d < 12; d++) {
    if (!cueValue(v, CUE_DEGREES + 3 * d, &cents[d])) return false;
    cents[d] += 100 * d;
  }
  period += 1200;
  int rootMidi = 60 + (v[CUE_ROOT] - 1) % 12;
  double base = 440.0 * pow(2.0, (rootMidi - 69) / 12.0);
  for (int m = 0; m < 128; m++) {
    int d = m - rootMidi, oct = (int)floor(d / 12.0), deg = d - 12 * oct;
    table[m] = base * pow(2.0, (oct * period + cents[deg]) / 1200.0);
  }
  int i = 0;
  for (; i < CUE_NAME_LEN && v[CUE_NAME + i]; i++) name[i] = (char)v[CUE_NAME + i];
  name[i] = 0;
  return true;
}

static void takeCue(void) {
  double table[128];
  char name[CUE_NAME_LEN + 1];
  bool ok = readCue(pending, table, name);
  memset(pending, 0, sizeof pending);
  if (!ok) { printf("(an incomplete tuning cue: ignored)\n"); fflush(stdout); return; }
  memcpy(freqs, table, sizeof freqs);
  snprintf(scaleName, sizeof scaleName, "%s", name);
  publish();
  report("from a cue");
}

static void cueNoteIn(unsigned char k, unsigned char v) {
  // our own cue coming straight back (the DAW's track monitoring while it
  // records): Bloom is playing, and it's the one to follow
  if (now() - lastOut < 2.0) return;
  pending[k] = v;
  unsigned gen = ++inGen;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 40 * NSEC_PER_MSEC), q, ^{ if (gen == inGen) takeCue(); });
}

static void onSignal(int sig) { (void)sig; quit = 1; }

int main(int argc, char **argv) {
  bool reinit = false;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--dry")) dry = true;
    else if (!strcmp(argv[i], "--reinit")) reinit = true;
    else if (!strcmp(argv[i], "--decode")) {
      unsigned char v[128] = {0};
      int k, vel;
      while (scanf("%d %d", &k, &vel) == 2) if (k >= 0 && k < 128) v[k] = vel & 0x7F;
      double table[128];
      char name[CUE_NAME_LEN + 1];
      if (!readCue(v, table, name)) { fprintf(stderr, "incomplete cue\n"); return 1; }
      printf("%s\n", name);
      for (int m = 0; m < 128; m++) printf("%.9f\n", table[m]);
      return 0;
    }
    else { fprintf(stderr, "usage: bloom-mts [--dry] [--reinit] [--decode]\n"); return 2; }
  }
  q = dispatch_queue_create("bloom-mts", DISPATCH_QUEUE_SERIAL);
  for (int k = 0; k < 128; k++) freqs[k] = 440.0 * pow(2.0, (k - 69) / 12.0);

  if (!dry) {
    if (!load_libmts()) {
      fprintf(stderr, "libMTS not found. Install MTS-ESP (the free MTS-ESP Mini from oddsound.com puts it in\n"
                      "/Library/Application Support/MTS-ESP), or run with --dry to just watch what Bloom sends.\n");
      return 1;
    }
    if (mts_HasMaster && mts_HasMaster()) {
      if (reinit && mts_HasIPC && mts_HasIPC() && mts_Reinitialize) {
        mts_Reinitialize();
      } else {
        fprintf(stderr, "Another MTS-ESP master is connected (MTS-ESP Mini or Suite in a project?). Only one can\n"
                        "be: remove it. If none is running and a crash left one registered, run with --reinit.\n");
        return 1;
      }
    }
    mts_RegisterMaster(NULL);
    publish();
  }

  MIDIClientRef client;
  MIDIEndpointRef dest;
  if (MIDIClientCreate(CFSTR("bloom-mts"), NULL, NULL, &client) != noErr
      || MIDIDestinationCreateWithBlock(client, CFSTR("Bloom Tuning"), &dest,
                                        ^(const MIDIPacketList *list, void *src) { (void)src; readPackets(list); }) != noErr
      || MIDISourceCreate(client, CFSTR("Bloom Tuning Cues"), &cueSource) != noErr) {
    fprintf(stderr, "couldn't open the Bloom Tuning MIDI ports\n");
    if (!dry) mts_DeregisterMaster();
    return 1;
  }

  signal(SIGINT, onSignal);
  signal(SIGTERM, onSignal);
  printf("bloom-mts: listening on \"Bloom Tuning\"%s; tuning cues out of \"Bloom Tuning Cues\". ctrl-c quits.\n",
         dry ? " (dry run: no libMTS)" : ", MTS-ESP master");
  if (!dry && mts_HasIPC) printf("IPC %s\n", mts_HasIPC() ? "on: clients in other processes hear it too" : "off");
  report(NULL);

  int clients = dry || !mts_GetNumClients ? 0 : mts_GetNumClients();
  while (!quit) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.5, false);
    if (!dry && mts_GetNumClients && mts_GetNumClients() != clients) {
      clients = mts_GetNumClients();
      printf("%d client%s connected\n", clients, clients == 1 ? "" : "s");
      fflush(stdout);
    }
  }

  dispatch_sync(q, ^{ cueOff(); });
  MIDIEndpointDispose(cueSource);
  MIDIEndpointDispose(dest);
  MIDIClientDispose(client);
  if (!dry) mts_DeregisterMaster();
  printf("\nbloom-mts: stopped, master released\n");
  return 0;
}
