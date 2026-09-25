// The motion showcase: Painful Pleasures' new buy box as a 20 s reel on the drive track, one bar per idea, each named in
// the HUD by the craft it shows off. The bars live in bars/, the clock and palette in timeline.ts, the frame every bar
// is drawn inside in reel.tsx, the beat sheet in storyboard.md.

import { FPS, defineVideo } from '../../lib/studio/api.ts';
import { bounceBar } from './bars/01-bounce.tsx';
import { everyColorBar } from './bars/02-every-color.tsx';
import { swatchesBar } from './bars/03-swatches.tsx';
import { inkBar } from './bars/04-ink.tsx';
import { searchBar } from './bars/05-search.tsx';
import { buyMoreBar } from './bars/06-buy-more.tsx';
import { tiersBar } from './bars/07-tiers.tsx';
import { payLessBar } from './bars/08-pay-less.tsx';
import { oneBoxBar } from './bars/09-one-box.tsx';
import { barScene, reelTrack } from './reel.tsx';
import { SOUND_LAG_SECONDS } from './timeline.ts';

/** The bars in order, exported so a check can read their cuts, kicks and sounds. */
export const showcaseBars = [bounceBar, everyColorBar, swatchesBar, inkBar, searchBar, buyMoreBar, tiersBar, payLessBar, oneBoxBar];
// Each lands with the music's hit. Its id, the bar's and its role there, picks the take, so two sounds sharing one
// would play the same take and read as one row in every check.
const sounds = showcaseBars.flatMap((bar) => (bar.sounds ?? []).map(({ at, id, ...sound }) => ({ ...sound, at: at / FPS + SOUND_LAG_SECONDS, id: `${bar.id}/${id}` })));
const repeatedSoundId = sounds.find((s, i) => sounds.findIndex((other) => other.id === s.id) !== i)?.id;
if (repeatedSoundId) throw new Error(`two sounds are ${repeatedSoundId}: give each its own role in its bar`);

// The music leads, 4 LU over the accents: measured at their moments, the strikes and whips sit 3–6 LU under the
// track, heard but inside it, and the last needle rides over the final hit's tail.
export default defineVideo({
  title: 'Painful Pleasures: the new buy box', voice: {}, scenes: showcaseBars.map(barScene), music: { track: reelTrack, bedRelativeLu: -4 }, sounds,
});
