// piece-tracks.ts: where a piece is on each frame, read from its model with no render. A project's scene model
// (`bars/<id>-model.ts`) exports a `definePieceTracks`: its scene's key and, given that scene's clock, each piece's
// place at a frame and what its box keeps clear of (the HUD). `studio look --graph=models` samples them over a bar or
// frames. The scene draws from the same model, so the numbers are the picture's, and can't drift from it.
//
// Clearance is the gap from a piece's box to the nearest box it keeps clear of: positive is clear by that many px,
// negative overlaps by that much (the shallower way out).

import type { Rect } from '#lib/picture/camera/models/camera.ts';
import type { ResolvedScene, ResolvedSceneClock } from '#lib/timing/timeline/models/timeline.ts';

/**
 * A piece on one frame: its point in frame px, any other number its model gives (a scale, a squash), a word for its
 * state (a ball's `contact`), and the box it covers, for clearance.
 */
export type PieceSample = { x: number; y: number; values?: Readonly<Record<string, number>>; state?: string; box?: Rect };

/** The piece on its scene's frame `f` (from the scene's origin, as its clock counts), or null while it's out of shot. */
export type PieceTrack = (f: number) => PieceSample | null;

export type ScenePieces = {
  tracks: Readonly<Record<string, PieceTrack>>;
  /** What a piece's box keeps clear of on its scene's frame `f`, by name: a HUD's parts. */
  keepClear?: (f: number) => Readonly<Record<string, Rect>>;
};

export type PieceTracksDefinition = { kind: 'piece-tracks'; scene: string; bind(clock: ResolvedSceneClock): ScenePieces };

/** A scene's piece tracks, bound to the clock the timeline resolves for `scene` (the same one its scene is handed). */
export function definePieceTracks<Clock extends ResolvedSceneClock>(scene: Clock['id'], bind: (clock: Clock) => ScenePieces): PieceTracksDefinition {
  return { kind: 'piece-tracks', scene, bind: bind as (clock: ResolvedSceneClock) => ScenePieces };
}

export const isPieceTracksDefinition = (value: unknown): value is PieceTracksDefinition =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'piece-tracks';

/** How far `a` is from `b`: the gap between them, or minus the shallower overlap where they meet. */
export function rectClearance(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (dx >= 0 || dy >= 0) return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.max(dx, dy);
}

export type PieceClearance = { margin: number; nearest: string };

/** A box's clearance from the nearest of `keepClear`, or null with nothing to keep clear of. */
export function pieceClearance(box: Rect, keepClear: Readonly<Record<string, Rect>>): PieceClearance | null {
  let best: PieceClearance | null = null;
  for (const [name, rect] of Object.entries(keepClear)) {
    const margin = rectClearance(box, rect);
    if (!best || margin < best.margin) best = { margin, nearest: name };
  }
  return best;
}

/** One piece over the video frames asked: its id (`scene/name`), and each frame's sample and clearance. */
export type SampledPiece = {
  id: string;
  scene: string;
  rows: { frame: number; sample: PieceSample | null; clearance: PieceClearance | null }[];
};

/**
 * Each piece of `scenes` over the video's `frames`, where its scene plays them (a model can answer outside its bar,
 * but its scene doesn't draw it there), each asked on its scene's own frame. `pick` keeps pieces whose id contains one
 * of its parts; none keeps all.
 */
export function samplePieceTracks(
  scenes: readonly { scene: Pick<ResolvedScene, 'id' | 'origin' | 'from' | 'to'>; pieces: ScenePieces }[],
  frames: readonly number[],
  pick?: readonly string[],
): SampledPiece[] {
  return scenes.flatMap(({ scene, pieces }) => {
    const own = frames.filter((f) => f >= scene.from && f < scene.to);
    if (!own.length) return [];
    return Object.entries(pieces.tracks)
      .map(([name, track]) => ({ id: `${scene.id}/${name}`, track }))
      .filter(({ id }) => !pick?.length || pick.some((part) => id.includes(part)))
      .map(({ id, track }) => ({
        id, scene: scene.id,
        rows: own.map((frame) => {
          const sample = track(frame - scene.origin);
          const clearance = sample?.box && pieces.keepClear ? pieceClearance(sample.box, pieces.keepClear(frame - scene.origin)) : null;
          return { frame, sample, clearance };
        }),
      }));
  });
}

const fixed = (v: number, digits = 1) => v.toFixed(digits);

/**
 * Each piece as a table, a row a frame: its point, its values and state, and its clearance with the nearest part named.
 * Then, for a boxed piece, its tightest frame. `beatAt` labels each frame with the grid's beat.
 */
export function formatPieceTables(pieces: readonly SampledPiece[], beatAt?: (frame: number) => number): string[] {
  return pieces.flatMap((piece) => {
    const valueKeys = [...new Set(piece.rows.flatMap((r) => Object.keys(r.sample?.values ?? {})))];
    const boxed = piece.rows.some((r) => r.clearance);
    const stated = piece.rows.some((r) => r.sample?.state);
    const head = ['frame', ...(beatAt ? ['beat'] : []), 'x', 'y', ...valueKeys, ...(stated ? ['state'] : []), ...(boxed ? ['clear', 'of'] : [])];
    const body = piece.rows.map(({ frame, sample, clearance }) => [
      String(frame), ...(beatAt ? [fixed(beatAt(frame), 2)] : []),
      ...(sample
        ? [fixed(sample.x), fixed(sample.y), ...valueKeys.map((k) => (sample.values?.[k] === undefined ? '' : fixed(sample.values[k], 3))), ...(stated ? [sample.state ?? ''] : [])]
        : ['—', '—', ...valueKeys.map(() => ''), ...(stated ? ['out of shot'] : [])]),
      ...(boxed ? (clearance ? [fixed(clearance.margin), clearance.nearest] : ['', '']) : []),
    ]);
    const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join('  ').trimEnd();
    const tightest = piece.rows.filter((r) => r.clearance).sort((a, b) => a.clearance!.margin - b.clearance!.margin)[0];
    return [
      piece.id,
      line(head),
      ...body.map(line),
      ...(tightest ? [`tightest: frame ${tightest.frame}, ${fixed(tightest.clearance!.margin)} px ${tightest.clearance!.margin < 0 ? 'into' : 'from'} ${tightest.clearance!.nearest}`] : []),
      '',
    ];
  });
}
