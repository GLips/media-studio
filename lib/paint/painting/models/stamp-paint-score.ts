// stamp-paint-score.ts: when each deposit shows. A passage's applications form a tree (an apply over its calls, a
// technique over the raw ops it writes, a raw op over its one deposit); each passes its interval of scene time down
// to its children by weight, and the leaves' intervals are their deposits' reveals.
//
// Scene time only: a wait advances painting time (stamp-wetness.ts) and costs the score nothing.

/**
 * When an application shows, in scene seconds. `static`: there from the start. `{ at, over }`: its automatic
 * children share `over` by weight, so a new sibling redistributes the rest. `{ at, secondsPerWeight }`: each weight
 * is that long, so a new sibling extends it. No reveal anywhere above an application means it's static.
 */
export type StampReveal = { kind: 'static' } | { at: number; over: number } | { at: number; secondsPerWeight: number };

/**
 * How an application's automatic children share its interval. `sequence`: one after another, each as long as its
 * weight's share. `together`: each over the whole interval. `{ overlap }`: in sequence, each drawn over `overlap`
 * times its share, as a hand's marks overlap, the whole scaled so the latest to end ends with the interval.
 */
export type StampChildTiming = 'sequence' | 'together' | { overlap: number };

/**
 * An application's place in the score. `weight` (finite, > 0): its share among its automatic siblings; a raw op's
 * and a technique's default 1, a grouping apply's its children's sum (their most, laid together). `reveal`: an
 * exact override, taking no share of its parent's interval. `children`: how its automatic children share its own.
 */
export type StampScoreOptions = { weight?: number; reveal?: StampReveal; children?: StampChildTiming };

/**
 * An application as the builder records it. A grouping apply with no score options of its own is transparent: its
 * children stand among its siblings as if written there, so wrapping calls in one changes no interval. A technique
 * never is: its weight is one application's, however many marks it lays.
 */
export type StampScoreNode<D> = {
  path: string;
  score: StampScoreOptions;
  kind: 'apply' | 'technique' | 'op';
  /** A raw op's deposits: its one, or none (a stroke masked away still has its deposit). */
  deposits: D[];
  children: StampScoreNode<D>[];
  /** A technique's own way of sharing its interval when its call doesn't say. */
  timing?: StampChildTiming;
  /** A technique's default weight when its call doesn't say. */
  weight?: number;
};

/** A deposit's reveal as compiled (StampDepositReveal's successor): from `at`, drawn over `over` (0 lands whole). */
export type StampAllocatedReveal = { at: number; over: number };

type Interval = { a: number; d: number } | null;

/**
 * Every deposit under `root` (a passage) with its reveal, absent for one that's static. Throws, naming the
 * application, on a weight that isn't finite and positive, an overlap that isn't, or a reveal out of range.
 */
export function allocateStampScore<D>(root: StampScoreNode<D>): Map<D, StampAllocatedReveal> {
  const reveals = new Map<D, StampAllocatedReveal>();
  const visit = (node: StampScoreNode<D>, interval: Interval, inherited: StampChildTiming) => {
    for (const deposit of node.deposits) if (interval) reveals.set(deposit, { at: interval.a, over: interval.d });
    const timing = ownTiming(node, inherited);
    const automatic = laidChildren(node).filter((child) => !child.score.reveal);
    const { places, envelope } = stampScoreLayout(automatic.map((child) => weightOf(child, timing)), timing);
    automatic.forEach((child, i) => visit(child, interval && share(interval, places[i], envelope), timing));
    for (const child of laidChildren(node)) if (child.score.reveal) visit(child, overridden(child, timing), timing);
  };
  visit(root, root.score.reveal ? overridden(root, 'sequence') : null, 'sequence');
  return reveals;
}

/** How `node` shares its interval: as it says, a technique as it's made to, else as its parent does. */
const ownTiming = <D>(node: StampScoreNode<D>, inherited: StampChildTiming): StampChildTiming => {
  const timing = node.score.children ?? node.timing ?? inherited;
  if (typeof timing === 'object' && !(timing.overlap > 0 && Number.isFinite(timing.overlap))) {
    throw new Error(`stamp paint: ${node.path}'s children overlap by ${timing.overlap}, and an overlap is finite and above 0`);
  }
  return timing;
};

