// stamp-sheet-checkpoints.ts: a sheet solve's state after an entry, kept in the device's cache as producer
// 'checkpoint' (ENGINE 4.5): its GPU state as pieces, each cropped to where it was drawn and naming where it goes
// back (a film over its paint box, the field's paper and rim over the box water touched, each clip a later entry
// reads), and in its note the CPU's state and the decisions so far. Resuming from one equals replaying to it.
//
// A piece names its film, so programs sharing a prefix share its checkpoints whatever layers follow. The cache gives
// checkpoints up first: a solve can always run from an earlier one, or the start.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampSheetDecision, StampSheetSolveState } from '../models/stamp-sheet-schedule.ts';
import type { StampGpuCacheStore } from './stamp-paint-gpu-cache.ts';
import { copyStampTextureBox } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampSheetClipKept } from './stamp-sheet-clips.ts';

/** Where a piece of a solve's GPU state goes back to: a film, the field's paper or rim, or a wash's clip. */
export type StampSheetPieceTarget = { kind: 'film'; film: number } | { kind: 'paper' } | { kind: 'rim' } | { kind: 'clip'; clip: StampSheetClipKept };

/** Part of a solve's GPU state: where it goes back to, the stage-sized texture holding it, and the box of it that's kept (null for nothing drawn). */
export type StampSheetPiece = { target: StampSheetPieceTarget; texture: GPUTexture; box: StampPixelBox | null };

/** A checkpoint's CPU half: the solve's state, the decisions of the entries before it, and the clips it kept. */
export type StampSheetCheckpoint = { state: StampSheetSolveState; decisions: readonly StampSheetDecision[]; clips: readonly StampSheetClipKept[] };

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

/** Whether a checkpoint is kept under `key` on `owner`'s device. */
export const stampSheetCheckpointKept = (owner: StampPaintGpuOwner, key: string) => stampSheetCheckpointStore(owner).peek(key) !== null;

/** Holds the checkpoint under `key` from the cache's eviction until the returned release runs; null when none is kept. */
export const holdStampSheetCheckpoint = (owner: StampPaintGpuOwner, key: string) => stampSheetCheckpointStore(owner).hold(key);

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
 * The checkpoint under `key`, null when none is kept. Its pieces are copied in `encoder` into the textures `into`
 * gives for it, each piece's at the box it came from; what no piece covers is the caller's to have cleared.
 */
export function restoreStampSheetCheckpoint(
  owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, key: string, into: (checkpoint: StampSheetCheckpoint) => (target: StampSheetPieceTarget) => GPUTexture,
): StampSheetCheckpoint | null {
  const found = stampSheetCheckpointStore(owner).find(key, encoder);
  if (!found) return null;
  const textureOf = into(found.note);
  found.note.pieces.forEach(({ target, box }, i) => copyStampTextureBox(encoder, { texture: found.textures[i], x: 0, y: 0 }, { texture: textureOf(target), x: box.x, y: box.y }, box));
  return found.note;
}
