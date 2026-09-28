// studio review: a project's renders and stills in the studio app (web/), where notes are pinned on them. It opens the
// app already serving this checkout, or serves it here. See lib/engine/web/studio-app-server.ts.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'review',
    description: "Open the studio app on a project's renders and stills to review them: play and frame-step one, click the frame to pin a note at that moment and point, drag the scrubber for a range, or click a sound's marker to note that sound. 'Copy notes' puts them on the clipboard as markdown for a chat, and every change saves to review/notes-<render>.json in the project. A project opens on its newest file (the videos in out/ and out/wip/, the animatic from studio render --animatic among them, and the stills in out/stills/ and out/still-sheets/), and the header switches between them. The app names a file by a hash of its bytes, warns when it's replaced on disk, and stamps each note with the hash it was written on. The scrubber carries the render's timing (scene cuts; beats, the music's downbeats heavier; each cue, replay and landmark, which a click seeks to), and a storyboard under it has a card per scene with its rung, note and stills cut from the render (on each cue, replay and landmark and each voiced line, in timeline.ts's words); a click on a still seeks there. Each note leads with its moment: its scene, the scene's rung, and the cue within 3 frames or else the beat, in timeline.ts's words (bar 4 · blocking · beat 3 +4f · ink.strike2), and names its scene, the sounds within 3 frames and the motion-tagged elements under the point, from the render's own snapshot (<name>.snapshot.json beside it, which studio render writes) and sfx/cues.json, so an old render reads the timeline it was rendered from; a render made with the draft voice says so in a banner. Only a delivered render (studio render) carries the motion; a slice (--frames) is on its own clock, from its first frame. Makes no paid calls.",
  },
  args: {
    target: { type: 'positional', required: true, description: 'A project, or a render or still inside one (.mp4, .webm, .mov, .png, .jpg, .webp)' },
    port: { type: 'string', default: '4317', description: 'Port the studio app is on, or is served on' },
    open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
  },
  async run({ args }) {
    const { resolveStudioReviewTarget } = await import('#engine/review/review-target.ts');
    const { openStudioAppServer } = await import('#engine/web/studio-app-server.ts');
    const target = resolveStudioReviewTarget(args.target);
    const app = await openStudioAppServer({ port: Number(args.port) });
    const url = `${app.url}${target.route}`;
    process.stderr.write([
      `reviewing ${target.project} on ${url}${app.startedHere ? ' (Ctrl-C to stop)' : ', in the studio app already running'}`,
      ...(target.artifacts.length ? ['its renders and stills, newest first (switch in the page header):', ...target.artifacts.map((a) => `  ${a.modified}  ${a.path}`)] : [`${target.project} has made nothing to review yet`]),
    ].join('\n') + '\n');
    if (args.open) {
      const { spawn } = await import('node:child_process');
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    // Serve until interrupted.
    if (app.startedHere) await new Promise(() => {});
  },
});
