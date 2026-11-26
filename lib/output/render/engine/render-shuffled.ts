// render-shuffled.ts: proves a span of frames draws alike in turn and shuffled. A render's tabs each draw every Nth
// frame, and a reply slice starts mid-scene, so a frame reading anything a frame before it left behind (a cache
// filled in order, an effect's history) differs between the two orders.

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import { measureWithFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { RenderSession } from './render-session.ts';

/** Frames `from` to `to` inclusive in an order seeded by `seed`, the same each run (Fisher–Yates). */
export function renderFramesShuffled(from: number, to: number, seed: number): number[] {
  const frames = Array.from({ length: to - from + 1 }, (_, i) => from + i), random = seededRandom(seed);
  for (let i = frames.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [frames[i], frames[j]] = [frames[j], frames[i]];
  }
  return frames;
}

/**
 * Draws frames `from` to `to` (inclusive) in turn and in a seeded shuffle, each order in one tab, and compares every
 * frame's two renders: equal over 50 dB PSNR, from PNGs. Keeps each differing pair in out/check/shuffled/, and times
 * both orders.
 */
export async function checkFramesShuffled(session: RenderSession, from: number, to: number): Promise<{ ok: boolean; report: string[] }> {
  const { durationInFrames, fps } = await session.compositionFor(session.props());
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to < durationInFrames)) {
    throw new Error(`frames ${from}:${to} aren't a span of the video's ${durationInFrames} frames`);
  }
  const inTurn = Array.from({ length: to - from + 1 }, (_, i) => from + i), shuffled = renderFramesShuffled(from, to, from * 7919 + to);
  const kept = join(session.project, 'out', 'check', 'shuffled');
  rmSync(kept, { recursive: true, force: true });
  const { worst, ms } = await withStudioTemp('shuffled', async (dir) => {
    const timed = async (name: string, order: number[]) => {
      const started = performance.now(), { fileFor } = await session.renderReplay(join(dir, name), order);
      const files = new Map(order.map((frame, i) => [frame, fileFor(i)]));
      return { files, ms: performance.now() - started };
    };
    const turn = await timed('in-turn', inTurn), shuffle = await timed('shuffled', shuffled);
    const differing: { frame: number; db: number }[] = [];
    for (const frame of inTurn) {
      const a = turn.files.get(frame)!, b = shuffle.files.get(frame)!;
      const { stderr } = measureWithFfmpeg(['-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-']);
      const db = Number(/average:(\S+)/.exec(stderr)![1].replace('inf', 'Infinity'));
      if (db === Infinity) continue;
      differing.push({ frame, db });
      mkdirSync(kept, { recursive: true });
      copyFileSync(a, join(kept, `frame-${frame}-in-turn.png`));
      copyFileSync(b, join(kept, `frame-${frame}-shuffled.png`));
    }
    return { worst: differing.toSorted((a, b) => a.db - b.db), ms: { turn: turn.ms, shuffle: shuffle.ms } };
  });
  const count = to - from + 1, ok = worst.every(({ db }) => db > 50);
  const report = [
    `  frames ${from}:${to} (${(from / fps).toFixed(2)}–${((to + 1) / fps).toFixed(2)} s), ${count} drawn twice, in one tab each`,
    `  in turn ${(ms.turn / 1000).toFixed(1)} s, shuffled ${(ms.shuffle / 1000).toFixed(1)} s`,
    worst.length ? `  ${worst.length} differ at all; worst ${worst.slice(0, 5).map(({ frame, db }) => `${frame} (${db.toFixed(1)} dB)`).join(', ')}: ${kept}` : '  every frame identical',
    ok ? 'in turn and shuffled alike ✓' : 'not alike: a frame reads something the frames drawn before it left behind',
  ];
  return { ok, report };
}
