// kit.ts: written by `studio sfx kit` from lib/sfx/sfx-files.ts. Change the kit there and rerun, rather than editing this.
import type { SfxSound } from '../sfx.tsx';
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
  click: [{ src: click1, seconds: 0.4074, landsAt: 0 }, { src: click2, seconds: 0.4102, landsAt: 0 }, { src: click3, seconds: 0.4243, landsAt: 0 }, { src: click4, seconds: 0.4496, landsAt: 0 }],
  /** key */
  key: [{ src: key1, seconds: 0.4743, landsAt: 0 }, { src: key2, seconds: 0.4966, landsAt: 0 }, { src: key3, seconds: 0.5013, landsAt: 0 }, { src: key4, seconds: 0.4513, landsAt: 0 }, { src: key5, seconds: 0.495, landsAt: 0 }, { src: key6, seconds: 0.4836, landsAt: 0 }],
  /** toggle.on */
  toggleOn: [{ src: toggleOn1, seconds: 0.4536, landsAt: 0.028 }, { src: toggleOn2, seconds: 0.4352, landsAt: 0.028 }],
  /** toggle.off */
  toggleOff: [{ src: toggleOff1, seconds: 0.4727, landsAt: 0.028 }, { src: toggleOff2, seconds: 0.4634, landsAt: 0.028 }],
  /** pop */
  pop: [{ src: pop1, seconds: 0.5699, landsAt: 0 }, { src: pop2, seconds: 0.5699, landsAt: 0 }, { src: pop3, seconds: 0.5699, landsAt: 0 }],
  /** whoosh */
  whoosh: [{ src: whoosh1, seconds: 1.0366, landsAt: 0.385 }],
  /** whoosh.whip */
  whip: [{ src: whip1, seconds: 0.581, landsAt: 0.096 }],
  /** riser */
  riser: [{ src: riser1, seconds: 2.0578, landsAt: 1.5 }],
  /** impact */
  impact: [{ src: impact1, seconds: 1.115, landsAt: 0 }],
  /** chime */
  chime: [{ src: chime1, seconds: 2.1615, landsAt: 0 }],
  /** chime.success */
  success: [{ src: success1, seconds: 1.9915, landsAt: 0 }],
  /** ding */
  ding: [{ src: ding1, seconds: 2.268, landsAt: 0 }],
} as const satisfies Record<string, readonly SfxSound[]>;
