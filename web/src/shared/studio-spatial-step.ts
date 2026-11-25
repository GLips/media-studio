/** Where an item sits on screen: its box, as getBoundingClientRect gives it. */
export type StudioItemBox = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

export type StudioStepDirection = 'up' | 'down' | 'left' | 'right';

/** Boxes whose tops differ by less than this share a line: a grid row's tiles, give or take a pixel. */
const SAME_LINE_SLACK = 4;

const centreX = (box: StudioItemBox) => (box.left + box.right) / 2;

/**
 * The item an arrow moves to from `at` among rows and tiles laid out down a page: up and down to the nearest line
 * that way, at the item nearest the current one's centre; left and right to the neighbour on its line. Null at an
 * edge, so the cursor holds; the first item when nothing is focused.
 */
export function studioSpatialStepOf(boxes: readonly StudioItemBox[], at: number | null, direction: StudioStepDirection): number | null {
  if (boxes.length === 0) return null;
  if (at === null) return 0;
  const from = boxes[at];
  const indices = boxes.map((_, i) => i).filter((i) => i !== at);
  if (direction === 'left' || direction === 'right') {
    const sameLine = indices.filter((i) => Math.abs(boxes[i].top - from.top) < SAME_LINE_SLACK);
    const ahead = sameLine.filter((i) => (direction === 'right' ? boxes[i].left >= from.right : boxes[i].right <= from.left));
    const nearest = ahead.toSorted((a, b) => Math.abs(centreX(boxes[a]) - centreX(from)) - Math.abs(centreX(boxes[b]) - centreX(from)));
    return nearest[0] ?? null;
  }
  const beyond = indices.filter((i) => (direction === 'down' ? boxes[i].top >= from.bottom - SAME_LINE_SLACK : boxes[i].bottom <= from.top + SAME_LINE_SLACK));
  if (beyond.length === 0) return null;
  // The nearest line in that direction, then the item on it nearest the current one's centre.
  const lineTop = direction === 'down' ? Math.min(...beyond.map((i) => boxes[i].top)) : Math.max(...beyond.map((i) => boxes[i].top));
  const line = beyond.filter((i) => Math.abs(boxes[i].top - lineTop) < SAME_LINE_SLACK);
  // From a row wider than the line's items (a full-width row onto tiles), aim at its start, where reading begins.
  const itemWidth = boxes[line[0]].right - boxes[line[0]].left;
  const aim = Math.min(centreX(from), from.left + itemWidth / 2);
  return line.toSorted((a, b) => Math.abs(centreX(boxes[a]) - aim) - Math.abs(centreX(boxes[b]) - aim))[0];
}
