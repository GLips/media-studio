// studio-recording-json.ts: recording.json, the one file of a Studio Recorder take that says how its tracks line up,
// as the recorder writes it (Recording.swift). Pure: the schema every reader decodes it with, so a take written by
// another recorder version fails where it's read, naming the field, never deeper in an add.
//
// `studio-recording/1` stays readable: a field the recorder adds later is optional here, and one it stops writing is
// never required.
import { Schema } from 'effect';

export const STUDIO_RECORDING_FORMAT = 'studio-recording/1';

/** The geometry of the display a screen track recorded, which maps the input log's global points onto its pixels. */
export const RecordingScreenDisplay = Schema.Struct({
  name: Schema.String,
  /** [x, y, width, height] in global points: origin at the main display's top left, y down. */
  boundsPoints: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
  scale: Schema.Finite,
  widthPixels: Schema.Finite,
  heightPixels: Schema.Finite,
});
export interface RecordingScreenDisplay extends Schema.Schema.Type<typeof RecordingScreenDisplay> {}

/**
 * One track as recording.json lists it. `startSeconds` is when its first sample arrived on the host clock, from the
 * take's start; an early recorder listed a camera that sent nothing, with no start.
 */
export const RecordingTrackJson = Schema.Struct({
  file: Schema.String,
  startSeconds: Schema.optionalKey(Schema.Finite),
  latencySeconds: Schema.optionalKey(Schema.Finite),
  /** How far the host clock ran ahead of the track's own sample clock over the take (the mic's). */
  hostDriftSeconds: Schema.optionalKey(Schema.Finite),
  device: Schema.optionalKey(Schema.String),
  display: Schema.optionalKey(RecordingScreenDisplay),
  sourceFormat: Schema.optionalKey(Schema.String),
  channel: Schema.optionalKey(Schema.Finite),
  sampleRate: Schema.optionalKey(Schema.Finite),
  captureDroppedFrames: Schema.optionalKey(Schema.Finite),
  writerDroppedFrames: Schema.optionalKey(Schema.Finite),
});
export interface RecordingTrackJson extends Schema.Schema.Type<typeof RecordingTrackJson> {}

/**
 * recording.json. `status` is `recording` from the first samples until the take stops cleanly, when it turns
 * `complete` and gains `durationSeconds`: a take left `recording` was killed, or is live.
 */
export const StudioRecordingJson = Schema.Struct({
  format: Schema.Literal(STUDIO_RECORDING_FORMAT),
  status: Schema.Literals(['recording', 'complete']),
  startedAt: Schema.String,
  durationSeconds: Schema.optionalKey(Schema.Finite),
  tracks: Schema.Record(Schema.String, RecordingTrackJson),
  input: Schema.optionalKey(Schema.Struct({ file: Schema.String, coordinates: Schema.Literal('global-points') })),
  clockLog: Schema.optionalKey(Schema.String),
  /** Tracks that couldn't start or sent nothing, and why. */
  leftOut: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** What went wrong with a recording track mid-take, by track. */
  problems: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export interface StudioRecordingJson extends Schema.Schema.Type<typeof StudioRecordingJson> {}

/** recording.json's text, parsed and decoded. */
export const StudioRecordingJsonText = Schema.fromJsonString(StudioRecordingJson);
