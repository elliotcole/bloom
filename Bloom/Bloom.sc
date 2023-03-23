Bloom {
	classvar <>midiOut, <>midiIn, <>clock,
	<>defaultQuant = 0,
	<>defaultChan = 0,
	<>defaultLegato = 2,
	<>defaultSustain = 4,
	<>defaultTimeRangeLow = 0.1,
	<>defaultTimeRangeHi = 0.5,
	<>defaultLowestPossibleNote = 20,
	<>defaultHighestPossibleNote = 100,
	<>defaultLowestSeedNote = 50,
	<>defaultHighestSeedNote = 100,
	<>maxChan = 0,
	<>defaultFixedGrid = false,
	<>defaultFixedScale = false,
	<>defaultFixedDur = false,
	<>defaultFixedDurMode = \trim;

	var <>notes, <>velocities, <>timeIntervals, <>chans;
	var <>lowestPossibleNote, <>highestPossibleNote;
	var <>lowestSeedNote, <>highestSeedNote;
	var <>timeRangeLow, <>timeRangeHi;
	var <>legato, <>sustain;
	var <>name;
	var <>appliedScale, <>keyRoot = 0;
	var <isRecording;
	var <>fixedScale;
	var <>fixedDur;
	var <>fixedDurMode;
	var <>fixedGrid;
	var <>quant;
	var <>logName = \blooms, <saved, <>stack;
	var <>verbose = true;
	var savedTimeIntervals; // could be replaced with push/pop
	var nest;

	*new {arg notes, vels, times, chans;
		if (clock == nil, {clock = TempoClock.default})
		^super.new.init(notes, vels, times, chans);
	}


	*midiInit{|out = nil, in = nil|
		if (out == nil, {
			MIDIClient.init;
			"MIDI Out: using default".postln;
			out = MIDIOut.newByName("IAC Driver", "Bus 1");
		});

		if (in == nil, {
			"MIDI In: using default".postln;
			in = MIDIClient.sources[0];});

		midiOut = out;
		midiIn = in.uid;
	}

	init {arg n, vel, times, chans;
		if (n.class == Bloom, {this.import(n)},
			{
				n = n ? 60;
				vel = vel ? 60;
				times = times ? 1;
				this.initNotes(n);
				this.initVels(vel);
				this.initTimes(times);
				this.initChans(chans);
				quant = defaultQuant;
				legato = defaultLegato;
				sustain = defaultSustain;
				timeRangeLow = defaultTimeRangeLow;
				timeRangeHi = defaultTimeRangeHi;
				lowestPossibleNote = defaultLowestPossibleNote;
				highestPossibleNote = defaultHighestPossibleNote;
				lowestSeedNote = defaultLowestSeedNote;
				highestSeedNote = defaultHighestSeedNote;
				fixedDur = defaultFixedDur;
				fixedDurMode = defaultFixedDurMode;
				fixedScale = defaultFixedScale;
				fixedGrid = defaultFixedGrid;
				stack = [];
				if (midiOut == nil || midiIn == nil, {Bloom.midiInit});
			}
		)
	}

	initNotes {arg n;
		if (n == nil, {notes = [60]}, {notes = [n].flatten});
	}

	initVels {arg vel;
		if (vel == nil, {velocities = [60]}, {velocities = [vel].flatten});
	}

	initTimes {arg times;
		if (times == nil, {timeIntervals = [1/4]}, {timeIntervals = [times].flatten});
	}

	initChans {arg channels;
		if (chans == nil, {chans = [defaultChan.asInteger]}, {chans = [defaultChan.asInteger].flatten})
	}

	import {arg bloom;
		bloom = bloom.deepCopy; // divorce from source
		notes = bloom.notes;
		timeIntervals = bloom.timeIntervals;
		velocities = bloom.velocities;
		chans = bloom.chans;
		lowestPossibleNote = bloom.lowestPossibleNote;
		highestPossibleNote = bloom.highestPossibleNote;
		lowestSeedNote = bloom.lowestSeedNote; highestSeedNote = bloom.highestSeedNote;
		timeRangeLow = bloom.timeRangeLow; timeRangeHi = bloom.timeRangeHi;
		legato = bloom.legato; sustain = bloom.sustain;
		name = bloom.name;
		appliedScale = bloom.appliedScale; keyRoot = bloom.keyRoot;
		isRecording = bloom.isRecording;
		fixedScale = bloom.fixedScale;
		fixedDur = bloom.fixedDur; fixedDurMode = bloom.fixedDurMode;
		fixedGrid = bloom.fixedGrid;
		quant = bloom.quant;
		logName = bloom.logName; saved = bloom.saved;
		verbose = bloom.verbose;

		// don't migrate stack b/c the .popped bloom already has the right stack
	}


	empty {|passedInMIDI = nil|
		notes = [];
		velocities = [];
		timeIntervals = [];
		chans = [];
	}

	at {|index = 0|
		var ev;
		ev = (type:\midi, midinote: notes.at(index), amp: velocities.wrapAt(index).linlin(0,127,0,1.0),
			dur: timeIntervals.wrapAt(index), chan:chans.wrapAt(index), legato: legato, \midiout: midiOut);
		if (sustain.notNil, ev.add(\sustain -> sustain));
		^ev;
	}

	saveNest {
		nest = notes.deepCopy;
	}

	restoreNest {
		notes = notes.flat.matchNesting(nest);
		velocities = velocities.flat.matchNesting(nest);
		chans = chans.flat.matchNesting(nest);
		this.wrapToNotes;
	}

	log {|index|
		var bloomLog = Archive.global.at(logName);
		if (bloomLog == nil, {Archive.global.put(logName, [])}); // first time users
		bloomLog = Archive.global.at(logName);
		Archive.global.put(logName,
			if (index == nil, {
				index = bloomLog.size;
				"%-%".format(logName, bloomLog.size).asSymbol.postln;
				bloomLog = bloomLog.add(this.deepCopy.name_("%-%".format(logName, index).asSymbol));
			},
			{
				"%-%".format(logName, index).asSymbol.postln;
				bloomLog = bloomLog.put(index, this.deepCopy.name_("%-%".format(logName, index).asSymbol))
			}
			)

		);
		"Retrieve with .fromLog(%)".format(index).postln;
	}

	logAsArray {
		^Archive.global.at(logName).deepCopy;
	}

	fromLog {|index|
		var bloomLog = Archive.global.at(logName);
		var bloom;
		if (index == nil, {
			index = (bloomLog.size-1).rand;
			bloom = bloomLog.choose;
		}, {
			bloom = bloomLog.at(index);
		});
		"logged bloom %".format(index).postln;
		this.import(bloom);
	}

	clearLog {
		Archive.global.put(logName, []);
	}

	save {
		saved = this.deepCopy;
	}

	restore {
		if (saved.class == Bloom, {
			var restored, lastSave;
			"restoring".postln;
			lastSave = saved.deepCopy;
			this.import(saved);
			this.save;
		},{
			"no bloom saved".postln;
		})
	}

	pop {
		if(stack.notNil and: { stack.notEmpty }) { this.import(stack.pop) };
	}

	push { stack = stack.add(this.deepCopy) }

	popAny {
		if(stack.notNil and: { stack.notEmpty }) { this.import(stack.removeAt(stack.at((stack.size-1).rand)))};
	}



	seed {|numNotes, low, hi|
		numNotes = numNotes ? round(exprand(4, 10));
		low = low ? lowestSeedNote; hi = hi ? highestSeedNote;
		notes = dup({round(exprand(low,hi))}, numNotes);
		velocities = dup({round(exprand(30,110))},numNotes).sort.reverse;
		timeIntervals = dup({exprand(timeRangeLow,timeRangeHi).round(0.01)}, numNotes) * clock.tempo;
		chans = [0];
		this.enforceRange;
	}

	random {|numNotes = 0|
		this.seed(numNotes);
	}

	newNotes {
		notes.do({|note, counter|
			notes[counter] = round(exprand(lowestSeedNote,highestSeedNote));
		});
		this.enforceRange;
	}

	newShape {
		velocities = dup({round(exprand(40,100))},notes.size).sort.reverse;
		timeIntervals = dup({exprand(timeRangeLow, timeRangeHi).round(0.01)}, notes.size);
	}


	mutateNotes { |probability = 0.3| /// to do: if there's a scale, adjust diatonically
		var random;
		this.saveNest;
		notes = notes.flat;
		nest.postln;

		notes.do({|note, count|
			random = rand(1.0);
			case { random <= (probability / 2) }
			{
				//count.postln;
				notes[count] = notes[count] - 1 ;
			}
			{ rand(1.0) >= (1.0 - probability) }
			{
				notes[count] = notes[count] + 1;
			};
		});

		this.restoreNest;
		this.enforceRange;
	}

	mutateNotesD { arg probability = 0.3;
		var random, currentScale, degrees, newDegrees;
		this.saveNest;

		notes = notes.flat;

		currentScale = this.scale;
		degrees = notes.keyToDegree(currentScale);

		newDegrees = degrees.collect({|deg|
			if (probability.coin, {

				if ([true,false].choose, {deg + 1}, {deg-1});
			},
			{deg}
			)
		});

		notes = newDegrees.degreeToKey(currentScale);
		this.restoreNest;
		this.enforceRange;
	}

	mutateVelocities {| maxChange = 30 |
		var tempVel = [];

		velocities = velocities.collect {|vel, i|
			var change = (maxChange.rand * ([1,-1]).choose).round;
			(change + vel).wrap(0,127);
		};

	}

	mutateTime {
		var possibilities = [1/4, 1/2, 1, 1, 1, 1.5, 2];

		if (0.5.coin, {timeIntervals = timeIntervals.scramble}, {
			timeIntervals = timeIntervals.collect {| time |
				var newTime = time * (possibilities.choose);
				if (newTime > 0.05, {newTime}, {time});
			};
		})
	}

	mutateShape {| maxChange = 0.2 |
		this.mutateTime;
		this.mutateVelocities;
	}

	mutate {
		this.mutateNotes;
		this.mutateShape;
	}

	mutateD {
		this.mutateNotesD;
		this.mutateShape;
	}

	scramble {
		notes = notes.scramble;
	}

	deepScramble {
		this.saveNest;
		notes = notes.flat.scramble;
		this.restoreNest;
	}

	permute {|nthPermutation|
		notes = notes.permute(nthPermutation);
	}

	shuffle {
		if (notes.size.odd, {this.add(notes[0], velocities[0], timeIntervals[0])});
		notes = notes.perfectShuffle;
		timeIntervals = timeIntervals.perfectShuffle;
		velocities = velocities.perfectShuffle;
		this.wrapToNotes;
	}

	deepShuffle {
		this.saveNest;
		notes = notes.flat.shuffle;
		this.restoreNest;
	}




	//// expanding / contracting


	remove { |index=0|
		notes.removeAt(index);
		if(timeIntervals.at(index).isNil, {}, {timeIntervals.removeAt(index)});
		if(velocities.at(index).isNil, {}, {velocities.removeAt(index)});
		if(chans.at(index).isNil, {}, {chans.removeAt(index)});
	}



	addOne {|noteOrList = nil|
		if (noteOrList == nil, {
			notes = notes.add(rrand(20,100));  // create random entry
			velocities = velocities.add(velocities[velocities.size.rand]);  // use a vel and time from somewhere
			timeIntervals = timeIntervals.add(timeIntervals[timeIntervals.size.rand]);
		});

		if (noteOrList.isKindOf(SimpleNumber),
			{
				notes = notes.add(noteOrList); // add the input number and random attendants
				velocities = velocities.add(velocities.choose);  // use a vel and time from somewhere
				timeIntervals = timeIntervals.add(timeIntervals.choose);
			}
		);

		if (noteOrList.class == Array,
			{
				notes = notes.add(noteOrList[0]);
				velocities = velocities.add(noteOrList[1]);
				timeIntervals = timeIntervals.add(noteOrList[2]);
			}
		)

	}

	addOneInScale {
		var scale, newNote;
		scale = this.asScale;
		if (scale.size < 2, {
			this.addOne
		},
		{
			newNote = round(exprand(lowestPossibleNote,highestPossibleNote));
			newNote = newNote.nearestInScale(scale);
			this.addOne(newNote);
		})
	}

	dropLast {
		this.remove(this.notes.size - 1);
	}

	drawCurves{|newSize = 10|
		notes = notes.resamp1(newSize).round;
		timeIntervals = timeIntervals.resamp1(newSize).round(0.001);
		velocities = velocities.resamp1(newSize).round;
		chans = chans.wrapExtend(newSize);
	}

	drawCurvesD{|newSize = 10|
		var scale;
		scale = this.scale;
		notes = notes.resamp1(newSize).round;
		timeIntervals = timeIntervals.resamp1(newSize).round(0.001);
		velocities = velocities.resamp1(newSize).round;
		chans = chans.wrapExtend(newSize);

		this.applyScale(scale);
	}

	curvesDownward {
		// leaves upward motion as leaps, fills in downward leaps
	}

	thicken {|percentNew = 0.5|  // very slow with long blooms -- the applyScale?
		var thickener = Bloom.new.seed(this.notes.size * percentNew);
		var scale;
		if (appliedScale.notNil, {scale = appliedScale}, {scale = this.asScale});
		//scale.postln;
		thickener.applyScale(scale);
		//this.wrapToNotes;
		this.blend(thickener);
		this.enforceRange;
	}

	thickenLengthen {|percentNew = 0.5|
		var thickener = Bloom.new.seed(this.notes.size * percentNew);
		var scale;
		if (appliedScale.notNil, {scale = appliedScale}, {scale = this.asScale});
		thickener.applyScale(scale);
		//this.wrapToNotes;
		this.interlace(thickener);
		this.enforceRange;
	}


	thin { |probability = 0.3| // problematic - somehow we get the same number of notes out, with some wrapped around
		var tempNotes, tempVel, tempTime, tempLastItem, tempChan;
		this.saveNest;

		notes = notes.flat;
		tempLastItem = -1;
		tempNotes = [];
		tempVel = [];
		tempTime = [];
		tempChan = [];
		notes.do({|note, count|
			if ( (rand(1.0) > probability),
				{
					tempNotes = tempNotes.add(notes[count]);
					tempVel = tempVel.add(velocities.wrapAt(count));
					tempTime = tempTime.add(timeIntervals.wrapAt(count));
					tempChan = tempChan.add(chans.wrapAt(count));
					tempLastItem = tempLastItem + 1;
				},
				{
					// if we do cut out a note, make up for its time
					if(tempLastItem >= 0, {tempTime[tempLastItem] = tempTime[tempLastItem] + timeIntervals[count]});
				}
			)
		});

		if( tempNotes.size > 1,
			{
				notes = tempNotes.asArray;
				velocities = tempVel.asArray;
				timeIntervals = tempTime.asArray;
				chans = tempChan;
			},
			{"can't thin to fewer than 2".postln}
		);

		this.restoreNest;
		this.trimTo(tempNotes.size);


	}

	thinShorten {|probability = 0.3|
		var newNotes = [], newVels = [], newTimes = [], newChans = [];
		notes.do {|note, i|
			if (coin(probability),
				{},
				{
					newNotes = newNotes.add(note); newVels = newVels.add(velocities.wrapAt(i));
					newTimes = newTimes.add(timeIntervals.wrapAt(i)); newChans = newChans.add(chans.wrapAt(i));
				}
			)
		};
		notes = newNotes; velocities = newVels; timeIntervals = newTimes; chans = newChans;
	}


	gap {|probability = 0.3|
		velocities.do {|vel, i|
			if (coin(probability),
				{ velocities[i] = 0 },
				{  }
			)
		}
	}

	unGap {|probability = 0.3|
		velocities.do {|vel, i|
			if (vel == 0,
				{velocities[i] = velocities.reject({|x| x == 0}).mean.round(0.01)}
			)
		}
	}

	removeDoubles {
		var numberOfItems, newNotes, doubles;
		doubles = notes.indexOfDoubles;
		doubles.do {|double|
			var iToKeep = double[0], iToReject = double[1];
			notes[iToReject] = nil;
			timeIntervals[iToReject] = nil;
			velocities[iToReject] = nil;
			chans[iToReject] = nil;
		};
		notes = notes.reject{| item | item == nil};
		timeIntervals = timeIntervals.reject{| item | item == nil};
		velocities = velocities.reject{| item | item == nil};
		chans = chans.reject{| item | item == nil};
	}

	/*
	var doubles = this.indexOfDoubles;
	var array = this.copy;
	doubles.do {|set|
	set.do {|indexOfDouble, i|
	if (i>0, {
	array[indexOfDouble] = nil;
	})
	}
	};
	^array.reject{|item| item.isNil}
	*/

	moveDoublesUpOctave {
		this.saveNest;
		notes = notes.flat.moveDoublesUpOctave;
		this.restoreNest;
	}

	trimTo {|length|
		if (length == nil, {length = notes.size});
		notes = notes.keep(length);
		timeIntervals = timeIntervals.keep(length);
		velocities = velocities.keep(length);
		chans = chans.keep(length);
	}

	trimToDur {|dur = 4|
		var total = 0, n = 0, excess;
		if (dur.isNil, {}, {
			if (dur <= timeIntervals.sum, {
				while ({total < dur}, {
					total = timeIntervals.at(n) + total;
					n = n + 1;
				});
				timeIntervals = timeIntervals.keep(n);
				excess = timeIntervals.sum - dur;
				timeIntervals[n-1] = timeIntervals[n-1] - excess;
				notes = notes.keep(timeIntervals.size);
				velocities = velocities.keep(timeIntervals.size);
				chans = chans.keep(timeIntervals.size);
			}, { // if target dur is greater than current dur, simply extend last note
				var excess = dur - timeIntervals.sum;
				timeIntervals[timeIntervals.size-1] = timeIntervals[timeIntervals.size-1] + excess;
			});
		})
	}

	scaleToDur{|dur = 4|
		timeIntervals = timeIntervals.normalizeSum * dur
	}



	// ROTATIONS

	rotate {|n = 1|
		notes = notes.rotate(n);
		//velocities = velocities.rotate(n); // preserve bloom shape
		timeIntervals = timeIntervals.rotate(n);
	}

	rotateNotes {|n = 1|
		notes = notes.rotate(n);
	}

	rotateVelocities {|n = 1|
		velocities = velocities.rotate(n);
	}

	rotateTime {|n = 1|
		timeIntervals = timeIntervals.rotate(n);
	}

	rotateChans {|n = 1|
		chans = chans.rotate(n);
	}


	// SHAPING




	// shaping

	slower {|multiplier=1.2|
		timeIntervals.do({|note, count|
			timeIntervals[count] = (timeIntervals[count]*multiplier).round(0.01)}
		);
	}

	faster {|multiplier=1.2|
		timeIntervals.do({|note, count| timeIntervals[count] = (timeIntervals[count]*(multiplier.reciprocal)).round(0.01)});
	}

	louder {|multiplier=1.2|
		velocities.do({|v, count|
			velocities[count] = min(127, (multiplier * v).round(0.01)) ;
		});
	}

	softer {|multiplier=1.2|
		velocities.do({|v, count|
			velocities[count] = max(20, ((multiplier.reciprocal) * v).round(0.01)) ;
		})
	}

	fan {
		timeIntervals = timeIntervals.sort;
	}

	avgTime {
		var avg;
		avg = 0;
		timeIntervals.do({|time|
			avg = avg + time;
		});
		avg = avg/(timeIntervals.size);
		timeIntervals.do({|time, iter|
			timeIntervals[iter] = avg;
		});

	}

	addComma{|dur=1|
		var lastIndex = timeIntervals.size - 1;
		timeIntervals[lastIndex] = timeIntervals[lastIndex] + dur;
	}


	trimLastTime {
		var quantLength, diff;
		timeIntervals.pop;
		quantLength = timeIntervals.sum;
		quantLength = quantLength.snap(1,1,1);
		diff = quantLength - timeIntervals.sum;
		if (diff <= 0, {diff = diff + 1});
		timeIntervals.add(diff);

	}

	decrescendo {
		velocities = velocities.sort.reverse;
	}

	crescendo {
		velocities = velocities.sort;
	}

	// CHANNELS

	addChan {chans = chans.add((maxChan + 1).rand);}
	dropChan {if (chans.size > 1, {chans = chans.drop(-1)});}
	randChans {chans = chans.collect{(maxChan+1).rand};}
	sortChans {chans = chans.sort;}
	cycleChans {chans = chans.collect{|chan| (chan+1).wrap(0, maxChan)};}


	// FISSION

	curdle {|probability = 0.2|
		var cNotes, cVel, cTime, bloomset;
		var aVelClump, aTimeClump, ret;
		cNotes = []; cVel = []; cTime = [];

		cNotes = notes.curdle(probability);
		cNotes.do({|lump|
			aVelClump = lump.collect({|each|
				velocities[notes.indexOf(each)];
			});
			aTimeClump = lump.collect({|each|
				timeIntervals[notes.indexOf(each)]
			});
			cVel = cVel.add(aVelClump);
			cTime = cTime.add(aTimeClump);
		});
		ret = cNotes.collect({|x, i|
			Bloom.new.seed.empty.add(x, cVel[i], cTime[i]);
		});
		^ret;
	}

	split {|splitAt = nil|
		var newBloom = Bloom.new.empty, ret;
		var newN = [], newV = [], newT = [], newC = [];

		this.wrapToNotes; // make all lists the same length

		if (splitAt == nil, {splitAt = notes.size.rand});
		newN = notes.clumps([splitAt, notes.size - splitAt]);
		newV = velocities.clumps([splitAt, notes.size - splitAt]);
		newT = timeIntervals.clumps([splitAt, notes.size - splitAt]);
		newC = chans.clumps([splitAt, notes.size - splitAt]);

		ret = newN.collect({|x, i|
			Bloom.new(x, newV[i], newT[i], newC[i]);
		});

		^ret;

	}

	//// FUSION


	add {|newNotesOrBloom = 60, newVels = 60, newTimes = 0.25, newChans = 0|
		if (newNotesOrBloom.class == Bloom, {
			newTimes = newNotesOrBloom.timeIntervals;
			newVels = newNotesOrBloom.velocities;
			newChans = newNotesOrBloom.chans;
			newNotesOrBloom = newNotesOrBloom.notes;
		});
		notes = notes ++ newNotesOrBloom;
		velocities = velocities ++ newVels;
		timeIntervals = timeIntervals ++ newTimes;
		chans = chans ++ newChans;
	}

	++ { arg aBloom;
		var newBloom = this.deepCopy;
		newBloom.add(aBloom)
		^newBloom;
	}

	fromListOfBlooms {|list|
		list = list.select{|item| item.isKindOf(Bloom)};
		notes = []; timeIntervals = []; velocities = []; chans = [];
		notes = list.collect{|bloom| bloom.notes}.flat;
		timeIntervals = list.collect{|bloom| bloom.timeIntervals}.flat;
		velocities = list.collect{|bloom| bloom.velocities}.flat;
		chans = list.collect{|bloom| bloom.chans}.flat;
	}

	blend { |bloom|  // doesn't quite do timeIntervals correctly -- last time is empty (till the wrap)
		var newTime;
		newTime = [];
		if ((bloom.class == Bloom), {

			bloom.softer;				// new notes softer

			notes = [notes, bloom.notes].lace((notes.size).max(bloom.notes.size) * 2 - 1);
			velocities = [velocities, bloom.velocities].lace(notes.size);
			timeIntervals = [timeIntervals, bloom.timeIntervals].lace(notes.size);

			timeIntervals.pairsDo({|orig, new|

				newTime = newTime.add(orig - new);
				newTime = newTime.add(new);

			});

			// no negative timeIntervals:

			timeIntervals = newTime.abs;

			this.wrapToNotes;
		}, {"can only blend a bloom with a bloom".postln});
	}

	interlace { |bloom|

		if ((bloom.class == Bloom), {

			bloom.softer.softer;				// new notes softer

			notes = [notes, bloom.notes].lace(notes.size.max(bloom.notes.size) * 2 - 1);
			velocities = [velocities, bloom.velocities].lace(notes.size);
			timeIntervals = [timeIntervals, bloom.timeIntervals].lace(notes.size);
			chans = [chans, bloom.chans].lace(notes.size)

			// no negative timeIntervals:
		});
	}

	cast {|bloom|
		var newNotes;
		var bloomScale = this.asScale;

		if (bloom.class == Bloom, {

			newNotes = bloom.notes.collect {|note, i|
				var pc = notes.flat.wrapAt(i) % 12;
				var allOctaves = Array.fill(13, {|j| pc + (12*j)});
				var newNote = note.nearestInList(allOctaves);
				newNote;
			};

			notes = newNotes;
			timeIntervals = bloom.timeIntervals;
			velocities = bloom.velocities;

		},
		{"source not a bloom".postln;})

	}


	// Patterning

	stutter {|repetitions = 2|
		notes = notes.stutter(repetitions);
		velocities = velocities.stutter(repetitions);
		timeIntervals = timeIntervals.stutter(repetitions);
		chans = chans.stutter(repetitions);
	}

	sputter {arg probability = 0.3;
		var sputterPlan = Array.fill(notes.size, {|i| i}).sputter(probability);
		var newNotes, newTimes, newVels, newChans;
		newNotes = sputterPlan.collect{|i|
			notes.wrapAt(i);
		};
		newTimes = sputterPlan.collect{|i|
			timeIntervals.wrapAt(i);
		};
		newVels = sputterPlan.collect{|i|
			velocities.wrapAt(i);
		};
		newChans = sputterPlan.collect{|i|
			chans.wrapAt(i);
		};
		notes = newNotes; timeIntervals = newTimes; velocities = newVels; chans = newChans;
	}

	spray {|probability = 0.25|
		notes = notes.sputter(probability);
		velocities = velocities.sputter(probability);
		timeIntervals = timeIntervals.sputter(probability);
		this.wrapToNotes;
	}

	ratchet {|repetitions, index|
		var ratchetedEvent;
		index = index ? timeIntervals.indexOf(timeIntervals.sort.reverse.keep(1).choose);
		// split one of the two greatest durations // not quite working right
		repetitions = repetitions ? ([2,3].choose);
		ratchetedEvent = [
			notes.wrapAt(index), velocities.wrapAt(index),
			timeIntervals.wrapAt(index), chans.wrapAt(index)];
		this.remove(index);
		"removing item %".format(index).postln;
		this.report;
		repetitions.do({
			if (ratchetedEvent[2] > 0, {
				notes = notes.insert(index,ratchetedEvent[0]);
				velocities = velocities.insert(index,ratchetedEvent[1]);
				timeIntervals = timeIntervals.insert(index,ratchetedEvent[2] / repetitions);
				chans = chans.insert(index,ratchetedEvent[3]);
				"inserting % in space %".format(ratchetedEvent, index).postln;
			})
		});
	}

	mirror {
		notes = notes.mirror;
		velocities = velocities.mirror;
		timeIntervals = timeIntervals.mirror;
		chans = chans.mirror
	}


	pyramid {|patternType = 1|
		notes = notes.pyramid(patternType);
		timeIntervals = timeIntervals.pyramid(patternType);
		velocities = velocities.pyramid(patternType);
	}

	slide {|windowLength = 3|
		if (notes.size < windowLength, {notes.wrapExtend(windowLength)});
		if (timeIntervals.size < windowLength, {timeIntervals.wrapExtend(notes.size)});
		if (velocities.size < windowLength, {velocities.wrapExtend(notes.size)});
		notes = notes.slide(windowLength);
		timeIntervals = timeIntervals.slide(windowLength);
		velocities = velocities.slide(windowLength);
	}

	braid {|windowLength = 3|
		this.slide(windowLength);
	}

	quantize {|grid = 4, margin = 0, strength = 1.0|
		if (grid.isKindOf(Collection), {grid = grid[0].lcm(grid[1])});
		timeIntervals = timeIntervals.collect{|time|
			time.softRound(grid.reciprocal, margin, strength)
		}
	}

	wrapTime{|list|
		if (list == nil, {list = timeIntervals});
		list = [list].flat;
		timeIntervals = notes.collect{|x, i| list.wrapAt(i)}
	}


	wrapVel{|list|
		if (list == nil, {list = velocities});
		list = [list].flat;
		velocities = notes.collect{|x, i| list.wrapAt(i)}
	}


	wrapChan{|list|
		if (list == nil, {list = chans});
		list = [list].flat;
		chans = notes.collect{|x, i| list.wrapAt(i)}
	}

	applyShape{|bloom|
		timeIntervals = bloom.timeIntervals;
		velocities = bloom.velocities;
		chans = bloom.chans;
	}













	// PITCH


	compass {| lo = 60, hi = 90 |
		this.saveNest;
		if (hi-lo < 12, {hi = lo+12});

		notes = notes.flat;
		notes = notes.collect {|note|
			case {note < lo}
			{
				var newNote;
				newNote = note.justAbove(lo);
				//"note % less than % becomes %".format(note, lo, note.justAbove(lo)).postln;
			}
			{note > hi}
			{
				var newNote;
				newNote = note.justBelow(hi);
				//"note % more than % becomes %".format(note, hi, note.justBelow(hi)).postln;
			}
			{note >= lo && note <= hi} {note};
		};
		this.restoreNest;
	}



	compress {
		var lowestNote;
		this.saveNest;
		notes = notes.flat;
		lowestNote = notes[notes.minIndex];
		notes.do({|each, counter|
			while ({each >= (lowestNote + 12)}, {each = each - 12;
				//counter.postln;
				notes[counter] = each;
			});
		});
		this.restoreNest;
	}

	shear {		// randomizes octave of all notes except lowest.  lowest stays lowest
		var change, lowestIndex, lowestNote, newNote;
		this.saveNest;

		notes = notes.flat;
		lowestIndex = notes.minIndex;
		lowestNote = notes[lowestIndex];

		(notes.size - 1).do({ arg iter;			// subtract 1 so iter = list index

			if ((iter != lowestIndex), {	// don't change lowest note
				change = rrand(-2,2)*12;		// one octaves up or down
				newNote = notes[iter]+change;
				while ({newNote < lowestNote}, {newNote = newNote + 12});
				notes[iter] = newNote;
			},
			{})	// if it IS the lowest note, do nothing
		});

		this.compass(lowestPossibleNote, highestPossibleNote);

		this.restoreNest;
	}


	invertMean {
		var scale = appliedScale;
		this.saveNest;
		notes = notes.flat.invertMean;
		appliedScale = nil;
		this.restoreNest;
		appliedScale = this.asScale;
	}

	invert { |n = 1|
		this.saveNest;
		notes = notes.flat.invertChord(n);
		this.enforceRange;
		this.restoreNest;
	} // maybe make inverts that iterate over chords?  you'd have to figure out what to do with singletons.  maybe they're their own set?

	transpose { |semitones = 0|
		notes = notes + semitones;
		//if (appliedScale.notNil, {appliedScale = appliedScale.transpose(semitones)});
		this.appliedScale = nil;
		this.enforceRange;
	}

	dTranspose { |steps = 0|
		var degrees, scale;
		if (appliedScale == nil, {scale = this.asScale}, {scale = appliedScale});
		degrees = notes.collect{arg note; note.keyToDegree(scale, scale.stepsPerOctave)};
		degrees = degrees + steps;
		notes = degrees.collect{arg degree; degree.degreeToKey(scale, scale.stepsPerOctave)};
		this.enforceRange;
	}

	resolve {|percentToResolve = 0.2|
		var numberToResolve = notes.size * percentToResolve;
		this.saveNest;
		notes = notes.flat;
		numberToResolve.do({
			var int;
			int = this.intervals;
			block{|break|
				int.do({|intset|		// each intset will be [interval [indexOfNote1,iof2]]
					var hilo, hi, lo;
					hilo = [notes[intset[1][0]], notes[intset[1][1]]].sort({ arg a, b; a > b });
					hi = hilo[0];
					lo = hilo[1];

					hi = notes.indexOfEqual(hi);
					lo = notes.indexOfEqual(lo);

					//"high: % / low: %".format(hi, lo).postln;

					case		//resolution priority
					{intset[0] == 11} {notes[hi] = notes[hi] - 1; "M7 > M6 between % and %".format(hi,lo).postln; break.value(0)}
					{intset[0] == 5} {notes[hi] = notes[hi] - 1; "4 > M3 between % and %".format(hi,lo).postln; break.value(0)}
					{intset[0] == 6} {notes[hi] = notes[hi] + 1; notes[lo] = notes[lo] - 1;
						"tt out between % and %".format(hi,lo).postln; break.value(0)}
					{intset[0] == 10} {notes[hi] = notes[hi] - 1; "m7 > M6 between % and %".format(hi,lo).postln; break.value(0)}

					{intset[0] == 2} {notes[lo] = notes[lo] - 1; "M2 > m3 between % and %".format(hi,lo).postln; break.value(0)}
					{intset[0] == 1} {notes[hi] = notes[hi] - 1; "m2 > U between % and %".format(hi,lo).postln; break.value(0)}
					{intset[0] == 8} {notes[hi] = notes[hi] - 1; "m6 > 5 between % and %".format(hi,lo).postln; break.value(0)}
				});
			}
		});
		this.restoreNest;
	}

	generateDmitriSet {
		var allTranspositionsAlongIntrinsicAndDiatonicScales = [];
		appliedScale = appliedScale ?? {this.chooseScale};

		allTranspositionsAlongIntrinsicAndDiatonicScales = notes.size.collect {|i|
			appliedScale.size.collect {|j|
				var variant;
				variant = this.deepCopy.invert(i).dTranspose(j);
				variant.report;
			}
		};

		^allTranspositionsAlongIntrinsicAndDiatonicScales.flat
	}


	pivot {|i=1|
		var newBloom, diff;
		this.saveNest;
		notes = notes.flat;

		i.do({
			newBloom = this.deepCopy;
			newBloom.invert;});
		diff = newBloom.notes[newBloom.highestNote] - notes[this.highestNote];
		newBloom.notes = newBloom.notes - diff;
		notes = newBloom.notes;
		this.enforceRange;
		this.restoreNest;
		appliedScale = this.asScale;
	}

	pivotBass {|i=1|
		var newBloom, diff;
		this.saveNest;
		notes = notes.flat;

		i.do({
			newBloom = this.deepCopy;
			newBloom.invert;});
		diff = newBloom.notes[newBloom.lowestNote] - notes[this.lowestNote];
		newBloom.notes = newBloom.notes - diff;
		notes = newBloom.notes;
		this.enforceRange;
		this.restoreNest;
		appliedScale = this.asScale;
	}

	pivotLoudest {|i=1|
		var newBloom, diff;
		this.saveNest;
		notes = notes.flat;

		i.do({
			newBloom = this.deepCopy;
			newBloom.invert;});
		diff = newBloom.notes[newBloom.loudestNote] - notes[this.loudestNote];
		newBloom.notes = newBloom.notes - diff;
		notes = newBloom.notes;
		this.enforceRange;
		this.restoreNest;
		appliedScale = this.asScale;
	}

	negHarmony {|root|
		if (root.isNil, {root = keyRoot});
		notes = notes.negHarmony(root);
		appliedScale = this.asScale;
	}

	flatten {|howManyToFlatten = 1|
		var currentScale = this.asScale;
		var scaleChange = ((-1 ! howManyToFlatten) ++ (0 ! 7)).keep(currentScale.degrees.size).scramble;
		var newDegrees, newScale;

		newDegrees = ((currentScale.degrees + scaleChange) % 12).sort;

		newScale = Scale.new(newDegrees, currentScale.pitchesPerOctave, currentScale.tuning, "Flattened");

		newScale.postln;
		"flatten: % - %".format(currentScale.degrees, scaleChange).postln;
		this.applyScale(newScale);
	}





	// DIATONICISM

	applyScale {|input, root|
		var newScale, rootZeroDegrees, rootShiftedDegrees;
		this.saveNest;
		input ?? {newScale = Scale.choose};
		if (input.class == Bloom, {newScale = input.asScale}); // test!
		if ((input.class == List) || (input.class == Array), {newScale = Scale.new(input)});
		if (input.class == Scale, {newScale = input});
		if (root.class == String, {root = root.spellToPC});
		notes = notes.flat;
		rootZeroDegrees = ((newScale.degrees - keyRoot) % 12).sort; // with prior keyRoot
		if (root.isNil, {}, {keyRoot = root});
		if (verbose,
			{
				//"applying scale % [%] with root: %".format(rootZeroDegrees.spell, newScale.name, keyRoot).postln
			}
		);
		rootShiftedDegrees = ((rootZeroDegrees + keyRoot) % 12).sort;
		appliedScale = Scale.new(rootShiftedDegrees, newScale.pitchesPerOctave, newScale.tuning, newScale.name);
		notes = notes.nearestInScaleUnique(rootShiftedDegrees);
		this.restoreNest;
	}

	chooseScale {
		var nearestScales = Scale.mostSimilarTo(this.asScale);
		var newScale = nearestScales.choose;
		this.applyScale(newScale);
		newScale.name.postln;
		//^newScale;
	}

	slantScale {
		var scale, slantScales, newScale;
		scale = this.scale;
		slantScales = Scale.slantMatch(scale);
		newScale = slantScales.choose;
		this.applyScale(newScale);
		newScale.name.postln;
	}

	root {|root|
		if (root.isNil, {^keyRoot}, {
			if (root.class == String, {root = root.spellToPC});
			if (appliedScale.isNil, {this.applyScale(this.asScale, root % 12)}, {this.applyScale(appliedScale, root % 12)})
		})
	}

	addSharp {
		this.root(keyRoot + 7);
	}

	addFlat {
		this.root(keyRoot - 7);
	}

	scale {
		var scale;
		if (appliedScale == nil, {^this.asScale}, {^appliedScale});
	}

	reduceScale {
		var newScale, newName;
		newScale = this.asScale.degrees;
		newScale.removeAt(newScale.size.rand);
		if (appliedScale.notNil, {newName = "Reduced" + appliedScale.name}, "Reduced");
		this.applyScale(Scale.new(newScale, name:newName));
	}





	// CHORDS

	saveTimeIntervals {
		savedTimeIntervals = timeIntervals;
	}

	restoreTimeIntervals {
		if (savedTimeIntervals.isNil, {}, {timeIntervals = savedTimeIntervals})
	}

	chord {
		this.saveTimeIntervals;
		notes = [notes];
		timeIntervals = timeIntervals.matchNesting(notes);
		timeIntervals = timeIntervals.collect {|item|
			if (item.class == Array, {item.sum}, {item})
		};
		velocities = velocities.matchNesting(notes);
	}

	chords {|notesPerChord=3|
		this.saveTimeIntervals;
		this.flattenChords;
		notes = notes.clump(notesPerChord).flatBelow(1);
		timeIntervals = timeIntervals.matchNesting(notes);
		timeIntervals = timeIntervals.collect {|item|
			if (item.class == Array, {item.sum}, {item})
		};
		velocities = velocities.matchNesting(notes);
		this.wrapToNotes;
	}


	chordsShorten {|notesPerChord=3|
		this.saveTimeIntervals;
		this.flattenChords;
		notes = notes.clump(notesPerChord).flatBelow(1);
		velocities = velocities.matchNesting(notes);
		this.wrapToNotes;
	}

	chordsRand {|probability=0.3333|
		this.saveTimeIntervals;
		this.flattenChords;
		notes = notes.curdle(probability).flatBelow(1);
		timeIntervals = timeIntervals.matchNesting(notes);
		timeIntervals = timeIntervals.collect {|item|
			if (item.class == Array, {item.sum}, {item})
		};
		velocities = velocities.copyRange(0, notes.size);
		this.wrapToNotes;
	}

	chordsRandShorten {|probability=0.3333|
		this.flattenChords;
		notes = notes.curdle(probability).flatBelow(1);
		this.wrapToNotes;
	}



	chordsByInterval {|interval = 3|
		// works except repeated applications makes the list longer somehow
		var chords = [], scaleSize;
		var savedPCorder = this.notes.extractPCOrder;
		this.saveTimeIntervals;
		if (appliedScale.notNil, {
			notes = notes.keyToDegree(appliedScale);
			interval = interval - 1; //a diatonic third is actually +2 steps
		});
		scaleSize = if (appliedScale.isNil, {12}, {appliedScale.degrees.size});
		notes = notes.flat.sort;
		notes.do {|startingNote|
			var chord = [startingNote], i=1;

			while {(notes % scaleSize).includes((startingNote + (interval*i)) % scaleSize)} {
				var pcToFind = (startingNote + (interval*i)) % scaleSize;
				//var foundNote = notes.select{|item| (((item % scaleSize) == pcToFind) && (item > startingNote))}.first; // only notes above
				var foundNote = notes.select{|item| (((item % scaleSize) == pcToFind))}.first;
				// remove only one at a time to build up multiple chords when there are doubled notes

				if (appliedScale.isNil, {
					("% found a % ".format(startingNote.spellOctave, pcToFind.spell) ++
						":%".format(foundNote)).postln; // nil means the pitch class was found, but it isn't above
				}, {
					("% (scale degree %) found a %:".format(
						startingNote.degreeToKey(appliedScale).spellOctave, startingNote, pcToFind.degreeToKey(appliedScale).spell, pcToFind) ++
					": %".format(foundNote.degreeToKey(appliedScale))).postln;
				});

				if (foundNote.notNil, {
					notes.remove(foundNote);
					chord = chord.add(foundNote);
				});
				i = i+1;
			};

			chords = chords.add(chord);
		};
		notes = chords.flattenSingletons;
		notes.postln;
		this.saveNest;
		notes = notes.flat;
		if (appliedScale.notNil, {notes = notes.degreeToKey(appliedScale)});
		//notes.restorePCOrder(savedPCorder);
		this.restoreNest;
		this.wrapToNotes;
	}

	harmonize {|chordTones, probability=1|
		var harmonies;
		this.flattenChords;
		chordTones = chordTones ? [1,3,5];
		harmonies = notes.collect {|note| note.harmonies(this.scale, chordTones, this.root)
			.reject {|chord| chord.sort.differentiate.drop(1).sum == (chord.size-1 * 3)
				// reject diminished triads ^ ?

			}.choose // pick any
		};

		notes = notes.collect {|note, i|
			if (probability.coin, {
				harmonies[i]
			}, {
				note
			})
		}
	}



	harmonizeEfficiently {|chordTones|
		var harmonies;
		this.flattenChords;
		chordTones = chordTones ? [1,3,5];
		harmonies = notes.melodyToEfficientProgression(this.scale, chordTones, this.root);
		notes = notes.collect {|note, i|
			[note] ++ harmonies[i]
		}
	}


	flattenChords {
		notes = notes.flat;
		velocities = velocities.flat;
		chans = chans.flat;
		this.restoreTimeIntervals;
		this.wrapToNotes;
	}

	extractChords {
		var chords = [];
		notes.do {|item|
			if (item.size > 1, {chords = chords.add(item)})
		};
		^chords
	}

	replaceChords {|chords|
		// takes a list of chords (from extractChords) and attempts
		chords = chords.reverse;
		notes.do {|item, i|
			if (item.size > 1, {notes[i] = chords.pop});
		}
	}

	pivotChords {
		var chords = this.extractChords;
		var chordsAsBlooms = Array.fill(chords.size, {|i| Bloom.new(chords[i])});
		var newChords = chordsAsBlooms.collect {|bloom| bloom.pivot.notes};
		this.replaceChords(newChords);
	}


	spaceChords {
		var chords = this.extractChords;
		chords = chords.collect {|chord| chord.spacedVoicing};
		this.replaceChords(chords);
	}

	efficientChordVoicings {
		var chords = this.extractChords;
		var newChords = [];
		chords = chords.do {|chord, i|
			if (i == 0, {newChords = newChords.add(chord)}, {
				//"adjusting chord % to smoothly come from %".format(i, i-1).postln;
				newChords = newChords.add(chord.efficientMotionFrom(newChords.last)); // down?
			})
		};
		//newChords.postln;
		this.replaceChords(newChords);
		//this.enforceRange; // creates a problem somehow
	}





	// playing



	play {arg channels = chans, trace = false;
		var theseNotes, theseVel, theseTimes, pbind;

		this.resolveFixed;

		pbind = Pbind(
			\type, \midi,
			\chan, Pseq([chans].flat, inf),
			\midiout, midiOut,
			\midinote, Pseq([notes].flatten),
			\dur, Pseq([timeIntervals].flat, inf),
			\amp, Pseq([velocities].flatten.linlin(0,127,0,1), inf),
			\isRest, Pfunc({|ev| ev.amp}),
			\legato, legato
		);

		if (sustain.notNil, {
			pbind = Pbindf(pbind, \sustain, sustain)}, {
			pbind = Pbindf(pbind, \legato, legato)
		});

		this.checkScale;

		if (trace,
			{pbind.trace.play(clock, quant: quant)},
			{pbind.play(clock, quant: quant)}
		);

		if (verbose, {this.report});
	}

	playWait {|trace = false|
		this.play(trace:trace);
		^this.dur.wait;
	}


	synthPlay {|length = 10.0, synth|
		// rewrite with Event ?
	}

	setLegato {|value = 1|
		sustain = nil;
		legato = value;
		^this;
	}

	setSustain {|value = 1|
		legato = nil;
		sustain = value;
		^this;
	}

	asPbind{ |name, channel|
		var pbind, durs;

		if (name == nil, {name = 1000.rand.asSymbol});
		if (channel == nil, {channel = defaultChan});

		//"Pbind name %.  Created Pdefns: %_bloom / %_dur / %_vel / %_durScale / %_chan / %_i".format(
		//name, name, name, name, name, name, name, name).postln;

		pbind = Pbind(
			\type, \midi,
			\bloom, Pdefn((name++"_bloom").asSymbol, Pfunc{this}),
			\midiout, midiOut,
			\i, Pdefn((name++"_i").asSymbol, Pseries(0,1)), // which note to play
			\midinote, Pdefn((name++"_midinote").asSymbol,
				Pfunc({|ev| ev.bloom.notes.wrapAt(ev.i)}), Prout
			),
			\durScale, Pdefn((name++"_durScale").asSymbol, 1),
			\dur, Pdefn((name++"_dur").asSymbol, p {loop {[timeIntervals].flat.do{|time| (time.yield)}}}) * Pkey(\durScale);,
			\amp, Pdefn((name++"_vel").asSymbol, p { loop {[velocities].flat.do{|amp| amp.linlin(0,127,0,1.0).yield}}}),
			\legato, Pfunc{this.legato},
			\chan, Pdefn((name++"_chan").asSymbol, p { loop {[chans].flat.do{|chan| chan.yield}}}),
		);

		if (sustain.notNil, {pbind = Pbindf(pbind, \sustain, sustain)});

		^pbind
	}

	asPdef{ |name|
		if (name == nil, {
			"you must provide a name for the Pdef".postln;
		}, {
			^Pdef(name, this.asPbind(name))
		}
		)
	}

	loop { |name|
		^this.asPdef(name).play(clock, quant:quant)
	}

	pulse {|dur = 8, action|
		^BloomPulsar.new(this, dur,clock,quant, action);
	}


	// recording and importing


	record {|metronome = false|
		var livebloomrecorder, responder, click;

		if (metronome.class == Symbol, {
			if (metronome == true, {metronome = \default});
			~metronome = Task.new({
				loop {
					click = Synth(metronome);
					"click".postln;
					1.wait;
				}
			}).play
		});

		isRecording = true;

		livebloomrecorder = Task({
			var now, last;
			this.empty;
			"getting midi from source %".format(midiIn);
			"recording".postln;

			last = thisThread.seconds;

			MIDIdef.noteOn(\bloomListener, { |vel, num, chan, src|
				now = thisThread.seconds;
				notes = notes.add(num);
				velocities = velocities.add(vel);
				chans = chans.add(chan);
				timeIntervals = timeIntervals.add(
					max((now - last), 0.005).postln;
				);
				last = now;
				this.report;
			},srcID: midiIn.uid)
		}).play;
	}

	rstop {
		var last;
		this.rotateTime(-1);
		isRecording = false;
		if (timeIntervals.size > 0, {
			last = timeIntervals.pop;
			timeIntervals.add(last.round(1/8)); // ti = ti?
		});
		this.report;
		"recording stopped".postln;
		MIDIdef(\bloomListener).free;
		if (~metronome.isKindOf(Task), {~metronome.stop})
	}

	fromMIDI {|simpleMIDIFile, whichTrack=0|
		var temp;
		if (simpleMIDIFile.class == SimpleMIDIFile,
			{
				//import notes
				temp = simpleMIDIFile.generatePatternSeqs[whichTrack].select({|x|
					x[0].isInteger;});
				notes = temp.collect({|x| x[0]});
				//import times
				simpleMIDIFile.timeMode_('seconds');
				timeIntervals = simpleMIDIFile.generatePatternSeqs[whichTrack].collect({|x|
					x[1];
				});
				//import velocities
				velocities = simpleMIDIFile.realNoteOnEvents.collect({|x| x[5]})

			},
			{"can only use with a SimpleMIDIFile"}
		)

	}




	trans {
		[
			{this.mutateNotesD; "shiftD".postln},
			{this.newShape},
			{this.mutateShape},
			{this.scramble},
			{this.deepScramble},
			{this.shear},
			{this.chooseScale; this.thicken},
			{this.chooseScale; this.thicken(0.2)},
			{this.chooseScale; this.thicken(0.9)},
			{this.chooseScale; this.thickenLengthen},
			{this.chooseScale; this.thickenLengthen(0.2)},
			{this.chooseScale; this.thickenLengthen(0.9)},
			{this.thin},
			{this.thinShorten},
			{this.trimTo},
			{this.rotate},
			{this.chordsRand},
			{this.chords},
			{this.chordsShorten},
			{this.sputter},
			{this.spray},
			{this.mirror},
			{this.pyramid},
			{this.slide},
			{this.quantize(4,4)},
			{this.quantize(2,3)},
			{this.wrapTime(0.25)},
			{this.slower},
			{this.faster},
			{this.softer},
			{this.louder},
			{this.fan},
			{this.avgTime},
			{this.compress},
			{this.applyScale(Scale.dorian)},
			{this.applyScale(Scale.ionian)},
			{this.applyScale(Scale.gong)},
			{this.applyScale(Scale.lydian)},
			{this.applyScale(Scale.mixolydian)},
			{this.applyScale(Scale.diminished)},
			{this.applyScale},
			{this.chooseScale},
			{this.slantScale},
			{this.applyScale},
			{this.chooseScale},
			{this.slantScale},
			{this.reduceScale},
			{this.invertMean},
			{this.invert},
			{this.transpose(2)},
			{this.transpose(7)},
			{this.transpose(-2)},
			{this.transpose(-7)},
			{this.transpose(-12)},
			{this.chooseScale; this.dTranspose(1)},
			{this.chooseScale; this.dTranspose(2)},
			{this.chooseScale; this.dTranspose(3)},
			{this.chooseScale; this.dTranspose(4)},
			{this.chooseScale; this.dTranspose(12.rand)},
			{this.chooseScale; this.dTranspose(-1)},
			{this.chooseScale; this.dTranspose(-2)},
			{this.chooseScale; this.dTranspose(-3)},
			{this.chooseScale; this.dTranspose(-4)},
			{this.chooseScale; this.dTranspose(-12.rand)},
			{this.resolve},
			{this.pivot},
			{this.pivot(2)},
			{this.pivot(3)},
			{this.pivot(4)},
			{this.pivotBass},
			{this.pivotBass(2)},
			{this.pivotBass(3)},
			{this.pivotBass(4)},
			{this.pivotLoudest},
			{this.pivotLoudest(2)},
			{this.pivotLoudest(3)},
			{this.pivotLoudest(4)},
			{this.flatten(1)},
			{this.flatten(2)},
			{this.flatten(3)},
			{this.flatten(4)},
			{this.flatten(5)},
		].choose.value;
	}

	// reporting and conversion




	asScale {arg notesPerOctave = 12;
		var scale;
		if (notes != nil, {
			scale = notes.flat.copy;
			scale.do({|each, counter|
				while ({each >= notesPerOctave}, {each = each - notesPerOctave;
					scale[counter] = each;
				});
			});
			scale = scale.as(Set).as(Array).sort.asInteger;
			^Scale.new(scale, notesPerOctave, Tuning.et, name:"");
		},
		{^Scale.chromatic;}
		)
	}


	asPChist {
		var hist;
		hist = notes.flat.asPCs;
		hist = hist.histo(12, 0, 12);
		^hist;
	}

	asPCs {
		var pcs = notes.flat.asPCs;
		^pcs;
	}

	asMIDIhist {
		var hist;
		hist = notes.flat.copy;
		hist = hist.histo(127, 0, 127);
		^hist;
	}


	report {
		var lengths, maxLength;

		lengths = this.generateStringLengths + 1;

		this.checkQ(lengths);
		this.reportNotes(lengths);
		this.reportVelocities(lengths);
		this.reportTimes(lengths);
		this.reportChans(lengths);
		this.reportScale(lengths);
		this.reportName(lengths);
		"".postln;

	}


	generateStringLengths {
		var longestList, roundedTimes;
		longestList = [notes.size, timeIntervals.size, velocities.size].maxItem;
		longestList = Array.fill(longestList, {1});
		roundedTimes = timeIntervals.round(0.3);
		^longestList.collect {|note, i|
			var array, sizes;
			array = [notes.at(i), velocities.at(i), roundedTimes.at(i), chans.at(i)];
			sizes = array.collect {|item| item.asString.size}.maxItem;
			sizes;
		};
	}

	reportNotes {|blockWidthArray|
		(("midinotes:").leftJustify(15) ++ notes.asInteger.asJustifiedString(blockWidthArray)).postln;
		(("notes:").leftJustify(15) ++ notes.spellOctave
			.asJustifiedString(blockWidthArray)).postln;
	}

	reportVelocities {|blockWidthArray|
		(("velocities:").leftJustify(15) ++ velocities.asInteger
			.asJustifiedString(blockWidthArray)).postln;
	}

	reportTimes {|blockWidthArray|
		(("timeIntervals:").leftJustify(15) ++ timeIntervals.round(0.01)
			.asJustifiedString(blockWidthArray)).postln;
	}

	reportChans {|blockWidthArray|
		(("channels:").leftJustify(15) ++ chans.asInteger.asJustifiedString(blockWidthArray)).postln;
	}

	reportName {|blockWidthArray|
		if (name.notNil, {
			(("name:").leftJustify(17) ++ name.asString.rightJustify(blockWidthArray[0])).postln;
		}, {});
	}

	reportScale {
		var scale, name;
		scale = this.scale;
		if (appliedScale == nil or: {appliedScale == ""},
			{ name = "" },
			{ name = keyRoot.spell + this.scale.name}
		);
		(("scale:").leftJustify(15) + scale.degrees.spell + name).postln;
	}


	rp {
		"Bloom.new(".postln;
		(notes.asString ++ ",").postln;
		(velocities.asString ++ ",").postln;
		(timeIntervals.round(0.001).asString ++ ",").postln;
		(chans.asString ++ ")").postln;
	}

	duration {
		var dur = 0;
		timeIntervals.do({|time| dur = dur + time});
		^dur;
	}

	intervals {
		var intervalList, modTwelve;
		modTwelve = (0..12);
		intervalList = [];
		notes.do({|source, i|
			notes.do({|target, j|
				var interval;
				if (j > i, {		// only test notes after it in list
					interval = (target - source).abs;
					interval = interval%12;
					intervalList = intervalList.add([interval, [i,j]]);
				});
			})
		});
		^intervalList
	}



	dur {
		var allDurs = notes.collect {|note, i| timeIntervals.wrapAt(i)};
		^allDurs.sum;
	}



	// PRIVATE METHODS

	// these resolutions aren't right - think again

	resolveFixedDur {
		if (fixedDur.isKindOf(Number), {
			if (fixedDurMode == \scale, {this.scaleToDur(fixedDur)});
			if (fixedDurMode == \trim, {this.trimToDur(fixedDur)});
		})
	}

	resolveFixedScale {
		if (fixedScale.isKindOf(Scale), {this.applyScale(fixedScale)});
	}

	resolveFixedGrid {
		if (fixedGrid.isKindOf(Collection) or: fixedGrid.isKindOf(Number),
			{this.quantize(fixedGrid)});
	}

	resolveFixed {
		case
		{fixedDurMode == \trim} {
			this.resolveFixedGrid;
			this.resolveFixedDur}
		{fixedDurMode == \scale} {
			this.resolveFixedDur;
			this.resolveFixedGrid;
			this.trimToDur(fixedDur)};

		this.resolveFixedScale;
	}

	absTime {
		var absTime, totalTime = 0, i=0;
		absTime = timeIntervals.collect({|ti, i|
			if (i == 0, { 0 },
				{
					totalTime = timeIntervals[i-1] + totalTime;
					totalTime;
			})
		})
		^absTime;
	}



	setRelTime {|absTimes|
		var totalTime, i;
		timeIntervals.do({|ti, i|
			if (i == (timeIntervals.size - 1),
				{
					//don't change the last entry -- we don't know it
				},
				{	// for all other entries:
					timeIntervals[i] = absTimes[i+1] - absTimes[i];
				}
			)
		})
		^timeIntervals;
	}


	checkForScaleMatch {
		var scale = this.scale;
		var root = scale.degrees[0];
		var normalizedScale = Scale.new(scale.degrees - root);
		var match = Scale.match(normalizedScale);
		if (match == [], {^nil}, {^[match, root]})
	}


	asDegrees {
		var scale = this.scale;
		^notes.collect{|note| note.keyToDegree(scale);}
	}





	// QUERIES

	lowestNote {
		^notes.minIndex;
	}

	highestNote {
		^notes.maxIndex;
	}

	loudestNote {
		^velocities.maxIndex;
	}

	copy {
		^this.deepCopy;
	}

	// CLEANING UP

	enforceRange { // constrains to reality
		var originalNotes = notes.deepCopy; // don't use .saveNest or else it will interfere with others if order is prior to .restoreNest because they often both happen at the end of a function

		notes = notes.flat.collect{|note|
			while ({note < lowestPossibleNote}, {note = note+12});
			while ({note > highestPossibleNote}, {note = note-12});
			note;
		};
		velocities = velocities.flat.collect{|vel|
			while ({vel < 0}, {vel = vel+12});
			while ({vel > 127}, {vel = vel-12});
			vel;
		};
		timeIntervals = timeIntervals.flat.collect{|ti|
			if (ti < 0, {0.05}, {ti})
		};
		chans = chans.flat.collect{|chan|
			if (chan > 15, {0}, {chan})
		};


		notes = notes.matchNesting(originalNotes);
		velocities = velocities.matchNesting(originalNotes);
		chans = chans.matchNesting(originalNotes);
	}


	wrapToNotes { // makes all parameters the same length as notes
		velocities = notes.collect {|note, i| velocities.wrapAt(i)};
		timeIntervals = notes.collect {|note, i| timeIntervals.wrapAt(i)};
		chans = notes.collect {|note, i| chans.wrapAt(i)};
	}


	wrapToLongest {
		var longest = [notes.size, timeIntervals.size, velocities.size, chans.size].maxItem;
		"longest %".format(longest).postln;
		notes = longest.collect {|i| notes.wrapAt(i)};
		velocities = longest.collect {|i| velocities.wrapAt(i)};
		timeIntervals = longest.collect {|i| timeIntervals.wrapAt(i)};
		chans = longest.collect {|i| chans.wrapAt(i)};
	}

	checkScale {
		var currentScale = this.asScale;
		var pastScale = appliedScale;
		if (pastScale.notNil, {
			if (difference(currentScale.degrees, pastScale.degrees) == [],
				{
					// if not difference, keep it
				},
				{
					// if there is a difference, we've drifted -- remove appliedScale
					appliedScale = nil; keyRoot = 0;
				}
		)}
		)
	}
}

