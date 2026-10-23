CFLAGS = -O2 -Wall -Wno-deprecated-declarations -mmacosx-version-min=11.0
LIBS = -framework CoreMIDI -framework CoreFoundation

bloom-mts: bloom-mts.c
	clang $(CFLAGS) -o $@ $< $(LIBS)

# Intel + Apple Silicon in one file, published on the site for download
universal: bloom-mts.c
	clang $(CFLAGS) -arch arm64 -arch x86_64 -o ../web/public/bloom-mts $< $(LIBS)
	codesign --force --sign - ../web/public/bloom-mts

clean:
	rm -f bloom-mts

.PHONY: clean universal
