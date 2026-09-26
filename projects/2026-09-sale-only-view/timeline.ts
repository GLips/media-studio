// The walkthrough's timing, stated once: each scene's lines as recorded, and the words its picture moves on. A
// re-recorded line re-times its scene, every later one and each cue on its words; `studio clock` prints it.

import { defineTimeline, voiceSpan } from '#models/timeline/timeline.ts';
import { voice } from './audio/manifest.ts';

// Seconds each crossfade takes, centred on its cut. The clicks from one page to the next cut hard instead.
const XFADE = 0.5;

export const timeline = defineTimeline({
  voice,
  scenes: {
    title: voiceSpan(['intro'], { lead: 1.4, tail: 1.0 }),
    today: voiceSpan(['problem-a', 'problem-b'], {
      lead: 0.5, gap: 0.5, tail: 0.6, crossfade: XFADE,
      cues: {
        // The card is clicked on "sale item", so the product page lands as it's named.
        click: { line: 'problem-a', phrase: 'item' },
        fullPrice: { line: 'problem-a', phrase: 'at full price' },
        // "They have to hunt": the picker's ring gives way and the cursor goes looking.
        hunt: { line: 'problem-b' },
      },
    }),
    fix: voiceSpan(['fix-a', 'fix-b'], {
      lead: 0.9, gap: 0.5, tail: 0.8, crossfade: XFADE,
      cues: {
        // The same click, as the line starts.
        click: { line: 'fix-a' },
        onlyOnSale: { line: 'fix-a', phrase: 'showing only' },
        note: { line: 'fix-b' },
      },
    }),
    pick: voiceSpan(['pick'], { lead: 0.6, tail: 0.5, cues: { choose: { line: 'pick', phrase: 'they choose' } } }),
    'show-all': voiceSpan(['show-all'], { lead: 0.6, tail: 1.0, min: 4.2, cues: { click: { line: 'show-all', phrase: 'click' } } }),
    'all-on-sale': voiceSpan(['all-on-sale'], {
      lead: 1.0, tail: 1.4, min: 5.5, crossfade: XFADE,
      cues: { land: { line: 'all-on-sale' }, saysSo: { line: 'all-on-sale', phrase: 'the page simply says so' } },
    }),
    big: voiceSpan(['big'], {
      lead: 0.5, tail: 1.6, min: 8.5, crossfade: XFADE,
      cues: { listings: { line: 'big', phrase: 'the biggest listings' }, narrowed: { line: 'big', phrase: 'variations' } },
    }),
    pricing: voiceSpan(['pricing'], { lead: 2.2, tail: 0.6, crossfade: XFADE, cues: { card: { line: 'pricing' } } }),
    rollout: voiceSpan(['rollout'], { lead: 0.4, tail: 3.4, cues: { card: { line: 'rollout' } } }),
  },
});
