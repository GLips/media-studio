// render-ledger.ts: what a render command keeps of its project apart from any page: the project's clock and whether
// it's silent, read once, and the timed passes it reports at the end. A render session (render-session.ts) opens one
// and bundles; a command whose frames are drawn elsewhere (remote-render) opens only this, and never a browser.
import { readProjectDeclaration } from '#lib/platform/project/engine/studio-project.ts';
import { readProjectClock } from './project-clock.ts';

/** One timed pass of a command's renders: `workers` and `gpu` where it rendered frames. */
export type RenderPass = { pass: string; seconds: number; workers?: number; gpu?: string };

export type RenderLedger = Awaited<ReturnType<typeof openRenderLedger>>;

/**
 * The ledger of a render command on `project`. Its clock is read now, so every snapshot the command writes holds the
 * clock its renders were made on.
 */
export async function openRenderLedger(project: string) {
  const opened = performance.now();
  const clock = (await readProjectClock(project)) ?? null;
  const declaration = await readProjectDeclaration(project);
  // A silent video delivers with no mix and no audio track (render-pipeline.ts).
  const silent = declaration?.capability === 'silent', paints = Boolean(declaration?.styles?.length);
  const passes: RenderPass[] = [];

  /** Runs `run` and records it as `pass`. */
  async function timed<T>(pass: string, run: () => Promise<T> | T, more: Omit<RenderPass, 'pass' | 'seconds'> = {}): Promise<T> {
    const started = performance.now();
    const result = await run();
    passes.push({ pass, seconds: (performance.now() - started) / 1000, ...more });
    return result;
  }

  return { project, clock, silent, paints, opened, passes, timed };
}
