// recording-clock-log.ts: clock.jsonl, how each device's own clock ran against the host clock through a take, one
// sample per line, as ClockLog (JSONLines.swift) writes it. Pure: the line's schema; recording/engine streams the file.
import { Schema } from 'effect';

/**
 * One sample: `host`, when it happened on the host clock; `media`, where it sits on the track's own timeline;
 * `arrival`, when the recorder received it. All seconds from the take's start.
 */
export const RecordingClockSample = Schema.Struct({
  track: Schema.String,
  host: Schema.Finite,
  media: Schema.Finite,
  arrival: Schema.Finite,
});
export interface RecordingClockSample extends Schema.Schema.Type<typeof RecordingClockSample> {}

/** One line of clock.jsonl, parsed and decoded. */
export const RecordingClockSampleLine = Schema.fromJsonString(RecordingClockSample);
