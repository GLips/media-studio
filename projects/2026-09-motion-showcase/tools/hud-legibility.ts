// hud-legibility.ts: is the showcase's HUD legible on every frame of a render?
//   node projects/2026-09-motion-showcase/tools/hud-legibility.ts <mp4> [--from=<video frame of the mp4's frame 0>]
//     [--frames=a-b] [--show=<frame>]
// A bar's render (out/wip/bars/0N.mp4) starts at the bar's first frame unless --from says otherwise.
// The ink is where a render of the HUD alone draws (out/hud-mask/, redone when its code or text changes).
// In luma, glyph by glyph (the rule in 20 px stretches), a part VANISHES when its ink's far fifth stands under ΔL 40
// from the median ground 3–6 px around it (a beat square passes on colour too); word by word, it's BUSY when 12% of
// that ground is on a sharp step to something ink-coloured. Both thresholds sit between the critic's failing frames
// and the frames it calls clean.
import '#engine/bundle/tsx-test-hooks.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnFfmpeg } from '#engine/ffmpeg/ffmpeg.ts';
import type { Rect } from '#studio';
import type { ReelHudSlot } from '#models/reel/hud.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const PROJECT = resolve(import.meta.dirname, '..');
// The mask renders from a project of its own, since a render session bundles a project's video.tsx.
const MASK_PROJECT = join(PROJECT, 'out/hud-mask');
const MASK_DIR = join(MASK_PROJECT, 'mask');

const VANISH_DL = 40, BUSY_SHARE = 0.12, BUSY_RING = 400;
// A ground pixel is on a step when one EDGE_REACH px away differs by half the ink's contrast, and at least EDGE_MIN.
const EDGE_REACH = 2, EDGE_MIN = 32;
// Mask levels (paper on black, 0–255): any ink at all; ink meant to read (the rule's unfilled track, at 20%, isn't);
// and the core of a stroke, as a share of its word's brightest.
const ANY_INK = 8, WORD_INK = 64, CORE = 0.5;
// Ground is judged `RING` px around the ink, from `CLEAR` px out, past the antialiasing and the lens's resting fringe.
const RING = 6, CLEAR = 3;
// Glyphs are ink runs split at a clear column (stretches of up to STRETCH px for the rule); words, glyphs under
// WORD_GAP px apart.
const GLYPH_GAP = 1, WORD_GAP = 10, STRETCH = 20;

const { SHOWCASE_HUD } = await import(`${PROJECT}/hud.ts`);
const { showcaseBars } = await import(`${PROJECT}/video.tsx`);
const { SHOWCASE_FORMAT, timeline } = await import(`${PROJECT}/timeline.ts`);
const W: number = SHOWCASE_FORMAT.width, FPS: number = timeline.fps;
const { REEL_HUD_SLOTS, reelHudBoxes } = await import(`${ROOT}/lib/models/reel/hud.ts`);

const { lensFringeAt, lensFringeSubpixelMax } = await import(`${ROOT}/lib/models/reel/lens.ts`);

// Each bar where the video plays it, its kicks and glitches moved from its own clock onto the video's frames.
type Bar = { id: string; scene: { from: number; to: number }; kicks: readonly number[]; glitches: readonly number[] };
type PlacedBar = { bar: { id: string; kicks?: readonly number[]; glitches?: readonly number[] }; scene: { origin: number; from: number; to: number } };
const bars: Bar[] = (showcaseBars as PlacedBar[]).map(({ bar, scene }) => ({
  id: bar.id, scene, kicks: (bar.kicks ?? []).map((f) => scene.origin + f), glitches: (bar.glitches ?? []).map((f) => scene.origin + f),
}));
const barOf = (f: number) => bars.find((b) => f >= b.scene.from && f < b.scene.to)!;
// The reel's fade takes the HUD down with everything from here.
const FADE_FROM = timeline.fade.from;

/** Marks a frame where the lens moves the HUD's channels whole px apart, by design: a cut's kick, a glitch's split. */
function lensMark(f: number) {
  const bar = barOf(f);
  const kicks = [...(bar.scene.from > 0 ? [bar.scene.from] : []), ...bar.kicks].map((k) => k / FPS);
  const fringe = lensFringeAt(f / FPS, FPS, { kicks, splits: bar.glitches.map((g) => g / FPS) });
  return fringe.red || fringe.blue ? ' (split)' : fringe.radial > lensFringeSubpixelMax(SHOWCASE_FORMAT) ? ' (kick)' : '';
}

