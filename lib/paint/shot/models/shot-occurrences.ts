// shot-occurrences.ts: the names a shot's drawables go by. A plane is named by its id; a layer or group a painted plane
// shows is an occurrence, `<plane id>/<key>`, so the same layer on two planes is two occurrences. Neither plane ids
// nor document keys hold a `/`, so the first one splits a name. An instanced plane's items aren't occurrences. A
// painted plane's occurrences are the layers and groups its source shows, in document order.

import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingNodePlace } from '#lib/paint/document/models/painting-tree.ts';
import type { InstancedPlaneProps, OccurrenceKey, PlaneProps } from './shot-props.ts';
import type { PaintedSource } from './shot-selection.ts';

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

/**
 * The layer and group keys `source` shows, each once: a selection's keys and every node under them in document order,
 * then what a dissolve's other side adds. Both sides of a dissolve share their keys' occurrences, moved alike; a
 * plane's occurrences are these through shotOccurrenceKey.
 */
export function paintedSourceNodeKeys(source: PaintedSource): NodeKey[] {
  if (source.kind === 'dissolve') return [...new Set([...paintedSourceNodeKeys(source.a), ...paintedSourceNodeKeys(source.b)])];
  const chosen = new Set(source.layers);
  return source.painting.tree.nodes.filter(({ node, groups }) => chosen.has(node.key) || groups.some((group) => chosen.has(group))).map(({ node }) => node.key);
}

/**
 * One occurrence a painted plane shows: its name, the document node it is, whether a layer or a group, and the group
 * occurrences enclosing it on its plane, outermost first. A group the selection starts inside isn't one.
 */
export type ShotOccurrence = { readonly key: OccurrenceKey; readonly node: NodeKey; readonly kind: 'layer' | 'group'; readonly groups: readonly OccurrenceKey[] };

/** Where `key` sits in the first of a dissolve's ends to hold it. */
function placeOf(source: PaintedSource, key: NodeKey): PaintingNodePlace | undefined {
  if (source.kind === 'layers') return source.painting.tree.byKey.get(key);
  return placeOf(source.a, key) ?? placeOf(source.b, key);
}

/** Every occurrence plane `plane` shows of `source`, in document order (paintedSourceNodeKeys). */
export function shotPlaneOccurrences(plane: string, source: PaintedSource): ShotOccurrence[] {
  const keys = paintedSourceNodeKeys(source), shown = new Set(keys);
  return keys.map((key) => {
    const place = placeOf(source, key)!;
    return { key: shotOccurrenceKey(plane, key), node: key, kind: place.kind, groups: place.groups.filter((group) => shown.has(group)).map((group) => shotOccurrenceKey(plane, group)) };
  });
}
