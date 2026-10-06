// shot-rigs.ts: a group occurrence cut into parts and posed (ENGINE 6.5), purely. A part is a cut declaration with
// its cels under the rigged group; a pose moves and turns it about its pivot in its parent's frame and bends it from
// pivot to farthest rest paint, as main's rig composes sway and placement (paint-deform.ts).
//
// A group owning its sheet is drawn as pieces: its sheet laid with its shown cels' films, cut by their cel layer's
// ownership, posed by skin (shotRigPieces). Otherwise its cels' marks are posed before painting (shotRigCelPoses): a
// rest cel by its skin mesh where it has one, any other by its part's rigid map; a cel owning a sheet moves it whole.

import { paintPlacementIsRest, paintPlacementRounded, paintRatioSteps, type PaintDeform } from '#lib/paint/animation/models/paint-deform.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { PAINTING_REST_POSE, paintingDeformsPose, paintingPoseMap, paintingPoseText, type PaintingNodePose } from '#lib/paint/document/models/painting-pose.ts';
import { paintingField, paintingProblem, paintingProblemsError, isPaintingFinitePoint, isPaintingPositive, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintingEvaluation } from '#lib/paint/document/models/painting-source.ts';
import { paintingLayersUnder, paintingSheetInGroup, type PaintingTree } from '#lib/paint/document/models/painting-tree.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { paintRigCelLayer, paintRigPicturePainted, type PaintRigCelPart } from '#lib/paint/rig/models/paint-rig-cel-layer.ts';
import type { PaintRigCutLayer } from '#lib/paint/rig/models/paint-rig-cuts.ts';
import { paintRigSkinGroupPicture, type PaintRigPicture, type PaintRigPiece } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import {
  paintRigBandStretch, paintRigSkinGroups, paintRigSkinMesh, paintRigSkinProblems, paintRigSkinRestMap, paintRigSkinTriangles,
  type PaintRigBoneless, type PaintRigSkinGroup, type PaintRigSkinMesh,
} from '#lib/paint/rig/models/paint-rig-skin.ts';
import { paintedSourceNodeKeys, shotEntryProblem } from './shot-occurrences.ts';
import type { OccurrenceKey, OccurrenceRig, RigPart, RigPartPose } from './shot-props.ts';
import type { PaintedSourceEnd } from './shot-selection.ts';

/**
 * A rig checked: its group occurrence, plane and painting's size (px); each part's line (itself, then its ancestors);
 * each cel's part and layers (document order); `pieces`, whether its group owns the sheet its cels lie on, so it's
 * drawn as pieces; its pose; and `text`, its declaration's canonical text, which every map it makes names.
 */
export type CompiledShotRig = {
  readonly occurrence: OccurrenceKey;
  readonly plane: string;
  readonly size: { readonly widthPx: number; readonly heightPx: number };
  readonly group: NodeKey;
  readonly parts: readonly RigPart[];
  readonly lines: ReadonlyMap<string, readonly RigPart[]>;
  readonly celPart: ReadonlyMap<NodeKey, string>;
  readonly celLayers: ReadonlyMap<NodeKey, readonly NodeKey[]>;
  readonly pieces: boolean;
  readonly pose: OccurrenceRig['pose'];
  readonly text: string;
};

/** A problem with `occurrence`'s rig at `field`, named where its entry writes it: `front.occurrences.heron.rig.parts`. */
const rigError = (occurrence: OccurrenceKey, field: string, message: string) => shotEntryProblem('error', occurrence, paintingField('rig', field), message);

/** Each part's line, itself first, or a problem: a parent that isn't a part, or a cycle. */
function rigLines(occurrence: OccurrenceKey, parts: readonly RigPart[], problems: PaintingProblem[]): Map<string, RigPart[]> {
  const byId = new Map(parts.map((part) => [part.id, part])), lines = new Map<string, RigPart[]>();
  for (const part of parts) {
    const line = [part];
    for (let up = part.parent; up !== null;) {
      const parent = byId.get(up);
      if (!parent) { problems.push(rigError(occurrence, `parts.${part.id}`, `hangs from ${up}, which isn't one of the rig's parts`)); break; }
      if (line.includes(parent)) { problems.push(rigError(occurrence, `parts.${part.id}`, `${line.map(({ id }) => id).join(' → ')} → ${up} is a cycle`)); break; }
      line.push(parent);
      up = parent.parent;
    }
    lines.set(part.id, line);
  }
  return lines;
}

