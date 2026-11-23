// input-log.ts: the input log, one shape for every source that logs input: Studio Recorder's input.jsonl
// (lib/footage/recording/engine/recorder/Sources/StudioRecorder/InputLog.swift) and a capture's take, which fills
// what a scripted browser knows (glide ends, clicks, typed characters). Pure, so it loads in plain Node.

/**
 * The space an event's x and y are in. `global-points`: macOS points, origin at the main display's top left, y down,
 * across every display (the recording's screen geometry maps them onto its pixels). `viewport-css-pixels`: the
 * captured page's viewport.
 */
export type InputLogCoordinates = 'global-points' | 'viewport-css-pixels';

/** A modifier held when the event happened. */
export type InputModifier = 'ctrl' | 'opt' | 'shift' | 'cmd' | 'fn';

/**
 * One logged event: `t` in seconds from the start, on the tracks' clock; x, y in the log's coordinates. `key` is the
 * character typed, or a name (`return`, `left`, `f5`) for a key that types none; `repeat`, a key held down. `gap`:
 * events lost while macOS had switched the recorder's tap off for being slow.
 */
export type InputEvent = { t: number; modifiers?: readonly InputModifier[] } & (
  | { type: 'keyDown' | 'keyUp'; key?: string; keyCode?: number; repeat?: true }
  | { type: 'mouseDown' | 'mouseUp'; x: number; y: number; button: string; clicks?: number }
  | { type: 'mouseMove' | 'mouseDrag'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { type: 'modifiers' }
  | { type: 'gap' });

/** A take's or recording's input, in time order. */
export type InputLog = { coordinates: InputLogCoordinates; events: readonly InputEvent[] };

/**
 * Studio Recorder's input.jsonl as an input log. A killed recording can end mid-line: that torn last line is dropped,
 * as the events before it stand.
 */
export function parseRecorderInputLog(jsonl: string): InputLog {
  const lines = jsonl.split('\n').filter((line) => line.trim());
  const events = lines.flatMap((line, i): InputEvent[] => {
    try {
      // SAFETY: the recorder writes only InputEvent lines (InputLog.swift).
      return [JSON.parse(line) as InputEvent];
    } catch (error) {
      if (i === lines.length - 1) return [];
      throw error;
    }
  });
  return { coordinates: 'global-points', events };
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