// ---------- arguments ----------

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const input = args.find((a) => !a.startsWith('--'));
if (!input) throw new Error('usage: node projects/2026-09-motion-showcase/tools/hud-legibility.ts <mp4> [--from=N] [--frames=a-b] [--show=N]');
const barFile = /bars\/0?(\d)\.mp4$/.exec(input);
const from = Number(flag('from') ?? (barFile ? bars[Number(barFile[1]) - 1].scene.from : 0));
const [lo, hi] = (flag('frames') ?? `0-${timeline.end - 1}`).split('-').map(Number);
const show = flag('show') === undefined ? undefined : Number(flag('show'));

// ---------- the mask ----------

// The showcase's HUD alone, paper on black, over every frame of the reel. No lens and no grain, so each ink pixel sits
// where the cut's does.
const MASK_VIDEO = `import { defineScene, defineVideo } from '#studio';
import { ReelHud } from '#studio/reel/hud.tsx';
import { SHOWCASE_HUD } from '../../hud.ts';
import { SHOWCASE_FORMAT, timeline } from '../../timeline.ts';

const hudMask = defineScene({
  id: 'hud-mask', note: 'The showcase HUD, paper on black', min: timeline.end / timeline.fps, lead: 0, tail: 0, cut: true,
  render: (s) => (
    <>
      <div style={{ position: 'absolute', inset: 0, background: '#000' }} />
      <ReelHud t={Math.round(s.t * timeline.fps) / timeline.fps} {...SHOWCASE_HUD} />
    </>
  ),
});

export default defineVideo({ title: 'Showcase HUD mask', voice: {}, scenes: [hudMask], format: SHOWCASE_FORMAT });
`;
const MASK_INPUTS = ['lib/studio/reel/hud.tsx', 'lib/models/reel/hud.ts', 'lib/models/reel/type.ts', 'lib/studio/fonts/fonts.ts'].map((f) => join(ROOT, f))
  .concat(['hud.ts', 'look.ts', 'timeline.ts'].map((f) => join(PROJECT, f)));
const stamp = createHash('sha1').update([MASK_VIDEO, ...MASK_INPUTS.map((f) => readFileSync(f))].join('\0')).digest('hex');
const stampFile = join(MASK_DIR, 'stamp');

if (!existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== stamp) {
  console.error('rendering the HUD alone for its ink mask…');
  mkdirSync(MASK_PROJECT, { recursive: true });
  writeFileSync(join(MASK_PROJECT, 'video.tsx'), MASK_VIDEO);
  const { openRenderSession } = await import('#engine/render/render-session.ts');
  const session = await openRenderSession(MASK_PROJECT);
  rmSync(MASK_DIR, { recursive: true, force: true });
  mkdirSync(MASK_DIR, { recursive: true });
  await session.renderFrameFiles({ outputDir: MASK_DIR, imageFormat: 'png', imageSequencePattern: 'f-[frame].[ext]' });
  writeFileSync(stampFile, stamp);
}
const maskFiles = readdirSync(MASK_DIR).filter((f) => f.endsWith('.png'));
const digits = /f-(\d+)\.png/.exec(maskFiles[0])![1].length;

// ---------- the HUD's rows ----------

// Each row of parts, cut out of every frame with room for the ground around it; the two are stacked into one band.
// Cropped as RGB: ffmpeg rounds an odd crop offset to even on 4:2:0 video, which would set the band a row off the mask's.
const rowBoxes = reelHudBoxes(SHOWCASE_HUD, 0, SHOWCASE_FORMAT) as Record<ReelHudSlot, Rect>;
const PAD = 10;
const rows = [rowBoxes.tl, rowBoxes.timecode].map((b) => ({ y: Math.round(b.y) - PAD, h: Math.round(b.h) + 2 * PAD }));
const BAND_H = rows[0].h + rows[1].h;
const bandY = (y: number) => (y < rows[1].y ? y - rows[0].y : rows[0].h + y - rows[1].y);
const cropFilter = `format=rgb24,split=2[a][b];[a]crop=${W}:${rows[0].h}:0:${rows[0].y}[t];[b]crop=${W}:${rows[1].h}:0:${rows[1].y}[u];[t][u]vstack=inputs=2`;

/**
 * Frames from ffmpeg. Stopping early (a bar's render ends long before the reel's mask) kills it outright: closing its
 * pipe first would have it report a write error.
 */
