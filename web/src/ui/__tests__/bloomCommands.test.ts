// Bloom's palette commands, moved out of main.ts so the editor can run them on
// passes: every name main.ts registered before the move, pinned, in order.
import { describe, expect, it } from 'vitest';
import { BLOOM_COMMANDS } from '../bloomCommands';

/** The names main.ts registered (launch, which reaches the page, stays there and comes last now) */
const BEFORE: string[][] = [
  ['mutate'], ['mutatec'], ['scramble'], ['shuffle'], ['chunks'], ['thicken'], ['thin'], ['gap', 'addgap'],
  ['ungap'], ['slower', 'slow'], ['faster', 'fast'], ['softer', 'soft'], ['louder', 'loud'], ['droplast'],
  ['addone'], ['addinscale', 'adddiatonic'], ['rotatenotes'], ['rotate'], ['rotateintervals'],
  ['randintervals'], ['addinterval'], ['dropinterval'], ['widenintervals'], ['narrowintervals'],
  ['resetintervals'], ['bakeintervals'], ['bakefigures'], ['clearfigures'], ['sparserintervals'],
  ['denserintervals'], ['stutter'], ['sputter'], ['mirror'], ['braid'], ['pyramid'], ['quantize'], ['shear'],
  ['gather'], ['removedoubles'], ['drawcurves'], ['invert', 'inv'], ['invertmean', 'invm'], ['up1'], ['down1'],
  ['up12'], ['down12'], ['step+'], ['step-'], ['pivot'], ['pivotl'], ['choosescale', 'scale'], ['slant'],
  ['reduce'], ['chords', 'clump'], ['flattenchords', 'flatten'], ['newshape', 'shape'], ['push'], ['pop'],
  ['calm'], ['intensify'], ['vary'], ['split'], ['merge'], ['breeze+', 'breeze'], ['breeze-'], ['breezeup1'],
  ['breezedown1'], ['breezeup12'], ['breezedown12'], ['sortpitch', 'sortp'], ['wheels', 'wheelswithinwheels'],
  ['scramblep'], ['shufflep'], ['mirrorp'], ['stutterp'], ['sputterp'], ['braidp'], ['pyramidp'], ['mutatep'],
  ['mutatewildp'], ['nudgedownp'], ['nudgeupp'], ['octavedownp'], ['octaveupp'], ['stepdownp'], ['stepupp'],
  ['breezedownp'], ['breezeupp'], ['convergep'], ['divergep'], ['unifyp'], ['invertp'], ['invertmidp'],
  ['tiltdownp'], ['tiltupp'], ['curvep'], ['sortupp'], ['sortdownp'], ['fewerp'], ['morep'], ['renewp'],
  ['renewwildp'], ['scramblet'], ['shufflet'], ['mirrort'], ['stuttert'], ['sputtert'], ['braidt'],
  ['pyramidt'], ['mutatet'], ['mutatewildt'], ['nudgedownt'], ['nudgeupt'], ['octavedownt'], ['octaveupt'],
  ['stepdownt'], ['stepupt'], ['breezedownt'], ['breezeupt'], ['converget'], ['diverget'], ['unifyt'],
  ['invertt'], ['invertmidt'], ['tiltdownt'], ['tiltupt'], ['curvet'], ['sortupt'], ['sortdownt'], ['fewert'],
  ['moret'], ['renewt'], ['renewwildt'], ['scramblev'], ['shufflev'], ['mirrorv'], ['stutterv'], ['sputterv'],
  ['braidv'], ['pyramidv'], ['mutatev'], ['mutatewildv'], ['nudgedownv'], ['nudgeupv'], ['octavedownv'],
  ['octaveupv'], ['stepdownv'], ['stepupv'], ['breezedownv'], ['breezeupv'], ['convergev'], ['divergev'],
  ['unifyv'], ['invertv'], ['invertmidv'], ['tiltdownv'], ['tiltupv'], ['curvev'], ['sortupv'], ['sortdownv'],
  ['fewerv'], ['morev'], ['renewv'], ['renewwildv'], ['scramblec'], ['shufflec'], ['mirrorc'], ['stutterc'],
  ['sputterc'], ['braidc'], ['pyramidc'], ['mutatec'], ['mutatewildc'], ['nudgedownc'], ['nudgeupc'],
  ['octavedownc'], ['octaveupc'], ['stepdownc'], ['stepupc'], ['breezedownc'], ['breezeupc'], ['convergec'],
  ['divergec'], ['unifyc'], ['invertc'], ['invertmidc'], ['tiltdownc'], ['tiltupc'], ['curvec'], ['sortupc'],
  ['sortdownc'], ['fewerc'], ['morec'], ['renewc'], ['renewwildc'], ['scramblei'], ['shufflei'], ['mirrori'],
  ['stutteri'], ['sputteri'], ['braidi'], ['pyramidi'], ['mutatei'], ['mutatewildi'], ['nudgedowni'],
  ['nudgeupi'], ['octavedowni'], ['octaveupi'], ['stepdowni'], ['stepupi'], ['breezedowni'], ['breezeupi'],
  ['convergei'], ['divergei'], ['unifyi'], ['inverti'], ['invertmidi'], ['tiltdowni'], ['tiltupi'], ['curvei'],
  ['sortupi'], ['sortdowni'], ['feweri'], ['morei'], ['renewi'], ['renewwildi'],
];

describe('Bloom\'s commands as a list', () => {
  it('every command main.ts had but launch, in the order it had them, and nothing else', () => {
    expect(BLOOM_COMMANDS.map(c => c.names)).toEqual(BEFORE);
    expect(BEFORE.length + 1).toBe(227);   // with launch, as main.ts had them
  });
  it('each name answers one command, but mutateC, which was already two (mutate chromatic, found first; mutate channels)', () => {
    const all = BLOOM_COMMANDS.flatMap(c => c.names);
    const twice = all.filter((n, i) => all.indexOf(n) !== i);
    expect(twice).toEqual(['mutatec']);
    expect(BLOOM_COMMANDS.find(c => c.names.includes('mutatec'))!.description).toBe('mutate notes (chromatic)');
  });
  it('each says what it does and runs on a bloom', () => {
    expect(BLOOM_COMMANDS.every(c => c.description.length > 2 && typeof c.fn === 'function')).toBe(true);
    for (const n of ['scramble', 'up1', 'mirror', 'calm', 'scramblep', 'invertt', 'unifyc']) expect(BLOOM_COMMANDS.some(c => c.names.includes(n)), n).toBe(true);
  });
});
