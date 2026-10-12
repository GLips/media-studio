// remote-render.ts: `studio render --remote`, from this machine. The project's frames drawn on the deployed app's
// GPU containers (remote-render-call.ts), each container's share as a lossless piece per browser, and finished here: a
// --frames slice encoded as `studio render --frames` encodes one; the whole video's pieces joined in order and encoded
// once under a mix mastered from the sound the first container drew. No browser opens here, so the GPU lease is never
// taken. Node only.
//
// Pieces join by their snapshots: every one drawn on one timeline, on the project's clock now, together covering the
// span with no gap or overlap.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { masterRenderedMix } from '#lib/output/render/engine/render-pipeline.ts';
import type { RenderLedger } from '#lib/output/render/engine/render-ledger.ts';
import { traceClock } from '#lib/platform/trace/engine/trace-collector.ts';
import { concatList, DELIVERY_ENCODING, encodeLosslessList, formatRenderSpans, muxDeliveredSound, SLICE_ENCODING, type VideoEncoding } from '#lib/output/render/engine/render-session.ts';
import { refuseSliceOutside } from '#lib/output/render/engine/render-slices.ts';
import { loadRenderSnapshot, readRenderSource, writeRenderSnapshot } from '#lib/output/render/engine/render-snapshot.ts';
import type { RenderSource } from '#lib/output/render/models/render-snapshot-model.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import type { TimelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { countVideoFrames } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import { REMOTE_PIECE_SUFFIX, REMOTE_SOUND_FILE } from '../models/remote-render-job.ts';
import { remoteContainerCount, type RemoteFrames } from '../models/remote-render-plan.ts';
import { openRemoteRenderCall, writeRemoteFiles } from './remote-render-call.ts';

/** Where a whole video's remote pieces are kept, to look into after a join refused them. */
export const REMOTE_PIECES_DIR = join('out', 'wip', 'remote');

/**
 * Renders the project `ledger` is of on the remote app: `frames` of it as a slice at `out`, or the whole video's
 * pieces into out/wip/remote/ joined at `out`. `lens` and `workers` are the command's flags. Returns
 * the files it wrote, and prints what the calls billed, whether it wrote them or failed.
 */
export async function renderRemotely(ledger: RenderLedger, { frames, out, lens, workers }: {
  frames?: RemoteFrames; out: string; lens?: string; workers?: number;
}): Promise<string[]> {
  const { project } = ledger;
  // Refused here before anything uploads when the clock knows the length; each container checks again on its page.
  if (frames && ledger.clock) refuseSliceOutside({ durationInFrames: ledger.clock.end }, frames);
  const known = frames ? frames.end - frames.from : ledger.clock?.end;
  const source = readRenderSource();
  const call = await openRemoteRenderCall(project);
  try {
    const containers = known === undefined ? 1 : remoteContainerCount(known, call.settings.render.maxContainers);
    const drawing = traceClock();
    const label = (index: number) => (containers > 1 ? `remote ${index + 1}/${containers}` : 'remote');
    const answers = await call.runJobs(Array.from({ length: containers }, (_, index) => ({
      job: {
        kind: 'pieces', project: relative(STUDIO_ROOT, project), ...(lens !== undefined && { lens }), ...(workers !== undefined && { workers }),
        frames: frames ?? 'all', containers, index, browsers: call.settings.render.browsers, sound: !frames && index === 0 && !ledger.silent,
      },
      label: label(index),
    })));
    ledger.trace.record(`remote frames (${containers} container${containers > 1 ? 's' : ''})`, {
      start: drawing, end: traceClock(), ...(answers[0].report.gpuName && { attributes: { gpu: answers[0].report.gpuName } }),
    });
    const written = frames
      ? await withStudioTemp('remote-pieces', async (dir) => {
        for (const { files } of answers) writeRemoteFiles(files, dir);
        return [await encodeRemotePieces(ledger, dir, { out, span: frames, encoding: SLICE_ENCODING, source })];
      })
      : [await joinRemotePieces(ledger, answers.map((a) => a.files), { out, source })];
    for (const line of formatRenderSpans(ledger)) process.stderr.write(`${line}\n`);
    return written;
  } finally {
    call.printBilling();
    call.close();
  }
}

/** A piece as its snapshot says it was made: `name`, its frames `from`–`end` (exclusive), and what it was drawn on. */
export type RemotePiece = {
  readonly name: string; readonly from: number; readonly end: number;
  readonly timeline: TimelineReport; readonly clock: TimelineClockTable | null; readonly gpu: string; readonly captions: boolean;
};

/**
 * The pieces in order, with their one timeline and GPUs, covering the whole video or `span` of it. Refuses pieces from
 * two timelines, one on another `clock` than the project's now, a gap, an overlap or a run short of the span.
 */