/** Why `part`'s declaration can't be posed, or null: a z, pivot and blend that aren't numbers a pose can use. */
function partProblem(part: RigPart): string | null {
  if (!Number.isFinite(part.z)) return `its z is ${part.z}, not a finite number`;
  if (part.parent === null) return null;
  if (!isPaintingFinitePoint(part.pivot)) return `its pivot (${part.pivot.x}, ${part.pivot.y}) isn't a finite point`;
  if (part.joint === 'skin' && !isPaintingPositive(part.blend)) return `its skin blends over ${part.blend} px; a blend is a finite px above 0`;
  return null;
}

/** The layers under node `key` in `tree`, in document order: itself for a layer. */
const layersUnder = (tree: PaintingTree, key: NodeKey) => paintingLayersUnder(tree, tree.byKey.get(key)!).map(({ node }) => node.key);

/** Cel `cel`'s layers in `tree`, in document order: itself, a layer, or those under it; null where it isn't under `group`. */
function celCut(tree: PaintingTree, group: NodeKey, cel: NodeKey): NodeKey[] | null {
  return tree.byKey.get(cel)?.groups.includes(group) ? layersUnder(tree, cel) : null;
}

/** `group`'s layers in `tree` on the root's sheet though it owns its own: off the sheet a pieces rig reads its cels from. */
const offGroupSheet = (tree: PaintingTree, group: NodeKey) => layersUnder(tree, group).filter((layer) => !paintingSheetInGroup(tree, tree.byKey.get(layer)!.sheet, group));

/** Whether `selection` shows `group` as a group: a rig on its plane is cut in the first end that does. */
export const shotRigShowsGroup = (selection: LayerSelection, group: NodeKey) => selection.painting.tree.byKey.get(group)?.kind === 'group' && paintedSourceNodeKeys(selection).includes(group);

const sameKeys = (a: readonly NodeKey[], b: readonly NodeKey[]) => a.length === b.length && a.every((key) => b.includes(key));

/**
 * Why `end`, a selection rig `rig`'s plane shows, doesn't hold its group as the rig cuts it, at the end's field: not
 * showing it, a cel holding other layers, a layer under it in no cel, or its sheet owned otherwise.
 */
function shotRigEndProblems(rig: CompiledShotRig, { selection, field }: PaintedSourceEnd): PaintingProblem[] {
  const problems: PaintingProblem[] = [], { group, occurrence } = rig, { tree } = selection.painting;
  const error = (message: string) => problems.push(paintingProblem('error', rig.plane, field, `${message}: every end of a rigged plane holds its rigged groups cut alike`));
  if (!shotRigShowsGroup(selection, group)) {
    error(`shows no group ${group}, which ${occurrence} rigs`);
    return problems;
  }
  for (const [cel, layers] of rig.celLayers) {
    const cut = celCut(tree, group, cel);
    if (!cut) error(`holds no ${cel} under ${group}, and ${occurrence} cuts it as a cel`);
    else if (!sameKeys(cut, layers)) error(`holds ${occurrence}'s cel ${cel} as ${cut.join(', ') || 'no layers'}, and the rig cuts it as ${layers.join(', ')}`);
  }
  const celled = new Set([...rig.celLayers.values()].flat());
  for (const layer of layersUnder(tree, group)) if (!celled.has(layer)) error(`holds ${layer} under ${group}, in none of ${occurrence}'s cels`);
  const pieces = tree.byKey.get(group)!.sheet.owner === group;
  if (pieces !== rig.pieces) error(rig.pieces ? `paints ${group} on its parent's sheet, and ${occurrence} draws it as pieces, on its own` : `gives ${group} a sheet of its own, and ${occurrence} poses its marks on its parent's`);
  else if (pieces) for (const layer of offGroupSheet(tree, group)) error(`paints ${layer} on the root's sheet, and ${occurrence} draws ${group} as pieces off its own`);
  return problems;
}

/**
 * Why plane `plane`'s `ends` (its load's, or a callback's later read) don't hold the groups its rigs (of `rigs`) cut
 * as they're cut, at each end's field. Each end's rig is found and posed over that end's paint, so a pose must move
 * the same layers in every end.
 */
export function shotPlaneRigEndProblems(rigs: Iterable<CompiledShotRig>, plane: string, ends: readonly PaintedSourceEnd[]): PaintingProblem[] {
  return [...rigs].filter((rig) => rig.plane === plane).flatMap((rig) => ends.flatMap((end) => shotRigEndProblems(rig, end)));
}

