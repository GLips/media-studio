// library-probe.ts: what a track's file holds and how long it runs, from ffprobe, decoded. Node only.
import { Effect, Schema } from 'effect';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { LibraryTrackUnreadable } from '../models/library-errors.ts';
import type { LibraryTrackStreams } from '../models/library-item.ts';

/** ffprobe's `-show_streams -of json`, the fields the library reads; any stream may lack any of them. */
const FfprobeStreams = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({
    codec_type: Schema.String,
    codec_name: Schema.optionalKey(Schema.String),
    width: Schema.optionalKey(Schema.Finite),
    height: Schema.optionalKey(Schema.Finite),
    r_frame_rate: Schema.optionalKey(Schema.String),
    avg_frame_rate: Schema.optionalKey(Schema.String),
    sample_rate: Schema.optionalKey(Schema.String),
    channels: Schema.optionalKey(Schema.Finite),
  })),
}));

// ffprobe prints `0/0` or `N/A` for a rate or count it doesn't know; item.json takes finite numbers alone.
const ratio = (text: string | undefined) => {
  const [n, d] = (text ?? '0/1').split('/').map(Number);
  const value = n / d;
  return Number.isFinite(value) ? value : 0;
};

const positiveNumber = (text: string | undefined) => {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/** What a file's first video and audio streams are. Variable rate: ffprobe's nominal and average rates differ. */
export const probeLibraryStreams = Effect.fn('LibraryProbe.streams')(function* (path: string) {
  const ffmpeg = yield* StudioFfmpeg;
  const { streams } = yield* Schema.decodeUnknownEffect(FfprobeStreams)(yield* ffmpeg.probe(['-v', 'error', '-show_streams', '-of', 'json', path])).pipe(
    Effect.mapError(() => new LibraryTrackUnreadable({ path, lacks: 'streams' })),
  );
  const video = streams.find((s) => s.codec_type === 'video' && s.width), audio = streams.find((s) => s.codec_type === 'audio');
  if (!video && !audio) return yield* new LibraryTrackUnreadable({ path, lacks: 'streams' });
  const nominal = ratio(video?.r_frame_rate), average = ratio(video?.avg_frame_rate);
  const sampleRate = positiveNumber(audio?.sample_rate);
  const read: LibraryTrackStreams = {
    ...(video && { video: { width: video.width ?? 0, height: video.height ?? 0, fps: Math.round((average || nominal) * 1000) / 1000, variableRate: Math.abs(nominal - average) > 0.01, codec: video.codec_name ?? '' } }),
    ...(audio && { audio: { ...(sampleRate && { sampleRate }), channels: audio.channels ?? 1, codec: audio.codec_name ?? '' } }),
  };
  return read;
});

/**
 * A file's length: its header's, or for an interrupted take its packets' ends, since a killed recorder never finished
 * its header and the one it started may name only its first fragment.
 */
export const probeLibrarySeconds = Effect.fn('LibraryProbe.seconds')(function* (path: string, { interrupted }: { interrupted: boolean }) {
  const ffmpeg = yield* StudioFfmpeg;
  const header = Number((yield* ffmpeg.probe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])).trim());
  if (!interrupted && Number.isFinite(header) && header > 0) return header;
  const packets = yield* ffmpeg.probe(['-v', 'error', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', '-read_intervals', '%+#999999', path]);
  const last = packets.trim().split('\n').map((line) => line.split(',').map(Number)).reduce((end, [pts, duration]) => Math.max(end, pts + (duration || 0)), 0);
  if (!(last > 0)) return yield* new LibraryTrackUnreadable({ path, lacks: 'length' });
  return last;
});
