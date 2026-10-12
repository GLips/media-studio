// studio review open: the studio app on a project's renders and stills, where the reviewer pins notes. It opens the
// app already serving this checkout, or serves it here. See lib/platform/web/engine/studio-app-server.ts.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';

const reviewOpenArgs = {
  target: { type: 'positional', required: true, description: 'A project, or a render or still inside one (.mp4, .webm, .mov, .png, .jpg, .webp)' },
  port: { type: 'string', default: '4317', description: 'Port the studio app is on, or is served on' },
  open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
} as const satisfies ArgsDef;

export const reviewOpenCommand = defineCommand({
  meta: {
    name: 'open',
    description: "Open the studio app on a project's renders and stills: a project lands on its page, a file on its review. The reviewer plays and frame-steps a render (keys as in an NLE; ? lists them), pins a note at a moment, a range or a point, draws on the frame, and sees the agent's replies land live; every change saves to review/review.json at once, with the frame as seen in review/frames/. Notes are kept per project and carried to each new render by their moment (scene, beat, cue or word, from the render's snapshot), so animatic notes show on the final. A newer render loads by itself unless a note is being written; earlier renders are kept in out/.history/ to compare against. Makes no paid calls.",
  },
  args: reviewOpenArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs.filter((arg) => arg !== '--no-open'), reviewOpenArgs);
    const { resolveStudioReviewTarget } = await import('#lib/output/review/engine/review-target.ts');
    const { openStudioAppServer } = await import('#lib/platform/web/engine/studio-app-server.ts');
    const target = resolveStudioReviewTarget(args.target);
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
