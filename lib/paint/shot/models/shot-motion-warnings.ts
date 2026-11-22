// shot-motion-warnings.ts: a compiled shot's motion judged over its span (paint-motion-warnings.ts), as warnings the
// check and the render print. The judge takes the camera's own move; each drawable here (a plane, an occurrence with a
// node or visibility of its own) is followed on what it adds: a plane its depth, lay and node, the camera held; an
// occurrence its own node, its plane and the nodes above held. One with no node of its own adds nothing: what carries
// it warns for it. A card held near edge-on warns too (shotEdgeOnWarnings).
//
// Negative space: bends, sway, boil and rigs' poses move paint within a drawable and aren't followed; nor are
// instanced planes' items, three planes, or a plane pinned to HTML.

import { paintPlaneSimilarity, paintStageCentre } from '#lib/paint/animation/models/paint-camera.ts';
import { PAINT_CARD_SLIVER, PAINT_EDGE_ON } from '#lib/paint/animation/models/paint-card-face.ts';
import { paintLaneClipAt } from '#lib/paint/animation/models/paint-clock.ts';
import { paintFoldClipAt, paintLaneSnapsBetween } from '#lib/paint/animation/models/paint-motion-clips.ts';
import { paintLevelPlacementAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
import { paintMotionWarnings, type PaintMotionFollowed, type PaintMotionSamples } from '#lib/paint/animation/models/paint-motion-warnings.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityOf, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { PaintSpanFrame } from '#lib/paint/animation/models/paint-span-moments.ts';
import { presentationValueAt, presentationValueSnapsBetween, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingBoxUnion, paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStageExtent } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane, CompiledShotPlane } from './shot-compile.ts';
import { shotPlaneLayAt, shotPlaneMomentAt, shotRigMomentAt } from './shot-frame-plan.ts';
import type { CompiledShotMotion } from './shot-motion.ts';
import { shotRigPartFacing, shotRigPoseAt } from './shot-rigs.ts';

/** The occurrence `key` of `plane`'s box: its node's in the first end showing it. */
function occurrenceBox(plane: CompiledShotPaintedPlane, node: string): StampBox | undefined {
  for (const { selection } of plane.ends) {
    const place = selection.painting.tree.byKey.get(node);
    if (place) return paintingNodeBox(place.node);
  }
  return undefined;
}

/** `place` kept by sample. */
function bySample(place: (sample: number) => PaintSimilarity): (sample: number) => PaintSimilarity {
  const placed: PaintSimilarity[] = [];
  return (sample) => (placed[sample] ??= place(sample));
}

/** Each drawable of `shot` followed (see the file's head), at the judge's `samples`. */
function followedDrawables(shot: CompiledPaintedShot, { moments, cameraAt }: PaintMotionSamples): PaintMotionFollowed[] {
  const { motion } = shot, centre = paintStageCentre(shot.camera.stage), fps = motion.animationFps;
  const nodePlaces = new Map<string, (sample: number) => PaintSimilarity>();
  const nodePlaceAt = (id: string) => {
    let placeAt = nodePlaces.get(id);
    if (!placeAt) {
      const node = motion.nodes.get(id);
      placeAt = bySample((sample) => {
        const place = node && paintLevelPlacementAt(node, moments[sample], fps);
        return place ? paintSimilarityOf(place.placement, place.pivot) : PAINT_SIMILARITY_IDENTITY;
      });
      nodePlaces.set(id, placeAt);
    }
    return placeAt;
  };
  const nodeSnapsBetween = (id: string, from: number, to: number) => {
    const node = motion.nodes.get(id);
    return !!node && paintLaneSnapsBetween(node.place, moments[from], moments[to], fps);
  };
  const visibilityOf = (plane: string, key: string) => {
    const value: PresentationValue<number> | undefined = shot.visibility.get(key);
    return (moment: PaintMoment) => (value === undefined ? 1 : presentationValueAt(value, shotPlaneMomentAt(motion, plane, moment)));
  };
  const followed: PaintMotionFollowed[] = [];
  for (const plane of shot.planes) {
    const followable = plane.kind === 'picture' || (plane.kind === 'painted' && plane.lay.kind !== 'screen');
    if (!followable) continue;
    const box = planeBox(shot, plane);
    if (!box) continue;
    // What the plane adds, plane px: its lay after its node; its depth, read under the camera's pose.
    const added = bySample((sample) => {
      const lay = plane.kind === 'painted' ? shotPlaneLayAt(plane, motion, moments[sample]) : PAINT_SIMILARITY_IDENTITY;
      return paintSimilarityAfter(lay, nodePlaceAt(plane.id)(sample));
    });
    const depthAt = (sample: number) => presentationValueAt(plane.depth, moments[sample]);
    const planeAt = (sample: number, held: number) => paintSimilarityAfter(paintPlaneSimilarity(cameraAt(held), depthAt(sample), centre), added(sample));
    const planeSnapsBetween = (from: number, to: number) => {
      const [a, b] = [moments[from], moments[to]];
      if (presentationValueSnapsBetween(plane.depth, a, b) || nodeSnapsBetween(plane.id, from, to)) return true;
      return plane.kind === 'painted' && plane.lay.kind === 'moving' && presentationValueSnapsBetween(plane.lay.lay, shotPlaneMomentAt(motion, plane.id, a), shotPlaneMomentAt(motion, plane.id, b));
    };
    followed.push({ name: plane.id, depthAt, box, placeAt: planeAt, visibilityAt: visibilityOf(plane.id, plane.id), snapsBetween: planeSnapsBetween });
    if (plane.kind !== 'painted') continue;
    const planeSeen = bySample((sample) => planeAt(sample, sample));
    for (const occurrence of plane.occurrences) {
      if (!motion.nodes.has(occurrence.key) && !shot.visibility.has(occurrence.key)) continue;
      const occurrenceBoxFound = occurrenceBox(plane, occurrence.node);
      if (!occurrenceBoxFound) continue;
      // Its nodes, nearest first, up to (not including) its plane's: its own first, if it has one.
      const line: string[] = [];
      for (let id = motion.nearest.get(occurrence.key); id !== undefined && id !== plane.id; id = motion.nodes.get(id)!.parent ?? undefined) line.push(id);
      const own = line[0] === occurrence.key ? occurrence.key : null, above = own ? line.slice(1) : line;
      const carrierAt = bySample((sample) => above.reduceRight((outer, id) => paintSimilarityAfter(outer, nodePlaceAt(id)(sample)), planeSeen(sample)));
      followed.push({
        name: occurrence.key, depthAt, box: occurrenceBoxFound, visibilityAt: visibilityOf(plane.id, occurrence.key),
        placeAt: (sample, held) => (own ? paintSimilarityAfter(carrierAt(held), nodePlaceAt(own)(sample)) : carrierAt(held)),
        snapsBetween: (from, to) => !!own && nodeSnapsBetween(own, from, to),
      });
    }
  }
  return followed;
}

