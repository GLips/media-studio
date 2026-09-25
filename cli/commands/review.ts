// studio review: a local page for pinning notes on a render or a still, which copies them as markdown for a chat and
// saves them to the project's review/notes-<render>.json. See lab/review/server.ts.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'review',
    description: "Open a page to review a render or a still: play and frame-step it, click the frame to pin a note at that moment and point, drag the scrubber for a range, or click a sound's marker to note that sound. 'Copy notes' puts them on the clipboard as markdown for a chat, and every change saves to review/notes-<render>.json in the project. In a project, each note names its scene, the sounds within 3 frames and the motion-tagged elements under the point, from out/check/timeline.json, sfx/cues.json and out/check/motion.json (studio check writes them). Makes no paid calls.",
  },
  args: {
    target: { type: 'positional', required: true, description: 'A render or still (.mp4, .webm, .mov, .png, .jpg, .webp), or a project, whose out/video.mp4 is reviewed' },
    port: { type: 'string', default: '4318', description: 'Port to serve on' },
    open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
  },
  async run({ args }) {
    const { resolveReviewTarget, startStudioReview } = await import('../../lab/review/server.ts');
    const target = resolveReviewTarget(args.target);
    const { url } = await startStudioReview({ target, port: Number(args.port) });
    process.stderr.write(`reviewing ${target.media} on ${url} (Ctrl-C to stop); notes save to ${target.notesFile}\n`);
    if (args.open) {
      const { spawn } = await import('node:child_process');
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    // Serve until interrupted.
    await new Promise(() => {});
  },
});
