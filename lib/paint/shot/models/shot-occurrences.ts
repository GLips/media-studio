// shot-occurrences.ts: the names a shot's drawables go by. A plane is named by its id; a layer or group a painted plane
// shows is an occurrence, `<plane id>/<key>`, so the same layer on two planes is two occurrences. Neither plane ids
// nor document keys hold a `/`, so the first one splits a name. An instanced plane's items aren't occurrences.

import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import type { InstancedPlaneProps, OccurrenceKey, PlaneProps } from './shot-props.ts';

/** The occurrence of `key` (a layer or group) on plane `plane`. */
export const shotOccurrenceKey = (plane: string, key: NodeKey): OccurrenceKey => `${plane}/${key}`;

/** The plane `name` lies on: an occurrence's plane, or a plane id itself. */
export const shotOccurrencePlane = (name: OccurrenceKey): string => name.split('/', 1)[0];

/** What a name means in a shot: a plane, a painted plane's occurrence, an instanced plane's item, or nothing drawn. */
export type ShotDrawableName = 'plane' | 'occurrence' | 'item' | 'unknown';

/**
 * Reads names against a shot's `planes` and `occurrences` (each painted plane's, from its first evaluation): a plane
 * id of any kind, an occurrence, or a name under an instanced plane, whose items masks and visibility can't reach.
 */
export function shotDrawableNamer(planes: readonly (PlaneProps | InstancedPlaneProps)[], occurrences: ReadonlyMap<string, readonly OccurrenceKey[]>) {
  const instanced = new Set(planes.filter((plane) => plane.kind === 'instanced').map(({ id }) => id)), ids = new Set(planes.map(({ id }) => id));
  const occurring = new Set([...occurrences.values()].flat());
  return (name: string): ShotDrawableName => {
    if (ids.has(name)) return 'plane';
    if (occurring.has(name)) return 'occurrence';
    return instanced.has(shotOccurrencePlane(name)) ? 'item' : 'unknown';
  };
}