BloomPulsar {
	var <>task, <>rate = 8, <>pulsingBloom, <>routine;

	*new {|bloom, rate, clock, quant, action|
		^super.new.init(bloom, rate, clock, quant, action)
	}

	init {|bloom, startingRate, clock, quant, action|
		if (action.class == Routine, {routine = action});
		pulsingBloom = bloom;
		rate = startingRate;
		task = Task.new({
			loop {
				if (action.class == Function, {action.value});
				if (action.class == Routine, {routine.next});
				//"playing %".format(pulsingBloom).postln;
				pulsingBloom.play;
				rate.wait;
			}
		}, clock).play(quant: quant)
	}

	start {task.start}

	stop {task.stop}

	isPlaying {^task.isPlaying}
}


Pedal {
	var chan = 0, midiOut, <state;

	*new {|chan, midiOut|
		^super.new.init(chan, midiOut);
	}

	init {|ch, out|
		chan = ch; midiOut = out;
		state = false;
	}

	down {
		midiOut.control(chan, 64, 127);
		state = true;
	}

	up {
		midiOut.control(chan, 64, 0);
		state = false
	}
}

Chord[slot] : Array {

	*with { arg ... args;
		// return an array of the arguments given
		// cool! the interpreter does it for me..
		^args
	}

}



