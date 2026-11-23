// frame-glitch-check.ts: blank and torn frames, the glitch a viewer reads as broken: part of the picture snapping to
// black, or flickering to a flat dark fill, and coming back mid-scene, as a frame read back half-painted or an undecoded
// video's backdrop does. Pure; the render measures each frame as it lands.
//
// Design stays clear of it: a fade dims before it goes flat, a snap to black cuts away and a black card cuts out,
// and a dark page's content slides rather than blanking as one block.
//
// Negative space: a region blank until the scene cuts away (a video blank to its scene's end) passes, like a card.
// Transparent videos aren't judged: their clear pixels are their design.
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';

/** The grid a frame is measured on: a cell is 30 px square at 1080p. */
export const FRAME_GLITCH_GRID = { cols: 64, rows: 36 } as const;
const CELLS = FRAME_GLITCH_GRID.cols * FRAME_GLITCH_GRID.rows;
/** Samples a cell measures along each side: 64 a cell, 147k a frame, whatever the frame's size. */
const SAMPLES_PER_SIDE = 8;

/** A frame's cells, row by row: each one's mean luma, and the spread of its samples' (max less min), both 0–255. */
export type FrameCells = { luma: Uint8Array; spread: Uint8Array };

// Blank: flat (an encode's noise aside) and dark, black or the backdrop under a video that didn't draw (#202020 seen).
const BLANK_SPREAD = 8;
const BLANK_LUMA = 48;
// Black, as unpainted pixels come back: one snap there and back is a glitch. A dark fill is a dark-mode UI's own
// background as often (a caption pill, a panel), so it's a glitch only flickering: FLICKER_SNAPS blank runs, none
// longer than FLICKER_RUN_SECONDS, starting within FLICKER_SECONDS. Content shows that briefly only by accident.
const BLACK_LUMA = 3;
const FLICKER_SNAPS = 3;
const FLICKER_SECONDS = 1;
const FLICKER_RUN_SECONDS = 0.15;
// …each run's picture resuming as it was, its level within this share of before it: a fast scroll over a dark page
// blanks and fills with new rows instead.
const RESUME_SHARE = 0.2;
// Lit: holding a picture, textured or well clear of any blank fill.
const LIT_SPREAD = 24;
const LIT_LUMA = 72;
// A cell dimming faster than this between its last two lit frames is fading, not snapping (3 frames from mid-grey).
const FADING_RATIO = 0.7;
// Longer blank than this between snaps is a deliberate card, however it's cut; the longest glitch seen held 86 frames.
const MAX_GLITCH_SECONDS = 4;

/** Measures an RGBA frame's cells (its alpha ignored, as an encode drops it): cheap enough for every frame at 4K. */
export function measureFrameCells(rgba: Uint8Array, width: number, height: number): FrameCells {
  const { cols, rows } = FRAME_GLITCH_GRID, luma = new Uint8Array(CELLS), spread = new Uint8Array(CELLS);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0, least = 255, most = 0;
      for (let sy = 0; sy < SAMPLES_PER_SIDE; sy++) {
        const y = Math.floor(((row + (sy + 0.5) / SAMPLES_PER_SIDE) * height) / rows);
        for (let sx = 0; sx < SAMPLES_PER_SIDE; sx++) {
          const x = Math.floor(((col + (sx + 0.5) / SAMPLES_PER_SIDE) * width) / cols), at = (y * width + x) * 4;
          const l = (54 * rgba[at] + 183 * rgba[at + 1] + 19 * rgba[at + 2]) >> 8;
          sum += l;
          least = Math.min(least, l);
          most = Math.max(most, l);
        }
      }
      const cell = row * cols + col;
      luma[cell] = Math.round(sum / (SAMPLES_PER_SIDE * SAMPLES_PER_SIDE));
      spread[cell] = most - least;
    }
  }
  return { luma, spread };
}

/** A glitch: frames `from`–`to` (exclusive) of the render, its most cells blank in a frame, and where, as shares of the frame. */
export type FrameGlitch = { from: number; to: number; cells: number; box: { x0: number; x1: number; y0: number; y1: number } };

/**
 * The glitches in `frames`, measured frames from frame `first` on, in `timeline`'s scenes. A cell's blank run counts
 * when it snaps both ways (from lit, not fading, and back to lit mid-scene, not fading in); it's a glitch when black,
 * or flickering.
 */
