// render-slices.ts: a video rendered a slice at a time (`studio render --frames`), to re-render just what a change
// touched, each slice kept lossless beside its review video with its snapshot; and the slices joined (`--join`) into
// the whole, encoded once under a mix made now. A join reads its timeline from the slices' snapshots, with no page:
// every slice must have been rendered on one timeline, on the project's clock now and on one GPU, and together they
// must cover the video. A remote render (remote-render) joins its pieces the same way, under the sound it drew. Node
// only.

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { countVideoFrames } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import type { TimelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import { renderProgress } from './render-pipeline.ts';
import { concatList, DELIVERY_ENCODING, encodeLosslessList, muxDeliveredSound, type RenderSession } from './render-session.ts';
import { loadRenderSnapshot, writeRenderSnapshot } from './render-snapshot.ts';
import type { RenderLedger } from './render-ledger.ts';

/** What names a slice's lossless frames, beside its video: what --join reads. */
export const LOSSLESS_SLICE_SUFFIX = '.lossless.mkv';

/** Where a slice at `out` keeps its frames lossless: `<name>.lossless.mkv` beside it. */
export const losslessSliceFor = (out: string) => join(dirname(out), `${basename(out, extname(out))}${LOSSLESS_SLICE_SUFFIX}`);

/** Refuses frames `from`–`end` (exclusive) unless they're whole and within `timeline`'s video. */
export function refuseSliceOutside(timeline: Pick<TimelineReport, 'durationInFrames'>, { from, end }: { from: number; end: number }): void {
  if (!(Number.isInteger(from) && Number.isInteger(end) && from >= 0 && end > from && end <= timeline.durationInFrames)) {
    throw new Error(`frames ${from}–${end - 1} aren't within the video's 0–${timeline.durationInFrames - 1}`);
  }
}

/**
 * Frames `from`–`end` (exclusive) of the video, silent, at `out` at delivery settings to watch, and kept lossless
 * beside it for --join, each with its snapshot recording where in the video it starts. No framing check and no mix.
 * Returns both files.
 */
export async function renderVideoSlice(session: RenderSession, { from, end, out }: { from: number; end: number; out: string }): Promise<string[]> {
  const timeline = await session.readTimeline();
  refuseSliceOutside(timeline, { from, end });
  const lossless = losslessSliceFor(out);
  await session.renderVideo({ out, frames: { from, end }, sound: 'none', encoding: DELIVERY_ENCODING, lossless, timeline, onProgress: renderProgress(out) });
  return [out, lossless];
}

/** A slice as its snapshot says it was made: `name`, its frames `from`–`end` (exclusive), and what it was drawn on. */
export type RenderSlice = {
  readonly name: string; readonly from: number; readonly end: number;
  readonly timeline: TimelineReport; readonly clock: TimelineClockTable | null; readonly gpu: string;
};

/**
 * The video `slices` (the slices in `dir`) join into, in order, with their one timeline and GPU: the whole video, or
 * `span` of it. Refuses slices from two timelines, one on another `clock` than the project's now, two GPUs, a gap, an
 * overlap or a run short of the span.
 */
export function joinedRenderSlices<S extends RenderSlice>(slices: readonly S[], { dir, clock, span }: {
  dir: string; clock: TimelineClockTable | null; span?: { from: number; end: number };
}): { ordered: S[]; timeline: TimelineReport; gpu: string } {
  const ordered = slices.toSorted((a, b) => a.from - b.from);
  if (!ordered.length) throw new Error(`${dir} holds no slices (*${LOSSLESS_SLICE_SUFFIX}): render them with studio render --frames`);
  const [first] = ordered, { timeline } = first, laid = JSON.stringify(timeline), now = JSON.stringify(clock);
  for (const s of ordered) {
    const which = `${s.name} (frames ${s.from}–${s.end - 1})`;
    if (JSON.stringify(s.timeline) !== laid) throw new Error(`${which} was rendered on another timeline than ${first.name}: render the older one again`);
    // A retime moves every later bar and cue, so a slice from before one puts its picture off the mix made now.
    if (JSON.stringify(s.clock) !== now) throw new Error(`${which} was rendered on another clock than the project's now (a retime moves every later bar and cue): render it again`);
  }
  // Slices drawn on two GPUs join: each rounds paint its own way, too little to see where they meet.
  const gpus = [...new Set(ordered.map((s) => s.gpu))];
  const { from, end } = span ?? { from: 0, end: timeline.durationInFrames };
  let reached = from;
  for (const s of ordered) {
    if (s.from !== reached) throw new Error(`${s.name} starts at frame ${s.from}, but the slices before it reach ${reached}: ${s.from > reached ? 'render the gap' : 'they overlap'}`);
    reached = s.end;
  }
  if (reached !== end) throw new Error(`the slices in ${dir} reach frame ${reached}, short of ${span ? `frame ${end}` : `the video's ${end}`}`);
  return { ordered, timeline, gpu: gpus.join('; ') };
}

/** The slices in `dir`, each `<name>.lossless.mkv` with its snapshot, checked to hold the frames its snapshot says. */
export function readRenderSlices(dir: string): (RenderSlice & { file: string })[] {
  return readdirSync(dir).filter((name) => name.endsWith(LOSSLESS_SLICE_SUFFIX)).map((name) => {
    const file = join(dir, name), loaded = loadRenderSnapshot(file);
    if (loaded.kind === 'none') throw new Error(loaded.reason);
    const { frames, timeline, clock, gpu } = loaded.snapshot;
    const counted = countVideoFrames(file);
    if (counted !== frames.end - frames.from) throw new Error(`${name} holds ${counted} frames, and its snapshot says ${frames.end - frames.from}`);
    return { file, name, timeline, clock, gpu, from: frames.from, end: frames.end };
  });
}

/**
 * Joins the slices' lossless frames in `dir` (each `<name>.lossless.mkv`) at `out`, encoded once as a delivered video
 * is, under the mastered mix `mixFor` makes now, so sounds play across the joins (joinedRenderSlices says what's
 * refused). A silent project's has no mix.
 */
export async function joinVideoSlices(ledger: Pick<RenderLedger, 'project' | 'clock' | 'silent' | 'trace'>, { dir, out, mixFor }: {
  dir: string; out: string; mixFor: (timeline: TimelineReport) => Promise<string>;
}): Promise<string> {
  const { ordered, timeline, gpu } = joinedRenderSlices(readRenderSlices(dir), { dir, clock: ledger.clock });
  const mix = ledger.silent ? undefined : await mixFor(timeline);
  mkdirSync(dirname(out), { recursive: true });
  await withStudioTemp('join', async (tmp) => {
    const list = join(tmp, 'slices.txt'), picture = join(tmp, basename(out));
    writeFileSync(list, concatList(ordered.map((s) => s.file)));
    await ledger.trace.run(`${basename(out)} encode`, () => encodeLosslessList(list, picture, DELIVERY_ENCODING));
    if (mix) await ledger.trace.run(`${basename(out)} mux`, () => muxDeliveredSound(picture, mix, out, { frames: timeline.durationInFrames, fps: timeline.fps }));
    else copyFileSync(picture, out);
  });
  const counted = countVideoFrames(out);
  if (counted !== timeline.durationInFrames) throw new Error(`${out} holds ${counted} frames, not the video's ${timeline.durationInFrames}`);
  writeRenderSnapshot(out, { frames: { from: 0, end: timeline.durationInFrames }, timeline, clock: ledger.clock, voice: renderVoiceOf(ledger.project), gpu });
  return out;
}
