// kit.ts: written by `studio sfx kit` from lib/timing/sound/engine/sfx-files.ts. Change the kit there and rerun, rather than editing this.
import type { SfxSound } from './sfx.tsx';
import click1 from './click-1.wav';
import click2 from './click-2.wav';
import click3 from './click-3.wav';
import click4 from './click-4.wav';
import key1 from './key-1.wav';
import key2 from './key-2.wav';
import key3 from './key-3.wav';
import key4 from './key-4.wav';
import key5 from './key-5.wav';
import key6 from './key-6.wav';
import toggleOn1 from './toggleOn-1.wav';
import toggleOn2 from './toggleOn-2.wav';
import toggleOff1 from './toggleOff-1.wav';
import toggleOff2 from './toggleOff-2.wav';
import pop1 from './pop-1.wav';
import pop2 from './pop-2.wav';
import pop3 from './pop-3.wav';
import whoosh1 from './whoosh-1.wav';
import whip1 from './whip-1.wav';
import riser1 from './riser-1.wav';
import impact1 from './impact-1.wav';
import chime1 from './chime-1.wav';
import success1 from './success-1.wav';
import ding1 from './ding-1.wav';

export const SFX = {
  /** click */
  click: [{ src: click1, seconds: 0.4574, landsAt: 0.05, request: {"sound":"click","seed":"kit:click:1"} }, { src: click2, seconds: 0.4602, landsAt: 0.05, request: {"sound":"click","seed":"kit:click:2"} }, { src: click3, seconds: 0.4743, landsAt: 0.05, request: {"sound":"click","seed":"kit:click:3"} }, { src: click4, seconds: 0.4996, landsAt: 0.05, request: {"sound":"click","seed":"kit:click:4"} }],
  /** key */
  key: [{ src: key1, seconds: 0.5243, landsAt: 0.05, request: {"sound":"key","seed":"kit:key:1"} }, { src: key2, seconds: 0.5466, landsAt: 0.05, request: {"sound":"key","seed":"kit:key:2"} }, { src: key3, seconds: 0.5513, landsAt: 0.05, request: {"sound":"key","seed":"kit:key:3"} }, { src: key4, seconds: 0.5013, landsAt: 0.05, request: {"sound":"key","seed":"kit:key:4"} }, { src: key5, seconds: 0.545, landsAt: 0.05, request: {"sound":"key","seed":"kit:key:5"} }, { src: key6, seconds: 0.5336, landsAt: 0.05, request: {"sound":"key","seed":"kit:key:6"} }],
  /** toggle.on */
  toggleOn: [{ src: toggleOn1, seconds: 0.5036, landsAt: 0.078, request: {"sound":"toggle.on","seed":"kit:toggleOn:1"} }, { src: toggleOn2, seconds: 0.4852, landsAt: 0.078, request: {"sound":"toggle.on","seed":"kit:toggleOn:2"} }],
  /** toggle.off */
  toggleOff: [{ src: toggleOff1, seconds: 0.5227, landsAt: 0.078, request: {"sound":"toggle.off","seed":"kit:toggleOff:1"} }, { src: toggleOff2, seconds: 0.5134, landsAt: 0.078, request: {"sound":"toggle.off","seed":"kit:toggleOff:2"} }],
  /** pop */
  pop: [{ src: pop1, seconds: 0.6199, landsAt: 0.05, request: {"sound":"pop","seed":"kit:pop:1"} }, { src: pop2, seconds: 0.6199, landsAt: 0.05, request: {"sound":"pop","seed":"kit:pop:2"} }, { src: pop3, seconds: 0.6199, landsAt: 0.05, request: {"sound":"pop","seed":"kit:pop:3"} }],
  /** whoosh */
  whoosh: [{ src: whoosh1, seconds: 1.1338, landsAt: 0.43, request: {"sound":"whoosh","seed":"kit:whoosh:1"} }],
  /** whoosh.whip */
  whip: [{ src: whip1, seconds: 0.646, landsAt: 0.14, request: {"sound":"whoosh.whip","seed":"kit:whip:1"} }],
  /** riser */
  riser: [{ src: riser1, seconds: 2.1078, landsAt: 1.55, request: {"sound":"riser","seed":"kit:riser:1"} }],
  /** impact */
  impact: [{ src: impact1, seconds: 0.6061, landsAt: 0.05, request: {"sound":"impact","seed":"kit:impact:1"} }],
  /** chime */
  chime: [{ src: chime1, seconds: 2.2115, landsAt: 0.05, request: {"sound":"chime","seed":"kit:chime:1"} }],
  /** chime.success */
  success: [{ src: success1, seconds: 2.0415, landsAt: 0.05, request: {"sound":"chime.success","seed":"kit:success:1"} }],
  /** ding */
  ding: [{ src: ding1, seconds: 2.318, landsAt: 0.05, request: {"sound":"ding","seed":"kit:ding:1"} }],
} as const satisfies Record<string, readonly SfxSound[]>;
