// studio review: a project's review, in the studio app and from an agent's side. `open` shows the reviewer the
// project's renders and stills; the rest are the agent's half of the loop over review/review.json: read the notes,
// watch for new ones, reply, ask, and post decisions for the reviewer to choose. Each verb is in cli/commands/review/.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'review',
    description: "A project's review: notes pinned on its renders and stills, the agent's replies and questions, and decisions between candidates, all in the project's review/review.json. The reviewer works in the studio app (open); an agent leaves watch running in the background, is woken by each burst of notes, fixes them, replies --addressed with the commit and the render that shows the fix, asks with --question or ask when unsure, and posts choices with decide. Only the reviewer resolves, reopens, picks and signs off.",
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
