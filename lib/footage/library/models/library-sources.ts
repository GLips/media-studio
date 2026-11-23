// library-sources.ts: what an add takes in, before any file is probed: a recorder's take read from its
// recording.json, or files the caller names with their starts. Pure.
import { Result } from 'effect';
import type { RecordingWindowPlacement } from '#lib/footage/recording/models/recording-window-log.ts';
import type { StudioRecordingJson } from '#lib/footage/recording/models/studio-recording-json.ts';
import { LibraryNoTrackToAdd, LibraryRequestRefused } from './library-errors.ts';
import type { LibraryItemSource, LibraryScreenDisplay, LibraryScreenWindow } from './library-item.ts';
import type { RecorderTakeEnding } from './library-take-machine.ts';

/** A track to add: its source file and its sync, before ffprobe says what it holds. */
export type LibraryTrackSource = {
  name: string;
  path: string;
  startSeconds: number;
  latencySeconds?: number;
  hostDriftSeconds?: number;
  device?: string;
  display?: LibraryScreenDisplay;
  window?: LibraryScreenWindow;
};

/** Everything an add needs from its source but the files' own facts. */
export type LibraryAddSource = {
  tracks: LibraryTrackSource[];
  title: string;
  recordedAt?: string;
  source: LibraryItemSource;
  /** The input log's file, to copy beside the media. */
  input?: { path: string; coordinates: 'global-points' };
  /** The take's clock log, to check and carry along beside the media. */
  clockLog?: string;
  /** Files carried along with the media that the item doesn't read (the recorder's recording.json). */
  extras?: string[];
  problems?: Readonly<Record<string, string>>;
  leftOut?: Readonly<Record<string, string>>;
};

/**
 * A recorder take's add source, as the take machine judged it ended. `present` lists the folder's files;
 * `windowPlacements`, each window track's log as read. A track listed without its file or start (an early recorder
 * listed a camera that sent nothing) is left out; a take left with none is refused.
 */
export function recorderAddSource(
  folder: string, name: string, recording: StudioRecordingJson, present: ReadonlySet<string>, ending: RecorderTakeEnding,
  windowPlacements: Readonly<Record<string, readonly RecordingWindowPlacement[]>> = {},
): Result.Result<LibraryAddSource, LibraryNoTrackToAdd> {
  const extras = [`${folder}/recording.json`];
  const leftOut: Record<string, string> = { ...recording.leftOut };
  const tracks: LibraryTrackSource[] = [];
  for (const [track, json] of Object.entries(recording.tracks)) {
    if (!present.has(json.file)) leftOut[track] = `${json.file} was never written`;
    else if (json.startSeconds === undefined) leftOut[track] = 'the recorder wrote no start for it';
    else {
      const placements = windowPlacements[track] ?? [];
      const window = json.window && placements.length ? { title: json.window.title, app: json.window.app, placements: [placements[0], ...placements.slice(1)] as const } : undefined;
      if (json.window && present.has(json.window.file)) extras.push(`${folder}/${json.window.file}`);
      tracks.push({
        name: track, path: `${folder}/${json.file}`, startSeconds: json.startSeconds,
        ...(json.latencySeconds && { latencySeconds: json.latencySeconds }),
        ...(json.hostDriftSeconds && { hostDriftSeconds: json.hostDriftSeconds }),
        ...(json.device && { device: json.device }), ...(json.display && { display: json.display }), ...(window && { window }),
      });
    }
  }
  if (!tracks.length) return Result.fail(new LibraryNoTrackToAdd({ folder, leftOut }));
  const input = recording.input && present.has(recording.input.file) ? { path: `${folder}/${recording.input.file}`, coordinates: recording.input.coordinates } : undefined;
  const clockLog = recording.clockLog && present.has(recording.clockLog) ? `${folder}/${recording.clockLog}` : undefined;
  return Result.succeed({
    tracks, title: `Recording ${name}`, recordedAt: recording.startedAt,
    source: { kind: 'studio-recorder', folder, status: ending },
    ...(input && { input }), ...(clockLog && { clockLog }), extras,
    ...(recording.problems && { problems: recording.problems }), ...(Object.keys(leftOut).length && { leftOut }),
  });
}

const fileNameOf = (path: string) => (path.split('/').at(-1) ?? path).replace(/\.[^.]+$/, '');

const refused = (reason: string) => Result.fail(new LibraryRequestRefused({ reason }));

/** Values given per track by name, as the CLI's --starts, --latencies and --devices give them. */
export type LibraryTrackValues = {
  starts?: Readonly<Record<string, number>>;
  latencies?: Readonly<Record<string, number>>;
  devices?: Readonly<Record<string, string>>;
};

/**
 * Tracks the caller names, `name=path`, each starting at its entry in `starts` (seconds of item time; tracks start
 * together by default). `latencies` and `devices` are by track name too.
 */
export function namedFilesAddSource(specs: readonly string[], options: LibraryTrackValues & { title?: string }): Result.Result<LibraryAddSource, LibraryRequestRefused> {
  const tracks: LibraryTrackSource[] = [];
  for (const spec of specs) {
    const at = spec.indexOf('=');
    if (at <= 0) return refused(`"${spec}" isn't a track: name one as name=path, as screen=display.mp4`);
    const name = spec.slice(0, at), path = spec.slice(at + 1);
    const latencySeconds = options.latencies?.[name], device = options.devices?.[name];
    tracks.push({ name, path, startSeconds: options.starts?.[name] ?? 0, ...(latencySeconds && { latencySeconds }), ...(device && { device }) });
  }
  const names = tracks.map((t) => t.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) return refused(`two tracks are named ${duplicate}`);
  for (const [what, byTrack] of Object.entries({ start: options.starts, latency: options.latencies, device: options.devices })) {
    const stray = Object.keys(byTrack ?? {}).find((n) => !names.includes(n));
    if (stray) return refused(`a ${what} is given for ${stray}, which isn't one of the tracks (${names.join(', ')})`);
  }
  return Result.succeed({ tracks, title: options.title ?? fileNameOf(tracks[0].path), source: { kind: 'files', paths: tracks.map((t) => t.path) } });
}

/**
 * `name=value,name=value` as a record, each value read by `read`: how the CLI takes a value per track in one flag.
 * Values may not hold commas.
 */
export function parseTrackValues<T>(text: string | undefined, read: (value: string, name: string) => Result.Result<T, LibraryRequestRefused>): Result.Result<Record<string, T>, LibraryRequestRefused> {
  const values: Record<string, T> = {};
  for (const pair of text ? text.split(',') : []) {
    const at = pair.indexOf('=');
    if (at <= 0) return refused(`"${pair}" isn't track=value`);
    const name = pair.slice(0, at).trim(), value = read(pair.slice(at + 1).trim(), name);
    if (Result.isFailure(value)) return Result.fail(value.failure);
    values[name] = value.success;
  }
  return Result.succeed(values);
}
