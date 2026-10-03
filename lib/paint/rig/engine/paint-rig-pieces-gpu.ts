// paint-rig-pieces-gpu.ts: a Node tool's way to draw a posed rig's pieces through the GPU path a scene draws them
// with (paint-rig-pieces-draw.ts), in the render browser: each picture written once to a temp folder the page serves,
// each draw read back as a picture.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { PaintRigPicture, PaintRigPiece } from '../models/paint-rig-pieces.ts';
import type { PaintRigPiecesPageDraw, PaintRigPiecesPageSource } from '../studio/paint-rig-pieces-page.ts';

const PAINT_RIG_PIECES_PAGE = fileURLToPath(new URL('../studio/paint-rig-pieces-page.ts', import.meta.url));

/** Draws `pieces` in order over `box` (plane px): premultiplied linear, clear where none lie. */
export type PaintRigPiecesGpuDraw = (pieces: readonly PaintRigPiece[], box: { x0: number; y0: number; w: number; h: number }) => Promise<PaintRigPicture>;

/** Runs `use` with a draw on the render browser's GPU, its page and temp folder gone when `use` settles. */
export function withPaintRigPiecesGpu<T>(use: (draw: PaintRigPiecesGpuDraw) => Promise<T>): Promise<T> {
  return withStudioTemp('paint-rig-pieces', (dir) => withBrowserModulePage({ entry: PAINT_RIG_PIECES_PAGE, filesDir: dir }, (call) => {
    const sources = new Map<PaintRigPicture, PaintRigPiecesPageSource>();
    const sourceOf = (picture: PaintRigPicture) => {
      let source = sources.get(picture);
      if (!source) {
        const { x0, y0, w, h, rgba } = picture;
        source = { file: `picture-${sources.size}.f32`, x0, y0, w, h };
        writeFileSync(join(dir, source.file), new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength));
        sources.set(picture, source);
      }
      return source;
    };
    return use(async (pieces, box) => {
      const request: PaintRigPiecesPageDraw = { pieces: pieces.map(({ picture, triangles }) => ({ picture: sourceOf(picture), triangles: Array.from(triangles) })), box };
      const bytes = Buffer.from(await call<string>('paintRigDrawPieces', request), 'base64');
      return { ...box, rgba: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
    });
  }));
}
