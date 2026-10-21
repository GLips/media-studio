// review-watch-events.ts: what the reviewer did since a watch's cursor, one event per act, as `studio review watch
// --follow` streams them: a line each, naming the thing, its state, where it is and the command that prints it whole.
// A harness that wakes on each line (Claude Code's Monitor) then wakes the agent once per act, with nothing to re-arm.
//
// A reviewer's edit to their note reads as `note`, as a new one does: the file keeps no creation revision to tell them
// apart, and the agent re-reads either the same way.
import { formatReviewMomentPlace } from './review-moment.ts';
import { formatReviewPlanNoteWhere } from './review-plan.ts';
import type { ReviewAnchor, ReviewDecision, ReviewEntry, ReviewSignoff, ReviewThread, ReviewThreadState } from './review-threads.ts';

export type ReviewWatchEvent =
  | { kind: 'note' | 'reply' | 'reopen' | 'resolve'; rev: number; id: number; state: ReviewThreadState; where: string; text: string }
  | { kind: 'verdicts' | 'decided'; rev: number; id: number; question: string; picks: string[]; rejects: string[] }
  | { kind: 'signoff'; rev: number; where: string };

/** How much of a note or reply a line quotes: enough to triage by, with the command for the rest. */
const REVIEW_WATCH_QUOTE_CHARS = 72;

function reviewAnchorWhere(anchor: ReviewAnchor): string {
  if (anchor.on === 'video') return anchor.moment ? formatReviewMomentPlace(anchor.moment) : `f${anchor.frame}`;
  if (anchor.on === 'still') return `still ${anchor.writtenOn.path}${anchor.cell ? ` · ${anchor.cell}` : ''}`;
  if (anchor.on === 'plan') return `plan · ${formatReviewPlanNoteWhere(anchor, { short: true })}`;
  if (anchor.on === 'decision') return `decision #${anchor.decision}${anchor.candidate ? ` · ${anchor.candidate}` : ''}`;
  return 'project';
}

const REVIEW_TRANSITION_ACTS = { resolved: 'resolve', reopened: 'reopen', addressed: 'reply' } as const;

/** What a reviewer's entry did: entries[0] is the note itself, the rest replies, some moving its state. */
function reviewEntryAct(entry: ReviewEntry, index: number) {
  if (index === 0) return 'note';
  return entry.transition ? REVIEW_TRANSITION_ACTS[entry.transition] : 'reply';
}

const quoted = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > REVIEW_WATCH_QUOTE_CHARS ? `${flat.slice(0, REVIEW_WATCH_QUOTE_CHARS)}…` : flat;
};

/** Every reviewer act past `cursor` on what a watch woke with, oldest first. */
export function reviewWatchEventsOf(
  change: { threads: readonly ReviewThread[]; decisions: readonly ReviewDecision[]; signoffs: readonly ReviewSignoff[] }, cursor: number,
): ReviewWatchEvent[] {
  const notes = change.threads.flatMap((thread) => thread.entries.flatMap((entry, i): ReviewWatchEvent[] => {
    if (entry.author !== 'reviewer' || entry.rev <= cursor) return [];
    return [{ kind: reviewEntryAct(entry, i), rev: entry.rev, id: thread.id, state: thread.state, where: reviewAnchorWhere(thread.anchor), text: quoted(entry.text) }];
  }));
  const decisions = change.decisions.map((d): ReviewWatchEvent => ({
    kind: d.state === 'decided' ? 'decided' : 'verdicts', rev: d.rev, id: d.id, question: quoted(d.question),
    picks: d.decided?.picks ?? d.candidates.filter((c) => c.verdict === 'pick').map((c) => c.key),
    rejects: d.candidates.filter((c) => c.verdict === 'reject').map((c) => c.key),
  }));
  const signoffs = change.signoffs.filter((s) => s.rev > cursor).map((s): ReviewWatchEvent => (
    { kind: 'signoff', rev: s.rev, where: s.on === 'plan' ? `plan · ${s.scene}` : `render ${s.path}${s.rung ? ` · ${s.rung}` : ''}` }
  ));
  return [...notes, ...decisions, ...signoffs].toSorted((a, b) => a.rev - b.rev);
}

/**
 * `r14 #12 reopen · reopened · bar 3 (intro) · beat 2 · "still too soft" → studio review notes fodmap --id 12`: one
 * event as a line, leading with the revision so a burst reads in order.
 */
export function formatReviewWatchEvent(project: string, event: ReviewWatchEvent): string {
  switch (event.kind) {
    case 'signoff': return `r${event.rev} signoff · ${event.where} → studio review notes ${project}`;
    case 'verdicts':
    case 'decided': {
      const verdicts = [event.picks.length && `picks ${event.picks.join(', ')}`, event.rejects.length && `rejects ${event.rejects.join(', ')}`].filter(Boolean).join(' · ');
      return `r${event.rev} #${event.id} ${event.kind === 'decided' ? 'decision signed off' : 'decision verdicts'} · ${verdicts || 'none'} · "${event.question}" → studio review decisions ${project}`;
    }
    default: return `r${event.rev} #${event.id} ${event.kind} · ${event.state} · ${event.where}${event.text ? ` · "${event.text}"` : ''} → studio review notes ${project} --id ${event.id}`;
  }
}
