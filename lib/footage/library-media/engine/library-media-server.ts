// library-media-server.ts: the library's media served to pages, straight from the media folder, never copied:
//
//   /library-media/<item>/<file>                  a file, with HTTP Range, for <video>, <audio> and fetch
//   /library-frames?item=&file=&t=&width=&fps=    a video file's picture at media time `t`, as a JPEG (library-frame-decoder.ts)
//
// A render serves both from a loopback server of its own (serveLibraryMedia), the studio app's Vite server the first
// through its middleware (studio-app-library-media.ts). Media offline answers 503 with the reason. Node only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { listenOnRenderLoopback } from '#lib/platform/browser/engine/render-loopback.ts';
import { libraryFrameAt } from './library-frame-decoder.ts';
import { LibraryMediaOffline, onlineLibraryMediaFolder } from './library-media-folder.ts';

/** The path every page asks for library media under (library-media.ts names files under it). */
export const LIBRARY_MEDIA_PATH = '/library-media';
const LIBRARY_FRAMES_PATH = '/library-frames';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.jsonl': 'application/x-ndjson', '.json': 'application/json',
};

// Pages load from another origin (a render's bundle server, the Remotion Studio), and draw frames they fetch.
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length, content-range, accept-ranges' };

/** Answers with a plain-text reason a page can show. */
function refuse(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(message);
}

/** The file under the media folder that `relative` names, or null when it would step outside it. */
function mediaFileOf(relative: string): string | null {
  const folder = onlineLibraryMediaFolder(), path = resolve(folder, relative);
  return path.startsWith(folder + sep) ? path : null;
}

/** Serves `path` whole or by the request's one Range. */
function sendMediaFile(request: IncomingMessage, response: ServerResponse, path: string) {
  const { size } = statSync(path), type = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const headers = { ...CORS, 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range) {
    response.writeHead(200, { ...headers, 'content-length': size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
    return;
  }
  // `bytes=-n` is the last n bytes; `bytes=n-` from n to the end.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    response.writeHead(416, { ...CORS, 'content-range': `bytes */${size}` }).end();
    return;
  }
  response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path, { start, end }).pipe(response);
}

/** Answers a library request, or returns false for any other path. */
export function handleLibraryMediaRequest(request: IncomingMessage, response: ServerResponse): boolean {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const media = url.pathname.startsWith(`${LIBRARY_MEDIA_PATH}/`), frames = url.pathname === LIBRARY_FRAMES_PATH;
  if (!media && !frames) return false;
  void (async () => {
    if (media) {
      const path = mediaFileOf(decodeURIComponent(url.pathname.slice(LIBRARY_MEDIA_PATH.length + 1)));
      if (!path) refuse(response, 403, `${url.pathname} isn't in the library's media folder`);
      else if (!existsSync(path) || !statSync(path).isFile()) refuse(response, 404, `${url.pathname.slice(LIBRARY_MEDIA_PATH.length + 1)} isn't in the library's media folder (${path})`);
      else sendMediaFile(request, response, path);
      return;
    }
    const [item, file] = ['item', 'file'].map((name) => url.searchParams.get(name) ?? '');
    const [t, width, fps] = ['t', 'width', 'fps'].map((name) => Number(url.searchParams.get(name)));
    const path = item && file ? mediaFileOf(join(item, file)) : null;
    if (!path || !(t >= 0) || !(width > 0) || !(fps > 0)) {
      refuse(response, 400, `${url.search} names no item, file, t, width and fps in the media folder`);
      return;
    }
    if (!existsSync(path)) {
      refuse(response, 404, `${item}'s ${file} isn't in the library's media folder (${path})`);
      return;
    }
    // Even, as the JPEGs' chroma needs.
    const jpeg = await libraryFrameAt({ path, width: Math.ceil(width / 2) * 2, fps }, t);
    response.writeHead(200, { ...CORS, 'content-type': 'image/jpeg', 'content-length': jpeg.length, 'cache-control': 'no-store' }).end(jpeg);
  })().catch((error: Error) => {
    if (error instanceof LibraryMediaOffline) {
      // Said once in the terminal too: an audio pass's download names only the status.
      warnOffline(error.message);
      refuse(response, 503, error.message);
    } else refuse(response, 500, error.message);
  });
  return true;
}

let warnedOffline = false;
function warnOffline(message: string) {
  if (!warnedOffline) process.stderr.write(`${message}\n`);
  warnedOffline = true;
}

/** A loopback server of the library's media and frames for one render's pages; its origin goes in VideoProps' libraryMedia. */
export async function serveLibraryMedia(): Promise<{ url: string }> {
  const server = createServer((request, response) => {
    if (!handleLibraryMediaRequest(request, response)) refuse(response, 404, `${request.url} isn't library media`);
  });
  return { url: `http://127.0.0.1:${await listenOnRenderLoopback(server)}` };
}
