// paint-rig-pieces-page.ts: the browser half of drawing a posed rig's pieces for a Node tool
// (paint-rig-pieces-gpu.ts): pictures fetched once from the files the tool serves, each draw's picture handed back
// as base64 of its f32 bytes.

import { createGpuDeviceOwner, type GpuDeviceOwner } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import type { PaintRigPicture } from '../models/paint-rig-pieces.ts';
import { createPaintRigPiecesDrawer, type PaintRigPiecesDrawer } from './paint-rig-pieces-draw.ts';

/** A picture the tool wrote to `/files/<file>`: its rgba as raw f32 bytes, its box here. */
export type PaintRigPiecesPageSource = { readonly file: string; readonly x0: number; readonly y0: number; readonly w: number; readonly h: number };

/** One draw: each piece names its picture's file and carries its triangles (paintRigSkinTriangles' layout). */
export type PaintRigPiecesPageDraw = {
  readonly pieces: readonly { readonly picture: PaintRigPiecesPageSource; readonly triangles: readonly number[] }[];
  readonly box: { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number };
};

let drawing: { owner: GpuDeviceOwner; drawer: PaintRigPiecesDrawer } | null = null;
// Kept by file, so a picture drawn again is the same object and its texture isn't uploaded again.
const pictures = new Map<string, Promise<PaintRigPicture>>();

async function pictureOf({ file, x0, y0, w, h }: PaintRigPiecesPageSource): Promise<PaintRigPicture> {
  let held = pictures.get(file);
  if (!held) {
    held = fetch(`/files/${file}`).then(async (response) => {
      if (!response.ok) throw new Error(`paint rig: the picture ${file} wasn't served (${response.status})`);
      return { x0, y0, w, h, rgba: new Float32Array(await response.arrayBuffer()) };
    });
    pictures.set(file, held);
  }
  return held;
}

/** `request`'s pieces drawn over its box: the picture's rgba as base64 f32. */
async function paintRigDrawPieces(request: PaintRigPiecesPageDraw): Promise<string> {
  if (!drawing) {
    const owner = await createGpuDeviceOwner();
    drawing = { owner, drawer: createPaintRigPiecesDrawer((await owner.three()).renderer) };
  }
  const pieces = await Promise.all(request.pieces.map(async ({ picture, triangles }) => ({ picture: await pictureOf(picture), triangles: Float32Array.from(triangles) })));
  const { rgba } = await drawing.drawer.draw(pieces, request.box);
  // The render browser's Chrome encodes natively, far faster than btoa over char codes.
  // SAFETY: Chrome has had Uint8Array.prototype.toBase64 since 140; the ES2023 lib the studio types against lacks it.
  return (new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength) as Uint8Array & { toBase64: () => string }).toBase64();
}

Object.assign(globalThis, { paintRigDrawPieces });
