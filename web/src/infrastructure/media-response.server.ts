// media-response.server.ts: a file as an HTTP response, with byte ranges: a <video> won't seek without them.
import { createReadStream, statSync } from 'node:fs';

export function fileResponse(request: Request, file: string, type: string): Response {
  const size = statSync(file).size;
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const body = (start: number, end: number) => readFileRange(file, start, end);
  if (!range) return new Response(size ? body(0, size - 1) : null, { headers: { ...headers, 'content-length': String(size) } });
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  // A tab holding offsets into a file since re-rendered shorter asks past its end.
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(body(start, end), {
    status: 206, headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
  });
}

/**
 * Bytes `start` to `end` of a file as a web stream, read as the response drains it. Built here rather than by Node's
 * `Readable.toWeb`, whose stream is Node's web-streams type and not the DOM's that `Response` takes.
 */
function readFileRange(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  const stream = createReadStream(file, { start, end });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk: Buffer) => {
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 0) <= 0) stream.pause();
      });
      stream.once('end', () => controller.close());
      stream.once('error', (error) => controller.error(error));
    },
    pull: () => void stream.resume(),
    cancel: () => void stream.destroy(),
  });
}