/**
 * Where a plane paints, plane px: a painted plane's document where it lays paper (the back, a paper ground), else its
 * layers' boxes together; a picture's extent (the stage for one everywhere); none for one empty.
 */
function planeBox(shot: CompiledPaintedShot, plane: CompiledShotPlane): StampBox | undefined {
  if (plane.kind === 'painted') {
    if (plane.opaqueBack || plane.paints.ground === 'paper') return { x0: 0, y0: 0, x1: plane.paints.widthPx, y1: plane.paints.heightPx };
    return plane.occurrences.reduce<StampBox | undefined>((box, { kind, node }) => (kind === 'layer' ? paintingBoxUnion(box, occurrenceBox(plane, node)) : box), undefined);
  }
  if (plane.kind !== 'picture') return undefined;
  const { extent } = plane.source;
  if (extent.kind === 'box') return extent.box;
  return extent.kind === 'everywhere' ? stampStageExtent(shot.camera.stage) : undefined;
}

/** Node `id`'s facing at `t`: the product of its line's folds' cosines (fold.ts), its own and its ancestors'. */
function shotNodeFacingAt(motion: CompiledShotMotion, id: string, t: PaintMoment): number {
  let facing = 1;
  for (let at: string | null = id; at !== null; at = motion.nodes.get(at)!.parent) {
    const playing = paintLaneClipAt(motion.nodes.get(at)!.fold, t, motion.animationFps);
    if (playing) facing *= Math.cos(paintFoldClipAt(playing.play.clip, playing.moment));
  }
  return facing;
}

/** The first run of drawn frames, two or more long, in which `facing` says a card is a sliver; null for none. Edge-on it draws nothing, so is none. */
function sliverRun(frames: readonly PaintSpanFrame[], facing: (t: PaintMoment) => number): { from: number; to: number } | null {
  let start = -1;
  for (let i = 0; i <= frames.length; i++) {
    const shown = i < frames.length ? Math.abs(facing(frames[i].moments[0])) : 1, sliver = shown >= PAINT_EDGE_ON && shown < PAINT_CARD_SLIVER;
    if (sliver && start < 0) start = i;
    if (!sliver && start >= 0) {
      if (i - start >= 2) return { from: frames[start].t, to: frames[i - 1].t };
      start = -1;
    }
  }
  return null;
}

const SLIVER_ADVICE = 'it reads as a sliver, not a turn: pass through edge-on within a frame, or hold it further round';

/**
 * Each folding node, and each rig part a pose folds, held within about 10° of edge-on (|facing| below
 * PAINT_CARD_SLIVER) for two drawn frames or more running, once each.
 */
function shotEdgeOnWarnings(shot: CompiledPaintedShot, frames: readonly PaintSpanFrame[]): PaintingProblem[] {
  const { motion } = shot, warnings: PaintingProblem[] = [];
  const say = (owner: string, what: string, run: { from: number; to: number }) =>
    warnings.push(paintingProblem('warning', owner, 'motion', `${what} is folded within about 10° of edge-on from ${run.from.toFixed(3)} s to ${run.to.toFixed(3)} s; ${SLIVER_ADVICE}`));
  for (const node of motion.nodes.values()) {
    if (!node.fold.length) continue;
    const run = sliverRun(frames, (t) => shotNodeFacingAt(motion, node.id, t));
    if (run) say(node.id, node.id, run);
  }
  // Read unchecked: a pose a rig can't take is refused where a frame poses it, and a fold that isn't finite is no sliver.
  for (const rig of shot.rigs.values()) {
    for (const part of rig.parts) {
      const run = sliverRun(frames, (t) => shotRigPartFacing(rig, shotRigPoseAt(rig.pose, shotRigMomentAt(rig, motion, t)), part.id));
      if (run) say(rig.occurrence, `its part ${part.id}`, run);
    }
  }
  return warnings;
}

/** `shot`'s motion over `frames` judged (paint-motion-warnings.ts), as warnings by owner: the camera, or a drawable. */
export function shotMotionWarnings(shot: CompiledPaintedShot, frames: readonly PaintSpanFrame[]): PaintingProblem[] {
  const moving = paintMotionWarnings(shot.camera, frames, (samples) => followedDrawables(shot, samples)).map(({ name, message }) => paintingProblem('warning', name, 'motion', message));
  return [...moving, ...shotEdgeOnWarnings(shot, frames)];
}
