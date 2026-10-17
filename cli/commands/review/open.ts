// studio review open: the studio app on a project's renders and stills, where the reviewer pins notes, or on its plan,
// handed over. It opens the app already serving this checkout, or serves it here. See
// lib/platform/web/engine/studio-app-server.ts.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';

/** The app route that reviews `target`, and what the project holds, newest first, for the command to print. */
type StudioReviewTarget = { route: string; project: string; artifacts: { path: string; modified: string }[] };

/**
 * A path to a file reviews that file, at its route in the app; anything else names a project as `studio` commands do,
 * landing on its project page, or with `plan` on its plan page, having handed the plan over.
 */
async function resolveStudioReviewTarget(target: string, plan: boolean): Promise<StudioReviewTarget> {
  const { existsSync, realpathSync, statSync } = await import('node:fs');
  const { join, relative, resolve, sep } = await import('node:path');
  const { resolveStudioProject, STUDIO_PROJECTS_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
  const { listProjectArtifacts } = await import('#lib/output/review/engine/project-artifacts.ts');
  const { projectMediaTypeOf } = await import('#lib/output/review/engine/project-media.ts');
  const file = resolve(target);
  if (existsSync(file) && statSync(file).isFile()) {
    if (plan) throw new Error(`--plan opens a project's plan, not a file: give the project, as in studio review open <p> --plan`);
    // With no work/projects/ (a fresh clone), every file is outside it.
    const [project, ...path] = existsSync(STUDIO_PROJECTS_DIR) ? relative(realpathSync(STUDIO_PROJECTS_DIR), realpathSync(file)).split(sep) : ['..'];
    if (project === '..' || !path.length || !projectMediaTypeOf(file)) {
      throw new Error(`${target} isn't a render or still inside a project under work/projects/: studio review opens a project's files`);
    }
    return { route: `/projects/${encodeURIComponent(project)}/artifacts/${path.map(encodeURIComponent).join('/')}`, project, artifacts: listProjectArtifacts(project) };
  }
  const [project, ...rest] = relative(STUDIO_PROJECTS_DIR, resolveStudioProject(target)).split(sep);
  if (project === '..' || rest.length) throw new Error(`${target} isn't a project under work/projects/`);
  if (plan) {
    const { handOverReviewPlan } = await import('#lib/output/review/engine/review-dashboard.ts');
    const revision = handOverReviewPlan(join(STUDIO_PROJECTS_DIR, project));
    process.stderr.write(`handed ${project}'s plan over: its unsigned scenes now wait on the reviewer (revision ${revision})\n`);
    return { route: `/projects/${encodeURIComponent(project)}/plan`, project, artifacts: listProjectArtifacts(project) };
  }
  return { route: `/projects/${encodeURIComponent(project)}`, project, artifacts: listProjectArtifacts(project) };
}

const reviewOpenArgs = {
  target: { type: 'positional', required: true, description: 'A project, or a render or still inside one (.mp4, .webm, .mov, .png, .jpg, .webp)' },
  plan: { type: 'boolean', description: "Hand the project's plan (storyboard.ts) over for review and open its page: until then its unsigned scenes wait on no one" },
  port: { type: 'string', default: '4317', description: 'Port the studio app is on, or is served on' },
  open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
} as const satisfies ArgsDef;

export const reviewOpenCommand = defineCommand({
  meta: {
    name: 'open',
    description: "Open the studio app on a project, or on one of its renders or stills, for the reviewer.",
    about: "A project lands on its page, a file on its review; --plan hands the plan over, which puts it in the reviewer's Awaiting list, and lands on it. The reviewer plays and frame-steps a render (keys as in an NLE; ? lists them), pins a note at a moment, a range or a point, draws on the frame, and sees the agent's replies land live; every change saves to review/review.json at once, with the frame as seen in review/frames/. A newer render loads by itself unless a note is being written; earlier renders are kept in out/.history/ to compare against. Makes no paid calls.",
  },
  args: reviewOpenArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs.filter((arg) => arg !== '--no-open'), reviewOpenArgs);
    const { openStudioAppServer } = await import('#lib/platform/web/engine/studio-app-server.ts');
    const target = await resolveStudioReviewTarget(args.target, args.plan === true);
    const app = await openStudioAppServer({ port: Number(args.port) });
    const url = `${app.url}${target.route}`;
    process.stderr.write([
      `reviewing ${target.project} on ${url}${app.startedHere ? ' (Ctrl-C to stop)' : ', in the studio app already running'}`,
      ...(target.artifacts.length ? ['its renders and stills, newest first:', ...target.artifacts.map((a) => `  ${a.modified}  ${a.path}`)] : [`${target.project} has made nothing to review yet`]),
      `an agent follows the notes with: studio review watch ${target.project}`,
    ].join('\n') + '\n');
    if (args.open) {
      const { spawn } = await import('node:child_process');
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    // Serve until interrupted.
    if (app.startedHere) await new Promise(() => {});
  },
});
