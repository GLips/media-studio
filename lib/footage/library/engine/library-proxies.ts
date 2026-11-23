// library-proxies.ts: an item's editing proxies, made once each. A track whose video is variable-rate, larger than HD
// or not H.264 gets an H.264 copy at HD size and a constant rate (libraryProxyNeeded), for scrubbing, editing and
// render workers that can't decode HEVC. The original stays the source for the final render. Node only.
//
// A proxy keeps its track's media time: frame-rate conversion holds each frame's timestamp, so the track's sync
// numbers apply to it unchanged.
import { mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { libraryProxyNeeded, type LibraryItem } from '../models/library-item.ts';
import { onlineLibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { libraryMediaPath, readLibraryItem, writeLibraryItem } from './library-store.ts';

// macOS's hardware encoder: a 20-minute 5K screen takes minutes, not an hour. Its bitrate is for HD that edits cleanly.
const PROXY_ENCODER = ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1'];

/**
 * Makes each proxy `id`'s tracks need and lack, side by side (Apple silicon has encoders to spare), then records them
 * in item.json; returns the item.
 */
export async function makeLibraryProxies(id: string, log: (line: string) => void): Promise<LibraryItem> {
  const item = readLibraryItem(id);
  const wanted = Object.entries(item.tracks).flatMap(([name, track]) => {
    const size = libraryProxyNeeded(track);
    return size && !track.proxy ? [{ name, track, size }] : [];
  });
  if (!wanted.length) return item;
  const settled = await Promise.allSettled(wanted.map(async ({ name, track, size }) => {
    const file = `proxies/${name}.mp4`, out = join(onlineLibraryMediaFolder(), id, file), temp = `${out}.part.mp4`;
    mkdirSync(dirname(out), { recursive: true });
    log(`making ${name}'s proxy, ${size.width}×${size.height} at ${size.fps} fps`);
    await runFfmpegAsync([
      '-v', 'error', '-y', '-i', libraryMediaPath(item, track.file),
      '-vf', `scale=${size.width}:${size.height}:flags=bicubic`, '-fps_mode', 'cfr', '-r', String(size.fps),
      ...PROXY_ENCODER, ...(track.audio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), '-movflags', '+faststart', temp,
    ]);
    renameSync(temp, out);
    return [name, { file, ...size }] as const;
  }));
  // Re-read: another process may have changed item.json while the encodes ran. Proxies made are kept whatever failed.
  const now = readLibraryItem(id), tracks = { ...now.tracks };
  for (const result of settled) if (result.status === 'fulfilled') tracks[result.value[0]] = { ...tracks[result.value[0]], proxy: result.value[1] };
  writeLibraryItem({ ...now, tracks });
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return readLibraryItem(id);
}
