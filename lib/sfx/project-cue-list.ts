// project-cue-list.ts: a project's cue list against what `studio check` measured: drafting it (`studio sfx draft`),
// and the check's report on it.
import type { TimelineReport } from '../studio/Video.tsx';
import type { SfxEvent } from './cue-events.ts';
import { readSfxCueList, writeSfxCueList, writeSfxCueModule } from './cue-module.ts';
import { draftSfxCues, formatSfxCueList, formatSfxCueReport, sfxCueOverrides, staleSfxCues, type SfxClickStyle } from './cues.ts';

const spokenWords = (timeline: TimelineReport) => timeline.cues.flatMap((c) => c.words);

/**
 * The check's lines on the project's cue list, if it has one, over the checked frames. Overrides are reported either
 * way; a stale cue or uncued event fails only when the video plays the list, since only then is it out of step.
 */
export function sfxCueListReport(project: string, timeline: TimelineReport, events: readonly SfxEvent[], span: { first: number; last: number }): { ok: boolean; lines: string[] } {
  const list = readSfxCueList(project);
  if (!list) return { ok: true, lines: [] };
  const { fps } = timeline, from = span.first / fps, to = (span.last + 1) / fps;
  const stale = staleSfxCues(list, events, { from, to, fps, partial: span.first > 0 || span.last < timeline.durationInFrames - 1 });
  const overrides = sfxCueOverrides(list, spokenWords(timeline)).filter((o) => o.at >= from && o.at <= to);
  const lines = formatSfxCueReport(list, { stale, overrides });
  if (!timeline.sfxCueList && stale.length) lines.push('  (the video doesn\'t play its cue list, so stale cues don\'t fail the check)');
  return { ok: !timeline.sfxCueList || stale.length === 0, lines };
}

/**
 * Drafts sfx/cues.json from a whole-video check's events, keeping the edits in the one there. `clickStyle` defaults to
 * the list's, then soft. Rewrites generated/sfx-cues.ts too, so an open Studio plays the new list. Returns the lines
 * to print: the list, dropped edits, and the file.
 */
export function draftProjectSfxCueList(project: string, { timeline, events, clickStyle }: { timeline: TimelineReport; events: readonly SfxEvent[]; clickStyle?: SfxClickStyle }): string[] {
  const previous = readSfxCueList(project);
  const { list, dropped } = draftSfxCues(events, spokenWords(timeline), { clickStyle: clickStyle ?? previous?.clickStyle ?? 'soft', previous });
  const lines = [
    ...formatSfxCueList(list),
    ...dropped.map((d) => `dropped the edits to ${d.id}: ${d.why}`),
    ...sfxCueOverrides(list, spokenWords(timeline)).map((o) => `! ${o.at.toFixed(2)}s  ${o.id}: ${o.problem}`),
    writeSfxCueList(project, list),
  ];
  writeSfxCueModule(project);
  return lines;
}
