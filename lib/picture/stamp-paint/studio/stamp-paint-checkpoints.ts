// stamp-paint-checkpoints.ts: the renderer's saved states, so a frame starts from the latest one its settled events
// stand for (stamp-paint-events.ts) instead of bare paper. A checkpoint is the painting after its first `event` events
// and, partway through a group, that group's layer, clip base and painted box.
//
// A checkpoint is keyed by what else it depends on (a laid group's placement, a boiling one's epoch); a frame reuses
// one only under the same key, and restoring copies it back exactly, so a frame never depends on frames before it.
// Memory is bounded by STAMP_CHECKPOINTS_MOST and STAMP_CHECKPOINT_BUDGET, least recently used given up first.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';

/** The most a renderer's checkpoints take, bytes: three full ones for a 1080p pigment painting of four layers. */
export const STAMP_CHECKPOINT_BUDGET = 384 * 1024 * 1024;
/**
 * The most checkpoints a renderer keeps: one rolling with a render's settled prefix, one before the first group that
 * moves or boils, and a couple for scrubbing back.
 */
export const STAMP_CHECKPOINTS_MOST = 4;

/** The textures a checkpoint copies: the painting, the group layer and the clip base, all rgba16float. */
export type StampCheckpointTargets = { painting: GPUTexture; layer: GPUTexture; clip: GPUTexture };

/** A saved state: after `event` events under `key`; `inGroup` when partway through a group, whose layer and clip it holds. */
export type StampPaintCheckpoint = { event: number; key: string; inGroup: boolean; painted: StampPixelBox | null };

type Kept = StampPaintCheckpoint & { painting: GPUTexture; layer: GPUTexture | null; clip: GPUTexture | null; used: number };

const texelBytes = (texture: GPUTexture) => texture.width * texture.height * texture.depthOrArrayLayers * 8;
const copyWholeTexture = (encoder: GPUCommandEncoder, from: GPUTexture, to: GPUTexture) => encoder.copyTextureToTexture({ texture: from }, { texture: to }, [from.width, from.height, from.depthOrArrayLayers]);
const sameCheckpoint = (a: StampPaintCheckpoint, b: StampPaintCheckpoint) => a.event === b.event && a.key === b.key;

export type StampPaintCheckpoints = {
  /** The checkpoint furthest in at or before event `settled` whose key is `keyAt` its event, or null. */
  latest: (settled: number, keyAt: (event: number) => string) => StampPaintCheckpoint | null;
  /** Copies `checkpoint` back into the targets: the painting, and a group's layer and clip when it's partway through one. */
  restore: (encoder: GPUCommandEncoder, checkpoint: StampPaintCheckpoint) => void;
  /** Saves the targets as they'll stand at this point in `encoder` as `checkpoint`, unless it's kept already. */
  save: (encoder: GPUCommandEncoder, checkpoint: StampPaintCheckpoint) => void;
  dispose: () => void;
};

/** Checkpoints of `targets` on `device`, within `budget` bytes. */
export function stampPaintCheckpoints(device: GPUDevice, targets: StampCheckpointTargets, budget = STAMP_CHECKPOINT_BUDGET): StampPaintCheckpoints {
  const full = texelBytes(targets.painting) + texelBytes(targets.layer) + texelBytes(targets.clip);
  const capacity = Math.max(1, Math.min(STAMP_CHECKPOINTS_MOST, Math.floor(budget / full)));
  const kept: Kept[] = [];
  let clock = 0;
  const twin = (texture: GPUTexture) => device.createTexture({
    size: [texture.width, texture.height, texture.depthOrArrayLayers], format: texture.format, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
  return {
    latest(settled, keyAt) {
      const found = kept.filter(({ event, key }) => event <= settled && key === keyAt(event)).reduce<Kept | null>((best, c) => (!best || c.event > best.event ? c : best), null);
      if (found) found.used = ++clock;
      return found;
    },
    restore(encoder, checkpoint) {
      const found = kept.find((c) => sameCheckpoint(c, checkpoint));
      if (!found) throw new Error(`stamp paint: no checkpoint at event ${checkpoint.event} to restore`);
      copyWholeTexture(encoder, found.painting, targets.painting);
      if (!found.inGroup) return;
      copyWholeTexture(encoder, found.layer!, targets.layer);
      copyWholeTexture(encoder, found.clip!, targets.clip);
    },
    save(encoder, checkpoint) {
      if (kept.some((c) => sameCheckpoint(c, checkpoint))) return;
      // At capacity, the least recently used is given up, and its textures hold the new one.
      const given = kept.length < capacity ? null : kept.splice(kept.indexOf(kept.reduce((a, b) => (b.used < a.used ? b : a))), 1)[0];
      const saved: Kept = {
        ...checkpoint, used: ++clock,
        painting: given?.painting ?? twin(targets.painting),
        layer: given?.layer ?? (checkpoint.inGroup ? twin(targets.layer) : null),
        clip: given?.clip ?? (checkpoint.inGroup ? twin(targets.clip) : null),
      };
      copyWholeTexture(encoder, targets.painting, saved.painting);
      if (checkpoint.inGroup) {
        copyWholeTexture(encoder, targets.layer, saved.layer!);
        copyWholeTexture(encoder, targets.clip, saved.clip!);
      }
      kept.push(saved);
    },
    dispose() {
      for (const c of kept.splice(0)) for (const texture of [c.painting, c.layer, c.clip]) texture?.destroy();
    },
  };
}
