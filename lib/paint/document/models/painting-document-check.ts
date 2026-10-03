// painting-document-check.ts: a PaintingDocument held to what the engine can paint, before anything is solved
// (docs/painting-authoring.md, Checking). Three stages, each run only if those before it found no error, so references
// resolve before ranges are read: the document's shape and keys; papers, layers, washes and their applications in
// their resolved media; then each sheet's order (painting-sheet-check.ts), and the pigments each layer's film holds.
// What only solving can tell (an `on` that never holds over a real core) is the solver's.

import { PAINT_MEDIA, paintMediumCan } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_PIGMENT_GROUP_SLOTS } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { checkPaintingApplication, checkPaintingFootprint, type PaintingApplicationSetting } from './painting-application-check.ts';
import type { AnyApplication, Key, LayerNode, MediumName, PaintingDocument, Paper, Wash } from './painting-document.ts';
import { paintingBoxUnion, paintingGeometryBox, paintingNodeBox, paintingWashBox } from './painting-footprint.ts';
import {
  isPaintingHexColor, isPaintingList, isPaintingPositive, isPaintingShare, paintingApplicationOwner, paintingField, PaintingProblemList, type PaintingProblem,
} from './painting-problem.ts';
import { checkPaintingAmount, checkPaintingRegion } from './painting-region-check.ts';
import { checkPaintingSheetOrders } from './painting-sheet-check.ts';
import { paintingSheetOrders, paintingWashOrderTimes, type PaintingSheetOrder, type PaintingWashOrderTimes } from './painting-sheet-program.ts';
import { paintingAssetProblem, type PaintingStyleCatalogue } from './painting-styles.ts';
import { isPaintingGroup, paintingTree, type PaintingLayerPlace, type PaintingTree } from './painting-tree.ts';

/** WebGPU's guaranteed `maxTextureDimension2D`: the largest document side every device can hold. */
const LARGEST_DOCUMENT_SIDE = 8192;
const KEY = /^[^\s/|]+$/;

/** What a check found, and the resolved tree when its shape held. */
export type PaintingDocumentCheck = { readonly problems: readonly PaintingProblem[]; readonly tree: PaintingTree | null };

const isMedium = (name: string): name is MediumName => Object.hasOwn(PAINT_MEDIA, name);

/** The first stage: sizes, media, the tree's shape, keys unique and well formed, `clipTo` an earlier wash. */
function checkPaintingTreeAndKeys(list: PaintingProblemList, paintingDocument: PaintingDocument): void {
  for (const side of ['widthPx', 'heightPx'] as const) {
    const value = paintingDocument[side];
    if (!(Number.isInteger(value) && value >= 1)) list.error('document', side, `${value} isn't a whole number of px from 1`);
    else if (value > LARGEST_DOCUMENT_SIDE) list.error('document', side, `${side} ${value} is over ${LARGEST_DOCUMENT_SIDE}`);
  }
  const medium: string = paintingDocument.medium;
  if (!isMedium(medium)) list.error('document', 'medium', `'${medium}' isn't a medium: ${Object.keys(PAINT_MEDIA).join(', ')}`);
  if (!paintingDocument.paper) list.error('document', 'paper', 'a document needs its paper');
  if (!isPaintingList(paintingDocument.layers)) {
    list.error('document', 'layers', 'a document needs its layers, back to front');
    return;
  }
  const seen = new Map<Key, { what: string; box: StampBox | undefined }>();
  const claim = (key: Key | undefined, owner: string, what: string, box: StampBox | undefined) => {
    if (typeof key !== 'string' || !KEY.test(key)) {
      list.error(owner, 'key', `'${String(key)}' isn't a key: one is non-empty, with no /, | or whitespace`, box);
      return;
    }
    const first = seen.get(key);
    if (first) list.error(key, 'key', `is used twice, by ${first.what} and ${what}`, paintingBoxUnion(first.box, box));
    else seen.set(key, { what, box });
  };
  const visit = (node: LayerNode, path: string) => {
    const owner = typeof node.key === 'string' && node.key ? node.key : path, box = paintingNodeBox(node);
    const group = isPaintingList(node.children), layer = isPaintingList(node.washes);
    if (group === layer) {
      list.error(owner, group ? 'children' : 'washes', 'a node is a layer, holding washes, or a group, holding children', box);
      return;
    }
    claim(node.key, owner, group ? 'a group' : 'a layer', box);
    const nodeMedium: string | undefined = node.medium;
    if (nodeMedium !== undefined && !isMedium(nodeMedium)) list.error(owner, 'medium', `'${nodeMedium}' isn't a medium: ${Object.keys(PAINT_MEDIA).join(', ')}`, box);
    const sheet: string | undefined = node.sheet?.kind;
    if (sheet !== undefined && sheet !== 'own' && sheet !== 'scene') list.error(owner, 'sheet.kind', `'${sheet}' isn't own or scene`, box);
    if (node.sheet?.kind === 'own' && !node.sheet.paper) list.error(owner, 'sheet.paper', 'an own sheet needs its paper', box);
    if (isPaintingGroup(node)) {
      node.children.forEach((child, i) => visit(child, `${path}.children[${i}]`));
      return;
    }
    node.washes.forEach((wash, w) => {
      const washOwner = typeof wash.key === 'string' && wash.key ? wash.key : `${owner}.washes[${w}]`;
      claim(wash.key, washOwner, 'a wash', paintingWashBox(wash));
      if (wash.clipTo !== undefined && !node.washes.slice(0, w).some(({ key }) => key === wash.clipTo)) {
        list.error(washOwner, 'clipTo', `names ${wash.clipTo}, which isn't an earlier wash of ${owner}`, paintingWashBox(wash));
      }
      if (!isPaintingList(wash.applications)) {
        list.error(washOwner, 'applications', 'a wash needs its applications', paintingWashBox(wash));
        return;
      }
      wash.applications.forEach((application: AnyApplication, i) => {
        if (application.key !== undefined) claim(application.key, `${washOwner}.applications[${i}]`, 'an application', paintingGeometryBox(application, application.diameterPx));
      });
    });
  };
  paintingDocument.layers.forEach((node, i) => visit(node, `layers[${i}]`));
}

