// stamp-paint-checkpoints.ts: the renderer's saved states, so a frame starts from the latest one its settled events
// stand for (stamp-paint-events.ts) instead of bare paper. A checkpoint is the painting after its first `event` events,
// the frame's light once something has glowed, and partway through a group its layer, clip base and painted box.
//
// A checkpoint is keyed by what else it depends on (a group's lay and warp, its epoch or live marks, its paint's time);
// a frame reuses one only under the same key, and restoring copies it back exactly, so a frame never depends on frames
// before it.
// STAMP_CHECKPOINTS_MOST and STAMP_CHECKPOINT_BUDGET bound memory, least recently used given up first.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';

/**
 * The most a renderer's checkpoints hold, bytes. A 1080p pigment painting (two painting layers, four layer, one clip)
 * keeps three checkpoints partway through a group, or four between groups. At 4K a checkpoint partway through a group
 * (443 MiB) never fits, so a 4K frame starts no later than the last group boundary settled, of which three fit.
 */
export const STAMP_CHECKPOINT_BUDGET = 384 * 1024 * 1024;
/**
 * The most checkpoints a renderer keeps: one rolling with a render's settled prefix (a held frame's whole painting),
 * one before the first group with frame state, one with the first group laid apart painted, and one for scrubbing back.
 */
export const STAMP_CHECKPOINTS_MOST = 4;

/**
 * The textures a checkpoint copies: the painting, the group layer and the clip base, all rgba16float; and the frame's
 * light, the painting's size, made only when a frame first glows.
 */
export type StampCheckpointTargets = { painting: GPUTexture; layer: GPUTexture; clip: GPUTexture; light: () => GPUTexture };

/**
 * A saved state: after `event` events under `key`; `inGroup` when partway through a group, whose layer and clip it
 * holds; `lit` once something before it has glowed, so it holds the light too.
 */
export type StampPaintCheckpoint = { event: number; key: string; inGroup: boolean; painted: StampPixelBox | null; lit: boolean };

/** `encoder`: the last frame's to copy into or out of it, whose commands may be unsubmitted yet. */
type Kept = StampPaintCheckpoint & {
  painting: GPUTexture; group: { layer: GPUTexture; clip: GPUTexture } | null; light: GPUTexture | null; used: number; encoder: GPUCommandEncoder;
};

const texelBytes = (texture: GPUTexture) => texture.width * texture.height * texture.depthOrArrayLayers * 8;
const copyWholeTexture = (encoder: GPUCommandEncoder, from: GPUTexture, to: GPUTexture) => encoder.copyTextureToTexture({ texture: from }, { texture: to }, [from.width, from.height, from.depthOrArrayLayers]);
const sameCheckpoint = (a: StampPaintCheckpoint, b: StampPaintCheckpoint) => a.event === b.event && a.key === b.key;

export type StampPaintCheckpoints = {
  /** The checkpoint furthest in at or before event `settled` whose key is `keyAt` its event, or null. */
  latest: (settled: number, keyAt: (event: number) => string) => StampPaintCheckpoint | null;
  /** Copies `checkpoint` back into the targets: the painting, and a group's layer and clip when it's partway through one. */
  restore: (encoder: GPUCommandEncoder, checkpoint: StampPaintCheckpoint) => void;
  /** Saves the targets as they'll stand at this point in `encoder` as `checkpoint`, unless it's kept already or can't fit. */
  save: (encoder: GPUCommandEncoder, checkpoint: StampPaintCheckpoint) => void;
  /** Destroys every checkpoint's textures, once the frames that copied them are submitted. */
  dispose: () => void;
};

/**
 * Checkpoints of `targets` on `device`, within `budget` bytes. Each frame's encoder is submitted before the next one
 * is made, so a checkpoint the current encoder doesn't touch can be given up, its textures reused or destroyed.
 */
export function stampPaintCheckpoints(device: StampPaintDevice, targets: StampCheckpointTargets, budget = STAMP_CHECKPOINT_BUDGET): StampPaintCheckpoints {
  const paintingBytes = texelBytes(targets.painting), groupBytes = texelBytes(targets.layer) + texelBytes(targets.clip);
  // The light is one plain layer of the painting's size.
  const lightBytes = targets.painting.width * targets.painting.height * 8;
  const bytesOf = ({ inGroup, lit }: StampPaintCheckpoint) => paintingBytes + (inGroup ? groupBytes : 0) + (lit ? lightBytes : 0);
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
      found.encoder = encoder;
      copyWholeTexture(encoder, found.painting, targets.painting);
      if (found.light) copyWholeTexture(encoder, found.light, targets.light());
      if (!found.group) return;
      copyWholeTexture(encoder, found.group.layer, targets.layer);
      copyWholeTexture(encoder, found.group.clip, targets.clip);
    },
    save(encoder, checkpoint) {
      // Saved again, it's asked for again: kept from being given up as least recently used.
      const again = kept.find((c) => sameCheckpoint(c, checkpoint));
      if (again) {
        again.used = ++clock;
        return;
      }
      const needs = bytesOf(checkpoint);
      const givable = kept.filter((c) => c.encoder !== encoder).toSorted((a, b) => a.used - b.used);
      let held = kept.reduce((sum, c) => sum + bytesOf(c), 0), count = kept.length;
      const fits = () => held + needs <= budget && count < STAMP_CHECKPOINTS_MOST;
      const given: Kept[] = [];
      while (!fits() && givable.length) {
        const c = givable.shift()!;
        given.push(c);
        held -= bytesOf(c);
        count--;
      }
      if (!fits()) return;
      for (const c of given) kept.splice(kept.indexOf(c), 1);
      // What's given up is reused where it fits; the rest is destroyed, its last copies already submitted.
      const paintings = given.map((c) => c.painting), groups = given.flatMap((c) => (c.group ? [c.group] : [])), lights = given.flatMap((c) => (c.light ? [c.light] : []));
      const saved: Kept = {
        ...checkpoint, used: ++clock, encoder,
        painting: paintings.pop() ?? twin(targets.painting),
        group: checkpoint.inGroup ? groups.pop() ?? { layer: twin(targets.layer), clip: twin(targets.clip) } : null,
        light: checkpoint.lit ? lights.pop() ?? twin(targets.light()) : null,
      };
      for (const texture of [...paintings, ...groups.flatMap(({ layer, clip }) => [layer, clip]), ...lights]) texture.destroy();
      copyWholeTexture(encoder, targets.painting, saved.painting);
      if (saved.light) copyWholeTexture(encoder, targets.light(), saved.light);
      if (saved.group) {
        copyWholeTexture(encoder, targets.layer, saved.group.layer);
        copyWholeTexture(encoder, targets.clip, saved.group.clip);
      }
      kept.push(saved);
    },
    dispose() {
      for (const { painting, group, light } of kept.splice(0)) for (const texture of [painting, ...(group ? [group.layer, group.clip] : []), ...(light ? [light] : [])]) texture.destroy();
    },
  };
}