/**
 * `rig`, cutting group occurrence `occurrence` of plane `plane` as `painting` holds it, checked: parts with unique
 * ids, parents among them, no cycles, cels strictly under the group, each layer under it in one part's cels; a pieces
 * rig's cels on its group's sheet or one nested in it. Its plane's other ends are held to it by shotPlaneRigEndProblems.
 */
export function compileShotRig(occurrence: OccurrenceKey, plane: string, painting: PaintingEvaluation, rig: OccurrenceRig): { rig: CompiledShotRig | null; problems: PaintingProblem[] } {
  const { tree, document: { widthPx, heightPx } } = painting;
  const problems: PaintingProblem[] = [], group = occurrence.slice(plane.length + 1), place = tree.byKey.get(group);
  if (place?.kind !== 'group') return { rig: null, problems: [rigError(occurrence, '', `cuts ${group}, which isn't a group of ${plane}'s painting: a rig cuts a group`)] };
  if (!rig.parts.length) problems.push(rigError(occurrence, 'parts', 'are none: a rig cuts its group into parts'));
  const seen = new Set<string>();
  for (const part of rig.parts) {
    if (seen.has(part.id)) problems.push(rigError(occurrence, `parts.${part.id}`, 'is declared twice'));
    seen.add(part.id);
    const problem = partProblem(part);
    if (problem) problems.push(rigError(occurrence, `parts.${part.id}`, problem));
    if (!part.cels.length) problems.push(rigError(occurrence, `parts.${part.id}`, 'has no cels: a part shows a cel'));
  }
  const lines = rigLines(occurrence, rig.parts, problems);
  const celPart = new Map<NodeKey, string>(), celLayers = new Map<NodeKey, NodeKey[]>(), layerCel = new Map<NodeKey, NodeKey>();
  for (const part of rig.parts) {
    for (const cel of part.cels) {
      const layers = celCut(tree, group, cel);
      if (!layers) { problems.push(rigError(occurrence, `parts.${part.id}.cels`, `names ${cel}, which isn't under ${group}`)); continue; }
      if (celPart.has(cel)) { problems.push(rigError(occurrence, `parts.${part.id}.cels`, `names ${cel}, a cel of ${celPart.get(cel)} already`)); continue; }
      celPart.set(cel, part.id);
      celLayers.set(cel, layers);
      for (const layer of layers) {
        const before = layerCel.get(layer);
        if (before !== undefined) problems.push(rigError(occurrence, `parts.${part.id}.cels`, `names ${cel}, holding ${layer}, which cel ${before} holds too: a layer of a rig lies in one part's cels`));
        else layerCel.set(layer, cel);
      }
    }
  }
  for (const layer of layersUnder(tree, group)) {
    if (!layerCel.has(layer)) {
      problems.push(rigError(
        occurrence, 'parts',
        `hold no cel with ${layer}, which lies under ${group}: group it with the layer it rides on (a group cel's layers may mix media) and name the group as that part's cel, or give it a part of its own: a part's cels after its first are swaps, shown one at a time, so one named there is hidden at rest`,
      ));
    }
  }
  const pieces = place.sheet.owner === group;
  // A cel's paint is read off the group's sheet: one on the root's (a `scene` layer) isn't on it.
  for (const layer of pieces ? offGroupSheet(tree, group) : []) {
    problems.push(rigError(occurrence, 'parts', `hold ${layer}, which lies on the root's sheet, and ${group} owns its sheet: a cel of a rig drawn as pieces lies on its group's sheet`));
  }
  if (problems.length) return { rig: null, problems };
  return {
    rig: {
      occurrence, plane, size: { widthPx, heightPx }, group, parts: rig.parts, lines, celPart, celLayers, pieces, pose: rig.pose,
      text: stampCanonicalJson({ occurrence, parts: rig.parts }),
    },
    problems,
  };
}

/** Why `pose` can't pose `rig`, or null: a part it doesn't have, a cel not that part's, a number that isn't finite. */
export function shotRigPoseProblem(rig: CompiledShotRig, pose: Readonly<Record<string, RigPartPose>>): string | null {
  for (const [id, partPose] of Object.entries(pose)) {
    const part = rig.parts.find((each) => each.id === id);
    if (!part) return `poses ${id}, which isn't one of its parts`;
    if (partPose.cel !== undefined && !part.cels.includes(partPose.cel)) return `shows ${id}'s cel ${partPose.cel}; its cels are ${part.cels.join(', ')}`;
    for (const name of ['x', 'y', 'rotation', 'bend'] as const) {
      const value = partPose[name];
      if (value !== undefined && !Number.isFinite(value)) return `poses ${id}'s ${name} at ${value}, not a finite number`;
    }
  }
  return null;
}

