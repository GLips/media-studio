// library-proxies.ts: an item's editing proxies, made once each. A track whose video is variable-rate, larger than HD
// or not H.264 gets an H.264 copy at HD size and a constant rate (libraryProxyNeeded), for scrubbing, editing and
// render workers that can't decode HEVC. The original stays the source for the final render. Node only.
//
// A proxy keeps its track's media time: frame-rate conversion holds each frame's timestamp, so the track's sync
// numbers apply to it unchanged.
import { Effect, FileSystem, Path, Ref, Result } from 'effect';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { libraryProxiesWanted } from '../models/library-item.ts';
import { libraryProxiesMade, libraryProxyRunStarted, libraryProxyRunStep } from '../models/library-proxy-machine.ts';
import { LibraryStore } from './library-store.ts';

// macOS's hardware encoder: a 20-minute 5K screen takes minutes, not an hour. Its bitrate is for HD that edits cleanly.
const PROXY_ENCODER = ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1'];

/**
 * Makes each proxy `id`'s tracks need and lack, side by side (Apple silicon has encoders to spare), then records the
 * ones made in item.json, whatever else failed; fails with the first failure after. Returns the item.
 */
export const makeLibraryProxies = Effect.fn('LibraryProxies.make')(function* (id: string) {
  const store = yield* LibraryStore, media = yield* LibraryMediaFolder, ffmpeg = yield* StudioFfmpeg;
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const item = yield* store.readItem(id);
  const wanted = libraryProxiesWanted(item);
  if (!wanted.length) return item;
  const run = yield* Ref.make(libraryProxyRunStarted(wanted.map((w) => w.track)));

  const encode = Effect.fn('LibraryProxies.encode')(function* ({ track, size }: (typeof wanted)[number]) {
    const file = `proxies/${track}.mp4`, out = path.join(yield* media.online(), id, file), temp = `${out}.part.mp4`;
    const source = yield* media.itemFile(id, item.tracks[track].file);
    yield* fs.makeDirectory(path.dirname(out), { recursive: true });
    yield* Effect.log(`making ${track}'s proxy, ${size.width}×${size.height} at ${size.fps} fps`);
    yield* ffmpeg.run([
      '-v', 'error', '-y', '-i', source,
      '-vf', `scale=${size.width}:${size.height}:flags=bicubic`, '-fps_mode', 'cfr', '-r', String(size.fps),
      ...PROXY_ENCODER, ...(item.tracks[track].audio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), '-movflags', '+faststart', temp,
    ]);
    yield* fs.rename(temp, out);
    return { file, ...size };
  });

  const settled = yield* Effect.forEach(wanted, (want) => encode(want).pipe(
    Effect.tap((proxy) => Ref.update(run, (s) => libraryProxyRunStep(s, { type: 'proxyMade', track: want.track, proxy }))),
    Effect.tapError(() => Ref.update(run, (s) => libraryProxyRunStep(s, { type: 'proxyFailed', track: want.track }))),
    Effect.result,
  ), { concurrency: 'unbounded' });

  const made = libraryProxiesMade(yield* Ref.get(run)) ?? {};
  // Re-read: another process may have changed item.json while the encodes ran.
  const recorded = yield* store.updateItem(id, (now) => ({
    ...now, tracks: Object.fromEntries(Object.entries(now.tracks).map(([name, track]) => [name, made[name] ? { ...track, proxy: made[name] } : track])),
  }));
  const failure = settled.find(Result.isFailure);
  if (failure) return yield* Effect.fail(failure.failure);
  return recorded;
});