async function* rawFrames(ffmpegArgs: string[], frameBytes: number): AsyncGenerator<Buffer> {
  const ff = spawnFfmpeg(['-v', 'error', ...ffmpegArgs], { stdio: ['ignore', 'pipe', 'inherit'] });
  const chunks = (ff.stdout as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  let frame = Buffer.alloc(frameBytes), fill = 0;
  try {
    for (let next = await chunks.next(); !next.done; next = await chunks.next()) {
      const chunk = next.value;
      for (let off = 0; off < chunk.length;) {
        const n = Math.min(frameBytes - fill, chunk.length - off);
        chunk.copy(frame, fill, off, off + n);
        fill += n; off += n;
        if (fill === frameBytes) {
          yield frame;
          frame = Buffer.alloc(frameBytes);
          fill = 0;
        }
      }
    }
  } finally {
    ff.kill('SIGKILL');
  }
}

// ---------- measuring ----------

/** One glyph's ink (or a stretch of the rule, or a bracket) against the ground around it; dC is their colours' distance. */
type Glyph = { x0: number; x1: number; ink: number; ground: number; dL: number; dC: number; ring: number; edges: number };
/** A part's word: glyphs a space or less apart. Its busy share pools its glyphs' grounds. */
type Word = { slot: ReelHudSlot; x0: number; x1: number; worst: Glyph; busy: number };

/** The level a share `q` of a histogram's `n` counts lie at or under. */
function quantile(hist: Uint32Array, n: number, q: number) {
  for (let v = 0, seen = 0; v < 256; v++) if ((seen += hist[v]) >= q * n) return v;
  return 255;
}

/** The frame's band as luma, and where it's clear of any ink by CLEAR px (the mask dilated, a row then a column). */
function prepare(rgb: Buffer, mask: Buffer) {
  const n = W * BAND_H, luma = new Uint8Array(n), across = new Uint8Array(n), near = new Uint8Array(n);
  for (let i = 0; i < n; i++) luma[i] = Math.round(0.2126 * rgb[3 * i] + 0.7152 * rgb[3 * i + 1] + 0.0722 * rgb[3 * i + 2]);
  for (let y = 0; y < BAND_H; y++) for (let x = 0; x < W; x++) {
    for (let d = -CLEAR; d <= CLEAR; d++) if (mask[y * W + Math.min(W - 1, Math.max(0, x + d))] >= ANY_INK) { across[y * W + x] = 1; break; }
  }
  for (let y = 0; y < BAND_H; y++) for (let x = 0; x < W; x++) {
    for (let d = -CLEAR; d <= CLEAR; d++) if (across[Math.min(BAND_H - 1, Math.max(0, y + d)) * W + x]) { near[y * W + x] = 1; break; }
  }
  return { luma, near };
}

/** Every word of every part on one frame. */
function measureFrame(rgb: Buffer, mask: Buffer, f: number): Word[] {
  const { luma, near } = prepare(rgb, mask);
  const boxes = reelHudBoxes(SHOWCASE_HUD, f / FPS, SHOWCASE_FORMAT) as Record<ReelHudSlot, Rect>;
  const words: Word[] = [];
  for (const slot of REEL_HUD_SLOTS as ReelHudSlot[]) {
    const b = boxes[slot];
    const x0 = Math.max(0, Math.floor(b.x) - 2), x1 = Math.min(W - 1, Math.ceil(b.x + b.w) + 2);
    const row = rows[b.y < rows[1].y ? 0 : 1], y0 = bandY(Math.floor(b.y)), y1 = bandY(Math.ceil(b.y + b.h));
    const rowTop = bandY(row.y), rowBottom = rowTop + row.h - 1;
    // Glyphs are ink runs across the part split at a clear column; the rule and long strokes in stretches.
    const inked = (x: number) => { for (let y = y0; y <= y1; y++) if (mask[y * W + x] >= WORD_INK) return true; return false; };
    const runs: [number, number][] = [];
    for (let x = x0; x <= x1; x++) {
      if (!inked(x)) continue;
      const last = runs.at(-1);
      if (last && x - last[1] <= GLYPH_GAP && x - last[0] < STRETCH) last[1] = x;
      else runs.push([x, x]);
    }
    const glyphs = runs.flatMap(([g0, g1]) => measureGlyph(rgb, luma, mask, near, g0, g1, y0, y1, rowTop, rowBottom) ?? []);
    for (const g of glyphs) {
      const last = words.at(-1);
      if (last && last.slot === slot && g.x0 - last.x1 < WORD_GAP) {
        last.x1 = g.x1;
        if (vanishes(slot, g) >= vanishes(slot, last.worst) && Math.abs(g.dL) < Math.abs(last.worst.dL)) last.worst = g;
        (last as Word & { glyphs: Glyph[] }).glyphs.push(g);
      } else words.push({ slot, x0: g.x0, x1: g.x1, worst: g, busy: 0, glyphs: [g] } as Word & { glyphs: Glyph[] });
    }
  }
  // A word with too little ground to call busy (a dash, the rule's first frames) is judged with its whole part.
  const share = (gs: Glyph[]) => {
    const ring = gs.reduce((sum, g) => sum + g.ring, 0);
    return { ring, busy: ring ? gs.reduce((sum, g) => sum + g.edges, 0) / ring : 0 };
  };
  for (const w of words as (Word & { glyphs: Glyph[] })[]) {
    const own = share(w.glyphs);
    const part = share((words as (Word & { glyphs: Glyph[] })[]).filter((o) => o.slot === w.slot).flatMap((o) => o.glyphs));
    w.busy = own.ring >= BUSY_RING ? own.busy : part.ring >= BUSY_RING ? part.busy : 0;
  }
  return words;
}

function measureGlyph(rgb: Buffer, luma: Uint8Array, mask: Buffer, near: Uint8Array, x0: number, x1: number, y0: number, y1: number, rowTop: number, rowBottom: number): Glyph | null {
  let peak = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) peak = Math.max(peak, mask[y * W + x]);
  const core = CORE * peak;
  const isCore = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && mask[y * W + x] >= core;
  let bx0 = x1, bx1 = x0, by0 = y1, by1 = y0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!isCore(x, y)) continue;
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }
  // The strokes, and a pixel either side of them for the lens's shift.
  const inkHist = new Uint32Array(256), inkRgb = [0, 1, 2].map(() => new Uint32Array(256));
  let n = 0;
  for (let y = by0 - 1; y <= by1 + 1; y++) for (let x = bx0 - 1; x <= bx1 + 1; x++) {
    if (!(isCore(x, y) || isCore(x - 1, y) || isCore(x + 1, y) || isCore(x, y - 1) || isCore(x, y + 1))) continue;
    inkHist[luma[y * W + x]]++;
    if (isCore(x, y)) for (let c = 0; c < 3; c++) inkRgb[c][rgb[3 * (y * W + x) + c]]++;
    n++;
  }
  if (n < 8) return null;
  // The ground: around the ink's box, within its row, clear of any ink.
  const gx0 = Math.max(0, bx0 - RING), gx1 = Math.min(W - 1, bx1 + RING);
  const gy0 = Math.max(rowTop, by0 - RING), gy1 = Math.min(rowBottom, by1 + RING);
  const groundHist = new Uint32Array(256), groundRgb = [0, 1, 2].map(() => new Uint32Array(256));
  let ring = 0, cores = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isCore(x, y)) cores++;
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) {
    if (near[y * W + x]) continue;
    groundHist[luma[y * W + x]]++;
    for (let c = 0; c < 3; c++) groundRgb[c][rgb[3 * (y * W + x) + c]]++;
    ring++;
  }
  if (ring < 30) return null;
  const ground = quantile(groundHist, ring, 0.5);
  const [dim, bright] = [quantile(inkHist, n, 0.2), quantile(inkHist, n, 0.8)];
  const ink = Math.abs(bright - ground) >= Math.abs(dim - ground) ? bright : dim;
  const inkColor = [0, 1, 2].map((c) => quantile(inkRgb[c], cores, 0.5));
  const groundColor = [0, 1, 2].map((c) => quantile(groundRgb[c], ring, 0.5));
  const dC = Math.hypot(...inkColor.map((v, c) => v - groundColor[c])) / Math.sqrt(3);
  // Busy: ground on a step as strong as half the ink's own contrast, both sides within the ring, whose far side from
  // the ground is ink-coloured: type or a stroke the ink could be taken for, not a line of another hue crossing it.
  const step = Math.max(EDGE_MIN, 0.5 * Math.abs(ink - ground));
  const inkLike = (i: number) => {
    const d = (to: number[]) => Math.hypot(...to.map((v, c) => rgb[3 * i + c] - v));
    return d(inkColor) < d(groundColor);
  };
  let edges = 0;
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) {
    const i = y * W + x;
    if (near[i]) continue;
    for (const [dx, dy] of [[EDGE_REACH, 0], [-EDGE_REACH, 0], [0, EDGE_REACH], [0, -EDGE_REACH]]) {
      const xx = x + dx, yy = y + dy, j = yy * W + xx;
      if (xx < gx0 || xx > gx1 || yy < gy0 || yy > gy1 || near[j] || Math.abs(luma[i] - luma[j]) < step) continue;
      if (inkLike(Math.abs(luma[i] - ground) >= Math.abs(luma[j] - ground) ? i : j)) { edges++; break; }
    }
  }
  return { x0, x1, ink, ground, dL: ink - ground, dC, ring, edges };
}