/** What a part bends along: from its pivot toward its farthest rest paint, `length` px. */
export type ShotRigAxis = { readonly direction: number; readonly length: number };

/** The least alpha a texel holds to count as a part's paint when its axis is found. */
const AXIS_PAINT = 0.05;

/** The axis from `pivot` to the farthest texel of `picture` holding paint; a unit axis along x for one holding none. */
export function shotRigPartAxis(pivot: StampPoint, picture: PaintRigPicture): ShotRigAxis {
  let best = { distance: 0, x: pivot.x + 1, y: pivot.y };
  for (let j = 0; j < picture.h; j++) for (let i = 0; i < picture.w; i++) {
    if (picture.rgba[4 * (j * picture.w + i) + 3] <= AXIS_PAINT) continue;
    const x = picture.x0 + i + 0.5, y = picture.y0 + j + 0.5, distance = Math.hypot(x - pivot.x, y - pivot.y);
    if (distance > best.distance) best = { distance, x, y };
  }
  return { direction: Math.atan2(best.y - pivot.y, best.x - pivot.x), length: Math.max(1, best.distance) };
}

/** Where a part turns: its declared pivot, a root's the group node's. */
export const shotRigPartPivot = (part: RigPart, groupPivot: StampPoint): StampPoint => (part.parent === null ? groupPivot : part.pivot);

/**
 * A rig at one pose: each part's map, rest document px to posed in its group's frame, as a pose (a similarity while
 * nothing bends), and the cel each part shows.
 */
export type ShotRigPosed = { readonly maps: ReadonlyMap<string, PaintingNodePose>; readonly shown: ReadonlyMap<string, NodeKey> };

/** The cel each of `rig`'s parts shows at `pose`, by part id: the one its pose names, else its first. */
export const shotRigShownCels = (rig: CompiledShotRig, pose: Readonly<Record<string, RigPartPose>>): ReadonlyMap<string, NodeKey> =>
  new Map(rig.parts.map((part) => [part.id, pose[part.id]?.cel ?? part.cels[0]]));

/**
 * `rig`'s cels `pose` doesn't show. They stay in their sheet's program, so a swap never re-solves and what their water
 * did to others stays; their own films and cards lay nowhere.
 */
export function shotRigHiddenCels(rig: CompiledShotRig, pose: Readonly<Record<string, RigPartPose>>): NodeKey[] {
  const shown = new Set(shotRigShownCels(rig, pose).values());
  return [...rig.celPart.keys()].filter((cel) => !shown.has(cel));
}

/**
 * `rig` posed by `pose` (shotRigPoseProblem's checked): each part's own bend and placement about its pivot, then its
 * parent's, and so up, a root turning about `groupPivot`; a bend along its part's axis in `axes`. `wobble`, its group
 * node's boil as laid, goes first: the rest picture boiled, then cut and posed (ENGINE 6.5).
 */
export function shotRigPosed(
  rig: CompiledShotRig, pose: Readonly<Record<string, RigPartPose>>, groupPivot: StampPoint, axes: ReadonlyMap<string, ShotRigAxis>, wobble: PaintDeform | null,
): ShotRigPosed {
  const maps = new Map<string, PaintingNodePose>();
  for (const part of rig.parts) {
    const steps: PaintDeform[] = wobble ? [wobble] : [];
    for (const level of rig.lines.get(part.id)!) {
      const { x = 0, y = 0, rotation = 0, bend = 0 } = pose[level.id] ?? {}, pivot = shotRigPartPivot(level, groupPivot), angleSteps = paintRatioSteps(bend);
      if (angleSteps !== 0) steps.push({ owner: level.id, kind: 'sway', root: pivot, ...axes.get(level.id)!, angleSteps });
      const placement = paintPlacementRounded({ x, y, rotation });
      if (!paintPlacementIsRest(placement)) steps.push({ owner: level.id, kind: 'place', placement, pivot });
    }
    maps.set(part.id, paintingDeformsPose(steps, `${rig.text}:${part.id}:`));
  }
  return { maps, shown: shotRigShownCels(rig, pose) };
}

/**
 * A rig's picture read back (a rest cel, or a pieces rig's sheets) and `key`, naming its pixels (its readback's key):
 * equal keys, equal pictures, in any end or frame.
 */
export type ShotRigKeyedPicture = { readonly picture: PaintRigPicture; readonly key: string };

