// recording-window-log.ts: window.jsonl, where a recorded window sat through its take, one line per change, as
// WindowPlacementLog (ScreenTrack.swift) writes it. Pure: the line's schema; recording/engine streams the file.
import { Schema } from 'effect';

const Rect = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]);

/**
 * From `t` (seconds from the take's start, on the host clock) until the next placement, the window covered
 * `boundsPoints` in global points (origin at the main display's top left, y down) and its picture covered
 * `contentPixels` of the screen track. Both are [x, y, width, height].
 */
export const RecordingWindowPlacement = Schema.Struct({ t: Schema.Finite, boundsPoints: Rect, contentPixels: Rect });
export interface RecordingWindowPlacement extends Schema.Schema.Type<typeof RecordingWindowPlacement> {}

/** One line of window.jsonl, parsed and decoded. */
export const RecordingWindowPlacementLine = Schema.fromJsonString(RecordingWindowPlacement);