+ Scale {

	*match {arg targetScale;
		var allScales, bloomScale, match;
		allScales = Scale.names.collect {arg name; Scale.at(name)};
		bloomScale = targetScale.degrees;
		^match = allScales.select{arg scale; scale.degrees == bloomScale}
	}


	*compare {arg scale1, scale2;
		^sect(scale1.degrees, scale2.degrees);
	}


	*sortSimilar {arg targetScale, verbose = false;
		var allScales, bloomScale, matches;
		var targetScalePPO = targetScale.pitchesPerOctave;
		matches = {[]} ! 13; // if there's 1 match, it goes in the 1 bucket, etc
		allScales = Scale.names.collect {arg name; Scale.at(name)};
		//allScales.do{arg scale; scale.postln};
		allScales = allScales.reject {arg scale;
			scale.degrees.size > 10
		}; // exclude chromatic scales

		allScales = allScales.select {arg scale;
			scale.tuning.name == "ET12"
		}; // exclude other tunings for now

		allScales.do {arg scale;
			var scaleList, numNotesInCommon;
			numNotesInCommon = sect(scale.degrees % targetScalePPO, targetScale.degrees.asInteger).size;
			scaleList = matches[numNotesInCommon];
			matches[numNotesInCommon] = scaleList.add(scale);
		};
		//matches.do {arg bucket, i; bucket.do{arg scale; "% matches % notes".format(scale.name, i).postln}};

		if (verbose, {

			matches.do {|group,i|
				"________________________matching % notes".format(i).postln;
				group.do{|scale|
					"% %".format(scale.degrees, scale.name).postln
				}
			}

		})

		^matches; // [[scales that match 1 note], [scales that match 2 notes]...etc]
	}

	*mostSimilarTo {arg targetScale;
		// scales that match the most # of notes
		var sortedScales, scalesWithMostNotesInCommon;
		sortedScales = this.sortSimilar(targetScale);
		^scalesWithMostNotesInCommon = sortedScales.reject{arg x; x == []}.last;
	}

	*slantMatch {arg targetScale;
		// scales that match the second-to-most # of notes
		var sortedScales, slantScales;
		sortedScales = this.sortSimilar(targetScale);
		sortedScales = sortedScales.reject{|x| x == []};
		slantScales = sortedScales.drop(-1);
		^slantScales.last;

	}

	transpose {arg t;
		^Scale.new(((degrees + t) % 12), pitchesPerOctave, tuning, name)
	}

	diatonicChords {|chordTones|
		var family, bigScale;
		chordTones = chordTones ? [1,3,5];
		chordTones = chordTones - 1;
		bigScale = Array.fill(10, {|i| degrees + (pitchesPerOctave * i)}).flat;
		^family = degrees.collect {|degree, i| bigScale[chordTones + i]};
	}

}