/** A part's cel as a frame shows it: its node `cel`, its picture as the whole selection paints it unposed, and that picture's key. */
export type ShotRigCel = ShotRigKeyedPicture & { readonly cel: NodeKey };

/** Problems that leave `rig`'s cels unskinnable, as one error naming the rig. */
const shotRigSkinError = (rig: CompiledShotRig, problems: readonly PaintingProblem[]) => paintingProblemsError(`shot's rig ${rig.occurrence}`, problems);

/** Why part `k` of `rig`, showing `shown`, has no bone to bend its skin joint along (`boneless`, paintRigSkinProblems'). */
function shotRigBonelessProblem(rig: CompiledShotRig, k: number, shown: ShotRigCel, boneless: PaintRigBoneless, onDocument: string): PaintingProblem {
  const at = `parts.${rig.parts[k].id}`, bends = "a skin joint bends along its part's own paint";
  if (boneless === 'centred') {
    return rigError(rig.occurrence, at, `its cel ${shown.cel}'s own paint centres on its pivot, and ${bends}, out from the pivot: set the pivot where the part meets its parent`);
  }
  if (!paintRigPicturePainted(shown.picture)) return rigError(rig.occurrence, at, `its cel ${shown.cel} lays no paint on ${onDocument}, and ${bends}: paint it there, or leave the part out`);
  return rigError(
    rig.occurrence, at,
    `its cel ${shown.cel} gives none of the rig's texels most of their colour, outweighed everywhere it paints by the cels over or under it, and ${bends}: where it lies under them, raise its z; where it lies over them, paint it stronger, or out past them`,
  );
}

/**
 * A cel layer's skin: its cuts (parts in the rig's order) and each of its groups with its mesh, back to front; `key`
 * names the rest cels it was found over, and so its meshes.
 */
export type ShotRigSkin = {
  readonly key: string; readonly cuts: PaintRigCutLayer; readonly groups: readonly { readonly group: PaintRigSkinGroup; readonly mesh: PaintRigSkinMesh }[];
};

/**
 * `cels` (the cel each part shows, in part order) laid as one cel layer and skinned: its cuts, groups and meshes.
 * Refuses at the rig's path, by the rig engine's own rules, what it would refuse naming no rig: no cel painted, a
 * skin joint with no bone. A hinged part or a root may show a clear cel.
 */
export function shotRigSkin(rig: CompiledShotRig, cels: readonly ShotRigCel[]): { picture: PaintRigPicture; skin: ShotRigSkin } {
  const { widthPx, heightPx } = rig.size, onDocument = `the document (0,0 → ${widthPx},${heightPx})`;
  if (!cels.some(({ picture }) => paintRigPicturePainted(picture))) {
    throw shotRigSkinError(rig, [rigError(rig.occurrence, 'parts', `lays no paint on ${onDocument}: its cels ${cels.map(({ cel }) => cel).join(', ')} lie off it, or are clipped or reserved away`)]);
  }
  const parts: PaintRigCelPart[] = rig.parts.map((part, k) => ({ declaration: part, picture: cels[k].picture }));
  const { picture, cuts } = paintRigCelLayer(rig.occurrence, parts), key = stampCanonicalJson(cels.map((cel) => cel.key));
  const boneless = paintRigSkinProblems(cuts);
  if (boneless.length) throw shotRigSkinError(rig, boneless.map((problem) => shotRigBonelessProblem(rig, problem.part, cels[problem.part], problem.boneless, onDocument)));
  return { picture, skin: { key, cuts, groups: paintRigSkinGroups(cuts).map((group) => ({ group, mesh: paintRigSkinMesh(cuts, group) })) } };
}

/**
 * A marks rig's cel poses (document keys of its cels): a rest cel skinned with others by `skin` (over the rest cels'
 * coverage) goes by its mesh, posed through each member's map, and by its part's map off the mesh; every other cel,
 * shown or not, by its part's map.
 */