function checkPaper(list: PaintingProblemList, owner: string, field: string, paper: Paper, styles: PaintingStyleCatalogue | undefined): void {
  if (!isPaintingHexColor(paper.color)) list.error(owner, paintingField(field, 'color'), `'${paper.color}' isn't #rrggbb`);
  if (!isPaintingShare(paper.absorbency)) list.error(owner, paintingField(field, 'absorbency'), `${paper.absorbency} isn't within 0..1`);
  const { grain, image } = paper;
  if (grain && !isPaintingPositive(grain.scale)) list.error(owner, paintingField(field, 'grain.scale'), `${grain.scale} isn't above 0`);
  if (grain && !isPaintingShare(grain.depth)) list.error(owner, paintingField(field, 'grain.depth'), `${grain.depth} isn't within 0..1`);
  if (!styles) return;
  for (const [at, asset] of [['image', image], ['grain.image', grain?.image]] as const) {
    const problem = asset && paintingAssetProblem(styles, asset);
    if (problem) list.error(owner, paintingField(field, at), problem);
  }
}

type LatestTime = { readonly time: number; readonly wash: Wash; readonly what: 'start' | 'application' };

/** The latest start or order time of `washes`, the earlier washes of a layer: what it is, and the wash it's in. */
function latestOrderTime(washes: readonly Wash[], times: readonly PaintingWashOrderTimes[]): LatestTime | undefined {
  let latest: LatestTime | undefined;
  const reach = (wash: Wash, what: LatestTime['what']) => (time: number | null) => {
    if (time !== null && Number.isFinite(time) && !(latest && latest.time >= time)) latest = { time, wash, what };
  };
  washes.forEach((wash, w) => {
    reach(wash, 'start')(times[w].start);
    times[w].times.forEach(reach(wash, 'application'));
  });
  return latest;
}

/** The wash's own fields: wet history, prewet, rim and clock, held to its medium and to the washes before it. */
function checkWashFields(list: PaintingProblemList, layer: PaintingLayerPlace, w: number, times: readonly PaintingWashOrderTimes[], setting: PaintingApplicationSetting): void {
  const { medium, direct } = setting, wash = layer.node.washes[w], before = layer.node.washes.slice(0, w), box = paintingWashBox(wash);
  const history: unknown = wash.wetHistory;
  if (history !== undefined && history !== false) list.error(wash.key, 'wetHistory', `${JSON.stringify(history)} isn't false: a wash keeps a wet history unless it says wetHistory: false`, box);
  else if (!direct && !paintMediumCan(medium, 'wet-history')) list.error(wash.key, 'wetHistory', `needs wetHistory: false: ${medium.name} keeps no wet history`, box);
  for (const field of ['prewet', 'rim'] as const) {
    if (wash[field] === undefined) continue;
    if (direct) list.error(wash.key, field, `${field} needs a wet history: its wash says wetHistory: false`, box);
    else if (!paintMediumCan(medium, 'wet-history')) list.error(wash.key, field, `needs 'wet-history', which ${medium.name} doesn't declare`, box);
  }
  if (!direct && wash.prewet && checkPaintingRegion(list, wash.key, 'prewet.region', wash.prewet.region) && wash.prewet.water !== undefined) {
    checkPaintingAmount(list, wash.key, 'prewet.water', wash.prewet.water, box);
  }
  if (!direct) wash.prewet?.reserves?.forEach((footprint, i) => checkPaintingFootprint(list, wash.key, `prewet.reserves[${i}]`, footprint, setting.styles));
  if (!direct && wash.rim !== undefined && !(wash.rim >= 0 && wash.rim <= 2)) list.error(wash.key, 'rim', `${wash.rim} isn't within 0..2`, box);
  const { clock } = wash, clocked = before.findLast((earlier) => earlier.clock);
  if (clock) {
    const { origin, dryingScale } = clock;
    if (origin !== 'set' && !Number.isFinite(origin)) list.error(wash.key, 'clock.origin', `${origin} isn't a finite scene second or 'set'`, box);
    if (direct && dryingScale !== 'instant') list.error(wash.key, 'clock.dryingScale', `a direct wash's clock is instant, not ${dryingScale}`, box);
    else if (dryingScale !== 'instant' && dryingScale !== 'never' && !(dryingScale > 0 && Number.isFinite(dryingScale))) {
      list.error(wash.key, 'clock.dryingScale', `${dryingScale} isn't above 0, 'instant' or 'never'`, box);
    }
    if (origin === 'set' && !clocked) list.error(wash.key, 'clock', `starts when earlier washes set, and ${layer.node.key} has none before it`, box);
    const latest = latestOrderTime(before, times);
    if (origin !== 'set' && latest && origin < latest.time) list.error(wash.key, 'clock', `starts at ${origin} s, before ${latest.wash.key}'s ${latest.what} at ${latest.time} s`, box);
  }
  if (clocked?.clock?.dryingScale === 'never') list.error(wash.key, 'clock', `follows ${clocked.key}, which never dries`, box);
  else if (clocked && !clock) list.error(wash.key, 'clock', `follows ${clocked.key}, which is clocked: a wash after a clocked wash is clocked too`, box);
}

