// add-library-item.ts: taking footage into the library. Its files go to the media folder, its speech is transcribed,
// and its metadata is written to the workspace, so it's searchable; then tracks that need one get an editing proxy.
// Node only.
//
// Files are copied (an APFS clone where the media folder shares a volume with the source, so free), or moved with
// `move`, as a recorder's own recordings are: the library is their home, and the recorder's folder only an inbox.
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { transcribeFootage } from '#lib/footage/transcript/engine/transcribe-footage.ts';
import { runFfprobe } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { libraryItemDuration, librarySlug, librarySpeechTrack, LIBRARY_ITEM_FORMAT, unusedLibraryItemId, type LibraryItem, type LibraryTrack, type LibraryTrackStreams } from '../models/library-item.ts';
import { namedFilesAddSource, recorderAddSource, type LibraryAddSource, type RecorderRecordingJson } from '../models/library-sources.ts';
import { makeLibraryProxies } from './library-proxies.ts';
import { libraryItemDir, libraryMediaPath, listLibraryItemIds, onlineLibraryMediaFolder, readLibraryItem, readLibraryTranscript, writeLibraryItem, writeLibraryTranscript } from './library-store.ts';

/** What to add: one file or a recorder's folder by its path, or several files as named tracks (`screen=display.mp4`). */
export type LibraryAddRequest = {
  paths: readonly string[];
  title?: string;
  /** Seconds of item time each named track starts at; tracks start together by default. */
  starts?: Readonly<Record<string, number>>;
  /** Each named track's device, whose latency the recorder's settings give. */
  devices?: Readonly<Record<string, string>>;
  /** Latencies by track, over what a device's setting says. */
  latencies?: Readonly<Record<string, number>>;
  move?: boolean;
  proxies?: boolean;
  /** Progress, for stderr. */
  log?: (line: string) => void;
};

/** Adds the footage; returns the item, with its proxies when they're made. */
export async function addLibraryItem(request: LibraryAddRequest): Promise<LibraryItem> {
  const log = request.log ?? (() => {});
  const source = addSourceOf(request);
  const already = listLibraryItemIds().map(readLibraryItem).find((item) => sameSource(item, source));
  if (already) throw new Error(`${describeSource(source)} is in the library already, as ${already.id}`);

  const probed = source.tracks.map((track) => ({ ...track, streams: probeStreams(track.path), mediaSeconds: probeSeconds(track.path) }));
  // A lone file is named by what it holds.
  if (request.paths.length === 1 && source.source.kind === 'files') probed[0].name = probed[0].streams.video ? 'video' : 'audio';
  const id = unusedLibraryItemId(itemIdBase(source), new Set(listLibraryItemIds()));
  const media = join(onlineLibraryMediaFolder({ make: true }), id);
  mkdirSync(media, { recursive: true });

  const recorderLatency = recorderDeviceLatencies();
  const tracks: Record<string, LibraryTrack> = {};
  // A copy that fails leaves the sources as they were, so its half-filled media folder goes; a move's stays with what it moved.
  try {
  for (const track of probed) {
    const file = `${track.name}${extname(track.path).toLowerCase()}`;
    log(`${request.move ? 'moving' : 'copying'} ${track.path} → ${join(media, file)}`);
    bringFile(track.path, join(media, file), request.move ?? false);
    const latencySeconds = request.latencies?.[track.name] ?? track.latencySeconds ?? (track.device ? deviceLatency(recorderLatency, track.device) : undefined);
    tracks[track.name] = {
      file, ...track.streams, mediaSeconds: track.mediaSeconds, startSeconds: track.startSeconds,
      ...(latencySeconds && { latencySeconds }), ...(track.hostDriftSeconds && { hostDriftSeconds: track.hostDriftSeconds }),
      ...(track.device && { device: track.device }), ...(track.display && { display: track.display }),
    };
  }
  if (source.input) bringFile(source.input.path, join(media, 'input.jsonl'), request.move ?? false);
  for (const extra of source.extras ?? []) bringFile(extra, join(media, basename(extra)), request.move ?? false);
  } catch (error) {
    if (!request.move) rmSync(media, { recursive: true, force: true });
    throw error;
  }
  if (request.move && source.source.kind === 'studio-recorder') removeIfEmpty(source.source.folder);

  const speech = librarySpeechTrack(tracks);
  writeLibraryItem({
    format: LIBRARY_ITEM_FORMAT, id, title: source.title, source: source.source,
    ...(source.recordedAt && { recordedAt: source.recordedAt }), addedAt: new Date().toISOString(),
    durationSeconds: libraryItemDuration(tracks), tracks, ...(speech && { speech }),
    ...(source.input && { input: { file: 'input.jsonl', coordinates: source.input.coordinates } }),
    ...(source.problems && { problems: source.problems }), ...(source.leftOut && { leftOut: source.leftOut }),
  });
  log(`added ${id} to ${libraryItemDir(id)}`);
  return finishLibraryItem(id, { proxies: request.proxies ?? true, log });
}

