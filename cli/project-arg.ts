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

/** The --lens a rendering command takes: how its frames draw the lens. */
export const renderLensArg = {
  type: 'string',
  valueHint: 'fast',
  description: 'How the lens draws: fast (each frame once, defocus and motion blur drawn directly; the default) or reference (exposures averaged over the shutter and aperture, slow, the truth fast is measured against)',
} as const satisfies StringArgDef;

/**
 * Bundles the project a command-line argument names, which must have a video.tsx; `workers` is a --workers value,
 * `lens` a --lens one, `paintings` a --set of `painting.property=value` pairs (painting-value-overrides.ts).
 */
export async function openStudioRenderSession(projectArg: string, { workers, lens, paintings }: { workers?: string; lens?: string; paintings?: string } = {}) {
  const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
  const { openRenderSession } = await import('#lib/output/render/engine/render-session.ts');
  const { lensModeChecked } = await import('#lib/picture/lens/models/lens-mode.ts');
  const { readPaintingValueOverrides } = await import('#lib/paint/document/engine/painting-value-overrides.ts');
  const project = resolveStudioProjectWith(projectArg, 'video.tsx');
  return openRenderSession(project, {
    workers: workers === undefined ? undefined : Number(workers), lens: lens === undefined ? undefined : lensModeChecked(lens),
    ...(paintings !== undefined && { paintingValues: await readPaintingValueOverrides(project, paintings) }),
  });
}
