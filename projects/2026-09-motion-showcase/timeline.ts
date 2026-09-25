// The reel's clock, palette and inks, shared by every bar. Times are video frames (30 fps) unless a name says seconds.

import { FPS, beatGrid, seededRandom } from '../../lib/studio/api.ts';
import { music } from './music/index.ts';

export const track = music['drive-fit'];
export const grid = beatGrid(track, { steady: true });

// The tracker hears a hit about 20 ms late, and the picture should lead the sound by about a frame, as the reference
// reel's does (by 40 ms), so a beat's cut or hit is two frames before the tracker's beat frame.
const HIT_LEAD_FRAMES = 2;
/**
 * How far a placed sound trails the picture's event it marks. The music's attacks land about 35 ms after their frames
 * (`studio mix` measures each sound's gap to them), so a sound on the frame itself would strike that much ahead of the
 * music's hit, heard as a flam, not one hit.
 */
export const SOUND_LAG_SECONDS = 0.035;

/** The frame the track's beat `n` hits on (fractions for off-beats). Bars reach it through `barBeatFrame`. */
const hitFrame = (n: number) => Math.round(grid.at(n) * FPS) - HIT_LEAD_FRAMES;
/** The beat at `frame`, as a fraction, on the picture's clock: whole on each hit frame. */
export const beatAtFrame = (frame: number) => grid.beatOf((frame + HIT_LEAD_FRAMES) / FPS);

/**
 * The reel's structure, and its one statement: each bar's length in beats, from bar 1's downbeat (the track's beat
 * 0), and for a bar that cuts in after its first beat, by how much. A bar times its moments in beats from its own
 * first beat, so a bar made longer here moves every later bar with it. Tools read it through tools/bar-clock.ts.
 */
export const BAR_TABLE: readonly { beats: number; cutIn?: number }[] = [
  { beats: 4 }, { beats: 4 },
  // The product's hold and the needle's first strike each get half a bar of room, and the price a whole bar: the
  // music plays drive's bars 1–7 and 9–13 to make the 44 beats.
  { beats: 6 }, { beats: 6 }, { beats: 4 }, { beats: 4 }, { beats: 4 }, { beats: 8 },
  // The finale cuts in on its downbeat's "and", so bar 8's poster holds over the downbeat. Its last beat is the
  // music's final hit; the ring-out and the hold after it run on to the video's end.
  { beats: 4, cutIn: 0.5 },
];
export const BAR_COUNT = BAR_TABLE.length;

/** The track's beat bar `k` (1–9) starts on. */
export const barStartBeat = (k: number) => {
  if (!BAR_TABLE[k - 1]) throw new Error(`no bar ${k}: the reel has bars 1–${BAR_COUNT}`);
  return BAR_TABLE.slice(0, k - 1).reduce((sum, row) => sum + row.beats, 0);
};
/** The frame beat `n` of bar `k` hits on, counted from the bar's first beat: fractions for off-beats. */
export const barBeatFrame = (k: number, n: number) => hitFrame(barStartBeat(k) + n);
/** The frame bar `k` starts on: its first beat's hit, or where it cuts in. Bar 1 starts on the video's first frame. */
export const barFrame = (k: number) => (k === 1 ? 0 : barBeatFrame(k, BAR_TABLE[k - 1].cutIn ?? 0));

// The music is a recording, re-cut only in whole bars (`studio music fit --bars`), so a bar length changed above needs
// the music re-fitted to match, or the reel ends over the wrong bar of it.
const FINAL_HIT_BEAT = barStartBeat(BAR_COUNT) + BAR_TABLE[BAR_COUNT - 1].beats;
if (Math.abs(grid.at(FINAL_HIT_BEAT) - track.fit.downbeats.at(-1)!) > 0.05) {
  throw new Error(`the bar table ends the finale on the track's beat ${FINAL_HIT_BEAT} (${grid.at(FINAL_HIT_BEAT).toFixed(2)} s), `
    + `but the music's final hit is at ${track.fit.downbeats.at(-1)} s: re-fit it with studio music fit --bars, or change the table`);
}

/** The video's last frame, exclusive: the fitted track ends with it, silence and all. */
export const END_FRAME = Math.round(track.duration * FPS);
/** The frames the whole picture fades to black over, ending a few frames before the video does. */
export const FADE_TO_BLACK = { from: END_FRAME - 9, to: END_FRAME - 5 } as const;

export const P = {
  ground: '#0c0c0e', red: '#ee4c23', blue: '#4144f4', cream: '#f3f0e7', ink: '#140b0e',
  // The Solice's three swatches, sampled from the capture.
  black: '#000000', magenta: '#ff00c2', graphite: '#3d404b',
} as const;

/** The HUD's section labels, one per bar. */
export const SECTION_TITLES = [
  'SQUASH & STRETCH', 'KINETIC TYPE', 'DEPTH / UI', 'INK × 174', 'FILTER', 'TYPE AS TEXTURE', '3D / DEPTH OF FIELD', 'ODOMETER',
  'EDIT / RHYTHM',
] as const;

export type Ink = { color: string; hue: number; chroma: number; lightness: number };

/**
 * 174 inks, as a maker's chart runs: 150 hues round the wheel, each at one of five strengths so neighbours differ in
 * lightness, then 24 blacks, greys and whites. `inksByHue` is the chart order (for rings of a ripple); `inks` is a
 * seeded shuffle (for a field where every ink sits somewhere).
 */
export const inksByHue: Ink[] = (() => {
  const out: Ink[] = [];
  const strengths = [[0.62, 0.2], [0.48, 0.17], [0.74, 0.15], [0.38, 0.12], [0.56, 0.22]] as const;
  for (let i = 0; i < 150; i++) {
    const hue = (i / 150) * 360, [l, c] = strengths[i % 5];
    out.push({ color: `oklch(${l} ${c} ${hue.toFixed(1)})`, hue, chroma: c, lightness: l });
  }
  for (let i = 0; i < 24; i++) {
    const l = 0.12 + i * 0.036;
    out.push({ color: `oklch(${l.toFixed(3)} 0.01 60)`, hue: 60, chroma: 0.01, lightness: l });
  }
  return out;
})();

export const inks: Ink[] = (() => {
  const rnd = seededRandom('inks');
  return inksByHue.map((ink) => [rnd(), ink] as const).sort((a, b) => a[0] - b[0]).map(([, ink]) => ink);
})();

// The shop's ink search finds 17 of its 174 for "blue"; the 17 chart hues nearest cobalt's stand in for them.
const BLUE_HUE = 258;
const blueSet = new Set(
  inksByHue.filter((ink) => ink.chroma > 0.05).sort((a, b) => Math.abs(a.hue - BLUE_HUE) - Math.abs(b.hue - BLUE_HUE)).slice(0, 17),
);
export const isBlueInk = (ink: Ink) => blueSet.has(ink);
