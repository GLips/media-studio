// painting-reveal-seam-check.ts: a field reveal on a wrapped document, held to its seams (docs/painting-authoring.md,
// Wrapping and Reveals). A field is read at each texel's own document px and has no period, so a mark crossing a
// seam arrives in two halves wherever the field's arrivals on the seam's two edges differ. A strokes reveal wraps
// with its paint (stampRevealSegments), so only fields are held here.

import { stampRevealFieldArrival, type StampReveal } from '#lib/paint/painting/models/stamp-reveal.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { stampWrapsAcross, type StampAxis, type StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import type { AnyApplication, LayerNode, PaintingDocument } from './painting-document.ts';
import { paintingBoxUnion, paintingGeometryBox } from './painting-footprint.ts';
import { paintingApplicationOwner, type PaintingProblemList } from './painting-problem.ts';
import { paintingStampReveal } from './painting-reveal-profile.ts';
import type { PaintingTree } from './painting-tree.ts';

/** Arrivals closer than this across a seam split a mark on one frame at most, at up to 60 fps: too brief to see. */
const PAINTING_REVEAL_SEAM_SPLIT_S = 1 / 60;

type FieldReveal = Extract<StampReveal, { kind: 'field' }>;

/**
 * Where a document's edges meet on `axis`, every `period` px along it; `side`, the frame's px across it, and whether
 * that axis wraps too.
 */
type RevealSeam = { readonly axis: StampAxis; readonly period: number; readonly side: number; readonly acrossWraps: boolean };

/** A field's arrivals at a seam's two edges, at axis 0 and at its period, on texel row (column, for a y seam) `row`. */
type SeamArrivals = { readonly row: number; readonly low: number; readonly high: number };

const seamApart = ({ low, high }: SeamArrivals) => Math.abs(high - low);
const mostApart = (found: SeamArrivals | null, each: SeamArrivals) => (!found || seamApart(each) > seamApart(found) ? each : found);
const otherAxis = (axis: StampAxis): StampAxis => (axis === 'x' ? 'y' : 'x');
const boxSpan = (box: StampBox, axis: StampAxis): [number, number] => (axis === 'x' ? [box.x0, box.x1] : [box.y0, box.y1]);

/** The seams `wrap` makes on a document `widthPx` × `heightPx`. */
function revealSeams({ widthPx, heightPx }: PaintingDocument, wrap: StampWrap): RevealSeam[] {
  return (['x', 'y'] as const).filter((axis) => stampWrapsAcross(wrap, axis)).map((axis) => ({
    axis, period: axis === 'x' ? widthPx : heightPx, side: axis === 'x' ? heightPx : widthPx, acrossWraps: stampWrapsAcross(wrap, otherAxis(axis)),
  }));
}

/** Whether `box` crosses `seam`: a whole multiple of its period lies inside the box along its axis. */
function crossesSeam(box: StampBox, { axis, period }: RevealSeam): boolean {
  const [low, high] = boxSpan(box, axis);
  return (Math.floor(low / period) + 1) * period < high;
}

/**
 * The texel rows `box` lies on across `seam`, as the frame holds them: taken round the frame where that axis wraps
 * too, else only those inside it. Nearest the box's middle first, so rows the field reads alike name its middle.
 */
function seamRows(box: StampBox, { axis, side, acrossWraps }: RevealSeam): number[] {
  const [low, high] = boxSpan(box, otherAxis(axis)), first = Math.floor(low), middle = Math.floor((low + high) / 2);
  const rows = Array.from({ length: Math.max(0, Math.ceil(high) - first) }, (_, k) => first + k).toSorted((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
  return [...new Set(acrossWraps ? rows.map((row) => ((row % side) + side) % side) : rows.filter((row) => row >= 0 && row < side))];
}

/** A mark crossing a seam where its field arrives apart: its name, its box, and the row its edges differ most on. */
type SeamTear = { readonly owner: string; readonly box: StampBox; readonly most: SeamArrivals };

/** The marks under `node` crossing `seam` where `reveal` arrives more than PAINTING_REVEAL_SEAM_SPLIT_S apart on its edges. */
function seamTears(tree: PaintingTree, node: LayerNode, reveal: FieldReveal, seam: RevealSeam): SeamTear[] {
  const read = new Map<number, SeamArrivals>();
  const arrivalsOn = (row: number): SeamArrivals => {
    const at = (edge: number) => (seam.axis === 'x' ? stampRevealFieldArrival(reveal, edge, row + 0.5) : stampRevealFieldArrival(reveal, row + 0.5, edge));
    const arrivals = read.get(row) ?? { row, low: at(0), high: at(seam.period) };
    read.set(row, arrivals);
    return arrivals;
  };
  const layers = tree.layers.filter(({ node: layer, groups }) => layer.key === node.key || groups.includes(node.key));
  return layers.flatMap(({ node: layer }) => layer.washes.flatMap((wash) => {
    const applications: readonly AnyApplication[] = wash.applications;
    return applications.flatMap((application, i): SeamTear[] => {
      const box = paintingGeometryBox(application, application.diameterPx);
      const most = box && crossesSeam(box, seam) ? seamRows(box, seam).map(arrivalsOn).reduce<SeamArrivals | null>(mostApart, null) : null;
      return box && most && seamApart(most) > PAINTING_REVEAL_SEAM_SPLIT_S ? [{ owner: paintingApplicationOwner(wash, application, i), box, most }] : [];
    });
  }));
}

/** A scene second in a message: to a hundredth. */
const seconds = (value: number) => `${value.toFixed(2)} s`;

/**
 * Each field reveal on a wrapped document whose marks crossing a seam arrive in two halves, warned once a node and
 * seam: the edge arrivals that differ most, and the marks crossing. Expects a document whose reveals and
 * applications are checked.
 */
export function checkPaintingRevealSeams(list: PaintingProblemList, paintingDocument: PaintingDocument, tree: PaintingTree): void {
  const { wrap } = paintingDocument;
  if (!wrap) return;
  for (const { node } of tree.nodes) {
    const reveal = node.reveal && paintingStampReveal(node.reveal);
    if (reveal?.kind !== 'field') continue;
    for (const seam of revealSeams(paintingDocument, wrap)) {
      const tears = seamTears(tree, node, reveal, seam), worst = tears.map(({ most }) => most).reduce<SeamArrivals | null>(mostApart, null);
      if (!worst) continue;
      const { axis, period } = seam, [first, ...rest] = tears;
      const crossing = rest.length === 0 ? `${first.owner}, crossing the seam, arrives` : `${first.owner} and ${rest.length} more marks, crossing the seam, arrive`;
      const box = tears.reduce<StampBox | undefined>((union, tear) => paintingBoxUnion(union, tear.box), undefined);
      list.warn(
        node.key, 'reveal',
        `a field arrives at ${axis} 0 at ${seconds(worst.low)} and at ${axis} ${period} at ${seconds(worst.high)} (${otherAxis(axis)} ${worst.row}), so ${crossing} in two halves: keep marks off the seam, or reveal by strokes, which wrap`,
        box,
      );
    }
  }
}
