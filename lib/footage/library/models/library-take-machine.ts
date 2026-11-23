// library-take-machine.ts: a Studio Recorder take's folder as the recorder process leaves it, judged from outside by
// what the library sees: recording.json's status and how long the folder's files have been still. Pure.
//
//   unread    no recording.json read yet
//   live      marked recording, its files changed within RECORDER_TAKE_QUIET_MS: the recorder is writing it
//   killed    marked recording, its files still for longer: the recorder died mid-take, so it's added as interrupted
//   complete  marked complete: the recorder stopped it cleanly. Final, so a stale read never makes it live again
//
// Observations arrive in any order (another process writes the folder), so each keeps the newest it has seen of the
// files' change time and the clock: an older observation never moves the judgement back.
import type { SnapshotFrom } from 'xstate';
import { initialTransition, setup, transition, types } from 'xstate';
import type { StudioRecordingJson } from '#lib/footage/recording/models/studio-recording-json.ts';

/**
 * How long a take's files must have been still before a take still marked recording counts as killed. A live
 * recorder grows its files every fragment (2 s).
 */
export const RECORDER_TAKE_QUIET_MS = 10_000;

/** How an added take ended, as its item's source records it. */
export type RecorderTakeEnding = 'complete' | 'interrupted';

type RecorderTakeContext = {
  /** The newest recording.json read. */
  readonly recording: StudioRecordingJson | null;
  /** The latest change time seen of any of the folder's files, and the latest clock reading, in epoch ms. */
  readonly newestChangeMs: number | null;
  readonly nowMs: number | null;
};

type RecorderTakeObservation =
  | { readonly type: 'recordingRead'; readonly recording: StudioRecordingJson }
  | { readonly type: 'filesSeen'; readonly newestChangeMs: number; readonly nowMs: number };

const later = (seen: number | null, now: number) => (seen === null ? now : Math.max(seen, now));

function observed(context: RecorderTakeContext, event: RecorderTakeObservation): RecorderTakeContext {
  if (event.type === 'recordingRead') return { ...context, recording: event.recording };
  return { ...context, newestChangeMs: later(context.newestChangeMs, event.newestChangeMs), nowMs: later(context.nowMs, event.nowMs) };
}

/** Where an observation leaves a take not yet complete. A take whose files were never seen still counts as live. */
function judged(context: RecorderTakeContext): '#takeUnread' | '#takeLive' | '#takeKilled' | '#takeComplete' {
  const { recording, newestChangeMs, nowMs } = context;
  if (!recording) return '#takeUnread';
  if (recording.status === 'complete') return '#takeComplete';
  const quiet = newestChangeMs !== null && nowMs !== null && nowMs - newestChangeMs >= RECORDER_TAKE_QUIET_MS;
  return quiet ? '#takeKilled' : '#takeLive';
}

const takeSetup = setup({
  schemas: {
    context: types<RecorderTakeContext>(),
    events: {
      recordingRead: types<{ readonly recording: StudioRecordingJson }>(),
      filesSeen: types<{ readonly newestChangeMs: number; readonly nowMs: number }>(),
    },
  },
  states: {
    unread: { id: 'takeUnread' },
    live: { id: 'takeLive' },
    killed: { id: 'takeKilled' },
    complete: { id: 'takeComplete' },
  },
});

const observe = ({ context, event }: { context: RecorderTakeContext; event: RecorderTakeObservation }) => {
  const next = observed(context, event);
  return { target: judged(next), context: next };
};

const watching = { on: { recordingRead: observe, filesSeen: observe } };

export const recorderTakeMachine = takeSetup.createMachine({
  id: 'recorderTake',
  context: { recording: null, newestChangeMs: null, nowMs: null },
  initial: 'unread',
  states: {
    unread: watching,
    live: watching,
    killed: watching,
    // NEGATIVE SPACE: no event leaves it. The recorder never reopens a take it completed.
    complete: { type: 'final' },
  },
});

export type RecorderTakeSnapshot = SnapshotFrom<typeof recorderTakeMachine>;

/** The machine before anything is seen of the folder. */
export const recorderTakeUnread = (): RecorderTakeSnapshot => initialTransition(recorderTakeMachine)[0];

/** `snapshot` after seeing `observation`. */
export const observeRecorderTake = (snapshot: RecorderTakeSnapshot, observation: RecorderTakeObservation): RecorderTakeSnapshot =>
  transition(recorderTakeMachine, snapshot, observation)[0];

/** How the take ended, when it has: complete, or killed (interrupted). None while it's unread or live. */
export function recorderTakeEnding(snapshot: RecorderTakeSnapshot): RecorderTakeEnding | undefined {
  if (snapshot.matches('complete')) return 'complete';
  return snapshot.matches('killed') ? 'interrupted' : undefined;
}