/**
 * Makes what an item lacks from its media: its transcript, then the proxies its tracks need (with `proxies`). An add
 * ends with it; run again, it picks up where a failed or interrupted add stopped.
 */
export async function finishLibraryItem(id: string, { proxies, log }: { proxies: boolean; log: (line: string) => void }): Promise<LibraryItem> {
  const item = readLibraryItem(id);
  if (item.speech && !readLibraryTranscript(id)) {
    log(`transcribing ${item.speech}`);
    const transcript = await transcribeFootage(libraryMediaPath(item, item.tracks[item.speech].file));
    writeLibraryTranscript(id, { track: item.speech, ...transcript });
  }
  return proxies ? makeLibraryProxies(id, log) : item;
}

// How long a take's files must have been still before an unfinished one counts as killed rather than live.
const LIVE_RECORDING_QUIET_MS = 10_000;

function addSourceOf({ paths, title, starts, devices, latencies }: LibraryAddRequest): LibraryAddSource {
  if (!paths.length) throw new Error('name a file, a recorder folder, or tracks as name=path');
  const named = paths.filter((p) => /^[\w-]+=/.test(p));
  if (named.length && named.length !== paths.length) throw new Error('name every track as name=path, or add one file or folder alone');
  if (named.length) return namedFilesAddSource(named.map((spec) => spec.replace(/=(.*)$/, (_, path: string) => `=${resolve(path)}`)), { title, starts, latencies, devices });
  if (paths.length > 1) throw new Error('several files make one item only as named tracks: screen=a.mp4 camera=b.mp4');
  const path = resolve(paths[0]);
  if (!existsSync(path)) throw new Error(`${paths[0]} isn't there`);
  if (statSync(path).isDirectory()) {
    if (Object.keys({ ...starts, ...devices, ...latencies }).length) throw new Error("a recorder's folder carries its own starts and latencies");
    const recordingFile = join(path, 'recording.json');
    if (!existsSync(recordingFile)) throw new Error(`${paths[0]} is a folder without a recording.json: add its files as named tracks (name=path)`);
    // SAFETY: recorderAddSource checks the format the recorder stamps.
    const recording = JSON.parse(readFileSync(recordingFile, 'utf8')) as RecorderRecordingJson;
    // A take still marked recording is either killed or live; a live one's files grow every fragment (2 s).
    const newest = Math.max(...readdirSync(path).map((f) => statSync(join(path, f)).mtimeMs));
    if (recording.status === 'recording' && Date.now() - newest < LIVE_RECORDING_QUIET_MS) throw new Error(`${paths[0]} is still recording: add it once it stops`);
    const source = recorderAddSource(path, basename(path), recording, new Set(readdirSync(path)));
    return title ? { ...source, title } : source;
  }
  return namedFilesAddSource([`video=${path}`], { title, starts, latencies, devices });
}