/** Whether `node` stands aside for its children: a grouping apply with no score options of its own. */
const transparent = <D>(node: StampScoreNode<D>) => node.kind === 'apply' && node.score.weight === undefined && !node.score.reveal && !node.score.children;

/** Whether anything under `node` lays a deposit: an empty application takes no share. */
const lays = <D>(node: StampScoreNode<D>): boolean => node.deposits.length > 0 || node.children.some(lays);

/** `node`'s children as its interval is shared among them: transparent ones' own children in their place, empty ones gone. */
function laidChildren<D>(node: StampScoreNode<D>): StampScoreNode<D>[] {
  return node.children.flatMap((child) => {
    if (transparent(child)) return laidChildren(child);
    return lays(child) ? [child] : [];
  });
}

/** `node`'s weight among siblings sharing by `timing`: its own, a technique's default, or its children's sum (most, together). */
function weightOf<D>(node: StampScoreNode<D>, timing: StampChildTiming): number {
  const weight = node.score.weight ?? node.weight;
  if (weight !== undefined) {
    if (!(weight > 0 && Number.isFinite(weight))) throw new Error(`stamp paint: ${node.path} weighs ${weight}, and a weight is finite and above 0`);
    return weight;
  }
  if (node.kind === 'op') return 1;
  const own = ownTiming(node, timing), weights = laidChildren(node).filter((child) => !child.score.reveal).map((child) => weightOf(child, own));
  return own === 'together' ? Math.max(0, ...weights) : weights.reduce((sum, w) => sum + w, 0);
}

/**
 * Where each of `weights` falls in weight units under `timing`, and the envelope they span: in sequence end to end;
 * together all over the longest; overlapping, each started where it would be in sequence and drawn `overlap` times
 * as long.
 */
export function stampScoreLayout(weights: readonly number[], timing: StampChildTiming): { places: { start: number; length: number }[]; envelope: number } {
  if (timing === 'together') {
    const envelope = Math.max(0, ...weights);
    return { places: weights.map(() => ({ start: 0, length: envelope })), envelope };
  }
  const stretch = timing === 'sequence' ? 1 : timing.overlap;
  let cursor = 0, envelope = 0;
  const places = weights.map((weight) => {
    const place = { start: cursor, length: weight * stretch };
    cursor += weight;
    envelope = Math.max(envelope, place.start + place.length);
    return place;
  });
  return { places, envelope };
}

/** A child's share of `interval`, from `start` for `length` of `envelope` weight units. The whole of it is exactly it. */
function share({ a, d }: NonNullable<Interval>, { start, length }: { start: number; length: number }, envelope: number): Interval {
  return { a: start ? a + (d * start) / envelope : a, d: length === envelope ? d : (d * length) / envelope };
}

/** The interval `node`'s own reveal gives it: per weight, as long as its children's envelope (its weight, with none). */
function overridden<D>(node: StampScoreNode<D>, timing: StampChildTiming): Interval {
  const reveal = node.score.reveal!;
  if ('kind' in reveal) return null;
  if (!Number.isFinite(reveal.at)) throw new Error(`stamp paint: ${node.path} reveals at ${reveal.at}, and a reveal starts at a finite second`);
  if ('over' in reveal) {
    if (!(reveal.over >= 0 && Number.isFinite(reveal.over))) throw new Error(`stamp paint: ${node.path} reveals over ${reveal.over}s, and a reveal takes a finite 0 or more`);
    return { a: reveal.at, d: reveal.over };
  }
  if (!(reveal.secondsPerWeight >= 0 && Number.isFinite(reveal.secondsPerWeight))) {
    throw new Error(`stamp paint: ${node.path} reveals ${reveal.secondsPerWeight}s a weight, and that's a finite 0 or more`);
  }
  const own = ownTiming(node, timing), children = laidChildren(node).filter((child) => !child.score.reveal);
  const envelope = children.length ? stampScoreLayout(children.map((child) => weightOf(child, own)), own).envelope : weightOf(node, timing);
  return { a: reveal.at, d: reveal.secondsPerWeight * envelope };
}
