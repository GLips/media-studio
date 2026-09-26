// project-arg.ts: the project positional every per-project command takes, and the render session most open from it.
// Imported at the top of command files, so lib modules load inside the helper, only when a command runs.
import type { PositionalArgDef, StringArgDef } from 'citty';

export const studioProjectArg = {
  type: 'positional',
  required: true,
  description: 'Project slug, part of its name, or a path',
} as const satisfies PositionalArgDef;

/** The --workers a rendering command takes: tabs at once, over the video's `renderWorkers` and the default. */
export const renderWorkersArg = {
  type: 'string',
  valueHint: '4',
  description: "Tabs rendering at once, in place of the video's renderWorkers or the default, 3. The tabs share one GPU, so more rarely render faster and leave the machine less to spare",
} as const satisfies StringArgDef;

/** Bundles the project a command-line argument names, which must have a video.tsx; `workers` is a --workers value. */
export async function openStudioRenderSession(projectArg: string, { workers }: { workers?: string } = {}) {
  const { resolveStudioProjectWith } = await import('#engine/project/studio-project.ts');
  const { openRenderSession } = await import('#engine/render/render-session.ts');
  return openRenderSession(resolveStudioProjectWith(projectArg, 'video.tsx'), { workers: workers === undefined ? undefined : Number(workers) });
}