+ SequenceableCollection {
	nearestInScaleUnique { arg scale, stepsPerOctave=12;
		var key, root, nearestOptions;
		root = this.trunc(stepsPerOctave);
		key = this % stepsPerOctave;
		nearestOptions = (key.nearestInListWithOptions(scale) + root).allTuples.sort({|a, b|
			a.histo.count{|item| item == 1} > b.histo.count{|item| item == 1}
		});
		^nearestOptions.first;
	}

	nearestInListWithOptions { arg list;
		^this.collect{|item|
			item.nearestInListWithOptions(list)
		}
	}
}


+ Array {

	flattenSingletons {
		^this.collect{|item|
			case
			{item.isKindOf(Collection) == false} {item}
			{(item.size == 0)} {}
			{item.size == 1} {item[0]}
			{item.size > 1} {item}
		}
	}

	spellOctave {
		^this.collect({|note| note.spellOctave})
	}

	spell {
		^this.collect({|note|
			note.spell;
	})}

	matchNesting {|nestedArray|
		var flatArray = this;
		// first, make their flat lengths match
		flatArray = nestedArray.flat.collect{|item, i| this.wrapAt(i)};
		~privateFlatArray = flatArray.deepCopy;
		^flatArray.matchNester(nestedArray)
	}

	matchNester {|nestedArray|
		^nestedArray.collect{|item, i|
			if (item.class != Array,
				{~privateFlatArray.removeAt(0)},
				{
					var nextChunk = ~privateFlatArray.copyRange(0, item.size);
					nextChunk.matchNester(item)
				}
			)
		}
	}

	nearestInList {|list|
		^this.collect {|item|
			item.nearestInList(list)
		}
	}

	nearestOctaveTo {|target|
		target = target ? 60;
		^this.collect {|item|
			item.nearestOctaveTo(target)
		}
	}

	asJustifiedString {|blockWidthArray, char|
		var noteString = "";
		if (char == nil, {char = Char.space});
		this.do {|item, i|
			noteString = noteString ++ item.asString.rightJustify(blockWidthArray.wrapAt(i), char)
		};
		^noteString;
	}

	asScale {|pitchesPerOctave, tuning, name|
		var scale;
		scale = this.collect{|note|
			note.asPC
		};
		^Scale.new(scale.sort, pitchesPerOctave, tuning, name);
	}

	dTranspose {|steps, scale|
		var degrees;
		scale = scale ? Scale.chromatic;
		degrees = this.collect{|note| note.keyToDegree(scale, scale.stepsPerOctave)};
		degrees = degrees + steps;
		^degrees.collect{|degree| degree.degreeToKey(scale, scale.stepsPerOctave)}
	}

	// CHORD METHODS

	invertChord {|n = 1|
		var scale;
		scale = this.asScale;
		^this.dTranspose(n, scale);
	}

	invertMean {
		var sum, avg, dif;
		sum = 0;
		this.do({|each|
			sum = sum + each;
		});
		avg = (sum / this.size).round(1);

		this.do({|each, counter|
			dif = each - avg;
			this[counter] = avg - dif;
		});
	}


	spacing {
		^this.sort.differentiate.drop(1);
	}

	detectConsecutiveSemitones {
		var pairs = this.collect {|note, i| [note, this.wrapAt(i+1)]};
		^pairs.collect{|x| x == [1,1]}.includes(true);
	}

	howManyNegatives {
		var count = 0;
		this.do{|x|
			if (x<0, {count = count + 1});
		};
		^count;
	}

	/*goodChordSpacings { // inefficient heuristic... deprecated
	var highestNote = this.maxItem;
	var maxIndex = this.maxIndex;
	var diff, options, bestOptions;
	var notes = this.deepCopy;
	notes.removeAt(maxIndex);
	options = notes.collect {|note|
	while ({highestNote - note > 12}, {note = note + 12}); // bring into close octave
	(note ! 3) + [-12, 0]
	}.allTuples
	.collect{|tuple| tuple.sort}
	.collect{|tuple| tuple.add(highestNote)}
	.reject{|tuple| tuple.sort.last - tuple.sort.first > 40} // limit compass
	.reject{|tuple| tuple.spacing[0] < 6; } // ensure a wide interval is on the bottom
	.reject{|tuple| tuple.spacing.maxItem > 16} // no intervals wider than M10
	.reject{|tuple| tuple.spacing.detectConsecutiveSemitones}
	.sort{|prev, next| prev.spacing.differentiate.howManyNegatives > next.spacing.differentiate.howManyNegatives}
	//.sort{|prev, next| (prev.maxItem - prev.minItem) > (next.maxItem - next.minItem)} // sort by total span
	^options;
	//bestOptions = options.keep(-1 * (options.size / 2).round);
	}*/

	spacedVoicing { // better
		var model, models = [
			[0,7,10,0+12,4+12,6+12,8+12,11+12,13+12], // extended dominant voicing
			[0,12,2+12,3+12,7+12,10+12,5+24], // kenny barron voicing
			[0,5,10,3+12,8+12], // stacked 4ths
			[0,7,7+12,7+24], // stacked 5ths
		], lowestNote, highestNoteIndex, highestNoteValue, offsetToRestoreSop, upperVoices, originalNotes = this.copy;
		lowestNote = this.minItem;
		upperVoices = this.reject({|x| x == lowestNote});
		highestNoteIndex = upperVoices.maxIndex;
		highestNoteValue = upperVoices.maxItem;
		model = (models.choose + lowestNote);
		upperVoices = upperVoices.efficientMotionFrom(model.drop(1));
		upperVoices[highestNoteIndex].justAbove(upperVoices.maxItem); // put soprano back on top
		//offsetToRestoreSop = highestNoteValue - upperVoices.maxItem;
		//upperVoices = upperVoices + offsetToRestoreSop; // put soprano back in original place
		//if (upperVoices.minItem < lowestNote, {lowestNote = lowestNote - 12}); // if that collides with bass, move bass down
		^[lowestNote]++upperVoices;
	}

	melodyToEfficientProgression {|scale, chordTones, root|
		var chords;
		chords = [this[0].harmonies(scale, chordTones, root).choose];
		chords.postln;
		this.drop(1).do {|note|
			var options, efficientOptions, mostEfficientOption;
			options = note.harmonies(scale, chordTones, root);
			efficientOptions = options.collect {|option| option.efficientMotionFrom(chords.last)}.sort{|a,b| a.totalDistancePerVoiceTo(chords.last).mean < b.totalDistancePerVoiceTo(chords.last).mean};
			mostEfficientOption = efficientOptions.first;
			chords = chords.add(mostEfficientOption);
		}
		^chords;
	}


	hasConsecutiveDoubles {
		var thisStartingWith1 = this.drop(1), booleans = [];
		this.pairsDo {arg x, y; booleans = booleans.add(x == y)};
		thisStartingWith1.pairsDo {arg x, y; booleans = booleans.add(x == y)};
		^booleans.includes(true)
	}

	indexOfDoubles {
		var doubles = [];
		var i = 0;
		this.doAdjacentPairs{|a, b|
			if (a==b, {doubles = doubles.add([i, i+1])});
			i = i+1
		};
		^doubles;
	}

	moveDoublesUpOctave {
		var doubles = this.indexOfDoubles;
		doubles.do {|set|
			set.do {|indexOfDouble, i|
				if (i>0, {
					this[indexOfDouble] = (this.at(indexOfDouble)+(12*i))
				})
			}
		}
	}

	extractPCOrder {
		var pcs;
		pcs = this % 12;
		//pcs.postln;
		^(0..11).collect{|x| pcs.indicesOfEqual(x)}
	}

	restorePCOrder {|extractedPCorderArrays|
		var orderedArray = 0 ! this.size;
		var unorderedPCArray = this % 12;
		extractedPCorderArrays.do{|indices, pc|
			if (indices.isNil, {}, {
				indices.do{|index|
					var midinotesOfThatPCinUnorderedArray = this.at(unorderedPCArray.indicesOfEqual(pc));
					midinotesOfThatPCinUnorderedArray.do {|note| orderedArray.put(index, note)}
				}
			})
		};
		^orderedArray;
	}

	totalDistancePerVoiceTo {|targetChord|
		var sortedStart = this.sort, sortedTarget = targetChord.sort;
		^sortedStart.collect {|startNote, i|
			(sortedTarget[i] - startNote).abs;
		}
	}

	/*efficientMotionTo {|targetChord| // much more difficult to use than -From
	var startingNotes = this.deepCopy, targetNotes = targetChord.deepCopy;
	var newNotes = [], efficientMoves, distances;
	this ?? {startingNotes = [60,60,60]};

	while ({startingNotes.notEmpty}, {
	var allMoves, bestMove;
	//"possible moves:".postln;
	allMoves = targetNotes.collect {|targetNote, i| // collect all possible moves
	startingNotes.collect{|startingNote, j| (
	\startingNote: startingNote,
	\transposedTo: startingNote.nearestOctaveTo(targetNote),
	\targetNote: targetNote,
	\distance: (targetNote - startingNote.nearestOctaveTo(targetNote)).abs)//.postln;
	};
	};
	//"best move:".postln;
	bestMove = allMoves.flat.sort{|a, b| a.distance < b.distance}.first;//.postln;
	// make the best move
	newNotes = newNotes.add(bestMove.transposedTo);
	startingNotes.remove(bestMove.startingNote);
	});
	^newNotes;
	}*/

	efficientMotionFrom {|previousChord|
		var originalNotes = this.deepCopy;
		var newNotes = [], efficientMoves, distances, previousNotes;

		previousChord = previousChord ? [60];
		if (previousChord.isEmpty, {previousChord = [60]});

		previousNotes = previousChord.deepCopy;

		while ({originalNotes.notEmpty}, {
			var allMoves, bestMove;
			allMoves = previousNotes.collect {|previousNote, i|
				originalNotes.collect{|originalNote, j| ( // match notes with nearest previous note
					\originalNote: originalNote,
					\transposedTo: originalNote.nearestOctaveTo(previousNote),
					\previousNote: previousNote,
					\distance: (previousNote - originalNote.nearestOctaveTo(previousNote)).abs
				)}
			};
			bestMove = allMoves.flat.sort{|a, b| a.distance < b.distance}.first;

			bestMove ?? { // if you run out of previous notes, leave them where they are
				var noteToPull = originalNotes.choose;
				bestMove = (
					\originalNote: noteToPull,
					\transposedTo: noteToPull,
					\previousNote: noteToPull,
					\distance: 0)};
			//"best move: move % to % to be % steps away from %".format(bestMove.originalNote.spellOctave, bestMove.transposedTo.spellOctave, bestMove.distance, bestMove.previousNote.spellOctave).postln;
			newNotes = newNotes.add(bestMove.transposedTo);
			originalNotes.remove(bestMove.originalNote);
			previousNotes.remove(bestMove.previousNote);
		});
		^newNotes
	}


	removeDoubles {
		var doubles = this.indexOfDoubles;
		var array = this.copy;
		doubles.do {|set|
			set.do {|indexOfDouble, i|
				if (i>0, {
					array[indexOfDouble] = nil;
				})
			}
		};
		^array.reject{|item| item.isNil}
	}

	asPCs {
		^this.collect{|note| note.asPC}
	}

	icVector {
		var intervalBag, intervalVector, sortedUniquePCs, histo11, histo6;
		sortedUniquePCs = this.asPCs.sort.removeDoubles;
		sortedUniquePCs.do {|note, i|
			sortedUniquePCs.drop(i+1).do{|higherNote|
				//"note:%  higherNote: %".format(note,higherNote).postln;
				intervalBag = intervalBag.add(higherNote - note);
			}
		};
		histo11 = intervalBag.histo(11,1,11);
		histo6 = histo11.keep(6)+(histo11.drop(6).reverse)
		^histo6;
	}

	negHarmony {|tonic = 0|
		^this.collect{|note| note.negHarmony(tonic)}
	}

	justBelow {|target|
		^this.collect{|note| note.justBelow(target)}
	}

	justAbove {|target|
		^this.collect{|note| note.justAbove(target)}
	}
}