export function findFrameGlitches(frames: readonly FrameCells[], first: number, timeline: Pick<TimelineReport, 'fps' | 'scenes'>): FrameGlitch[] {
  const atCut = cutZones(timeline), longest = MAX_GLITCH_SECONDS * timeline.fps, n = frames.length;
  const blank = (k: number, cell: number) => frames[k].spread[cell] <= BLANK_SPREAD && frames[k].luma[cell] <= BLANK_LUMA;
  const lit = (k: number, cell: number) => k >= 0 && k < n && (frames[k].spread[cell] >= LIT_SPREAD || frames[k].luma[cell] >= LIT_LUMA);
  // Snapping, not fading: the lit neighbour is no dimmer or flatter than FADING_RATIO of the frame past it.
  const level = (k: number, cell: number) => frames[k].luma[cell] + frames[k].spread[cell];
  const steady = (k: number, beyond: number, cell: number) => beyond < 0 || beyond >= n || level(k, cell) >= FADING_RATIO * level(beyond, cell);
  const flagged: { cell: number; from: number; to: number; black: boolean }[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const snaps: { from: number; to: number; black: boolean; resumes: boolean }[] = [];
    for (let k = 0; k < n;) {
      if (!blank(k, cell)) { k++; continue; }
      const from = k;
      let black = true;
      for (; k < n && blank(k, cell); k++) black &&= frames[k].luma[cell] <= BLACK_LUMA;
      const into = lit(from - 1, cell) && steady(from - 1, from - 2, cell), out = lit(k, cell) && steady(k, k + 1, cell);
      // The picture coming back mid-scene is the glitch's mark: a design snaps to black and cuts away, or cuts in on
      // black and reveals; a picture that blanked then resumes as it was is a flicker's.
      const resumes = into && out && Math.abs(level(from - 1, cell) - level(k, cell)) <= RESUME_SHARE * Math.max(level(from - 1, cell), level(k, cell));
      if (into && out && !atCut(first + k) && k - from <= longest) snaps.push({ from, to: k, black, resumes });
    }
    const window = FLICKER_SECONDS * timeline.fps, brief = (j: number) => snaps[j].resumes && snaps[j].to - snaps[j].from <= FLICKER_RUN_SECONDS * timeline.fps;
    const burst = (j: number) => j + FLICKER_SNAPS <= snaps.length && snaps[j + FLICKER_SNAPS - 1].from - snaps[j].from <= window
      && Array.from({ length: FLICKER_SNAPS }, (_, m) => brief(j + m)).every(Boolean);
    const flickering = (i: number) => snaps.some((_, j) => j <= i && i < j + FLICKER_SNAPS && burst(j));
    snaps.forEach((snap, i) => {
      if (snap.black || flickering(i)) flagged.push({ cell, from: first + snap.from, to: first + snap.to, black: snap.black });
    });
  }
  return solidGlitches(flagged);
}

/** Whether a frame lies on a cut or its crossfade, a frame either side: a snap there is the edit's. */
function cutZones({ scenes }: Pick<TimelineReport, 'scenes'>): (frame: number) => boolean {
  const zones = scenes.slice(1).map((scene, k) => ({ from: Math.min(scene.visible.from, scene.from) - 1, to: Math.max(scenes[k].visible.to, scene.from) + 1 }));
  return (frame) => zones.some((z) => frame >= z.from && frame <= z.to);
}

/**
 * Frames where flagged runs make a solid block blanking at once, consecutive ones joined: neighbours blank over the
 * same frames, 3 cells (~90 px at 1080p) thick for black, 5 for a flickering dark fill. Bold type and border bars
 * are thinner; so are the gaps between paragraphs a fast scroll over a dark page flickers through.
 */
function solidGlitches(runs: readonly { cell: number; from: number; to: number; black: boolean }[]): FrameGlitch[] {
  const { cols, rows } = FRAME_GLITCH_GRID, byFrame = new Map<number, Map<number, string>>();
  for (const { cell, from, to, black } of runs) for (let f = from; f < to; f++) byFrame.set(f, (byFrame.get(f) ?? new Map<number, string>()).set(cell, `${from}-${to}${black ? ' black' : ''}`));
  const glitches: FrameGlitch[] = [];
  for (const frame of [...byFrame.keys()].toSorted((a, b) => a - b)) {
    const active = byFrame.get(frame)!, block = new Set<number>();
    for (const [cell, run] of active) {
      const col = cell % cols, row = Math.floor(cell / cols);
      const sameRun = (dx: number, dy: number) => col + dx >= 0 && row + dy >= 0 && col + dx < cols && row + dy < rows && active.get((row + dy) * cols + col + dx) === run;
      const reach = run.endsWith(' black') ? [-1, 0, 1] : [-2, -1, 0, 1, 2];
      if (!reach.every((dy) => reach.every((dx) => sameRun(dx, dy)))) continue;
      for (const dy of reach) for (const dx of reach) block.add((row + dy) * cols + col + dx);
    }
    if (!block.size) continue;
    const xs = [...block].map((c) => c % cols), ys = [...block].map((c) => Math.floor(c / cols));
    const box = { x0: Math.min(...xs) / cols, x1: (Math.max(...xs) + 1) / cols, y0: Math.min(...ys) / rows, y1: (Math.max(...ys) + 1) / rows };
    const last = glitches.at(-1);
    if (last && last.to === frame) {
      last.to = frame + 1;
      last.cells = Math.max(last.cells, block.size);
      last.box = { x0: Math.min(last.box.x0, box.x0), x1: Math.max(last.box.x1, box.x1), y0: Math.min(last.box.y0, box.y0), y1: Math.max(last.box.y1, box.y1) };
    } else glitches.push({ from: frame, to: frame + 1, cells: block.size, box });
  }
  return glitches;
}

const percentOf = (share: number) => Math.round(share * 100);

/** A glitch as a render's failure names it: its frames, and where in the frame, as `x 0–100%, y 50–100%`. */
export function frameGlitchText({ from, to, box }: FrameGlitch): string {
  const frames = to - from === 1 ? `frame ${from}` : `frames ${from}–${to - 1}`;
  return `${frames} blank at x ${percentOf(box.x0)}–${percentOf(box.x1)}%, y ${percentOf(box.y0)}–${percentOf(box.y1)}% of the frame`;
}
