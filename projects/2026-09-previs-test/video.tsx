// The previs test: not a product video. Two blockouts that each lean on one camera move, rendered into footage with
// `studio gen video previs-test <scene>`, to see how closely Seedance follows a blockout's camera path: an orbit, whose
// parallax a zoom can't fake, and a push-in, whose travel it can.

import {
  Blockout, defineScene, defineVideo, easeInOut, orbitMove, pushInMove, seg, type BlockoutSubject,
} from '../../lib/studio/api.ts';

// A café counter still life. Each subject has its own tint, and the prompt names it by that tint.
const COUNTER: BlockoutSubject[] = [
  { shape: 'box', at: [0, 0, 0], size: [2.4, 0.9, 0.7], color: '#9a8f86' },
  { shape: 'box', at: [-0.35, 0.9, -0.05], size: [0.45, 0.5, 0.4], color: '#c9956b' },
  { shape: 'cylinder', at: [0.25, 0.9, 0.12], size: [0.09, 0.1, 0.09], color: '#e8e4dc' },
  { shape: 'cylinder', at: [0.75, 0.9, -0.1], size: [0.18, 0.2, 0.18], color: '#8a9a82' },
  { shape: 'cone', at: [0.75, 1.1, -0.1], size: [0.34, 0.45, 0.34], color: '#6f8f68' },
];

const orbit = defineScene({
  id: 'orbit', note: 'An 80° orbit around the counter, the machine turning from three-quarter to profile.',
  min: 5, lead: 0, tail: 0,
  previs: {
    prompt: 'A small independent café in the morning. The long stone-grey block is a pale oak and concrete counter; the orange '
      + 'box is a brushed-steel espresso machine with copper accents; the small white cylinder is a ceramic espresso cup on a saucer; '
      + 'the green cone in its pot is a potted olive tree. Warm window light from the left, soft shadows, shallow depth of field, '
      + '35mm film look. No people.',
  },
  render: (s) => (
    <Blockout subjects={COUNTER} pose={orbitMove({ target: [0, 1, 0], radius: 3.4, height: 1.6, fromDeg: -50, toDeg: 30 })(seg(s.t, 0, s.dur, easeInOut))} />
  ),
});

const DESK: BlockoutSubject[] = [
  { shape: 'box', at: [0, 0, 0], size: [1.4, 0.74, 0.7], color: '#a09488' },
  { shape: 'card', at: [0, 0.74, -0.05], size: [0.34, 0.23, 0.01], color: '#6d7a8c', tiltDeg: 15 },
  { shape: 'box', at: [0, 0.74, 0.12], size: [0.34, 0.015, 0.24], color: '#6d7a8c' },
  { shape: 'figure', at: [-0.25, 0, 0.75], size: [0.45, 1.3, 0.35], color: '#c7a98f' },
  { shape: 'cylinder', at: [0.5, 0.74, 0.05], size: [0.2, 0.3, 0.2], color: '#d9c9a0' },
];

const pushIn = defineScene({
  id: 'push-in', note: 'A slow push from a wide of the desk to over the seated figure\'s shoulder onto the laptop.',
  min: 5, lead: 0, tail: 0, cut: true,
  previs: {
    prompt: 'A home office in the evening. The brown block is a walnut desk; the blue-grey panel and slab are an open silver laptop '
      + 'whose screen glows with a spreadsheet; the tan figure is a woman in a knit sweater seated with her back to us, typing; the pale '
      + 'cylinder is a lamp with a linen shade, switched on. Warm lamplight against a dim blue room, cinematic, 35mm film look.',
  },
  render: (s) => (
    <Blockout subjects={DESK} pose={pushInMove({ target: [0, 0.85, 0], position: [1.2, 1.7, 4.2], toDistance: 1.9 })(seg(s.t, 0, s.dur, easeInOut))} />
  ),
});

export default defineVideo({ title: 'Previs test', voice: {}, scenes: [orbit, pushIn] });
