// Bloom - Code Examples

(
MIDIClient.init;
Bloom.midiOut_(MIDIOut.newByName("IAC Driver", "Bus 1"));
Bloom.midiIn_(MIDIIn.findPort("IAC Driver","Bus 1"));
b = Bloom.new.verbose_(true);
c = Bloom.new.verbose_(true);

b.chans = [0,1,2,3,4]
)



/*

Suggested practice: building your .log

listen to random blooms and save ones that appeal to you in your log.  Draw randomly from this log for curated results.

*/


// // pedal down
p = Pedal.new(0, Bloom.midiOut);
p.down;


// // if you want to give it your full attention

b = Bloom.new
b.pulse(4, {3.wait; b.slower.playWait; 6.wait; b.seed}) // close eyes, just listen.  when you hear something you like, run:
b.log


// // ambient music approach -- long silences between, good for running while you do other things.

(
t = Task.new{
	loop {
		b.seed.playWait;
		5.wait;
		b.slower.playWait;
		5.wait;
		b.softer.playWait;
		25.wait;
	}
}
)

t.play
b.log // when you hear something you like, run this









/*

LIVE-CODE STYLE

in this style, code is written free-form and lines of code are played and replayed ad hoc in any order

*/


//

TempoClock.default.tempo = 1.5


// 16 step sequencer with transformations
b.seed(16).applyScale(Scale.todi).wrapTime(0.25).setLegato(1).fixedDur_(4).fixedDurMode_(\trim)
~pulse = b.pulse(4)


// play in any order
b.gap
b.shiftNotesD
b.shear
b.unGap
b.legato_(5)
b.legato_(0.1)
b.legato_(Prand([1,0.1,6],inf))
b.legato_(Prand([1,0.1,6,4,0.5],inf))
b.legato_(8)
b.unGap; b.gap;
b.curvesExtend(32).applyScale(Scale.todi)
b.shear
b.transpose(2);
b.dTranspose(-1);
b.addFlat;
b.shuffle
b.notes[5] = b.notes[[1,2,3,4]]; b.notes = b.notes.flat;
b.pivot
b.sputter
b.transpose(12);
b.applyScale(Scale.lydian)
b.applyScale(Scale.dorian)
b.applyScale(Scale.todi)
b.chooseScale
b.ratchet
b.slantScale
b.thicken.wrapTime(0.25)
b.wrapVel([100,60,60])
b.decrescendo
b.chordsRand
b.wrapTime(0.125)
b.pyramid(1)
b.slide(3)
b.flattenChords
~pulse.stop









// telescoping drum patterns

//
(
b.lowestPossibleNote_(36).highestPossibleNote_(48) // constrict range to conventional drum pads
.fixedDur_(2).fixedDurMode_(\scale).fixedGrid_(8) // squeeze all notes into a 2 beat phrase, and then quantize to 8 even subdivisions of each beat
.seed.setLegato(1) // legato = 1; notes will be held only as long as timeInterval
)

~pulse = b.pulse(2)
b.sputter
b.wrapTime(1) // equalizes durations but then they're squeezed
b.newShape
b.newNotes
b.ratchet
b.sputter
b.transpose(-1)
b.removeDoubles
b.thickenLengthen

b.lace(Bloom.new([36,36,36,36])) // add some kick drums
b.lace(Bloom.new([42,42,42,42])) // add some hi hats
b.shuffle

~pulse.stop




b.logName






// reorder notes, keep shape

(
b.fromLog;

t = Task.new{
	loop {
		b.fromLog;
		b.playWait;
		5.wait;
		5.do {
		b.notes = b.notes.scramble;
		b.slower.softer.playWait;
		4.wait};
		3.do {b.thin(0.3).slower.softer.playWait; 4.wait};
		10.wait;
	}
}

)

t.play
t.stop









// thin - sputter

(
b = Bloom.new.verbose_(true);

t = Task.new{
	loop {
		b.seed(16.rand+4).applyScale;
		c = b.deepCopy;
		b.play; b.dur.wait;

		7.do {
			b = c.deepCopy;
			b.thin(0.6).play;
			b.dur.wait;
			3.wait;
			b.thin(0.2).softer.sputter(0.4).play;
			b.dur.wait;
			3.wait;
		};

		5.wait;
	}
}

)

t.play
t.stop











// shear groove