/**
 * A wash's applications: each one's own checks, then its fixed `at` against its predecessor's order time (its wash's
 * start, or an earlier fixed `at`). The rest of an application's timing is the solver's.
 */
function checkWashApplications(list: PaintingProblemList, wash: Wash, { start }: PaintingWashOrderTimes, setting: PaintingApplicationSetting): void {
  const applications: readonly AnyApplication[] = wash.applications;
  if (applications.length === 0) list.warn(wash.key, 'applications', 'lays nothing');
  let latestAt = -Infinity;
  applications.forEach((application, i) => {
    const owner = paintingApplicationOwner(wash, application, i), box = paintingGeometryBox(application, application.diameterPx);
    checkPaintingApplication(list, owner, application, setting);
    const { at } = application;
    if (at === undefined) return;
    if (!wash.clock) list.error(owner, 'at', 'at needs a clocked wash', box);
    else if (!Number.isFinite(at)) list.error(owner, 'at', `${at} isn't a finite scene second`, box);
    else if (start !== null && at < start) list.error(owner, 'at', `fixed at ${at} s precedes its wash's start ${start} s`, box);
    else if (at < latestAt) list.error(owner, 'at', `fixed at ${at} s precedes its predecessor at ${latestAt} s`, box);
    latestAt = Math.max(latestAt, at);
  });
}

/** A layer's washes in order. */
function checkLayer(list: PaintingProblemList, layer: PaintingLayerPlace, styles: PaintingStyleCatalogue | undefined): void {
  const { node } = layer, medium = PAINT_MEDIA[layer.medium], times = paintingWashOrderTimes(node);
  if (node.washes.length === 0) list.warn(node.key, 'washes', 'paints nothing');
  node.washes.forEach((wash, w) => {
    const setting: PaintingApplicationSetting = { medium, direct: wash.wetHistory === false, ...(styles && { styles }) };
    checkWashFields(list, layer, w, times, setting);
    checkWashApplications(list, wash, times[w], setting);
  });
}

/** Each layer's film held to the pigments a layer's group can hold: its slots read the order's checked mixes. */
function checkLayerPalettes(list: PaintingProblemList, tree: PaintingTree, orders: readonly PaintingSheetOrder[]): void {
  for (const { layer, slots } of orders.flatMap((order) => order.layers)) {
    const { node } = tree.layers[layer], count = slots.palette.length;
    if (count > STAMP_PIGMENT_GROUP_SLOTS) list.error(node.key, 'washes', `mixes ${count} pigments; a layer holds ${STAMP_PIGMENT_GROUP_SLOTS}: split it into two layers`, paintingNodeBox(node));
  }
}

/**
 * `document` checked (with `styles`, its brushes and paper assets too): every problem, and its tree resolved when its
 * shape and keys held.
 */
export function checkPaintingDocument(paintingDocument: PaintingDocument, styles?: PaintingStyleCatalogue): PaintingDocumentCheck {
  const list = new PaintingProblemList();
  checkPaintingTreeAndKeys(list, paintingDocument);
  if (list.hasErrors) return { problems: list.problems, tree: null };
  const tree = paintingTree(paintingDocument);
  checkPaper(list, 'document', 'paper', paintingDocument.paper, styles);
  for (const place of tree.nodes) {
    const { node } = place;
    if (node.sheet?.kind === 'own') checkPaper(list, node.key, 'sheet.paper', node.sheet.paper, styles);
    if (place.kind === 'group' && place.node.children.length === 0) list.warn(node.key, 'children', 'holds nothing');
    if (place.kind === 'layer') checkLayer(list, place, styles);
  }
  if (list.hasErrors) return { problems: list.problems, tree };
  const orders = paintingSheetOrders(tree);
  checkLayerPalettes(list, tree, orders);
  checkPaintingSheetOrders(list, tree, orders, styles);
  return { problems: list.problems, tree };
}
