// remote-render-job.ts: what one remote call asks its container to render, and how the files it sends back are named.
// The Mac writes a job, the container's `studio remote job` runs it (remote-render-job-run.ts). Pure.
import type { LookComposition, LookFrameAsk } from '#lib/output/look/models/look-frames.ts';
import type { RemoteFrames } from './remote-render-plan.ts';

/**
 * A container's work, `project` relative to the studio: its share (`index` of `containers`) of `frames` or the whole
 * video as lossless pieces (remoteContainerPieces), with the raw sound when `sound`; or a look's stills, its frames
 * resolved there from `ask`, `width` wide, the frame before the first too when `before` (a motion look's).
 */
export type RemoteRenderJob =
  | {
    readonly kind: 'pieces'; readonly project: string; readonly lens?: string; readonly workers?: number; readonly frames: RemoteFrames | 'all';
    readonly containers: number; readonly index: number; readonly browsers: number; readonly sound: boolean;
  }
  | {
    readonly kind: 'look'; readonly project: string; readonly lens?: string; readonly set?: string; readonly captions: boolean;
    readonly ask: LookFrameAsk; readonly width: number | 'full'; readonly before: boolean;
  };

/** What a look job sends back beside its stills: the composition, the frames the look asked for and the stills' width. */
export type RemoteLookAnswer = { readonly composition: LookComposition; readonly frames: readonly number[]; readonly w: number };

/** The files a job sends back: a piece's frames, the raw sound, a look's answer and each of its stills. */
export const remotePieceFile = ({ from, end }: RemoteFrames) => `frames-${from}-${end - 1}.lossless.mkv`;
export const REMOTE_SOUND_FILE = 'sound.wav';
export const REMOTE_LOOK_ANSWER_FILE = 'look.json';
export const remoteStillFile = (frame: number) => `still-${frame}.jpg`;

const isText = (value: unknown): value is string => typeof value === 'string';
const isOptionalText = (value: unknown): value is string | undefined => value === undefined || isText(value);
const isWholeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function isRemoteFrames(value: unknown): value is RemoteFrames {
  return typeof value === 'object' && value !== null && 'from' in value && isWholeNumber(value.from) && 'end' in value && isWholeNumber(value.end);
}

function isLookFrameAsk(value: unknown): value is LookFrameAsk {
  return typeof value === 'object' && value !== null && 'step' in value && typeof value.step === 'number' && 'every' in value && typeof value.every === 'boolean' &&
    (!('frames' in value) || isOptionalText(value.frames)) && (!('bar' in value) || isOptionalText(value.bar)) &&
    (!('sheet' in value) || isOptionalText(value.sheet)) && (!('strip' in value) || isOptionalText(value.strip));
}

/** Whether `value`, a job file read as JSON, is a job. */
export function isRemoteRenderJob(value: unknown): value is RemoteRenderJob {
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('project' in value) || !isText(value.project)) return false;
  if ('lens' in value && !isOptionalText(value.lens)) return false;
  if (value.kind === 'pieces') {
    return 'frames' in value && (value.frames === 'all' || isRemoteFrames(value.frames)) && 'sound' in value && typeof value.sound === 'boolean' &&
      'containers' in value && isWholeNumber(value.containers) && 'index' in value && isWholeNumber(value.index) && 'browsers' in value && isWholeNumber(value.browsers) &&
      (!('workers' in value) || value.workers === undefined || isWholeNumber(value.workers));
  }
  return value.kind === 'look' && 'captions' in value && typeof value.captions === 'boolean' && 'ask' in value && isLookFrameAsk(value.ask) &&
    'width' in value && (value.width === 'full' || isWholeNumber(value.width)) && 'before' in value && typeof value.before === 'boolean' &&
    (!('set' in value) || isOptionalText(value.set));
}

/** Whether `value`, a look job's answer read as JSON, is one. */
export function isRemoteLookAnswer(value: unknown): value is RemoteLookAnswer {
  if (typeof value !== 'object' || value === null || !('composition' in value) || typeof value.composition !== 'object' || value.composition === null) return false;
  const { composition } = value;
  return 'fps' in composition && typeof composition.fps === 'number' && 'width' in composition && isWholeNumber(composition.width) &&
    'height' in composition && isWholeNumber(composition.height) && 'durationInFrames' in composition && isWholeNumber(composition.durationInFrames) &&
    'frames' in value && Array.isArray(value.frames) && value.frames.every(isWholeNumber) && 'w' in value && isWholeNumber(value.w);
}
