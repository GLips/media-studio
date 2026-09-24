// The previs test: not a product video. Blockouts rendered into footage with `studio gen video previs-test <scene>`.
// The first two each lean on one camera move, to see how closely Seedance follows a blockout's camera path: an orbit,
// whose parallax a zoom can't fake, and a push-in, whose travel it can. The third runs the whole flow: a blocked set,
// a subject from a reference still, a voiced line the move is timed to, and footage retimed afterwards.

import {
  Blockout, defineScene, defineVideo, dollyMove, easeInOut, orbitMove, pushInMove, seg, type BlockoutSubject,
} from '../../lib/studio/api.ts';
import { voice } from './audio/manifest.ts';

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

// A home kitchen with its walls and window blocked in, so the footage frames the room rather than just the subjects.
const KITCHEN: BlockoutSubject[] = [
  { shape: 'box', at: [0, 0, -1.1], size: [6, 2.7, 0.1], color: '#d8d0c4' },
  { shape: 'box', at: [-2.6, 0, 0.4], size: [0.1, 2.7, 3.1], color: '#d8d0c4' },
  { shape: 'card', at: [0.9, 1.15, -1.04], size: [1.1, 0.9, 0.02], color: '#b9c9d6' },
  { shape: 'box', at: [0, 0, -0.72], size: [3.6, 0.9, 0.65], color: '#8f959b' },
  { shape: 'box', at: [-0.4, 0.9, -0.75], size: [0.32, 0.4, 0.38], color: '#c9956b' },
  { shape: 'cylinder', at: [-0.05, 0.9, -0.55], size: [0.09, 0.1, 0.09], color: '#e8e4dc' },
  { shape: 'cylinder', at: [0.9, 0.9, -0.8], size: [0.16, 0.18, 0.16], color: '#8a9a82' },
  { shape: 'sphere', at: [0.9, 1.06, -0.8], size: [0.3, 0.3, 0.3], color: '#6f8f68' },
];
// A slow truck left along the counter with a slight push, settling on the machine as its line ends.
const kitchenMove = dollyMove(
  { position: [1.5, 1.45, 2.3], target: [0.3, 1.05, -0.7], fov: 35 },
  { position: [-0.7, 1.35, 1.4], target: [-0.35, 1.05, -0.75], fov: 35 },
);

const kitchen = defineScene({
  id: 'kitchen', note: 'The café\'s machine at home: a truck along a kitchen counter that settles on it as the line ends.',
  lines: ['kitchen'], lead: 0.8, tail: 0.8, min: 5, cut: true,
  previs: {
    prompt: 'A calm home kitchen early in the morning. The espresso machine (the orange box) is the one in @Image1. The long grey '
      + 'block is a matte grey stone counter; the small white cylinder is a ceramic espresso cup; the green ball in its pot is a small '
      + 'potted herb; the cream walls are warm plaster; the pale blue panel is a window with soft morning daylight coming through. '
      + 'Gentle natural light, a little steam rising from the cup, shallow depth of field, 35mm film look. No people.',
    references: ['refs/espresso-machine.png'],
    // Retimed after the render, as if the line had been re-voiced longer: the move settles 0.4s after the line ends,
    // where the blockout settled as it ended, without paying for another render.
    retime: (s) => [[0, 0], [s.line('kitchen').end + 0.4, s.line('kitchen').end]],
  },
  render: (s) => <Blockout subjects={KITCHEN} pose={kitchenMove(seg(s.t, 0, s.line('kitchen').end, easeInOut))} />,
});

export default defineVideo({ title: 'Previs test', voice, scenes: [orbit, pushIn, kitchen] });
