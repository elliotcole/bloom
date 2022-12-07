

(
var copybuffer, newBloom, keypad, pulsar, looper, pedals, settings;

MIDIClient.init;
Bloom.midiOut_(MIDIOut.newByName("IAC Driver", "Bus 1").latency(0.01));
Bloom.midiIn_(MIDIIn.findPort("Moog One","Moog One."));
MIDIIn.connectAll;
Bloom.maxChan = 6;


Window.closeAll;
g = List.newClear(1);

keypad = ();
settings = (
	quantize:8,
	quantizeOptions:Routine{loop {[[4,4],[4,3],[3,5],[3,6],[3,2],[4,7],[3,7]].do{|q| q.yield}}},
	maxChannels:1,
	pulsarBaseRate:8,
	nilSpacePauseDur:2,
	legato: 2,
	modifiers:(leftShift:131072, leftShiftArrow:2228224, option:524288),
	tempo:1,
);

////// Bloom Prototype //////

// Clock: one or the other

// default or
TempoClock.default.tempo = settings.tempo;

// Ableton Link (optional)
l = LinkClock(1).latency_(Server.default.latency); Bloom.clock_(l).defaultQuant_([1,0,0]);

// Settings

// telescoping drums
// 36-55 ableton 16 drum rack BUT wrapping is continuous by pitch class, so top of range not always expressed
Bloom.defaultLowestPossibleNote_(40);
Bloom.defaultHighestPossibleNote_(104);
Bloom.defaultFixedGrid_(nil);
Bloom.defaultFixedDurMode_(\scale);
Bloom.defaultFixedDur_(nil);
Bloom.defaultFixedScale_(nil);
/*
// pianoland
Bloom.defaultLowestPossibleNote_(20);
Bloom.defaultHighestPossibleNote_(100);
Bloom.defaultFixedGrid_(nil);
Bloom.defaultFixedDur_(nil);
Bloom.defaultFixedDurMode_(\scale);
*/

b = Bloom.new.verbose_(true);

b.sustain = 2;

keypad.sizes = (full: Rect(0,0, 650, 1200), small: Rect(0,0,650,75), minimized:false);
keypad.w = Window.new("Bloom Keypad", keypad.sizes.full).background_(Color.cyan);
keypad.view = View.new(keypad.w, 650@1000);
keypad.view.addFlowLayout(5@5, 5@5);

// toggles

keypad.toggles = ();
keypad.toggles.view = View.new(keypad.view, Rect(0,0,650, 55));
keypad.toggles.view.addFlowLayout(5@5, 5@5);

StaticText(keypad.toggles.view, Rect(0,0,40, 15)).string_("Fixed").font_(Font(bold: true));
keypad.toggles.fixedDur = CheckBox(keypad.toggles.view,Rect(0,0,70,15))
.string_("duration")
.action_({|box|
	if (box.value, {var amountBox = keypad.toggles.fixedDurAmount;
		amountBox.visible_(true).valueAction_(b.dur);
		keypad.toggles.fixedDurMode.visible_(true);
	}, {
		keypad.toggles.fixedDurAmount.visible_(false);
		b.fixedDur = false; Bloom.defaultFixedDur = false;
		keypad.toggles.fixedDurMode.visible_(false);} )
})
.canFocus_(false);

keypad.toggles.fixedDurAmount = EZSlider.new(keypad.toggles.view, Rect(0,0,100, 15), controlSpec: ControlSpec.new(0.5, 8, step: 0.5,units: "beats"), labelHeight: 15)
.action_({|ez| b.fixedDur = ez.value; Bloom.defaultFixedDur = ez.value})
.value_(2)
.visible_(false);

/*keypad.toggles.fixedDurAmount = Slider.new(keypad.toggles.view, Rect(0,0,100, 15))
.step_(0.5)
.action_({|ez| b.fixedDur = ez.value; Bloom.defaultFixedDur = ez.value})
.value_(2)
.visible_(false);*/

keypad.toggles.fixedDurMode = EZPopUpMenu.new(keypad.toggles.view, 120@15, label: "mode", labelWidth: 40).items_(['scale' -> {b.fixedDurMode_(\scale); Bloom.defaultFixedDurMode_(\scale)},
	'trim' -> {b.fixedDurMode_(\trim); Bloom.defaultFixedDurMode_(\trim)}])
.visible_(false).setColors(background: Color.green);


keypad.toggles.fixedGrid = CheckBox(keypad.toggles.view,Rect(0,0,70,15))
.string_("grid")
.action_({|box|
	if (box.value, {var amountBox = keypad.toggles.fixedGridSize;
		amountBox.visible_(true).valueAction_(amountBox.value)}, {
		keypad.toggles.fixedGridSize.visible_(false);
		b.fixedGrid = false; Bloom.defaultFixedGrid = false} )
})
.canFocus_(false);
keypad.toggles.fixedGridSize = EZNumber.new(keypad.toggles.view, Rect(0,0,15, 15), controlSpec: ControlSpec.new(2, 12, step: 1))
.action_({|ez| b.fixedGrid = ez.value; Bloom.defaultFixedGrid = ez.value})
.value_(8)
.visible_(false);

keypad.toggles.fixedScale = CheckBox(keypad.toggles.view,Rect(0,0,70,15))
.string_("scale").action_({|self|
	var scale = b.scale, text = keypad.toggles.scaleText;
	if (self.value, {text.visible_(true);
		if (scale.name == "", {text.string_(scale.degrees.spell)}, {text.string_(scale.name)};
			b.applyScale(b.scale);
			b.fixedScale_(b.scale);
			Bloom.defaultFixedScale_(b.scale);
	)},
	{text.visible_(false).string_("");
		b.fixedScale_(false);
		Bloom.defaultFixedScale_(false);
})})
.canFocus_(false);
keypad.toggles.scaleText = StaticText.new(keypad.toggles.view, 120@15).visible_(false);

keypad.toggles.range = EZRanger.new(keypad.toggles.view, 450@15, "Compass", ControlSpec(0, 127,step: 1), labelWidth: 60, labelHeight: 15)
.lo_(Bloom.defaultLowestPossibleNote)
.hi_(Bloom.defaultHighestPossibleNote)
.action_({|range|
	if (range.hi - range.lo < 12, {range.hi = range.lo + 12});
	Bloom.defaultLowestPossibleNote = range.lo; b.lowestPossibleNote = range.lo;
	Bloom.defaultHighestPossibleNote = range.hi; b.highestPossibleNote = range.hi;
	b.compass(range.lo, range.hi)}
);

keypad.toggles.drumRange = Button.new(keypad.toggles.view, 50@15)
.states_([["bloom"],["drums"],["full"]])
.action_({arg choice, range;
	case
	{choice.value == 0} {range = [40,108]}
	{choice.value == 1} {range = [36,55]}
	{choice.value == 2} {range = [0,127]};
	keypad.toggles.range.value_(range);
	keypad.toggles.range.doAction;
});

pedals = ();
pedals.outs = Bloom.maxChan.collect{|x| Pedal.new(x, Bloom.midiOut)};
pedals.up = {arg self; self.outs.do{|pedal| pedal.up}; "pedals up"};
pedals.down = {arg self; self.outs.do{|pedal| pedal.down}; "pedals down"};

pulsar = ();
pulsar.pulsar = Bloom.new.pulse(settings.pulsarBaseRate);
pulsar.pulsar.stop;
pulsar.updateBloom = {arg self; self.pulsar.pulsingBloom = b.deepCopy.verbose_(false); "update pulsar".postln};
pulsar.go = {arg self; self.pulsar.start; "start pulsar".postln};
pulsar.end = {arg self; self.pulsar.stop; "stop pulsar".postln};
pulsar.isItPlaying = {arg self; self.pulsar.isPlaying};

looper = ();
looper.pdef = Pdef(\looper);
looper.go = {Pdef(\looper).play; "start looper".postln};
looper.end = {Pdef(\looper).stop; "stop looper".postln};
looper.isItPlaying = {arg self; self.pdef.isPlaying};
looper.bloom = b;
looper.updateBloom = {arg self;	self.bloom = b; "update looper".postln};

//alternate implementation of looper that requires you to update for changes BUT it does do asynchronous lists - I should reimplement

Pdef(\looper, Pbind(
	\type, \midi,
	\midiout, Bloom.midiOut,
	\midinote, Prout { loop { looper.bloom.notes.do {|note| note.yield} } },
	\dur, Prout { loop { looper.bloom.timeIntervals.do {|time| time.yield} } },
	\amp, Prout { loop { looper.bloom.velocities.do {|vel| vel.linlin(0,127,0,1.0).yield} } },
	\chan, Prout { loop { looper.bloom.chans.do {|chan|
		if (chan.isKindOf(SimpleNumber), {chan.yield});
		if (chan.isKindOf(SequenceableCollection), {chan[0].yield});
	} } },
	\legato, Pfunc{looper.legato},
));


/*
Tdef(\looper, {
	loop {
		b.playWait;
	}
});
*/

looper.legato = settings.legato;

Tdef(\gardenLooper, {
	var bloomsInGarden = g.select{|i| i.isKindOf(Bloom)};
	if (bloomsInGarden.isEmpty, {"no blooms in garden".postln},
		{loop {	g.do {|location|
			if (location.isKindOf(Bloom), {location.playWait}, {settings.nilSpacePauseDur.wait})
		}}}
	)
});

Tdef(\gardenPulsar, {
	var bloomsInGarden = g.select{|i| i.isKindOf(Bloom)};
	if (bloomsInGarden.isEmpty, {"no blooms in garden".postln},
		{loop {	g.do {|location|
			if (location.isKindOf(Bloom),
				{location.play; pulsar.pulsar.rate.wait}, {settings.nilSpacePauseDur.wait})
		}}}
	)
});


looper.legato = 2;

keypad.text1 = StaticText(keypad.view, 300@1200).canFocus_(true);
keypad.text1.align = \topLeft;
keypad.text1.font = Font("Monaco", 12);
keypad.text1.string = "
n    new bloom
N    new bloom with same scale
b    new bloom shape
B    new bloom same scale same shape\n
* Storage *
l    save to log
L    new from log
p    push
P    pop\n
* Shaping *
m    mutate notes (diatonic)
M    mutate notes
t    mutate time
op-t sort time
T    mutate velocities
s    scramble
S    shuffle
H    thicken  h    thin
g    gap      G    unGap
[    faster   ]    slower
-    softer   =    louder
y    evenly distribute time\n
* Rotating / Extending *
z    drop last
a    add one in scale
A    add one
9    rotate notes
0    rotate velocities
(    rotate times
)    rotate chans\n
* Patterning *
u    stutter
U    sputter
Y    spray
r    ratchet
R    mirror
d    braid
D    pyramid
q    quantize
Q    change quantize amount
{ }   shorten / lengthen times
_ +   shorten /lengthen velocities
w    draw curves (diatonic)
W    remove doubles
op-w wheels within wheels\n
* Fission / Fusion *
|    merge garden into b
opt\ break b into garden
";

keypad.text2 = StaticText(keypad.view, 300@980).canFocus_(true);
keypad.text2.align = \topLeft;
keypad.text2.font = Font("Monaco", 12);
keypad.text2.string = "
* Blending *
x    interlace
X    blend
f    lift shape
F    lift shape + contour (cast)\n
* Chords *
c    clump chords
C    remove chords
5    harmonize some
%    harmonize all\n
* Pitch *
e    shear
E    center range
i    invert chord
I    invert around mean
1    transpose down semitone
2    transpose up semitone
!    transpose down octave
@    transpose up octave
3    transpose down step
4    transpose up step
v    pivot around highest
V    pivot around loudest\n
* Diatonicism *
k    chooseScale
K    slantScale
j    lift scale
J    reduceScale\n
* Multichannel *
;    randomize channels
'    cycle channels
:    drop channel
\"    add channel\n
* Playback *
space play what's in the buffer
shift-space play what's below
,    loop what's here or buffer
/    pulse what's here or buffer
.    stop looping or pulsing
<    faster pulse
>    slower pulse
?    toggle single or whole garden
\\    toggle sustain pedal\n
* Recording*
`    record / stop\n
* Sequencing *
down          save
up            pull
left/right    navigate
shift l/r     navigate and play
~     minimize window
";

/*
so far unused letters
Z - drop first?
| - split and insert?
6
^
7
&
8
*
?

functions i want to squeeze in

negative harmony

fixedDur toggle

*/





b = Bloom.new.seed;
i = 0;			// "here" index for array g.  ALWAYS INDEX (ie starts with 0)


keypad.text1.keyDownAction = { arg view,char,modifiers,unicode,keycode;
	/*
	("										" + modifiers).postln;
	("										" + char).postln;
	("										" + keycode).postln;
	(" ").postln;
	*/

	case

	//storage

	{ char == $n } { "*new bloom".postln; b.import(Bloom.new.seed).report;  }
	// import so it doesn't kill a loop or pulsar
	{ char == $N } { var scale; "*new bloom with same scale".postln; scale = b.scale;
		b.import(Bloom.new.seed.applyScale(scale)).report;  }
	{ char == $B } { var scale, times, vels, chans; "*new bloom, same scale, same shape".postln;
		scale = b.scale;
		times = b.timeIntervals;
		vels = b.velocities;
		chans = b.chans;
		b.import(Bloom.new.seed(b.timeIntervals.size).applyScale(scale));
		b.timeIntervals = times; b.velocities = vels; b.chans = chans; b.report  }
	{ char == $b } { "*new bloom shape".postln; b.newShape.report }
	{ char == $L } { "*new bloom from log".postln; b.fromLog;  }
	{ char == $l } { "*save to log".postln; b.log;  }
	{ char == $p } { "*push".postln; b.push;  }
	{ char == $P } { "*pop".postln; b.pop;  }

	//shaping

	{ char == $m } { "*mutate notes (diatonic)".postln; b.mutateNotesD.report;  }
	{ char == $M } { "*mutate notes".postln; b.mutateNotes.report;  }
	{ (char == $t) && (modifiers != settings.modifiers.option)} { "*mutate time".postln; b.mutateTime.report;  }
	{ (char == $t) && (modifiers == settings.modifiers.option)} { "*sort time".postln; b.timeIntervals = b.timeIntervals.sort; b.report;  }
	{ char == $t } { "*mutate time".postln; b.mutateTime.report;  }
	{ char == $T } { "*mutate velocities".postln; b.mutateVelocities.report;  }
	{ char == $s } { "*scramble".postln; b.scramble.report;  }
	{ char == $S } { "*shuffle".postln; b.shuffle.report;  }
	{ char == $H } { "*thicken".postln; b.thicken(0.3).report;  }
	{ char == $h } { "*thin".postln; b.thin.report;  }
	{ char == $g } { "*gap".postln; b.gap.report;  }
	{ char == $G } { "*ungap".postln; b.unGap.report;  }
	{ char == $] } { "*slower".postln; b.slower; b.report;  }
	{ char == $[ } { "*faster".postln; b.faster; b.report; }
	{ char == $- } { "*softer".postln; b.softer; b.report; }
	{ char == $= } { "*louder".postln; b.louder; b.report; }
	{ char == $y } { "*average time".postln; b.avgTime.report;  }
	{ char == $x } { "*lift and interlace".postln; if(g[i].class == Bloom, {b.interlace(g[i])}, {"no bloom here".postln});  }
	{ char == $X } { "*lift and blend".postln; if(g[i].class == Bloom, {b.blend(g[i])}, {"no bloom here".postln});  }
	{ char == $f } { "*lift shape".postln; if(g[i].class == Bloom, {b.applyShape(g[i])}, {"no bloom here".postln});  }
	{ char == $F } { "*lift shape and contour".postln; if(g[i].class == Bloom, {b.cast(g[i])}, {"no bloom here".postln});  }
	{ char == $z } { "*drop last".postln;  b.dropLast.report;  }
	{ char == $A } { "*add one".postln; b.addOne.report;  }
	{ char == $a } { "*add one in scale".postln; b.addOneInScale.report;  }
	{ char == $9 } { "*notes >>".postln; b.rotateNotes(1).report;  }
	{ char == $0 } { "*velocities >>".postln; b.rotateVelocities(1).report;  }
	{ char == $( } { "*times >>".postln; b.rotateTime(1).report;  }
	{ char == $) } { "*chans >>".postln; b.rotateChans(1).report;  }

	//patterning

	{ char == $u } { "*stutter".postln; b.stutter; b.report }
	{ char == $U } { "*sputter".postln; b.sputter; b.report }
	{ char == $Y } { "*spray".postln; b.spray; b.report }
	{ char == $r } { "*ratchet".postln; b.ratchet; b.report }
	{ char == $R } { "*mirror".postln; b.mirror; b.report }
	{ char == $d } { "*braid".postln; b.braid; b.report }
	{ char == $D } { "*pyramid".postln; b.pyramid; b.report }
	{ char == $q } { ("*quantize [%]").format(settings.quantize).postln; b.quantize(settings.quantize); b.report }
	{ char == $Q } { var nextQ = settings.quantizeOptions.next; settings.quantize = nextQ; ("*quantize [%]").format(nextQ).postln; b.quantize(settings.quantize); b.report }
	{ char == ${ } { "*shorten times".postln; b.timeIntervals = b.timeIntervals.drop(-1); b.report }
	{ char == $} } { "*lengthen times".postln; b.timeIntervals = b.timeIntervals.add(b.timeIntervals.choose); b.report  }
	{ char == $_ } { "*shorten velocities".postln; b.velocities = b.velocities.drop(-1); b.report }
	{ char == $+ } { "*lengthen velocities".postln; b.velocities = b.velocities.add(b.velocities.choose); b.report }

	// pitch
	{ char == $e } { "*shear".postln; b.shear; b.report }
	{ char == $E } { "*center range".postln; b.compass(48, 72); b.report }
	{ char == $i } { "*invert".postln; b.invert; b.report }
	{ char == $I } { "*invertMean".postln; b.invertMean; b.report }
	{ char == $1 } { "*down semitone".postln; b.transpose(-1); b.report }
	{ char == $2 } { "*up semitone".postln; b.transpose(-1); b.report }
	{ char == $! } { "*down octave".postln; b.transpose(-12); b.report }
	{ char == $@ } { "*up octave".postln; b.transpose(12); b.report }
	{ char == $3 } { "*down step".postln; b.dTranspose(-1); b.report }
	{ char == $4 } { "*up step".postln; b.dTranspose(1); b.report }
	{ char == $v } { "*pivot around highest".postln; b.pivot; b.report }
	{ char == $V } { "*pivot around loudest".postln; b.pivotLoudest; b.report }
	{ (char == $w) && (modifiers != settings.modifiers.option)} { "*draw curves".postln; b.drawCurvesD(b.notes.size * 2 ); b.report}
	{ (char == $w) && (modifiers == settings.modifiers.option)} { "*wheels within wheels".postln;
		b.velocities = [100] ++ (30 ! (b.notes.size)); b.report
	}
	{ char == $W } { "*remove doubles".postln; b.removeDoubles; b.report}

	// chords

	{ char == $c } { "*clump chords".postln; b.chordsRandShorten; b.report}
	{ char == $C } { "*flatten".postln; b.flattenChords; b.report}
	{ char == $5 } { "*harmonize some".postln; b.harmonize([1,3,5], 0.22); b.report}
	{ char == $% } { "*harmonize efficiently".postln; b.harmonize([1,3,5]); b.report}

	// diatonicism

	{ char == $k } { "*applying nearest scale".postln; b.chooseScale; b.report }
	{ char == $K } { "*applying slant scale".postln; b.slantScale; b.report }
	{ char == $j } { "*lift scale".postln; if(g[i].isKindOf(Bloom), {b.applyScale(g[i].scale)}, {}); }
	{ char == $J } { "*simplifying the scale".postln; b.reduceScale; b.report }

	// channels

	{ char == $; } { "*randomize channels".postln; b.randChans.report;  }
	{ char == $' } { "*cycle channels".postln; b.cycleChans.report; }
	{ char == $: } { "*chan <<".postln;b.dropChan.report; }


	// window size

	{ char == $~ } { if (keypad.sizes.minimized,
		{keypad.w.setTopLeftBounds(keypad.sizes.full); keypad.sizes.minimized = false},
		{keypad.w.setTopLeftBounds(keypad.sizes.small); keypad.sizes.minimized = true})
	}

	// playback

	{ char == $, } {if (looper.isItPlaying, {}, {looper.go}); looper.updateBloom;  }
	{ char == $. } {if (looper.isItPlaying, {looper.end}); if (pulsar.isItPlaying, {pulsar.end}) }
	{ char == $/ } {if (pulsar.isItPlaying, {}, {pulsar.go}); pulsar.updateBloom; }
	{ char == $< } { var newRate = pulsar.pulsar.rate - 0.25; "*pulse rate %".format(newRate).postln;
		pulsar.pulsar.rate = newRate;  }
	{ char == $> } { var newRate = pulsar.pulsar.rate.rate + 0.25; "*pulse rate %".format(newRate).postln;
		pulsar.pulsar.rate = newRate;  }

	{ char == $\\ } { if (pedals.outs[0].state, {pedals.up; "*pedal up".postln;}, {pedals.down; "*pedal down".postln}); }

	{ char == $` } { if (b.isRecording, {b.rstop}, {b.record}); }

	{ keycode == 43 && modifiers == settings.modifiers.option } {
		if (Tdef(\gardenLooper).isPlaying,
			{Tdef(\gardenLooper).stop; "stop looping".postln},
			{Tdef(\gardenLooper).play; "looping garden".postln;})
	} // option ,

	{ keycode == 44 && modifiers == settings.modifiers.option } {
		if (Tdef(\gardenPulsar).isPlaying,
			{Tdef(\gardenPulsar).stop; "stop pulsing".postln},
			{Tdef(\gardenPulsar).play; "pulsing garden".postln;})
	} // option /

	{ char == $| } {"merging garden".postln; b.fromListOfBlooms(g)}

	{ keycode == 42 && modifiers == settings.modifiers.option } {
		"curdling garden".postln; g = b.curdle(0.2)}

	{ keycode == 49 && modifiers == 0} { "- play b -".postln; if (b.isKindOf(Bloom), {b.play;}, {}); "		".postln; } //space


	{ (keycode == 125) && (modifiers != settings.modifiers.leftShiftArrow)} { 			// down arrow -- save b Here
		g[i] = b.deepCopy;
		("--- saving Bloom in slot [" + i + "]").postln;
		g[i].report;
	}

	{ (keycode == 125) && (modifiers == settings.modifiers.leftShiftArrow) }
	{ // insert
		g.insert(i, nil);
		("... inserting empty slot at [" + i + "]").postln;
	}

	{ keycode == 126 } {					// up arrow -- lift Here into buffer
		if(g[i].class == Bloom,
			{ b = g[i].deepCopy;
				("lifting Bloom from slot " + i + "into the buffer").postln;
				b.report;},
			{"nothing here".postln;})
	}

	{ keycode == 123 } {// "--- step back".postln; 				// left arrow
		keypad.actions.back.value(modifiers);
	}
	{ keycode == 124 } {// "--- step forward".postln; 				// right arrow
		keypad.actions.forward.value(modifiers);
	}

	{ keycode == 36 } {// ">> jump to end".postln; 			// enter key
		i = max(0, g.size);
		(">> new entry [" + i + "]").postln;
		g.add(nil);

	}
	{ keycode == 51 } { //"--- delete".postln;					// delete key

		case {g[i].isKindOf(Bloom)} {g[i] = nil;("[" + i + "] emptied").postln;}
		{g[i].isNil and: i>0}
		{g.removeAt(i); ("[" + i + "] deleted").postln; keypad.actions.back.value;};
	}

	{ ((keycode == 49) && (modifiers == settings.modifiers.leftShift)) }
	{ ("playing >> [" + i + "/" + (g.size - 1) + "]").postln; 	 // L shift + space bar
		if (g[i].isKindOf(Bloom),
			{g[i].play;},
			{});
		"		".postln;
	}

	{ keycode == 49 } { "- play buffer -".postln; 			// space bar
		if (b.isKindOf(Bloom),
			{b.play;
				i.postln
			},
			{"nothing in buffer.  type n to make a new Bloom"};);
		"		".postln;
	}

	{ (keycode == 49) && (modifiers == 262401) } { // option spacebar

	}


};

