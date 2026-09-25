// render-bars.ts: chosen bars of the showcase, each rendered from the reel itself into <out>/0N.mp4 (default
// out/wip/bars/), silent and without `studio render`'s framing check or mix: re-render the bars a change touched,
// then join-bars.sh makes the WIP cut. A bar is the reel's own frame range, so it's what `studio render` draws.
//   node projects/2026-09-motion-showcase/tools/render-bars.ts [N ...] [--out=<dir>]
// Two renders of the same code aren't bit for bit alike: compare renders with render-diff.py, not by eye on a mean.
import '../../../lib/studio/tsx-test-hooks.ts';
import { renderMedia } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RENDER_CHROMIUM, RENDER_CONCURRENCY, openRenderSession } from '../../../lib/render-session.ts';
import type { Bar } from '../bar.ts';

const PROJECT = resolve(import.meta.dirname, '..');
const { showcaseBars }: { showcaseBars: Bar[] } = await import('../video.tsx');

const args = process.argv.slice(2);
const out = resolve(args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? join(PROJECT, 'out/wip/bars'));
const picked = args.filter((a) => !a.startsWith('--')).map(Number);
for (const n of picked) if (!showcaseBars[n - 1]) throw new Error(`no bar ${n}: the showcase has bars 1–${showcaseBars.length}`);

mkdirSync(out, { recursive: true });
const session = await openRenderSession(PROJECT);
const inputProps = session.props();
const composition = await session.compositionFor(inputProps);
for (const n of picked.length ? picked : showcaseBars.map((_, i) => i + 1)) {
  const bar = showcaseBars[n - 1];
  const file = join(out, `0${n}.mp4`);
  await renderMedia({
    composition, serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps,
    codec: 'h264', crf: 20, muted: true, frameRange: [bar.from, bar.to - 1], outputLocation: file, onProgress: () => {},
  });
  console.log(file);
}
