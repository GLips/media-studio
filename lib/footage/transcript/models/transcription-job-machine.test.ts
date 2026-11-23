import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Option, Result } from 'effect';
import { initialTransition, transition, type EventFrom } from 'xstate';
import { transcriptionJobMachine, transcriptionStepDue } from './transcription-job-machine.ts';

type JobEvent = EventFrom<typeof transcriptionJobMachine>;

// Each step's success, in the order a cache miss runs them: a second of silence, which whisper hears nothing in.
const STEPS_OK: readonly JobEvent[] = [
  { type: 'cacheMissed', cacheKey: 'key' },
  { type: 'whisperInstalled' },
  { type: 'audioExtracted', samples: new Int16Array(16000), rate: 16000 },
  { type: 'piecesHeard', tokens: [] },
];

/** The job after `succeeded` of its steps succeed and the next one fails, or after every step when none fails. */
function jobFailingAt(succeeded: number, reason = 'boom') {
  let [job] = initialTransition(transcriptionJobMachine, { path: 'take.mov' });
  for (const event of STEPS_OK.slice(0, succeeded)) [job] = transition(transcriptionJobMachine, job, event);
  [job] = transition(transcriptionJobMachine, job, { type: 'stepFailed', reason });
  return job;
}

test('a failed step ends the job naming that step', () => {
  for (const [succeeded, step] of [[0, 'reading the file'], [1, 'installing whisper.cpp'], [2, 'reading its sound'], [3, 'hearing it with whisper']] as const) {
    const job = jobFailingAt(succeeded);
    assert.equal(job.status, 'done', step);
    assert.deepEqual(job.output, Result.fail({ step, reason: 'boom' }));
  }
});

test("a failed cache write still delivers the transcript, and says why it wasn't kept", () => {
  const job = jobFailingAt(STEPS_OK.length, 'disk full');
  assert.equal(job.status, 'done');
  assert.ok(Result.isSuccess(job.output) && job.output.success.duration === 1);
  assert.equal(job.getInputs().transcribedUncached?.reason, 'disk full');
  assert.ok(Option.isNone(transcriptionStepDue(job)));
});
