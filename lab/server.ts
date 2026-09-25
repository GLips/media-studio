// server.ts: `studio lab`, the Studio Lab served locally. esbuild bundles lab/app and rebuilds on every save; this
// server hands out that bundle, lab-manifest.json (lab/manifest.ts) and the media files the manifest lists, and takes
// the lab's only writes (lab/local-api.ts). Everything interactive runs in the browser from lib/ itself, so the lab
// can't drift from what a render does, and `studio lab export` (lab/export.ts) can serve the same page as static files.
//
// Negative space: nothing here generates media or calls a paid API.
import * as esbuild from 'esbuild';
import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, sep } from 'node:path';
import { LAB_APP_DIR, labBundleOptions } from './bundle.ts';
import { handleLabLocalApi } from './local-api.ts';
import { buildLabManifest, LAB_MEDIA_TYPES, labMediaRegister } from './manifest.ts';

const BUNDLE_TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.map': 'application/json', ...LAB_MEDIA_TYPES };

export async function startStudioLab({ port }: { port: number }) {
  const outdir = mkdtempSync(join(tmpdir(), 'studio-lab-'));
  const bundle = await esbuild.context(labBundleOptions({ outdir, production: false }));
  await bundle.watch();

  // The media URLs the last manifest handed out: only those are served, so a file the manifest doesn't list (code,
  // secrets, anything a deploy would leave out) never goes over the wire.
  let served = buildLabManifest({ writable: true }).files;
  const server = createServer((req, res) => {
    try {
      // Any page the browser has open can send requests here, and a DNS-rebinding page can read the replies: only
      // answer requests addressed to this machine by name.
      if (req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) return void res.writeHead(403).end();
      const url = new URL(req.url ?? '/', 'http://lab');
      const path = decodeURIComponent(url.pathname);
      if (path === '/') return sendFile(req, res, join(LAB_APP_DIR, 'index.html'), 'text/html');
      if (path === '/lab-manifest.json') {
        const { manifest, files } = buildLabManifest({ writable: true });
        served = files;
        return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(manifest));
      }
      if (handleLabLocalApi(req, res, url, labMediaRegister(() => true, served))) return;
      const media = served.get(url.pathname.slice(1));
      if (media) return sendFile(req, res, media, LAB_MEDIA_TYPES[extname(media).toLowerCase()]);
      const built = join(outdir, path);
      const type = BUNDLE_TYPES[extname(built)];
      if (built.startsWith(outdir + sep) && type && existsSync(built)) return sendFile(req, res, built, type);
      res.writeHead(404).end();
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done));
  return { url: `http://localhost:${port}/`, close: async () => { server.close(); await bundle.dispose(); } };
}

/** A file, with byte ranges: a <video> won't seek without them. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (!range) {
    res.writeHead(200, { ...headers, 'content-length': size });
    createReadStream(file).pipe(res);
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  // A tab holding offsets into a file since re-rendered shorter asks past its end.
  if (start >= size || start > end) return res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
  res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  createReadStream(file, { start, end }).pipe(res);
}
