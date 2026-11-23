// library-sources.ts: what an add takes in, before any file is probed: a recorder's folder read from its
// recording.json, or files the caller names with their starts. Pure.
import type { LibraryScreenDisplay } from './library-item.ts';

/** A track to add: its source file and its sync, before ffprobe says what it holds. */
export type LibraryTrackSource = {
  name: string;
  path: string;
  startSeconds: number;
  latencySeconds?: number;
  hostDriftSeconds?: number;
  device?: string;
  display?: LibraryScreenDisplay;
};

/** Everything an add needs from its source but the files' own facts. */
export type LibraryAddSource = {
  tracks: LibraryTrackSource[];
  title: string;
  recordedAt?: string;
  source: { kind: 'studio-recorder'; folder: string; status: 'complete' | 'interrupted' } | { kind: 'files'; paths: string[] };
  /** The input log's file, to copy beside the media. */
  input?: { path: string; coordinates: 'global-points' };
  /** Files carried along with the media that the item doesn't read (the recorder's recording.json and clock log). */
  extras?: string[];
  problems?: Record<string, string>;
  leftOut?: Record<string, string>;
};

type RecorderTrackJson = {
  file: string; startSeconds?: number; latencySeconds?: number; hostDriftSeconds?: number; device?: string; display?: LibraryScreenDisplay;
};

/** recording.json as the recorder writes it (lib/footage/recording/engine/recorder/Sources/StudioRecorder/Recording.swift). */
export type RecorderRecordingJson = {
  format: string;
  status: 'recording' | 'complete';
  startedAt: string;
  durationSeconds?: number;
  tracks: Record<string, RecorderTrackJson>;
  input?: { file: string; coordinates: 'global-points' };
  clockLog?: string;
  leftOut?: Record<string, string>;
  problems?: Record<string, string>;
};

export const RECORDER_RECORDING_FORMAT = 'studio-recording/1';

/**
 * A recorder folder's add source. `present` lists the folder's files. A track listed without its file or without a
 * start (an early recorder listed a camera that sent nothing) is left out, not added. A take still marked recording
 * was killed: it's interrupted, and its length comes from its files.
 */
export function recorderAddSource(folder: string, name: string, recording: RecorderRecordingJson, present: ReadonlySet<string>): LibraryAddSource {
  if (recording.format !== RECORDER_RECORDING_FORMAT) throw new Error(`${folder}/recording.json is ${recording.format}, not ${RECORDER_RECORDING_FORMAT}`);
  const leftOut: Record<string, string> = { ...recording.leftOut };
  const tracks: LibraryTrackSource[] = [];
  for (const [track, json] of Object.entries(recording.tracks)) {
    if (!present.has(json.file)) leftOut[track] = `${json.file} was never written`;
    else if (json.startSeconds === undefined) leftOut[track] = 'the recorder wrote no start for it';
    else {
      tracks.push({
        name: track, path: `${folder}/${json.file}`, startSeconds: json.startSeconds,
        ...(json.latencySeconds && { latencySeconds: json.latencySeconds }),
        ...(json.hostDriftSeconds && { hostDriftSeconds: json.hostDriftSeconds }),
        ...(json.device && { device: json.device }), ...(json.display && { display: json.display }),
      });
    }
  }
  if (!tracks.length) throw new Error(`${folder} holds no track to add: ${Object.entries(leftOut).map(([t, why]) => `${t}, ${why}`).join('; ')}`);
  const input = recording.input && present.has(recording.input.file) ? { path: `${folder}/${recording.input.file}`, coordinates: recording.input.coordinates } : undefined;
  const extras = [...(recording.clockLog && present.has(recording.clockLog) ? [`${folder}/${recording.clockLog}`] : []), `${folder}/recording.json`];
  return {
    tracks, title: `Recording ${name}`, recordedAt: recording.startedAt,
    source: { kind: 'studio-recorder', folder, status: recording.status === 'complete' ? 'complete' : 'interrupted' },
    ...(input && { input }), extras,
    ...(recording.problems && { problems: recording.problems }), ...(Object.keys(leftOut).length && { leftOut }),
  };
}

const fileNameOf = (path: string) => path.split('/').at(-1)!.replace(/\.[^.]+$/, '');

/**
 * Tracks the caller names, `name=path`, each starting at its entry in `starts` (seconds of item time; tracks start
 * together by default). `latencies` and `devices` are by track name too.
 */
export function namedFilesAddSource(specs: readonly string[], options: {
  title?: string; starts?: Readonly<Record<string, number>>; latencies?: Readonly<Record<string, number>>; devices?: Readonly<Record<string, string>>;
}): LibraryAddSource {
  const tracks = specs.map((spec): LibraryTrackSource => {
    const at = spec.indexOf('=');
    if (at <= 0) throw new Error(`"${spec}" isn't a track: name one as name=path, as screen=display.mp4`);
    const name = spec.slice(0, at), path = spec.slice(at + 1);
    const latencySeconds = options.latencies?.[name], device = options.devices?.[name];
    return { name, path, startSeconds: options.starts?.[name] ?? 0, ...(latencySeconds && { latencySeconds }), ...(device && { device }) };
  });
  const names = tracks.map((t) => t.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) throw new Error(`two tracks are named ${duplicate}`);
  for (const [what, byTrack] of Object.entries({ start: options.starts, latency: options.latencies, device: options.devices })) {
    const stray = Object.keys(byTrack ?? {}).find((n) => !names.includes(n));
    if (stray) throw new Error(`a ${what} is given for ${stray}, which isn't one of the tracks (${names.join(', ')})`);
  }
  return { tracks, title: options.title ?? fileNameOf(tracks[0].path), source: { kind: 'files', paths: tracks.map((t) => t.path) } };
}

/**
 * `name=value,name=value` as a record, each value parsed by `parse`: how the CLI takes a value per track in one flag.
 * Values may not hold commas.
 */
export function parseTrackValues<T>(text: string | undefined, parse: (value: string, name: string) => T): Record<string, T> {
  if (!text) return {};
  return Object.fromEntries(text.split(',').map((pair) => {
    const at = pair.indexOf('=');
    if (at <= 0) throw new Error(`"${pair}" isn't track=value`);
    const name = pair.slice(0, at).trim();
    return [name, parse(pair.slice(at + 1).trim(), name)];
  }));
}
