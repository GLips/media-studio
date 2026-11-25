// studio review: a project's review, in the studio app and from an agent's side. `open` shows the reviewer the
// project's renders and stills; the rest are the agent's half of the loop over review/review.json: read the notes,
// watch for new ones, say it has started on one, reply, ask, and post decisions for the reviewer to choose. Each verb
// is in cli/commands/review/.
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

export default defineCommand({
  meta: {
    name: 'review',
    description: "Review a project with the reviewer: notes, replies and decisions.",
    about: "The review lives in the project's review/review.json. The reviewer pins notes and picks between candidates in the studio app (open); an agent works them with watch, notes, start, reply, ask and decide. The studio-review skill has the loop.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: {
    open: () => import('./review/open.ts').then((m) => m.reviewOpenCommand),
    notes: () => import('./review/notes.ts').then((m) => m.reviewNotesCommand),
    watch: () => import('./review/watch.ts').then((m) => m.reviewWatchCommand),
    start: () => import('./review/start.ts').then((m) => m.reviewStartCommand),
    reply: () => import('./review/reply.ts').then((m) => m.reviewReplyCommand),
    ask: () => import('./review/ask.ts').then((m) => m.reviewAskCommand),
    decide: () => import('./review/decide.ts').then((m) => m.reviewDecideCommand),
    decisions: () => import('./review/decisions.ts').then((m) => m.reviewDecisionsCommand),
  },
});
