// stamp-sheet-checkpoints.ts: a sheet solve's state after an entry, kept in the device's cache as producer
// 'checkpoint' (ENGINE 4.5): its GPU state as pieces, each cropped to where it was drawn and naming where it goes
// back (a film, the field's paper and rim, each clip a later entry reads), and in its note the CPU's state. Resuming
// from one equals replaying to it; the decisions before it are the solve's memo's.
//
// A piece names its film, so programs sharing a prefix share its checkpoints whatever layers follow. The cache gives
// checkpoints up first, as a solve can run from an earlier one; one a solve must go back to is held from the step
// keeping it (ENGINE 4.7).

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampSheetSolveState } from '../models/stamp-sheet-schedule.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { copyStampTextureBox } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampSheetClipKept } from './stamp-sheet-clips.ts';

/** Where a piece of a solve's GPU state goes back to: a film, the field's paper or rim, or a wash's clip. */
export type StampSheetPieceTarget = { kind: 'film'; film: number } | { kind: 'paper' } | { kind: 'rim' } | { kind: 'clip'; clip: StampSheetClipKept };

/** Part of a solve's GPU state: where it goes back to, the stage-sized texture holding it, and the box of it that's kept (null for nothing drawn). */
export type StampSheetPiece = { target: StampSheetPieceTarget; texture: GPUTexture; box: StampPixelBox | null };

/** A checkpoint's CPU half: the solve's state, and the clips it kept. */
export type StampSheetCheckpoint = { state: StampSheetSolveState; clips: readonly StampSheetClipKept[] };

/** A checkpoint's note: its CPU half, and each piece kept, in the order of its textures. */
type StampSheetCheckpointNote = StampSheetCheckpoint & { pieces: readonly { target: StampSheetPieceTarget; box: StampPixelBox }[] };

const stores = new WeakMap<StampPaintGpuOwner, StampGpuCacheStore<StampSheetCheckpointNote>>();

/** `owner`'s store of checkpoints, made the first time it's asked for. */
function stampSheetCheckpointStore(owner: StampPaintGpuOwner): StampGpuCacheStore<StampSheetCheckpointNote> {
  const known = stores.get(owner);
  if (known) return known;
  const made = owner.cache.store<StampSheetCheckpointNote>('checkpoint');
  stores.set(owner, made);
  return made;
}

/** The engine fault of a checkpoint a solve relies on that isn't kept. */
const stampSheetCheckpointGone = (key: string) => `stamp sheet: the checkpoint ${key} was given up while a solve relied on it; an engine fault`;

/** Whether a checkpoint is kept under `key` on `owner`'s device. */
export const stampSheetCheckpointKept = (owner: StampPaintGpuOwner, key: string) => stampSheetCheckpointStore(owner).peek(key) !== null;

/** Holds the checkpoint under `key` from the cache's eviction until the returned release runs. Throws where none is kept. */
export function holdStampSheetCheckpoint(owner: StampPaintGpuOwner, key: string): () => void {
  const release = stampSheetCheckpointStore(owner).hold(key);
  if (!release) throw new Error(stampSheetCheckpointGone(key));
  return release;
}

/** Keeps `checkpoint` under `key`, its `pieces` copied in `encoder`. */
export function keepStampSheetCheckpoint(owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, key: string, pieces: readonly StampSheetPiece[], checkpoint: StampSheetCheckpoint) {
  const drawn = pieces.flatMap(({ target, texture, box }) => (box ? [{ target, texture, box }] : []));
  const usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const made = stampSheetCheckpointStore(owner).make(
    key, encoder, drawn.map(({ texture, box }) => ({ width: box.w, height: box.h, layers: texture.depthOrArrayLayers, format: texture.format, usage })),
    { ...checkpoint, pieces: drawn.map(({ target, box }) => ({ target, box })) },
  );
  drawn.forEach(({ texture, box }, i) => copyStampTextureBox(encoder, { texture, x: box.x, y: box.y }, { texture: made.textures[i], x: 0, y: 0 }, box));
}

/**
 * The checkpoint under `key`, its pieces copied in `encoder` into the textures `into` gives for it, each piece's at
 * the box it came from; what no piece covers is the caller's to have cleared. Throws where none is kept: a caller
 * checks `stampSheetCheckpointKept`, or holds it, first.
 */
export function restoreStampSheetCheckpoint(
  owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, key: string, into: (checkpoint: StampSheetCheckpoint) => (target: StampSheetPieceTarget) => GPUTexture,
): StampSheetCheckpoint {
  const found = stampSheetCheckpointStore(owner).find(key, encoder);
  if (!found) throw new Error(stampSheetCheckpointGone(key));
  const textureOf = into(found.note);
  found.note.pieces.forEach(({ target, box }, i) => copyStampTextureBox(encoder, { texture: found.textures[i], x: 0, y: 0 }, { texture: textureOf(target), x: box.x, y: box.y }, box));
  return found.note;
}
