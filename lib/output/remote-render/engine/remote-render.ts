// remote-render.ts: `studio render --remote`, from this machine. The project's frames drawn on the deployed app's
// GPU containers (remote-call.ts), each container's share as a lossless piece per browser, and finished here: a
// --frames slice kept lossless and encoded as `studio render --frames` keeps it; the whole video joined as `studio
// render --join` joins, under a mix mastered from the sound the first container drew. No browser opens here, so the
// GPU lease is never taken. Node only.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { masterRenderedMix } from '#lib/output/render/engine/render-pipeline.ts';
import { openRenderLedger } from '#lib/output/render/engine/render-ledger.ts';
import { concatList, DELIVERY_ENCODING, encodeLosslessList, formatRenderPasses } from '#lib/output/render/engine/render-session.ts';
import { joinedRenderSlices, joinVideoSlices, losslessSliceFor, readRenderSlices, refuseSliceOutside } from '#lib/output/render/engine/render-slices.ts';
import { writeRenderSnapshot } from '#lib/output/render/engine/render-snapshot.ts';
import { countVideoFrames, runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import { REMOTE_SOUND_FILE } from '../models/remote-render-job.ts';
import { remoteContainerCount, type RemoteFrames } from '../models/remote-render-plan.ts';
import { openRemoteCall, printRemoteBilling, writeRemoteFiles } from './remote-call.ts';

/** Where a whole video's remote pieces are kept, for `studio render --join` to join again. */
export const REMOTE_PIECES_DIR = join('out', 'wip', 'remote');

/**
 * Renders `project` (its folder) on the remote app: `frames` of it as a slice at `out` (and lossless beside it), or
 * the whole video's pieces into out/wip/remote/ joined at `out`. `lens` and `workers` are the command's flags. Returns
 * the files it wrote.
 */
export async function renderRemotely(project: string, { frames, out, lens, workers }: {
  frames?: RemoteFrames; out: string; lens?: string; workers?: number;
}): Promise<string[]> {
  const ledger = await openRenderLedger(project);
  // Refused here before anything uploads when the clock knows the length; each container checks again on its page.
  if (frames && ledger.clock) refuseSliceOutside({ durationInFrames: ledger.clock.end }, frames);
  const known = frames ? frames.end - frames.from : ledger.clock?.end;
  const call = await openRemoteCall(project);
  try {
    const containers = known === undefined ? 1 : remoteContainerCount(known, call.settings.maxContainers);
    const drawing = performance.now();
    const answers = await Promise.all(Array.from({ length: containers }, (_, index) => call.runJob({
      kind: 'pieces', project: relative(STUDIO_ROOT, project), ...(lens !== undefined && { lens }), ...(workers !== undefined && { workers }),
      frames: frames ?? 'all', containers, index, browsers: call.settings.browsers, sound: !frames && index === 0 && !ledger.silent,
    }, containers > 1 ? `remote ${index + 1}/${containers}` : 'remote')));
    ledger.passes.push({ pass: `remote frames (${containers} container${containers > 1 ? 's' : ''})`, seconds: (performance.now() - drawing) / 1000, gpu: answers[0].report.gpuName });
    const written = frames
      ? await withStudioTemp('remote-pieces', (dir) => {
        for (const { files } of answers) writeRemoteFiles(files, dir);
        return keepRemoteSlice(ledger, dir, frames, out);
      })
      : [await joinRemotePieces(ledger, answers.map((a) => a.files), out)];
    for (const line of formatRenderPasses(ledger)) process.stderr.write(`${line}\n`);
    printRemoteBilling(call.settings, answers.map((a) => a.report));
    return written;
  } finally {
    call.close();
  }
}

type Ledger = Awaited<ReturnType<typeof openRenderLedger>>;

/** The pieces in `dir` (`frames` between them) as one slice at `out`, kept lossless beside it, each with its snapshot. */
async function keepRemoteSlice(ledger: Ledger, dir: string, frames: RemoteFrames, out: string): Promise<string[]> {
  const { ordered, timeline, gpu } = joinedRenderSlices(readRenderSlices(dir), { dir, clock: ledger.clock, span: frames });
  const lossless = losslessSliceFor(out), list = join(dir, 'pieces.txt');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(list, concatList(ordered.map((piece) => piece.file)));
  const made = { frames, timeline, clock: ledger.clock, voice: renderVoiceOf(ledger.project), gpu };
  await ledger.timed(`${basename(lossless)} join`, () => runFfmpegAsync(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', lossless]));
  writeRenderSnapshot(lossless, made);
  await ledger.timed(`${basename(out)} encode`, () => encodeLosslessList(list, out, DELIVERY_ENCODING));
  const counted = countVideoFrames(out);
  if (counted !== frames.end - frames.from) throw new Error(`${out} holds ${counted} frames, not the ${frames.end - frames.from} drawn`);
  writeRenderSnapshot(out, made);
  return [out, lossless];
}

/** Every container's pieces kept in out/wip/remote/ and joined at `out` under the mix mastered from their sound. */
async function joinRemotePieces(ledger: Ledger, made: readonly ReadonlyMap<string, Uint8Array>[], out: string): Promise<string> {
  const dir = join(ledger.project, REMOTE_PIECES_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const files of made) writeRemoteFiles(files, dir);
  return joinVideoSlices(ledger, {
    dir, out,
    mixFor: async (timeline) => {
      const sound = join(dir, REMOTE_SOUND_FILE);
      if (!existsSync(sound)) throw new Error(`the remote render sent back no sound (${REMOTE_SOUND_FILE}) for ${basename(ledger.project)}'s mix`);
      return masterRenderedMix(ledger, sound, { beatClicks: timeline.beatClicks });
    },
  });
}