(
b = Bloom.new.verbose_(true);

b.seed(7).applyScale.wrapTime(1/3);
b.velocities = {30} ! (b.notes.size) ++ 100;
b.velocities = [100, 30, 40, 80, 30, 20];

z = b.loop(\loop);

Task.new{
	loop {
		b.shear;
		3.wait;
	}
}.play;

Task.new{
	loop {
		b.shiftNotes.chooseScale;
		13.wait;
	}
}.play;

)














// Flatten

(
b = Bloom.new.seed.verbose_(true);

t = Task.new{
	loop {
		b.flatten;

		b.play;

		(b.dur + (b.dur * 7/5)).wait;

		if (b.asScale.degrees.size < 3, {
			b.chooseScale.thicken.newShape;
			1.wait;
		});

		if (b.notes.size > 14, {
			b.thin.newShape;
		});

	}
}
)

t.play












// Common Tone / New Scale

(
b = Bloom.new.seed(2).verbose_(true);

t = Task.new{
	loop {

		13.do {
			b.play;
			c = b.deepCopy;
			4.wait;
			c.chooseScale.thicken(4).newShape.play;
			(c.dur * 18/5).wait;
		};

		b.applyScale(c.scale).newNotesSubtleD(0.7); "shift".postln;

	};

}
)

t.play

















// Thickness

(
b = Bloom.new.seed(4).applyScale.verbose_(true).wrapTime([1]).velocities_([120]);
c = Prand([{b.thicken}, {b.thicken}, {b.thicken2}, {b.avgTime}, {b.slantScale}],inf).asStream;

t = Task.new{
	loop {

		b.play;

		b.dur.wait; 3.wait;

		c.next.postln.value; // weirdly, postln makes this work...
	};
}
)

t.play






// pulse triads
(

b = Bloom.new(
	[ 82.0, 75.0, 78.0, 82.0 ],
	[ 84.0, 81.0, 72.0, 47.0 ],
	[ 0.34, 0.28, 0.25, 0.49 ],
	[ 0 ]);

z = b.pulse(4, {b.pivot})
)







// Trans

(
b = Bloom.new.seed.applyScale.verbose_(true);

t = Task.new({
	loop {
		b.play;
		b.dur.wait; 1.wait;
		b.trans.trans;
		if (b.notes.size > 30, {b.trimTo(10)})
}}, Bloom.clock);
)

t.play(quant: Bloom.quant)






b.play



// log blending // truly beautiful !


(
b = Bloom.new.verbose_(true);
c = Bloom.new.verbose_(true);

t = Task.new({
	b.fromLog;
	b.play;  b.dur.wait; 6.wait;
	b.save;

	loop {
		c.fromLog;

		"blending % with %".format(b.name, c.name).postln;
		b.cast(c).play; b.dur.wait; 6.wait;

		"playing %".format(c.name).postln;
		c.play; c.dur.wait; 6.wait;

		b = c.deepCopy;

}}, Bloom.clock);
)












// variation: iterate through log so they're never doubled
(
b = Bloom.new.verbose_(true);
c = Bloom.new.verbose_(true);

t = Task.new({
	var log = b.logAsArray.deepCopy;

	log.do {|bloom, i|
		var nextBloom = log.wrapAt(i+1);

		">>playing %".format(i).postln;
		bloom.play; bloom.dur.wait; 6.wait;

		bloom.save;
		">>blending % with %".format(i, i+1).postln;
		bloom.cast(nextBloom).play; bloom.dur.wait; 6.wait;
		bloom.restore;

}}, Bloom.clock);
)


b.fromLog(0).play
c.fromLog(1).play
c.fromLog(2).play
c.fromLog(3).play

b.cast(c).play
c.cast(b).play

t.play
z = b.logAsArray

//something is not working about cast in this case













// resample - 'curvesExtend'

(
b = Bloom.new.verbose_(true);

t = Task.new({
	loop {
		b.seed.play; b.dur.wait; 4.wait;
		b.curvesExtend(20.rand+10); b.softer; b.play; b.dur.wait; 8.wait;
	}
}, Bloom.clock)

)
t.play

// curvesExtend v2: diatonic
(
b = Bloom.new.verbose_(true);

t = Task.new({
	loop {
		var scale;
		b.seed(low:50, hi:100).play; b.dur.wait; 5.wait;
		b.chooseScale; scale = b.scale;
		b.curvesExtend(20.rand+10).applyScale(scale).softer.softer; b.play; b.dur.wait; 7.wait;
	}
}, Bloom.clock)

)