/** `2026-11-22-181929` for a recording, on its own clock; `2026-11-22-<title>` for files, dated today here. */
function itemIdBase({ source, recordedAt, title }: LibraryAddSource): string {
  if (source.kind === 'studio-recorder' && recordedAt) return recordedAt.slice(0, 19).replace('T', '-').replaceAll(':', '');
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${day}-${librarySlug(title)}`;
}

const describeSource = ({ source }: LibraryAddSource) => (source.kind === 'studio-recorder' ? source.folder : source.paths.join(', '));

function sameSource(item: LibraryItem, { source }: LibraryAddSource): boolean {
  if (item.source.kind === 'studio-recorder' && source.kind === 'studio-recorder') return basename(item.source.folder) === basename(source.folder);
  return item.source.kind === 'files' && source.kind === 'files' && item.source.paths.join('\n') === source.paths.join('\n');
}

type FfprobeStream = { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; sample_rate?: string; channels?: number };

const ratio = (text: string | undefined) => {
  const [n, d] = (text ?? '0/1').split('/').map(Number);
  return d ? n / d : 0;
};

/** What a file's first video and audio streams are. Variable rate: ffprobe's nominal and average rates differ. */
function probeStreams(path: string): LibraryTrackStreams {
  // SAFETY: ffprobe's JSON writer gives this shape for -show_streams.
  const { streams } = JSON.parse(runFfprobe(['-v', 'error', '-show_streams', '-of', 'json', path], { encoding: 'utf8' })) as { streams: FfprobeStream[] };
  const video = streams.find((s) => s.codec_type === 'video' && s.width), audio = streams.find((s) => s.codec_type === 'audio');
  if (!video && !audio) throw new Error(`${path} has no video or sound ffmpeg can read`);
  const nominal = ratio(video?.r_frame_rate), average = ratio(video?.avg_frame_rate);
  return {
    ...(video && { video: { width: video.width!, height: video.height!, fps: Math.round((average || nominal) * 1000) / 1000, variableRate: Math.abs(nominal - average) > 0.01, codec: video.codec_name } }),
    ...(audio && { audio: { sampleRate: Number(audio.sample_rate), channels: audio.channels ?? 1, codec: audio.codec_name } }),
  };
}

/**
 * A file's length from its streams' ends rather than its header, which a killed recording never wrote. ffprobe reads
 * the last packet of each stream.
 */
function probeSeconds(path: string): number {
  const header = Number(runFfprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' }).trim());
  if (Number.isFinite(header) && header > 0) return header;
  const last = runFfprobe(['-v', 'error', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', '-read_intervals', '%+#999999', path], { encoding: 'utf8' })
    .trim().split('\n').map((line) => line.split(',').map(Number)).reduce((end, [pts, duration]) => Math.max(end, pts + (duration || 0)), 0);
  if (!(last > 0)) throw new Error(`${path} has no length ffprobe can read`);
  return last;
}

function bringFile(from: string, to: string, move: boolean): void {
  if (move) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      // SAFETY: node:fs throws ErrnoExceptions; across volumes a rename can't, so it's a copy and a delete.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
  }
  copyFileSync(from, to, constants.COPYFILE_FICLONE);
  if (move) rmSync(from);
}

function removeIfEmpty(folder: string): void {
  const left = readdirSync(folder).filter((f) => f !== '.DS_Store');
  if (!left.length) rmSync(folder, { recursive: true });
}

// The recorder's settings hold each camera's and mic's latency by device name, set once for this machine's devices
// (vid-197's RecorderConfig.swift); the library records a track's at add time.
const RECORDER_CONFIG = join(homedir(), 'Library/Application Support/StudioRecorder/config.json');

/** Device name part → latency in seconds, from the recorder's settings; none without them. */
function recorderDeviceLatencies(): Record<string, number> {
  if (!existsSync(RECORDER_CONFIG)) return {};
  // SAFETY: RecorderConfig.swift writes this shape; only these fields are read.
  const config = JSON.parse(readFileSync(RECORDER_CONFIG, 'utf8')) as Partial<Record<'camera' | 'mic', { latencyMsByDevice?: Record<string, number> }>>;
  return Object.fromEntries([config.camera, config.mic].flatMap((d) => Object.entries(d?.latencyMsByDevice ?? {})).filter(([, ms]) => ms).map(([device, ms]) => [device, ms / 1000]));
}

const deviceLatency = (latencies: Record<string, number>, device: string) =>
  Object.entries(latencies).find(([part]) => device.toLowerCase().includes(part.toLowerCase()))?.[1];