keypad.text2.keyDownAction = keypad.text1.keyDownAction;

keypad.w.front;

keypad.text1.focus;


keypad.actions = ();
keypad.actions.back = {arg modifier;
	i = max(0, (i - 1));			// go back one

	("<< [" + i + "/" + max(0, (g.size - 1)) + "]").postln;

	if (g[i].isKindOf(Bloom),
		{
			g[i].report;
			if (modifier == settings.modifiers.leftShift, {b.play}, {});
		},
		{"(empty)\n".postln});
};

keypad.actions.forward = {arg modifier;
	i = i + 1;			// go forward one

	if (i < g.size, {
		(">> [" + i + "/" + (g.size - 1) + "]").postln;
		if (g[i].isKindOf(Bloom),
			{
				g[i].report;
				if (modifier == settings.modifiers.leftShift, {g[i].play}, {});

			},
			{"(empty)\n".postln;});
	},
	{			// ie if i is a new empty slot at the end
		(">> new entry [" + i + "]").postln;
		g.add(nil);
	}
	)
};



keypad.query = {g.do({|each, iter| ("[" + iter + "] ").postln;
	if (each.isKindOf(Bloom), {each.report}, {"(empty)".postln; })})};


)


// SAVING g

Archive.global.put(\bloomSo, g);

g = Archive.global.at(\bloomOct5);
g.postcs;


z = StaticText.new
z.hasFocus
z.canFocus_(true)
z.focus(true)