t.play
t.stop







// push and pop - forking paths

(
(
b = Bloom.new.verbose_(true).quant_(1);
p.down;

b.fromLog;

t = Task.new({
	loop {
		b.playWait; 6.wait;
		b.push;
		4.do {
			b.shift.softer.playWait;
			4.wait;
		};
		b.pop;
	}
}, Bloom.clock)

)

)

t.play
t.stop







// harmonies
(
b = Bloom.new.verbose_(true).quant_(1);
p.down;

b.seed(10).compass(70, 90); // melody

t = Task.new ({
	b.applyScale(Scale.ionian);
	loop {
		b.notes.do {|note|
			note.harmonies(b.appliedScale, [1,3,5,7], b.root).do {|chord| // arpeggiate each 7th chord that contains melody note
				var newNotes = [note] ++ chord.nearestOctaveTo(60);
				Bloom.new(newNotes.sort, 50, 0.6).playWait;
			}
	};}
}, Bloom.clock))

t.play
t.stop




// harmonies + curvesExtend
(
b = Bloom.new.verbose_(true).quant_(1);
p.down;
b.sustain = nil; b.legato = 1;

b.seed(10).compass(65, 80).curvesExtend(30).applyScale(Scale.dorian); // a curvacious line

//r = Routine {loop {b.timeIntervals.do{|time| time.yield}}}; // hand off original timeIntervals one at a time

t = Task.new ({
	b.playWait;
	4.wait;
	loop {
		b.notes.do {|note|
			var chord = note.harmonies(b.appliedScale, [1,3,5,7], b.root).choose.nearestOctaveTo(60);
			var newNotes = [[note, chord[0]]] ++ chord.drop(1).sort;
			Bloom.new(newNotes, [[100,50],50,50,50,50], r.next).sustain_(nil).legato_(1).playWait;
		}
	}
}, Bloom.clock)
)

t.play
t.stop








// efficient motion through random clusters

(
Bloom.defaultQuant_(1);
b = Bloom.new.verbose_(true);
p.down;


t = Task.new ({
	loop
	{
		b.seed(10+15.rand).chords(3).applyScale(Scale.dorian)
		.spaceChords.efficientChordVoicings.playWait;
		1.8.wait;
	}
}, Bloom.clock)
)

t.play
t.stop
b.enforceRange

// why do some chords end up with only 2 notes?
// does removeDoubles work?

b.chords.shiftNotesD
b.play












// harmonies in different keys with efficient motion

(
Bloom.defaultQuant_(1);
b = Bloom.new.verbose_(true).quant_(1);
p.down;
b.sustain = nil; b.legato = 0.5;


t = Task.new ({
	b.seed.chooseScale.playWait;
	4.wait;
	loop {
		var lastChord = b.notes[0].harmonies(b.scale, [1,3,5], b.root).choose.nearestOctaveTo(60);
		b.applyScale; // random scale
		2.do {
			b.notes.do {|note, i|
				var chord = (note.harmonies(b.scale, [1,3,5], b.root).choose.efficientMotionFrom(lastChord));
				var newNotes = ([[note, chord[0]]] ++ chord.drop(1).sort);
				Bloom.new(newNotes, [[100,50],50,50], 1/3).appliedScale_(b.scale).sustain_(nil).legato_(1).playWait;
				lastChord = chord;
			}
		}
	}
}, Bloom.clock)
)

t.play
t.stop


// chordsByInterval


(
Bloom.defaultQuant_(1);
b = Bloom.new.verbose_(true).quant_(1);//.fixedGrid_(8);
p.down;
b.sustain = nil; b.legato = 0.5;


t = Task.new ({
	var scale = Scale.choose;
	loop {
		var scale = Scale.major, i = 1;
		b.root(12.rand);
		3.do {
			i = i+i;
			b.seed(14.rand).applyScale(Scale.major).chordsByInterval(i).scramble.newShape;
			4.wait;
			b.playWait;
			b.addFlat;
		}
	}

}, Bloom.clock)
)

t.play
t.stop

Pcauchy

b.seed(15).applyScale(Scale.major).chordsByInterval(4).scramble.newShape;
b.play

b.notes


b.pulse(8, {b.seed.applyScale(Scale.choose).harmonize([1,3,5])})

// write one that interacts with Manta - keeps a mid-range arpegiation that conforms to your pitches

// manta should keep recent memory of pitches played without explicitly recording