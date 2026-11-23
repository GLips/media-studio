// input-log.ts: the input log, one shape for every source that logs input: Studio Recorder's input.jsonl
// (lib/footage/recording/engine/recorder/Sources/StudioRecorder/InputLog.swift) and a capture's take, which fills
// what a scripted browser knows (glide ends, clicks, typed characters). Pure, so it loads in plain Node.
import { Result, Schema } from 'effect';
import { parseRecorderLogLines, type RecordingLogLineUnreadable } from './recorder-log-lines.ts';

/**
 * The space an event's x and y are in. `global-points`: macOS points, origin at the main display's top left, y down,
 * across every display (the recording's screen geometry maps them onto its pixels). `viewport-css-pixels`: the
 * captured page's viewport.
 */
export type InputLogCoordinates = 'global-points' | 'viewport-css-pixels';

/** A modifier held when the event happened. */
export const InputModifier = Schema.Literals(['ctrl', 'opt', 'shift', 'cmd', 'fn']);
export type InputModifier = typeof InputModifier.Type;

const eventBase = { t: Schema.Finite, modifiers: Schema.optionalKey(Schema.Array(InputModifier)) };
const point = { x: Schema.Finite, y: Schema.Finite };

/**
 * One logged event: `t` in seconds from the start, on the tracks' clock; x, y in the log's coordinates. `key` is the
 * character typed, or a name (`return`, `left`, `f5`) for a key that types none; `repeat`, a key held down. `gap`:
 * events lost while macOS had switched the recorder's tap off for being slow.
 */
export const InputEvent = Schema.Union([
  Schema.Struct({ ...eventBase, type: Schema.Literals(['keyDown', 'keyUp']), key: Schema.optionalKey(Schema.String), keyCode: Schema.optionalKey(Schema.Finite), repeat: Schema.optionalKey(Schema.Literal(true)) }),
  Schema.Struct({ ...eventBase, ...point, type: Schema.Literals(['mouseDown', 'mouseUp']), button: Schema.String, clicks: Schema.optionalKey(Schema.Finite) }),
  Schema.Struct({ ...eventBase, ...point, type: Schema.Literals(['mouseMove', 'mouseDrag']) }),
  Schema.Struct({ ...eventBase, ...point, type: Schema.Literal('scroll'), dx: Schema.Finite, dy: Schema.Finite }),
  Schema.Struct({ ...eventBase, type: Schema.Literals(['modifiers', 'gap']) }),
]);
export type InputEvent = typeof InputEvent.Type;

/** One line of Studio Recorder's input.jsonl, parsed and decoded. */
export const InputEventLine = Schema.fromJsonString(InputEvent);

/** A take's or recording's input, in time order. */
export type InputLog = { coordinates: InputLogCoordinates; events: readonly InputEvent[] };

const decodeInputEventLine = Schema.decodeUnknownResult(InputEventLine);

/** Studio Recorder's input.jsonl, read from `path`, as an input log, by the recorder's line rule (recorder-log-lines.ts). */
export function parseRecorderInputLog(jsonl: string, path: string): Result.Result<InputLog, RecordingLogLineUnreadable> {
  return Result.map(parseRecorderLogLines({ path, holds: 'an input event' }, jsonl, decodeInputEventLine), (events) => ({ coordinates: 'global-points', events }));
}

/** A cursor waypoint: where a logged move ended or a click landed. */
export type InputWaypoint = { t: number; x: number; y: number; click: boolean };

/** The log's cursor waypoints in order: its moves and drags, and each press as a click where it landed. */
export function inputLogWaypoints({ events }: InputLog): InputWaypoint[] {
  return events.flatMap((e) => (e.type === 'mouseMove' || e.type === 'mouseDrag' || e.type === 'mouseDown' ? [{ t: e.t, x: e.x, y: e.y, click: e.type === 'mouseDown' }] : []));
}

/** When each key was struck: every keyDown but a held key's repeats. */
export function inputLogKeyStrikes({ events }: InputLog): number[] {
  return events.flatMap((e) => (e.type === 'keyDown' && !e.repeat ? [e.t] : []));
}
