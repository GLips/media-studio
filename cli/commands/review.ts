// studio review: a project's review, in the studio app and from an agent's side. `open` shows the reviewer the
// project's renders and stills; the rest are the agent's half of the loop over review/review.json: read the notes,
// watch for new ones, reply, ask, and post decisions for the reviewer to choose. Each verb is in cli/commands/review/.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'review',
    description: "A project's review in review/review.json: the reviewer pins notes and picks between candidates in the studio app (open), and an agent works them with watch, reply, ask and decide (the video-motion skill's review loop).",
  },
  subCommands: {
    open: () => import('./review/open.ts').then((m) => m.reviewOpenCommand),
    notes: () => import('./review/notes.ts').then((m) => m.reviewNotesCommand),
    watch: () => import('./review/watch.ts').then((m) => m.reviewWatchCommand),
    reply: () => import('./review/reply.ts').then((m) => m.reviewReplyCommand),
    ask: () => import('./review/ask.ts').then((m) => m.reviewAskCommand),
    decide: () => import('./review/decide.ts').then((m) => m.reviewDecideCommand),
    decisions: () => import('./review/decisions.ts').then((m) => m.reviewDecisionsCommand),
  },
});
