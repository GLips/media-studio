// review-decision-markdown.ts: a project's decisions as the markdown `studio review decisions` and `watch` hand an
// agent: the question, each candidate with its file (from the repo root, so it can be Read from anywhere) and meta,
// the reviewer's verdicts and, once signed off, the picks.
import type { ReviewCandidate, ReviewDecision } from './review-threads.ts';

export function formatReviewDecisionsMarkdown(project: string, decisions: readonly ReviewDecision[]): string {
  return decisions.map((d) => formatReviewDecision(project, d)).join('\n\n');
}

function formatReviewDecision(project: string, decision: ReviewDecision): string {
  const signed = decision.decided && `signed off: ${decision.decided.picks.length ? `picks ${decision.decided.picks.join(', ')}` : 'none picked'}`;
  return [
    `### #${decision.id} decision \`${decision.topic}\` · ${decision.state} · choose ${decision.choose}`,
    decision.question,
    decision.candidates.map((c) => formatReviewCandidate(project, c)).join('\n'),
    ...(signed ? [signed] : []),
  ].join('\n\n');
}

function formatReviewCandidate(project: string, candidate: ReviewCandidate): string {
  const what = candidate.media ? `work/projects/${project}/${candidate.media.path} \`${candidate.media.hash}\`` : `"${candidate.text ?? ''}"`;
  const meta = Object.entries(candidate.meta).map(([k, v]) => `${k} ${v}`);
  return [`- ${candidate.key} ${candidate.label} — ${what}`, ...meta, ...(candidate.verdict ? [`**${candidate.verdict}**`] : [])].join(' · ');
}
