// remote-render-job-run.ts: a remote call's job, run in its container by `studio remote job`: this container's pieces
// of the video kept lossless, with the raw sound when asked, or a look's stills, written into a folder the app sends
// back whole (remote-render-job.ts names the files). It renders as `studio render` does, in browsers borrowed from the
// container's keeper (kept-render-browsers.ts). Node only.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookFramesOf } from '#lib/output/look/models/look-frames.ts';
import { renderProgress } from '#lib/output/render/engine/render-pipeline.ts';
import { formatRenderPasses, type RenderSession } from '#lib/output/render/engine/render-session.ts';
import { refuseSliceOutside } from '#lib/output/render/engine/render-slices.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { remoteContainerPieces } from '../models/remote-render-plan.ts';
import {
  REMOTE_LOOK_ANSWER_FILE, REMOTE_SOUND_FILE, remotePieceFile, remoteStillFile, type RemoteLookAnswer, type RemoteRenderJob,
} from '../models/remote-render-job.ts';

/** How a job opens its project's render session: as the CLI does, from --workers, --lens and --set text. */
export type RemoteJobSessionOpener = (project: string, options: { workers?: string; lens?: string; paintings?: string }) => Promise<RenderSession>;

/** A container's share of the video drawn piece by piece at once, each in a browser of its own. */
async function renderRemoteShare(job: Extract<RemoteRenderJob, { kind: 'pieces' }>, session: RenderSession, out: string) {
  const timeline = await session.readTimeline();
  const frames = job.frames === 'all' ? { from: 0, end: timeline.durationInFrames } : job.frames;
  refuseSliceOutside(timeline, frames);
  await Promise.all(remoteContainerPieces(frames, job).map((piece) =>
    session.renderLosslessVideo({ out: join(out, remotePieceFile(piece)), frames: piece, timeline, onProgress: renderProgress(remotePieceFile(piece)) })));
}

/**
 * A pieces job: its share, and the sound when asked, drawn at once in the browser the keeper keeps spare. On a cloud
 * container gathering the sound takes about half a second a frame, painted or not, so after the pieces it would
 * near double the wall time.
 */
async function renderRemotePieces(job: Extract<RemoteRenderJob, { kind: 'pieces' }>, session: RenderSession, out: string) {
  await Promise.all([
    renderRemoteShare(job, session, out),
    ...(job.sound && !session.silent ? [session.renderAudio({ out: join(out, REMOTE_SOUND_FILE) })] : []),
  ]);
}

/** A look job: the frames it asks for, resolved against the composition, drawn as stills, with what it read. */
async function renderRemoteLook(job: Extract<RemoteRenderJob, { kind: 'look' }>, session: RenderSession, out: string) {
  const { fps, width, height, durationInFrames } = await session.compositionFor(session.props({ captions: job.captions }));
  const frames = lookFramesOf(job.ask, { fps, first: 0, end: durationInFrames }, { clock: session.clock ?? undefined, project: job.project });
  const drawn = job.before && frames[0] > 0 ? [frames[0] - 1, ...frames] : frames, w = job.width === 'full' ? width : job.width;
  await withStudioTemp('remote-look', async (dir) => {
    const stills = await session.renderStills(dir, drawn, { w, captions: job.captions });
    for (const frame of drawn) renameSync(stills.fileFor(frame), join(out, remoteStillFile(frame)));
  });
  const answer: RemoteLookAnswer = { composition: { fps, width, height, durationInFrames }, frames, w };
  writeFileSync(join(out, REMOTE_LOOK_ANSWER_FILE), JSON.stringify(answer));
}

/** Runs `job` into `out`, its session opened by `openSession`, and prints its passes' timing. */
export async function runRemoteRenderJob(job: RemoteRenderJob, { out, openSession }: { out: string; openSession: RemoteJobSessionOpener }): Promise<void> {
  mkdirSync(out, { recursive: true });
  const project = join(STUDIO_ROOT, job.project);
  const session = job.kind === 'pieces'
    ? await openSession(project, { ...(job.workers !== undefined && { workers: String(job.workers) }), ...(job.lens !== undefined && { lens: job.lens }) })
    : await openSession(project, { ...(job.lens !== undefined && { lens: job.lens }), ...(job.set !== undefined && { paintings: job.set }) });
  if (job.kind === 'pieces') await renderRemotePieces(job, session, out);
  else await renderRemoteLook(job, session, out);
  for (const line of formatRenderPasses(session)) process.stderr.write(`${line}\n`);
}
