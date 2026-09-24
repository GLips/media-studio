// project-arg.ts: the project positional every per-project command takes, and the render session most open from it.
// Imported at the top of command files, so lib modules load inside the helper, only when a command runs.
import type { PositionalArgDef } from 'citty';

export const studioProjectArg = {
  type: 'positional',
  required: true,
  description: 'Project slug, part of its name, or a path',
} as const satisfies PositionalArgDef;

/** Bundles the project a command-line argument names, which must have a video.tsx. */
export async function openStudioRenderSession(projectArg: string) {
  const { resolveStudioProjectWith } = await import('../lib/studio-project.ts');
  const { openRenderSession } = await import('../lib/render-session.ts');
  return openRenderSession(resolveStudioProjectWith(projectArg, 'video.tsx'));
}