// Text reads by its luma against the ground's; a beat square, a solid shape, has only to be seen, so its colour counts.
const vanishes = (slot: ReelHudSlot, g: Glyph) => Math.abs(g.dL) < VANISH_DL && (slot !== 'beats' || g.dC < VANISH_DL);
const verdict = (w: Word) => (vanishes(w.slot, w.worst) ? 'VANISH' : w.busy >= BUSY_SHARE ? 'BUSY' : '');

// ---------- the run ----------

const cutFrames = rawFrames(['-i', input, '-filter_complex', `[0:v]${cropFilter}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], W * BAND_H * 3);
const masks = rawFrames(['-start_number', String(from), '-i', join(MASK_DIR, `f-%0${digits}d.png`), '-filter_complex', `[0:v]${cropFilter},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], W * BAND_H)[Symbol.asyncIterator]();

type Failure = { f: number; word: Word; why: string };
const failures: Failure[] = [];
let judged = 0, k = 0;
for await (const rgb of cutFrames) {
  const f = from + k++;
  const { value: mask, done } = await masks.next();
  if (done || f >= timeline.end) break;
  if (f < lo || f > hi) continue;
  const words = measureFrame(rgb, mask, f);
  if (f === show) {
    for (const w of words) {
      console.log(`${f} ${w.slot.padEnd(8)} x${w.x0}–${w.x1}`.padEnd(30), `worst glyph x${w.worst.x0}: ink ${w.worst.ink} ground ${w.worst.ground} ΔL ${w.worst.dL} · busy ${(100 * w.busy).toFixed(0)}% ${verdict(w)}`);
    }
  }
  if (f >= FADE_FROM) continue;
  judged++;
  // A part's worst word stands for it.
  for (const slot of REEL_HUD_SLOTS as ReelHudSlot[]) {
    const worst = words.filter((w) => w.slot === slot && verdict(w)).sort((a, b) => Math.abs(a.worst.dL) - Math.abs(b.worst.dL) || b.busy - a.busy)[0];
    if (worst) failures.push({ f, word: worst, why: verdict(worst) });
  }
}
await masks.return(undefined);

