// remote-look.ts: `studio look --remote`, from this machine: the look's stills drawn by a warm render server on the
// deployed app (remote-render-call.ts), its frames resolved there against the composition, and handed back as a look source
// (frame-look.ts's `stills`) for the sheets, comparisons and motion `studio look` makes here. Node only.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { LookSource } from '#lib/output/look/engine/frame-look.ts';
import type { LookFrameAsk } from '#lib/output/look/models/look-frames.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { isRemoteLookAnswer, REMOTE_LOOK_ANSWER_FILE, remoteStillFile } from '../models/remote-render-job.ts';
import { openRemoteRenderCall, writeRemoteFiles } from './remote-render-call.ts';

/**
 * What a remote look asks for: frames as `ask` says, `width` wide (`full`, the video's), with the frame before the first
 * when `before`; drawn with captions burned in when `captions`, the lens as `lens` and paintings at `set`'s values.
 */
export type RemoteLookRequest = {
  readonly ask: LookFrameAsk; readonly width: number | 'full'; readonly before: boolean; readonly captions: boolean; readonly lens?: string; readonly set?: string;
};

/**
 * Draws `request`'s stills of `project` (its folder) remotely, then runs `look` with them as a source and the frames
 * the look asked for, while they're on disk. Prints what the call billed.
 */
export async function withRemoteLook<T>(project: string, request: RemoteLookRequest, look: (source: LookSource, frames: readonly number[]) => Promise<T>): Promise<T> {
  const call = await openRemoteRenderCall(project);
  try {
    const { files, report } = await call.runJob({
      kind: 'look', project: relative(STUDIO_ROOT, project), ask: request.ask, width: request.width, before: request.before, captions: request.captions,
      ...(request.lens !== undefined && { lens: request.lens }), ...(request.set !== undefined && { set: request.set }),
    }, 'remote');
    call.printBilling([{ label: 'remote', report }]);
    return await withStudioTemp('remote-look', async (dir) => {
      writeRemoteFiles(files, dir);
      const answer: unknown = JSON.parse(readFileSync(join(dir, REMOTE_LOOK_ANSWER_FILE), 'utf8'));
      if (!isRemoteLookAnswer(answer)) throw new Error(`the remote look's ${REMOTE_LOOK_ANSWER_FILE} isn't one`);
      const fileFor = (frame: number) => {
        const file = join(dir, remoteStillFile(frame));
        return existsSync(file) ? file : undefined;
      };
      return look({ kind: 'stills', composition: answer.composition, w: answer.w, fileFor }, answer.frames);
    });
  } finally {
    call.close();
  }
}
