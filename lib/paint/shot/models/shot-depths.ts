// shot-depths.ts: where a shot's planes lie in depth over its span. A plane's depth may be a value in time, read at
// its presentation's moment (its `clock`), as its lay is. It's sampled at every moment the span draws, as a reach is
// found, so the range checked is the range the frames draw: no `depths` are asked of the author.
//
// The back keeps one depth: it's the farthest plane, opaque on the first canvas, and the frame's order is built on
// it. A plane moving in depth stays nearer than it, and within its canvas's place in the canvases' order, at every
// moment. Draw order follows the depths each frame (shot-plan.ts), so a plane crossing another's depth passes it.

import { paintNodeClockSteps, paintNodeTimeAt } from '#lib/paint/animation/models/paint-clock.ts';
import { paintSecondsText } from '#lib/paint/animation/models/paint-span-moments.ts';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { InstancedPlaneProps, PlaneProps } from './shot-props.ts';

/** The depths something lies between over a shot: one depth, near = far, when it holds still. */
export type ShotDepthRange = { readonly near: number; readonly far: number };

/** Plane `plane`'s depth as each frame moment reads it: its own, or its value in time read through its `clock`. */
export function shotPlaneDepthValue(plane: PlaneProps, fps: number): PresentationValue<number> {
  const { depth } = plane;
  if (typeof depth === 'number') return depth;
  const clock = paintNodeClockSteps(plane.clock);
  return (moment) => depth(paintNodeTimeAt(clock, moment, fps));
}

/** The depths `plane` lies between at `moments`, its depth read through its clock; an instanced plane's `depths`. */
export function shotPlaneDepthRange(plane: PlaneProps | InstancedPlaneProps, moments: readonly PaintMoment[], fps: number): ShotDepthRange {
  if (plane.kind === 'instanced') return plane.depths;
  const value = shotPlaneDepthValue(plane, fps);
  if (typeof value === 'number') return { near: value, far: value };
  const depths = moments.map(value);
  return { near: Math.min(...depths), far: Math.max(...depths) };
}

/** A shot's planes' depths checked: each one's depth at a frame moment, and the back, which keeps its one depth. */
export type ShotDepths = {
  readonly values: ReadonlyMap<string, PresentationValue<number>>;
  readonly back: { readonly id: string; readonly depth: number } | null;
  readonly problems: readonly PaintingProblem[];
};

const depthError = (owner: string, message: string) => paintingProblem('error', owner, 'depth', message);

/**
 * `planes`' depths at `moments` (the shot's span's), read through each plane's clock at `fps`: a depth in time above 0
 * and finite at each, and nearer than the back, the farthest still plane, which a shot needs.
 */
export function shotPlaneDepths(planes: readonly (PlaneProps | InstancedPlaneProps)[], moments: readonly PaintMoment[], fps: number): ShotDepths {
  const problems: PaintingProblem[] = [], values = new Map<string, PresentationValue<number>>();
  let back: ShotDepths['back'] = null;
  for (const plane of planes) {
    if (plane.kind === 'instanced') continue;
    const value = shotPlaneDepthValue(plane, fps);
    values.set(plane.id, value);
    if (typeof value === 'number' && (!back || value > back.depth)) back = { id: plane.id, depth: value };
  }
  for (const plane of planes) {
    const value = values.get(plane.id);
    if (value === undefined || typeof value === 'number') continue;
    for (const moment of moments) {
      const depth = value(moment), at = paintSecondsText(moment.at);
      if (!(depth > 0 && Number.isFinite(depth))) {
        problems.push(depthError(plane.id, `at ${at} lies at depth ${depth}; a plane's depth is above 0`));
        break;
      }
      if (back && !(depth < back.depth)) {
        problems.push(depthError(plane.id, `at ${at} lies at depth ${depth}, not nearer than the back, ${back.id} at depth ${back.depth}: a plane whose depth moves stays nearer than the back, which keeps one depth`));
        break;
      }
    }
  }
  if (values.size && !back) problems.push(paintingProblem('error', 'shot', 'planes', "has no plane at one depth: the back, the farthest plane, keeps one depth"));
  return { values, back, problems };
}

/** Where a drawable lies on its canvas: a plane's depth in time, or the depths an instanced plane's items lie between. */
type ShotCanvasPlace = { readonly id: string; readonly canvas: number; readonly depth: PresentationValue<number> | ShotDepthRange };

const placeAt = ({ depth }: ShotCanvasPlace, moment: PaintMoment): ShotDepthRange => {
  if (typeof depth === 'object') return depth;
  const at = typeof depth === 'number' ? depth : depth(moment);
  return { near: at, far: at };
};

const rangeText = ({ near, far }: ShotDepthRange) => (near === far ? `at depth ${near}` : `at depths ${near}..${far}`);

const moves = ({ depth }: ShotCanvasPlace) => typeof depth === 'function';

/**
 * Why the drawables `places` (the back first) can't share their canvases (`canvases`, by name), checked at
 * `moments`: the back on the first, and at every moment a later canvas's drawables all nearer than an earlier one's.
 * A plane moving in depth is named with the moment and depth it first crosses.
 */
export function shotCanvasDepthProblems(places: readonly ShotCanvasPlace[], canvases: readonly string[], moments: readonly PaintMoment[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [], canvasError = (owner: string, message: string) => problems.push(paintingProblem('error', owner, 'canvas', message));
  if (places.length && places[0].canvas !== 0) canvasError(places[0].id, `is the back, so it draws in the first canvas, ${canvases[0]}`);
  for (const far of places) {
    for (const near of places) {
      if (near.canvas <= far.canvas) continue;
      if (!moves(near) && !moves(far)) {
        const nearAt = placeAt(near, moments[0]), farAt = placeAt(far, moments[0]);
        if (!(nearAt.far < farAt.near)) {
          canvasError(near.id, `draws in ${canvases[near.canvas]} ${rangeText(nearAt)}, not nearer than ${far.id} ${rangeText(farAt)} in ${canvases[far.canvas]}: a later canvas's planes are all nearer`);
        }
        continue;
      }
      const crossing = moments.find((moment) => !(placeAt(near, moment).far < placeAt(far, moment).near));
      if (!crossing) continue;
      // The plane that moves is the one named: the near one when both do.
      const [owner, other, relation] = moves(near) ? [near, far, 'not nearer than'] : [far, near, 'not farther than'];
      canvasError(owner.id, `draws in ${canvases[owner.canvas]} and at ${paintSecondsText(crossing.at)} lies ${rangeText(placeAt(owner, crossing))}, ${relation} ${other.id} ${rangeText(placeAt(other, crossing))} in ${canvases[other.canvas]}: a later canvas's planes are all nearer, at every moment`);
    }
  }
  return problems;
}
