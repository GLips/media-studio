// shot-entries.ts: a shot's plane entries read into what it compiles. A plane's entry says everything about it: its
// visibility, its own node's fields and plays, and under `occurrences`, by key, each layer's or group's visibility,
// rig, node fields and plays. They're read here into maps by drawable name (OccurrenceKey), as the compiled shot keys
// them. A node exists only where an entry writes a node field or a play, so an entry giving only a visibility or a rig
// leaves what moves its occurrence as it was.

import type { PaintMotionPlay } from '#lib/paint/animation/models/paint-motion-compile.ts';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { ShotMotionEntries, ShotMotionPlane } from './shot-motion.ts';
import { shotEntryProblem, shotOccurrenceKey } from './shot-occurrences.ts';
import type { InstancedPlaneProps, OccurrenceKey, OccurrenceMotionNode, OccurrenceRig, PlaneProps, ShotNodeFields, ShotNodePlay } from './shot-props.ts';

/** A shot's entries by drawable name: visibility (planes and occurrences), rigs (group occurrences), and motion nodes and their plays. */
export type ShotEntries = {
  readonly visibility: ReadonlyMap<OccurrenceKey, PresentationValue<number>>;
  readonly rigs: ReadonlyMap<OccurrenceKey, OccurrenceRig>;
  readonly motion: ShotMotionEntries;
};

const writesNode = (fields: Omit<OccurrenceMotionNode, 'id'>, plays: readonly ShotNodePlay[] | undefined) => Object.values(fields).some((value) => value !== undefined) || !!plays?.length;

/**
 * `written`'s entries read over `planes` (each compiled plane as motion reads it; one that failed to compile is left
 * out, its own problems said): an occurrence entry names a layer or group its painted plane shows; a picture or three
 * plane shows none. An instanced plane's entry holds its visibility only.
 */
export function shotPlaneEntries(written: readonly (PlaneProps | InstancedPlaneProps)[], planes: readonly ShotMotionPlane[], problems: PaintingProblem[]): ShotEntries {
  const visibility = new Map<OccurrenceKey, PresentationValue<number>>(), rigs = new Map<OccurrenceKey, OccurrenceRig>();
  const nodes: OccurrenceMotionNode[] = [], plays: PaintMotionPlay[] = [], compiled = new Map(planes.map((plane) => [plane.id, plane]));
  const take = (id: OccurrenceKey, fields: Omit<OccurrenceMotionNode, 'id'>, own: readonly ShotNodePlay[] | undefined) => {
    if (!writesNode(fields, own)) return;
    nodes.push({ id, ...fields });
    for (const play of own ?? []) plays.push({ ...play, target: id });
  };
  for (const props of written) {
    if (props.visibility !== undefined) visibility.set(props.id, props.visibility);
    const plane = compiled.get(props.id);
    if (props.kind === 'instanced' || !plane) continue;
    const { pivot, pins, marks, glow } = props, fields: ShotNodeFields = { pivot, pins, marks, glow };
    take(props.id, fields, props.plays);
    const entries = Object.entries(props.occurrences ?? {});
    if (entries.length && plane.kind !== 'painted') {
      problems.push(paintingProblem('error', props.id, 'occurrences', `is a ${plane.kind} plane, which shows no layers or groups`));
      continue;
    }
    const shown = new Set(plane.occurrences.map(({ node }) => node));
    for (const [key, { visibility: seen, rig, plays: own, ...node }] of entries) {
      const id = shotOccurrenceKey(props.id, key);
      if (!shown.has(key)) {
        problems.push(shotEntryProblem('error', id, '', `isn't a layer or group ${props.id} shows`));
        continue;
      }
      if (seen !== undefined) visibility.set(id, seen);
      if (rig) rigs.set(id, rig);
      take(id, node, own);
    }
  }
  return { visibility, rigs, motion: { nodes, plays } };
}
