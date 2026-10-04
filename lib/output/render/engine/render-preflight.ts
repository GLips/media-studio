// render-preflight.ts: what a render checks before it bundles or queues for the GPU, so a problem the static check
// finds in a second fails in a second, not after the wait: every painting source the project's scenes paint from,
// checked as `studio paint check` checks it at its defaults, and the styles its project.ts names. Node only.

import { basename, join } from 'node:path';
import { checkPaintingSourceFile } from '#lib/paint/document/engine/painting-source-load.ts';
import { paintingErrors, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { projectStyleProblems } from '#lib/paint/style/engine/project-styles.ts';
import { listProjectPaintingSources, readProjectDeclaration } from '#lib/platform/project/engine/studio-project.ts';

/**
 * Refuses a project whose paintings or styles have an error, naming every one, a painting's after its file; returns
 * how many paintings it checked. Warnings don't refuse: `studio paint check <file>` lists them.
 */
export async function refuseProjectPaintingErrors(project: string): Promise<number> {
  // A painting timed by the project's timeline imports the track's audio, which only the hooks let Node load.
  await import('./tsx-test-hooks.ts');
  const declaration = await readProjectDeclaration(project);
  const sources = listProjectPaintingSources(project, declaration?.shared ?? []);
  const problems = [...(await Promise.all(sources.map(async (source) => {
    try {
      const { problems: found } = await checkPaintingSourceFile(join(project, source), {});
      return paintingErrors(found).map((problem) => `${source}: ${paintingProblemText(problem)}`);
    } catch (error) {
      // The author's code threw as it loaded or ran; one painting's throw mustn't hide the others' problems.
      return [`${source}: ${error instanceof Error ? error.message : String(error)}`];
    }
  }))).flat(), ...projectStyleProblems(project)];
  if (!problems.length) return sources.length;
  const count = `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`;
  throw new Error([
    `${basename(project)} can't render: ${count} in its paintings and styles (\`studio paint check <file>\` shows a painting's warnings too, and where a throw came from):`,
    ...problems,
  ].join('\n'));
}