+ SimpleNumber {

	nearestInListWithOptions { | list |
		var index = list.indexInBetween(this);
		case
		{index % 1 > 0.5} {index = index.round}
		{index % 1 < 0.5} {index = index.round}
		{index % 1 == 0.5} {index = [index.trunc, index.trunc + 1]};
		^list.at(index.asInteger);
	}

	allOctaves {
		^Array.series(11, 0, 12) + (this%12);
	}

	nearestOctaveTo {|target|
		^target.nearestInList(this.allOctaves);
	}

	justBelow {|target|
		var nearest = this.nearestOctaveTo(target);
		if (nearest > target, {nearest = nearest - 12});
		^nearest;
	}

	justAbove {|target|
		var nearest = this.nearestOctaveTo(target);
		if (nearest < target, {nearest = nearest + 12});
		^nearest;
	}

	asPC {
		^(this % 12).asInteger
	}

	spellOctave {
		^#["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].wrapAt(this) ++
		(this.trunc(12)/12-1).asInteger;
	}

	spell {
		^#["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].wrapAt(this)
	}

	negHarmony {|tonic = 0|
		var ruler, pc = this.asPC, neg;
		ruler = ([[10,11,0,1,2,3],[4,5,6,7,8,9]]+tonic)%12;

		if (ruler[0].includes(pc), {
			var index = ruler[0].indexOf(pc);
			neg = ruler[1].reverse.[index];
		},
		{
			var index = ruler[1].indexOf(pc);
			neg = ruler[0].reverse[index];
		});
		//^neg.justBelow(tonic.justBelow(this));// inverts below tonic in that octave
		//^neg.justBelow(this); // each note inverted separately downward
		^neg.nearestOctaveTo(this); // each note inverted separately
	}

	harmonies {|scale, chordTones, root|
		/*
		the receiver is a scale degree
		chordTones are also scale degrees, written like we say them: one, three, five
		all inversions of all diatonic chords are returned
		NOTE that this then returns CHROMATIC scale note numbers
		*/
		var options;
		chordTones = chordTones ? [1,3,5];
		scale = scale ? Scale.ionian;
		root = root ? 0;
		root = root % 12;
		options = (scale.diatonicChords(chordTones) + root) % 12;
		options = options.select{|item| item.includesEqual(this % 12)};
		if (options.isEmpty, {^this.harmonies(scale, chordTones, root+1)}, {^options.justBelow(this)})
		// if no answers, try transpositions of this scale... could inf loop
	}
}


+ String {
	leftJustify { |width = 5, char = nil|
		var padString, currentWidth, after;
		if (char == nil, {char = Char.space});
		currentWidth = this.size;
		after = String.fill((width - currentWidth).max(0), char);
		^this ++ after;
	}

	rightJustify { |width = 5, char = nil|
		var padString, currentWidth, before;
		if (char == nil, {char = Char.space});
		currentWidth = this.size;
		before = String.fill((width - currentWidth).max(0), char);
		^before ++ this;
	}

	spellToPC {
		var note = [
			"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
			"C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"
		].indexOfEqual(this) % 12;
		^note;
	}
}
