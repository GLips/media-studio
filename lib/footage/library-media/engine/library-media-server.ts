// library-media-server.ts: the library's media served to pages, straight from the media folder, never copied:
//
//   /library-media/<item>/<file>                  a file, with HTTP Range, for <video>, <audio> and fetch
//   /library-frames?item=&file=&t=&width=&fps=    a video file's picture at media time `t`, as a JPEG (library-frame-decoder.ts)
//
// A render serves both from a loopback server of its own (serveLibraryMedia), the studio app's Vite server the first
// through its middleware (studio-app-library-media.ts). Media offline answers 503 with the reason. Node only.
//
// Each request is an Effect program over the media folder's service; a file's bytes stream from the media folder into
// the response with Range offsets, at the pace the page reads them.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NodeSink } from '@effect/platform-node';
import { Effect, FileSystem, Path, Schema, Stream } from 'effect';
import { listenOnRenderLoopback } from '#lib/platform/browser/engine/render-loopback.ts';
import { runStudioEffect } from '#lib/platform/process/engine/studio-effect-runtime.ts';
import { libraryFrameAt } from './library-frame-decoder.ts';
import { LibraryMediaFolder, libraryMediaFolderLayer } from './library-media-folder.ts';

/** The path every page asks for library media under (library-media.ts names files under it). */
export const LIBRARY_MEDIA_PATH = '/library-media';
const LIBRARY_FRAMES_PATH = '/library-frames';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.jsonl': 'application/x-ndjson', '.json': 'application/json',
};

// Pages load from another origin (a render's bundle server, the Remotion Studio), and draw frames they fetch.
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length, content-range, accept-ranges' };

/** The page stopped reading a file part way (a seek, a closed tab); its response is dropped, not answered. */
class LibraryMediaReaderGone extends Schema.TaggedError<LibraryMediaReaderGone>()('LibraryMediaReaderGone', { path: Schema.String }) {
  override get message(): string {
    return `the page stopped reading ${this.path}`;
  }
}

/** Answers with a plain-text reason a page can show. */
function refuse(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(message);
}

/** The file under the media folder that `relative` names, or null when it would step outside it. */
const mediaFileOf = Effect.fn('LibraryMediaServer.fileOf')(function* (relative: string) {
  const folder = yield* (yield* LibraryMediaFolder).online(), path = yield* Path.Path;
  const file = path.resolve(folder, relative);
  return file.startsWith(folder + path.sep) ? file : null;
});

/** `path`'s bytes from `offset`, `length` of them, written to `response` as it drains, then ended. */
const streamMediaBytes = Effect.fn('LibraryMediaServer.streamBytes')(function* (response: ServerResponse, path: string, offset: number, length: number) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.stream(path, { offset, bytesToRead: length }).pipe(
    Stream.run(NodeSink.fromWritable({ evaluate: () => response, onError: () => new LibraryMediaReaderGone({ path }) })),
  );
});

/** Serves `path`, `size` bytes, whole or by the request's one Range. */
const sendMediaFile = Effect.fn('LibraryMediaServer.sendFile')(function* (request: IncomingMessage, response: ServerResponse, path: string, size: number, extension: string) {
  const headers = { ...CORS, 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range) {
    response.writeHead(200, { ...headers, 'content-length': size });
    if (request.method === 'HEAD') return response.end();
    return yield* streamMediaBytes(response, path, 0, size);
  }
  // `bytes=-n` is the last n bytes; `bytes=n-` from n to the end.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) return response.writeHead(416, { ...CORS, 'content-range': `bytes */${size}` }).end();
  response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  if (request.method === 'HEAD') return response.end();
  return yield* streamMediaBytes(response, path, start, end - start + 1);
});

const answerMediaFile = Effect.fn('LibraryMediaServer.mediaFile')(function* (request: IncomingMessage, response: ServerResponse, url: URL) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const relative = decodeURIComponent(url.pathname.slice(LIBRARY_MEDIA_PATH.length + 1));
  const file = yield* mediaFileOf(relative);
  if (!file) return refuse(response, 403, `${url.pathname} isn't in the library's media folder`);
  const info = (yield* fs.exists(file)) ? yield* fs.stat(file) : undefined;
  if (info?.type !== 'File') return refuse(response, 404, `${relative} isn't in the library's media folder (${file})`);
  return yield* sendMediaFile(request, response, file, Number(info.size), path.extname(file).toLowerCase());
});

const answerFrame = Effect.fn('LibraryMediaServer.frame')(function* (response: ServerResponse, url: URL) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const [item, file] = ['item', 'file'].map((name) => url.searchParams.get(name) ?? '');
  const [t, width, fps] = ['t', 'width', 'fps'].map((name) => Number(url.searchParams.get(name)));
  const media = item && file ? yield* mediaFileOf(path.join(item, file)) : null;
  if (!media || !(t >= 0) || !(width > 0) || !(fps > 0)) return refuse(response, 400, `${url.search} names no item, file, t, width and fps in the media folder`);
  if (!(yield* fs.exists(media))) return refuse(response, 404, `${item}'s ${file} isn't in the library's media folder (${media})`);
  // Even, as the JPEGs' chroma needs.
  const jpeg = yield* libraryFrameAt({ path: media, width: Math.ceil(width / 2) * 2, fps }, t);
  return response.writeHead(200, { ...CORS, 'content-type': 'image/jpeg', 'content-length': jpeg.length, 'cache-control': 'no-store' }).end(jpeg);
});

let warnedOffline = false;

/** Answers a library request, or returns false for any other path. */
export function handleLibraryMediaRequest(request: IncomingMessage, response: ServerResponse): boolean {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const media = url.pathname.startsWith(`${LIBRARY_MEDIA_PATH}/`), frames = url.pathname === LIBRARY_FRAMES_PATH;
  if (!media && !frames) return false;
  const answer = Effect.gen(function* () {
    return media ? yield* answerMediaFile(request, response, url) : yield* answerFrame(response, url);
  }).pipe(
    Effect.catchTag('LibraryMediaOffline', (offline) => Effect.gen(function* () {
      // Said once in the terminal too: an audio pass's download names only the status.
      if (!warnedOffline) yield* Effect.log(offline.message);
      warnedOffline = true;
      refuse(response, 503, offline.message);
    })),
    // Its headers are already sent, so only dropping the connection tells the page.
    Effect.catchTag('LibraryMediaReaderGone', () => Effect.sync(() => response.destroy())),
    Effect.catch((error) => Effect.sync(() => refuse(response, 500, error.message))),
  );
  void runStudioEffect(answer, libraryMediaFolderLayer);
  return true;
}

/** A loopback server of the library's media and frames for one render's pages; its origin goes in VideoProps' libraryMedia. */
export const serveLibraryMedia = Effect.fn('LibraryMediaServer.serve')(function* () {
  const server = createServer((request, response) => {
    if (!handleLibraryMediaRequest(request, response)) refuse(response, 404, `${request.url} isn't library media`);
  });
  return { url: `http://127.0.0.1:${yield* Effect.promise(() => listenOnRenderLoopback(server))}` };
});