export function shotRigCelPoses(rig: CompiledShotRig, posed: ShotRigPosed, skin: ShotRigSkin): Map<NodeKey, PaintingNodePose> {
  const poses = new Map<NodeKey, PaintingNodePose>(), byPart = (k: number) => posed.maps.get(rig.parts[k].id)!;
  const skinned = new Map<string, StampWarpMap>();
  // At rest every mesh maps rest to rest: its cels keep the rest pose, so they're keyed as unposed and solve as such.
  const resting = [...posed.maps.values()].every((pose) => paintingPoseText(pose) === PAINTING_REST_POSE);
  for (const { group, mesh } of resting ? [] : skin.groups) {
    if (group.members.length < 2) continue;
    const triangles = paintRigSkinTriangles(mesh, (k) => paintingPoseMap(byPart(k))), onMesh = paintRigSkinRestMap(mesh, triangles);
    for (const k of group.members) {
      const rigid = paintingPoseMap(byPart(k));
      skinned.set(rig.parts[k].id, (rest) => onMesh(rest) ?? rigid(rest));
    }
  }
  const allTexts = rig.parts.map((part) => `${part.id}=${paintingPoseText(posed.maps.get(part.id)!)}`).join(';');
  for (const [cel, partId] of rig.celPart) {
    const part = rig.parts.find(({ id }) => id === partId)!, map = skinned.get(partId);
    // A skin mesh covers its part's rest cel alone: a swapped-in cel moves rigidly with its part. Every rest cel shapes
    // the mesh, so the skin's key is in the text: a body solved in one end isn't resumed by an end whose neck differs.
    if (map && cel === part.cels[0]) poses.set(cel, { kind: 'warp', map, text: `${rig.text}:skin(${partId}@${skin.key}):${allTexts}` });
    else poses.set(cel, posed.maps.get(partId)!);
  }
  return poses;
}

/**
 * A rig as a frame finds it, from its rest cels (one picture a part, its first cel, in part order) as the whole
 * selection paints them unposed: the axes its parts bend along, and a marks rig's skin. Found from all the paint, not a
 * timed prefix's, so a rig painted in over time poses alike throughout.
 */
export type ShotRigFound = { readonly rig: CompiledShotRig; readonly axes: ReadonlyMap<string, ShotRigAxis>; readonly skin: ShotRigSkin | null };

/** `rig` found over `cels`, its parts' rest cels, its roots turning about `groupPivot`. */
export function shotRigFound(rig: CompiledShotRig, groupPivot: StampPoint, cels: readonly ShotRigCel[]): ShotRigFound {
  const axes = new Map(rig.parts.map((part, k) => [part.id, shotRigPartAxis(shotRigPartPivot(part, groupPivot), cels[k].picture)] as const));
  return { rig, axes, skin: rig.pieces ? null : shotRigSkin(rig, cels).skin };
}

/** A skin joint's band at one pose: how far its triangles stretch, for a warning when one folds (ENGINE 6.5). */
export type ShotRigStretch = { readonly joint: string; readonly least: number; readonly most: number; readonly flips: number };

/**
 * A pieces rig's pictures, one a skin group of `skin` (over the shown cels' paint), cut from `picture` (its sheets laid
 * with those cels' films) by ownership, back to front: made once for a set of shown cels, posed every moment.
 */
export const shotRigPiecePictures = (picture: PaintRigPicture, skin: ShotRigSkin): PaintRigPicture[] =>
  skin.groups.map(({ group }) => paintRigSkinGroupPicture(picture, skin.cuts, group, () => true));

/**
 * A pieces rig's pieces at `posed`, in its group's frame: each of `pictures` (shotRigPiecePictures over `skin`)
 * through its skin group's mesh posed by each member's map. And each skin joint's stretch.
 */
export function shotRigPieces(posed: ShotRigPosed, pictures: readonly PaintRigPicture[], skin: ShotRigSkin): { pieces: PaintRigPiece[]; stretches: ShotRigStretch[] } {
  const pieces: PaintRigPiece[] = [], stretches: ShotRigStretch[] = [], { parts } = skin.cuts;
  skin.groups.forEach(({ mesh }, g) => {
    const triangles = paintRigSkinTriangles(mesh, (k) => paintingPoseMap(posed.maps.get(parts[k].id)!));
    for (const [child, band] of mesh.bands) stretches.push({ joint: parts[child].id, ...paintRigBandStretch(triangles, band) });
    pieces.push({ picture: pictures[g], triangles });
  });
  return { pieces, stretches };
}

/** `pieces` with their posed points carried by `map` (the group's sheet's placement), their rest points kept. */
export function shotRigPiecesPlaced(pieces: readonly PaintRigPiece[], map: StampWarpMap): PaintRigPiece[] {
  return pieces.map(({ picture, triangles }) => {
    const placed = triangles.slice();
    for (let v = 0; v < placed.length; v += 4) {
      const at = map({ x: placed[v], y: placed[v + 1] });
      placed[v] = at.x;
      placed[v + 1] = at.y;
    }
    return { picture, triangles: placed };
  });
}
