// stamp-sheet-clips.ts: each wash's clip coverage in a sheet solve (ENGINE 4.1's state). Every deposit draws its
// coverage into the one clip target, so it holds one wash's at a time: a wash that's clipped, or clipped to, keeps its
// own in a target of its own while other washes' entries land, and has it back before its next. A wash clipped to
// leaves its coverage as a base when it ends, for each wash clipping to it to start from.

import type { StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { clearStampTarget } from './stamp-paint-gpu.ts';
import type { StampSheetFieldPasses } from './stamp-sheet-field-passes.ts';
import type { StampSheetTargets } from './stamp-sheet-targets.ts';

/** A clip a checkpoint keeps: wash `wash`'s coverage while it's open, or its base once it has ended. */
export type StampSheetClipKept = { wash: number; kind: 'coverage' | 'base' };

/** `from` copied whole into `to`, a texture its size. */
const copyStampSheetClip = (encoder: GPUCommandEncoder, from: GPUTexture, to: GPUTexture) =>
  encoder.copyTextureToTexture({ texture: from }, { texture: to }, [from.width, from.height]);

/** `program`'s clip coverages in `targets`, a base copied by `passes`. */
export function createStampSheetClips(program: StampSheetProgram, targets: StampSheetTargets, passes: StampSheetFieldPasses) {
  const { washes, entries } = program;
  const clippedTo = new Set(washes.flatMap(({ clipTo }) => (clipTo === null ? [] : [clipTo])));
  const keeps = (w: number) => washes[w].clipTo !== null || clippedTo.has(w);
  const firstOf = washes.map((_, w) => entries.findIndex((entry) => entry.wash === w));
  const lastOf = washes.map((_, w) => entries.findLastIndex((entry) => entry.wash === w));
  /** Whether wash `w` has started and not ended once `k` entries have landed. */
  const openAfter = (w: number, k: number) => firstOf[w] >= 0 && firstOf[w] < k && lastOf[w] >= k;
  // The wash whose coverage the clip target holds (null for none worth keeping), and the washes started, not ended.
  let holder: number | null = null;
  let open = new Set<number>();
  /** The clip target's coverage into its wash's own target, when that wash keeps it and is open. */
  const park = (encoder: GPUCommandEncoder) => {
    if (holder !== null && keeps(holder) && open.has(holder)) copyStampSheetClip(encoder, targets.clip.texture, targets.clipCoverage(holder).texture);
  };
  const textureOf = ({ wash, kind }: StampSheetClipKept) => {
    if (kind === 'base') return targets.savedClip(wash).texture;
    return holder === wash ? targets.clip.texture : targets.clipCoverage(wash).texture;
  };
  /**
   * What a checkpoint after `k` entries keeps of the clips: each open wash's coverage it keeps, and each ended
   * wash's base that a wash not yet started clips to.
   */
  const kept = (k: number): StampSheetClipKept[] => washes.flatMap((_, w): StampSheetClipKept[] => {
    if (keeps(w) && openAfter(w, k)) return [{ wash: w, kind: 'coverage' }];
    const awaited = washes.some(({ clipTo }, v) => clipTo === w && firstOf[v] >= k);
    return clippedTo.has(w) && lastOf[w] >= 0 && lastOf[w] < k && awaited ? [{ wash: w, kind: 'base' }] : [];
  });
  return {
    /** Wash `w` starting: a clean clip, or the base of the wash it clips to. */
    start(encoder: GPUCommandEncoder, w: number) {
      if (holder !== w) park(encoder);
      const { clipTo } = washes[w];
      if (clipTo === null) clearStampTarget(encoder, targets.clip.view);
      else passes.clipBase(encoder, targets.savedClip(clipTo).view, targets.clip.view, 0);
      holder = w;
      open.add(w);
    },
    /** Whether an entry of wash `w` must have its coverage swapped in first (`enter`). */
    away: (w: number) => holder !== w,
    /** Wash `w`'s coverage in the clip target, the coverage there before parked. */
    enter(encoder: GPUCommandEncoder, w: number) {
      if (holder === w) return;
      park(encoder);
      if (keeps(w)) copyStampSheetClip(encoder, targets.clipCoverage(w).texture, targets.clip.texture);
      holder = w;
    },
    /** Wash `w`, the clip target's holder, ending: its base kept when a later wash clips to it. */
    end(encoder: GPUCommandEncoder, w: number) {
      open.delete(w);
      if (clippedTo.has(w)) passes.clipBase(encoder, targets.clip.view, targets.savedClip(w).view, washes[w].clipTo === null ? 0 : 1);
    },
    kept,
    /** The texture holding `clip` now. */
    textureOf,
    /**
     * The clips as a checkpoint after `k` entries left them, those it `held` cleared in `encoder` for it to write:
     * each in its own target (textureOf), none in the clip target.
     */
    restored(encoder: GPUCommandEncoder, k: number, held: readonly StampSheetClipKept[]) {
      holder = null;
      open = new Set(washes.flatMap((_, w) => (openAfter(w, k) ? [w] : [])));
      for (const clip of held) clearStampTarget(encoder, textureOf(clip).createView());
    },
    /**
     * What a checkpoint after `k` entries keeps of the clips, as text: one keeping other clips, as a program clipping
     * differently after the same prefix needs, is another checkpoint.
     */
    keptName: (k: number) => kept(k).map(({ wash, kind }) => `${kind} ${wash}`).join(', '),
  };
}

export type StampSheetClips = ReturnType<typeof createStampSheetClips>;
