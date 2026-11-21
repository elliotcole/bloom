// Bloom's palette commands that work on the bloom they're given and nothing
// else: main.ts registers them for the session, the editor runs them on passes
// of a take. Those that reach the page (a checkbox, a menu) stay in main.ts.

import type { Bloom, ListKey, ListVerb, PatternOp } from '../core/Bloom';
import type { PaletteCommand } from './commandPalette';

export const BLOOM_COMMANDS: PaletteCommand[] = [];

/** One command: its names (the first shown, all lower case), what it does */
function reg(names: string | string[], description: string, fn: (b: Bloom) => void): void {
  BLOOM_COMMANDS.push({ names: (Array.isArray(names) ? names : [names]).map(n => n.toLowerCase()), description, fn });
}


// Mutation
reg('mutate',    'mutate notes (diatonic)',   b => b.mutateNotesD());
reg('mutateC',   'mutate notes (chromatic)',  b => b.mutateNotes());

// Randomize
reg('scramble',  'scramble whole notes',      b => b.scramble());
reg('shuffle',   'perfect shuffle (whole notes)', b => b.shuffle());
reg('chunks',    'scramble in 3 chunks (whole notes; S asks how many)', b => { b.scrambleChunks(3); });

// Density
reg('thicken',   'new notes in the longest gaps', b => { b.thicken(); });
reg('thin',      'remove random notes',       b => b.thin());
reg(['gap', 'addgap'],    'insert time gap',  b => b.gap());
reg('ungap',     'remove time gap',           b => b.unGap());

// Tempo / dynamics
reg(['slower', 'slow'], 'stretch time intervals', b => b.slower());
reg(['faster', 'fast'], 'compress time intervals', b => b.faster());
reg(['softer', 'soft'], 'reduce velocities',   b => b.softer());
reg(['louder', 'loud'], 'increase velocities', b => b.louder());

// Extend / contract
reg('droplast',  'drop last note',            b => b.dropLast());
reg('addone',    'add one random note',       b => b.addOne());
reg(['addinscale', 'adddiatonic'], 'add note in scale', b => b.addOneInScale());

// Rotate
reg('rotatenotes', 'rotate notes array',      b => b.rotateNotes(1));
reg('rotate',      'rotate whole notes',      b => b.rotate(1));
reg('rotateintervals', 'rotate intervals',    b => b.rotateIntervals(1));

// Intervals
reg('randintervals',  'randomize intervals',        b => b.randIntervals());
reg('addinterval',    'add an interval step',       b => b.addInterval());
reg('dropinterval',   'drop last interval step',    b => b.dropInterval());
reg('widenintervals', 'widen intervals by one',     b => b.incrementIntervals(1));
reg('narrowintervals', 'narrow intervals by one',   b => b.incrementIntervals(-1));
reg('resetintervals', 'reset intervals (none)',     b => b.resetIntervals());
reg('bakeintervals',  'bake intervals into notes',  b => b.bakeIntervals());
reg('bakefigures',    'bake figures into notes (those from the garden stay)', b => b.bakeFigures());
reg('clearfigures',   'clear the figures (none)',   b => { b.figures = [0]; });
reg('sparserintervals', 'intervals further apart (one more rest after each)', b => b.spaceIntervals(true));
reg('denserintervals', 'intervals closer together (one rest fewer after each)', b => b.spaceIntervals(false));

// Patterning
reg('stutter',   'stutter pattern',           b => b.stutter());
reg('sputter',   'sputter pattern',           b => b.sputter());
reg('mirror',    'mirror whole notes',        b => b.mirror());
reg('braid',     'braid pattern',             b => b.braid());
reg('pyramid',   'pyramid pattern',           b => b.pyramid());
reg('quantize',  'quantize to grid (4)',      b => b.quantize(4));
reg('shear',     'shear: some notes an octave outward', b => b.shear());
reg('gather',    'gather: some notes an octave inward', b => b.gather());
reg('removedoubles', 'remove double notes',   b => b.removeDoubles());
reg('drawcurves', 'draw curves diatonic',     b => b.drawCurvesD(10));

