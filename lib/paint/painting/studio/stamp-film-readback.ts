// stamp-film-readback.ts: a solved film read back to the CPU (ENGINE 5.1): its coverage as a document-sized array, or
// its picture, premultiplied linear RGBA laid clear or on its sheet's paper and edge. Each is kept per device under
// everything that makes its pixels, the film's key (its solve's last key, finished or open, and its index) first, so
// a rig reading a cel every frame reads it back once.
//
// A sheet's stage is its document, no margin: a film's box is in document px.

import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import type { StampSheetCompositeStep } from '../models/stamp-sheet-program.ts';
import { stampCanonicalJson } from '../models/stamp-sheet-state-key.ts';
import { stampBoxUnion } from '../models/stamp-stage.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { readStampSheetsPicture, type StampSheetLaid, type StampSheetsPicture } from './stamp-sheet-composite.ts';
import { readStampSheetFilm } from './stamp-sheet-films.ts';

/** How many bytes of read-back films each device keeps, the least recently read given up first. */
export const STAMP_FILM_READBACK_BYTES = 256 * 2 ** 20;

/**
 * What a film's picture is laid on: `clear`, paint alone; `sheet`, its sheet's paper and edge, the root's paper
 * covering the document, an own sheet's card as far as its films' union.
 */
export type StampFilmBacking = 'clear' | 'sheet';

/** Where a sheet's paper lies: the root's covers the document; an own sheet's, its films' union (ENGINE 5.2). */
export type StampSheetEdgeKind = 'document' | 'union';

type StampFilmReadbackKept = { value: Promise<Float32Array | StampSheetsPicture>; bytes: number };
const keptOn = new WeakMap<StampPaintGpuOwner, Map<string, StampFilmReadbackKept>>();

/** What `owner` keeps under `key`, else `read()` kept there; least recently read given up past the budget. */
function keptStampFilmReadback<T extends Float32Array | StampSheetsPicture>(owner: StampPaintGpuOwner, key: string, read: () => Promise<T>, costs?: StampPaintCostTally): Promise<T> {
  let kept = keptOn.get(owner);
  if (!kept) keptOn.set(owner, (kept = new Map<string, StampFilmReadbackKept>()));
  const known = kept.get(key);
  costs?.count(known ? 'picture hits' : 'picture misses');
  if (known) {
    kept.delete(key);
    kept.set(key, known);
    // SAFETY: a key names one kind of readback: coverage keys and picture keys differ in their first word.
    return known.value as Promise<T>;
  }
  const value = readStampFilmKept(kept, key, read);
  kept.set(key, { value, bytes: 0 });
  return value;
}

/**
 * `read()`, kept in `held` under `key`: once read its bytes are counted (unless it was given up meanwhile) and the
 * least recently read past the budget given up. A failed read is forgotten.
 */
async function readStampFilmKept<T extends Float32Array | StampSheetsPicture>(held: Map<string, StampFilmReadbackKept>, key: string, read: () => Promise<T>): Promise<T> {
  try {
    const value = await read(), entry = held.get(key);
    if (entry) entry.bytes = (value instanceof Float32Array ? value : value.rgba).byteLength;
    let total = [...held.values()].reduce((sum, { bytes }) => sum + bytes, 0);
    for (const [other, { bytes }] of held) {
      if (total <= STAMP_FILM_READBACK_BYTES || other === key) break;
      held.delete(other);
      total -= bytes;
    }
    return value;
  } catch (error) {
    held.delete(key);
    throw error;
  }
}

/** Film `film` of `sheet`'s coverage (its layer 0's x) over the whole document, row by row; 0 where it never painted. */
export function readStampFilmCoverage(owner: StampPaintGpuOwner, sheet: StampSheetLaid, film: number, costs?: StampPaintCostTally): Promise<Float32Array> {
  const kept = sheet.films[film], { width, height } = sheet.program;
  return keptStampFilmReadback(owner, `coverage ${kept.key}`, async () => {
    const coverage = new Float32Array(width * height), read = await readStampSheetFilm(owner, kept);
    costs?.count('readbacks');
    if (!read || !kept.box) return coverage;
    const { x, y, w, h } = kept.box;
    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) coverage[(y + row) * width + x + column] = read.values[(row * w + column) * 4];
    }
    return coverage;
  }, costs);
}

const emptyPicture = (): StampSheetsPicture => ({ x0: 0, y0: 0, w: 0, h: 0, rgba: new Float32Array(0) });

/**
 * Film `film` of `sheet` (placed nowhere) as a premultiplied linear picture laid on `backing`, its sheet's edge
 * `edge`: over the film's paint box when clear, else over its paper's extent; empty where that's nothing.
 */
export function readStampFilmPicture(
  owner: StampPaintGpuOwner, sheet: StampSheetLaid, film: number, { backing, edge }: { backing: StampFilmBacking; edge: StampSheetEdgeKind }, costs?: StampPaintCostTally,
): Promise<StampSheetsPicture> {
  const { program, films } = sheet, kept = films[film];
  const document: StampPixelBox = { x: 0, y: 0, w: program.width, h: program.height };
  const union = films.reduce<StampPixelBox | null>((all, { box }) => stampBoxUnion(all, box), null);
  const paper = edge === 'document' ? document : union, crop = backing === 'clear' ? kept.box : paper;
  // The backing's identity: its paper, and for a card the films its edge joins.
  const backed = backing === 'clear' ? 'clear' : `sheet ${stampCanonicalJson(program.paper)} ${edge === 'union' ? films.map(({ key }) => key).join('+') : 'document'}`;
  const key = `picture ${kept.key} ${backed} ${crop ? `${crop.x},${crop.y},${crop.w},${crop.h}` : 'none'}`;
  return keptStampFilmReadback(owner, key, async () => {
    if (!crop) return emptyPicture();
    const steps: StampSheetCompositeStep[] = backing === 'sheet' && edge === 'union' ? [{ kind: 'card', sheet: 0 }] : [];
    steps.push({ kind: 'film', sheet: 0, film });
    const picture = await readStampSheetsPicture(owner, { sheets: [{ ...sheet, place: null }], steps }, crop, backing === 'sheet' && edge === 'document');
    costs?.count('readbacks', backing === 'sheet' && edge === 'document' ? 1 : 2);
    return picture;
  }, costs);
}