// ---------- the report ----------

const ranges = (fs: number[]) => fs.reduce<[number, number][]>((out, f) => {
  const last = out.at(-1);
  if (last && f === last[1] + 1) last[1] = f;
  else out.push([f, f]);
  return out;
}, []).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

console.log(`${basename(input)}: video frames ${from + Math.max(0, lo - from)}–${Math.min(from + k - 1, hi, FADE_FROM - 1)}, ${judged} judged (the fade from ${FADE_FROM} isn't)`);
console.log(`VANISH: ink under ΔL ${VANISH_DL} from the ground around it · BUSY: ${100 * BUSY_SHARE}% or more of that ground on a step to something ink-coloured · (kick), (split): the lens moves the HUD's channels apart, by design`);
if (!failures.length) console.log('every part legible on every frame');
for (const bar of bars) {
  const mine = failures.filter((x) => barOf(x.f) === bar);
  if (!mine.length) continue;
  console.log(`\n${bar.id} (${bar.scene.from}–${bar.scene.to - 1}): ${new Set(mine.map((x) => x.f)).size} frames`);
  for (const slot of REEL_HUD_SLOTS as ReelHudSlot[]) {
    for (const why of ['VANISH', 'BUSY']) {
      const fs = mine.filter((x) => x.word.slot === slot && x.why === why).map((x) => x.f);
      if (fs.length) console.log(`  ${slot.padEnd(8)} ${why.padEnd(6)} ${ranges(fs)}`);
    }
  }
  for (const x of mine) {
    const w = x.word;
    console.log(`    ${x.f}${lensMark(x.f)} ${w.slot} x${w.x0}–${w.x1}: ${x.why} worst glyph x${w.worst.x0} ink ${w.worst.ink} ground ${w.worst.ground} ΔL ${w.worst.dL} · busy ${(100 * w.busy).toFixed(0)}%`);
  }
}