// Pitch
reg(['invert', 'inv'],     'invert pitches',       b => b.invert());
reg(['invertmean', 'invm'], 'invert around mean',  b => b.invertMean());
reg('up1',   'transpose up 1 semitone',            b => b.transpose(1));
reg('down1', 'transpose down 1 semitone',          b => b.transpose(-1));
reg('up12',  'transpose up 1 octave',              b => b.transpose(12));
reg('down12', 'transpose down 1 octave',           b => b.transpose(-12));
reg('step+', 'diatonic step up',                   b => b.dTranspose(1));
reg('step-', 'diatonic step down',                 b => b.dTranspose(-1));
reg('pivot',  'pivot to highest note',             b => b.pivot());
reg('pivotL', 'pivot to loudest note',             b => b.pivotLoudest());

// Scale
reg(['choosescale', 'scale'], 'snap to nearest scale', b => b.chooseScale());
reg('slant',   'slant scale',                     b => b.slantScale());
reg('reduce',  'reduce scale degrees',            b => b.reduceScale());

// Chords
reg(['chords', 'clump'],    'clump into chords',  b => b.chordsRandShorten());
reg(['flattenchords', 'flatten'], 'flatten chords', b => b.flattenChords());

// Shape
reg(['newshape', 'shape'], 'new bloom shape',     b => b.newShape());
reg('push',    'push bloom to stack',             b => b.push());
reg('pop',     'pop bloom from stack',            b => b.pop());

// Gestures (whole bloom) and groove-safe rhythm
reg('calm',      'calm: sparser, softer, narrower',  b => b.calm());
reg('intensify', 'intensify: busier, louder, wider', b => b.intensify());
reg('vary',      'small variations all through',     b => b.vary());
reg('split',     'split a note into two halves',     b => { b.splitNote(); });
reg('merge',     'merge a note with the next',       b => b.mergeNote());
reg(['breeze+', 'breeze'], 'some notes up a scale step', b => b.breeze(1));
reg('breeze-',   'some notes down a scale step',     b => b.breeze(-1));
reg('breezeup1', 'some notes up a semitone',         b => b.breeze(1, 'semitone'));
reg('breezedown1', 'some notes down a semitone',     b => b.breeze(-1, 'semitone'));
reg('breezeup12', 'some notes up an octave',         b => b.breeze(1, 'octave'));
reg('breezedown12', 'some notes down an octave',     b => b.breeze(-1, 'octave'));
reg(['sortpitch', 'sortp'], 'sort pitches up',       b => b.sortNotes());
// N+1 velocities for N notes: one accent, then quiet, so the accent moves round each cycle
reg(['wheels', 'wheelswithinwheels'], 'wheels within wheels: one accent drifting round each cycle', b => { b.velocities = [100, ...Array(b.notes.length).fill(30)]; });

// One list at a time: <verb><list>, e.g. scrambleP (pitches), invertT, curveV, unifyC
const PATTERN_NAMES: PatternOp[] = ['scramble', 'shuffle', 'mirror', 'stutter', 'sputter', 'braid', 'pyramid'];
const LIST_SUFFIX: Array<[ListKey, string, string]> = [
  ['notes', 'P', 'pitches'], ['time', 'T', 'times'], ['vel', 'V', 'velocities'], ['chan', 'C', 'channels'],
  ['iv', 'I', 'intervals'],
];
LIST_SUFFIX.forEach(([k, suffix, name]) => {
  PATTERN_NAMES.forEach(op => reg(`${op}${suffix}`, `${op} ${name} only`, b => b.patternList(k, op)));
  const VERBS: ListVerb[] = [
    'mutate', 'mutateWild', 'nudgeDown', 'nudgeUp', 'octaveDown', 'octaveUp', 'stepDown', 'stepUp',
    'breezeDown', 'breezeUp',
    'converge', 'diverge', 'unify', 'invert', 'invertMid', 'tiltDown', 'tiltUp', 'curve', 'sortUp', 'sortDown',
    'fewer', 'more', 'renew', 'renewWild',
  ];
  VERBS.forEach(verb => reg(`${verb}${suffix}`, `${verb} ${name}`, b => { b.shapeList(k, verb); }));
});