export function joinedRemotePieces<P extends RemotePiece>(pieces: readonly P[], { dir, clock, span }: {
  dir: string; clock: TimelineClockTable | null; span?: { from: number; end: number };
}): { ordered: P[]; timeline: TimelineReport; gpu: string; captions: boolean } {
  const ordered = pieces.toSorted((a, b) => a.from - b.from);
  if (!ordered.length) throw new Error(`${dir} holds no pieces (*${REMOTE_PIECE_SUFFIX}): the remote render sent none back`);
  const [first] = ordered, { timeline } = first, laid = JSON.stringify(timeline), now = JSON.stringify(clock);
  for (const p of ordered) {
    const which = `${p.name} (frames ${p.from}–${p.end - 1})`;
    if (p.captions !== first.captions) throw new Error(`${which} was drawn ${p.captions ? 'with' : 'without'} captions and ${first.name} not: render again`);
    if (JSON.stringify(p.timeline) !== laid) throw new Error(`${which} was rendered on another timeline than ${first.name}: render again`);
    // A retime moves every later bar and cue, so a piece from before one puts its picture off the mix made now.
    if (JSON.stringify(p.clock) !== now) throw new Error(`${which} was rendered on another clock than the project's now (a retime moves every later bar and cue): render again`);
  }
  // Pieces drawn on two GPUs join: each rounds paint its own way, too little to see where they meet.
  const gpus = [...new Set(ordered.map((p) => p.gpu))];
  const { from, end } = span ?? { from: 0, end: timeline.durationInFrames };
  let reached = from;
  for (const p of ordered) {
    if (p.from !== reached) throw new Error(`${p.name} starts at frame ${p.from}, but the pieces before it reach ${reached}: ${p.from > reached ? 'a gap' : 'they overlap'}`);
    reached = p.end;
  }
  if (reached !== end) throw new Error(`the pieces in ${dir} reach frame ${reached}, short of ${span ? `frame ${end}` : `the video's ${end}`}`);
  return { ordered, timeline, gpu: gpus.join('; '), captions: first.captions };
}

/** The pieces in `dir`, each `<name>.lossless.mkv` with its snapshot, checked to hold the frames its snapshot says. */
function readRemotePieces(dir: string): (RemotePiece & { file: string })[] {
  return readdirSync(dir).filter((name) => name.endsWith(REMOTE_PIECE_SUFFIX)).map((name) => {
    const file = join(dir, name), loaded = loadRenderSnapshot(file);
    if (loaded.kind === 'none') throw new Error(loaded.reason);
    const { frames, timeline, clock, gpu, captions } = loaded.snapshot;
    const counted = countVideoFrames(file);
    if (counted !== frames.end - frames.from) throw new Error(`${name} holds ${counted} frames, and its snapshot says ${frames.end - frames.from}`);
    return { file, name, timeline, clock, gpu, captions, from: frames.from, end: frames.end };
  });
}

/**
 * The pieces in `dir` joined at `out`, `span` of the video or all of it, encoded once as `encoding` says, under the
 * mastered `mix` when given, with its snapshot naming `source`: the commits read before the remote call, since the
 * minutes it takes leave room for a commit.
 */
async function encodeRemotePieces(ledger: RenderLedger, dir: string, { out, span, encoding, mixFor, source }: {
  out: string; span?: RemoteFrames; encoding: VideoEncoding; mixFor?: (timeline: TimelineReport) => Promise<string>; source: RenderSource;
}): Promise<string> {
  const { ordered, timeline, gpu, captions } = joinedRemotePieces(readRemotePieces(dir), { dir, clock: ledger.clock, ...(span && { span }) });
  const frames = span ?? { from: 0, end: timeline.durationInFrames }, count = frames.end - frames.from;
  const mix = mixFor && !ledger.silent ? await mixFor(timeline) : undefined;
  mkdirSync(dirname(out), { recursive: true });
  await withStudioTemp('join', async (tmp) => {
    const list = join(tmp, 'pieces.txt'), picture = join(tmp, basename(out));
    writeFileSync(list, concatList(ordered.map((p) => p.file)));
    await ledger.trace.run(`${basename(out)} encode`, () => encodeLosslessList(list, picture, encoding));
    if (mix) await ledger.trace.run(`${basename(out)} mux`, () => muxDeliveredSound(picture, mix, out, { frames: count, fps: timeline.fps }));
    else copyFileSync(picture, out);
  });
  const counted = countVideoFrames(out);
  if (counted !== count) throw new Error(`${out} holds ${counted} frames, not the ${count} drawn`);
  writeRenderSnapshot(out, { frames, started: ledger.started, captions, timeline, clock: ledger.clock, voice: renderVoiceOf(ledger.project), gpu, source });
  return out;
}

/** Every container's pieces kept in out/wip/remote/ and joined at `out` under the mix mastered from their sound. */
async function joinRemotePieces(ledger: RenderLedger, made: readonly ReadonlyMap<string, Uint8Array>[], { out, source }: { out: string; source: RenderSource }): Promise<string> {
  const dir = join(ledger.project, REMOTE_PIECES_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const files of made) writeRemoteFiles(files, dir);
  return encodeRemotePieces(ledger, dir, {
    out, source, encoding: DELIVERY_ENCODING,
    mixFor: async (timeline) => {
      const sound = join(dir, REMOTE_SOUND_FILE);
      if (!existsSync(sound)) throw new Error(`the remote render sent back no sound (${REMOTE_SOUND_FILE}) for ${basename(ledger.project)}'s mix`);
      return masterRenderedMix(ledger, sound, { beatClicks: timeline.beatClicks });
    },
  });
}
