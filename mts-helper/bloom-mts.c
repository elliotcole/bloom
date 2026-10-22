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
//
// Build: make        Run: ./bloom-mts   (--dry: no libMTS, just print; --reinit:
// clear a master left registered by a crash)

#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <math.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
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

static double mtsFreq(int xx, int yy, int zz) {
  return 440.0 * pow(2.0, (xx + ((yy << 7) | zz) / 16384.0 - 69.0) / 12.0);
}

static void publish(void) {
  if (!dry) {
    mts_SetNoteTunings(freqs);
    if (mts_SetScaleName) mts_SetScaleName(scaleName);
  }
}

static void report(void) {
  // the twelve notes from middle C, in cents from 12-TET
  printf("%-24s", scaleName);
  for (int k = 60; k < 72; k++) {
    double c = 1200.0 * log2(freqs[k] / (440.0 * pow(2.0, (k - 69) / 12.0)));
    printf(" %+4.0f", c);
  }
  if (!dry && mts_GetNumClients) printf("   (%d client%s)", mts_GetNumClients(), mts_GetNumClients() == 1 ? "" : "s");
  printf("\n");
  fflush(stdout);
}

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
    if (m[7] + count > 127) report();   // after the message that reaches the top note
  } else if (m[1] == 0x7E && n >= 408 && m[3] == 0x08 && m[4] == 0x01) {
    // bulk dump: 16-character name, then three bytes for each of the 128 notes
    memcpy(scaleName, m + 6, 16);
    scaleName[16] = 0;
    for (int k = 0; k < 128; k++) {
      const unsigned char *e = m + 22 + 3 * k;
      if (!(e[0] == 0x7F && e[1] == 0x7F && e[2] == 0x7F)) freqs[k] = mtsFreq(e[0], e[1], e[2]);
    }
    publish();
    report();
  } else if (m[1] == 0x7D && n >= 6 && m[2] == 0x62 && m[3] == 0x6C && m[4] == 0x6D) {
    size_t len = n - 6 < 64 ? n - 6 : 64;
    memcpy(scaleName, m + 5, len);
    scaleName[len] = 0;
    publish();
  }
}

// SysEx can arrive split across packets, with real-time bytes in between
static unsigned char buf[4096];
static size_t bufLen = 0;
static bool inSysex = false;

static void readPackets(const MIDIPacketList *list) {
  const MIDIPacket *p = &list->packet[0];
  for (UInt32 i = 0; i < list->numPackets; i++) {
    for (UInt16 j = 0; j < p->length; j++) {
      unsigned char b = p->data[j];
      if (b >= 0xF8) continue;                       // real-time: clock, active sensing …
      if (b == 0xF0) { inSysex = true; bufLen = 0; }
      if (!inSysex) continue;
      if (b & 0x80 && b != 0xF0 && b != 0xF7) { inSysex = false; continue; }   // a status byte cut it short
      if (bufLen < sizeof buf) buf[bufLen++] = b;
      if (b == 0xF7) { inSysex = false; handleSysex(buf, bufLen); }
    }
    p = MIDIPacketNext(p);
  }
}

static void onSignal(int sig) { (void)sig; quit = 1; }

int main(int argc, char **argv) {
  bool reinit = false;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--dry")) dry = true;
    else if (!strcmp(argv[i], "--reinit")) reinit = true;
    else { fprintf(stderr, "usage: bloom-mts [--dry] [--reinit]\n"); return 2; }
  }
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
                                        ^(const MIDIPacketList *list, void *src) { (void)src; readPackets(list); }) != noErr) {
    fprintf(stderr, "couldn't open the Bloom Tuning MIDI port\n");
    if (!dry) mts_DeregisterMaster();
    return 1;
  }

  signal(SIGINT, onSignal);
  signal(SIGTERM, onSignal);
  printf("bloom-mts: listening on \"Bloom Tuning\"%s. ctrl-c quits.\n", dry ? " (dry run: no libMTS)" : ", MTS-ESP master");
  if (!dry && mts_HasIPC) printf("IPC %s\n", mts_HasIPC() ? "on: clients in other processes hear it too" : "off");
  report();

  int clients = dry || !mts_GetNumClients ? 0 : mts_GetNumClients();
  while (!quit) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.5, false);
    if (!dry && mts_GetNumClients && mts_GetNumClients() != clients) {
      clients = mts_GetNumClients();
      printf("%d client%s connected\n", clients, clients == 1 ? "" : "s");
      fflush(stdout);
    }
  }

  MIDIEndpointDispose(dest);
  MIDIClientDispose(client);
  if (!dry) mts_DeregisterMaster();
  printf("\nbloom-mts: stopped, master released\n");
  return 0;
}
