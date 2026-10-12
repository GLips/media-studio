import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { countReviewThreadTones, REVIEW_THREAD_TONES, type ReviewCandidate, type ReviewThread } from '#lib/output/review/models/review-threads.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { DecisionCandidateMedia } from './decision-candidate-media.tsx';
import { useDecisionScreen } from './decision-screen-context.tsx';
import { DECISION_NUMBER_KEYS, decisionCandidateKeyName } from './use-decision-hotkeys.ts';

const styles = stylex.create({
  frame: {
    display: 'grid', gridTemplateRows: `${spacing.rowDense} minmax(0, 1fr) ${spacing.rowDense}`, minHeight: 0, minWidth: 0,
    paddingInline: spacing.gap, cursor: 'pointer', borderRadius: radius.control,
    backgroundColor: { default: colors.panel, ':hover': colors.raised },
    borderWidth: '2px', borderStyle: 'solid', borderColor: { default: 'transparent', ':hover': colors.line },
    outlineStyle: 'solid', outlineWidth: 0, outlineColor: colors.cream, outlineOffset: '-4px',
  },
  // No meta posted: the media takes the bottom row too, short of the inset under it.
  bare: { gridTemplateRows: `${spacing.rowDense} minmax(0, 1fr)`, paddingBottom: spacing.gap },
  focused: { outlineWidth: '2px' },
  picked: { borderColor: colors.pass },
  label: { minWidth: 0, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: colors.cream },
  media: { minHeight: 0, minWidth: 0, backgroundColor: colors.screen },
  // Words are read on the panel itself, not letterboxed on the screen's black.
  words: { backgroundColor: 'transparent' },
  // Only the media fades: the key, the ✕, the focus edge and the note marks stay readable.
  faded: { opacity: 0.3 },
  meta: { overflow: 'hidden', alignSelf: 'center' },
  reject: { color: colors.cream, fontWeight: 700 },
  open: { color: colors.accent },
  addressed: { color: colors.pass },
  asks: { color: colors.caution },
  quiet: { color: colors.dim, cursor: 'default' },
  // Pick and reject, there for the mouse on the card under it and the one in focus.
  verdicts: { display: 'flex', gap: spacing.tight, opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 } },
  verdictsShown: { opacity: 1 },
  verdict: {
    display: 'flex', alignItems: 'center', gap: spacing.tight, height: spacing.rowDense, paddingInline: spacing.tight,
    borderRadius: radius.control, color: { default: colors.dim, ':hover': colors.cream },
    backgroundColor: { default: 'transparent', ':hover': colors.ground },
  },
  verdictOn: { color: colors.cream, backgroundColor: colors.ground },
});

type DecisionVerdictButtonProps = { readonly name: string; readonly hotkey: string; readonly keyCap: string; readonly on: boolean; readonly onClick: () => void; readonly children: ReactNode };

/** `✓ P`: a verdict with its key, lit when it stands; a press on a lit one takes it back. */
function DecisionVerdictButton({ name, hotkey, keyCap, on, onClick, children }: DecisionVerdictButtonProps) {
  return (
    <HotkeyTooltip name={name} hotkey={hotkey}>
      <UnstyledButton aria-label={name} aria-pressed={on} onClick={onClick} onDoubleClick={(event) => event.stopPropagation()} {...stylex.props(styles.verdict, on && styles.verdictOn)}>
        {children}<Readout>{keyCap}</Readout>
      </UnstyledButton>
    </HotkeyTooltip>
  );
}

/** The candidate's threads waiting on someone, by tone, as the thread panel's filter chips count them; none left out. */
function candidateThreadGlyphs(threads: readonly ReviewThread[]) {
  const counts = countReviewThreadTones(threads);
  return (['open', 'addressed', 'asks'] as const).filter((tone) => counts[tone] > 0)
    .map((tone) => ({ tone, count: counts[tone], glyph: REVIEW_THREAD_TONES[tone].glyph, word: REVIEW_THREAD_TONES[tone].word }));
}

/** Model, cost, seed and the rest, as posted, each by its name: a bare `41` doesn't say it's the seed. */
const candidateMetaLine = (candidate: ReviewCandidate) => Object.entries(candidate.meta).map(([name, value]) => `${name} ${value}`).join(' · ');

const FILE_STATE_GLYPHS = { changed: { glyph: '≠', name: 'changed since it was posted' }, missing: { glyph: '∅', name: 'file gone' } };

/**
 * One candidate: key, label and (on hover or focus) pick and reject along the top, its media, its meta in mono below.
 * A pick has a `pass` frame, a reject a ✕ and dimmed media, focus a cream inner edge; signed off, all but the picks
 * dim. A click hears it from the time now; a double click two-ups it.
 */
export function DecisionCandidateFrame({ candidate }: { readonly candidate: ReviewCandidate }) {
  const { view, decision, focused, focus, openTwoUp, decide } = useDecisionScreen();
  const { key } = candidate;
  const index = decision.candidates.findIndex((c) => c.key === key);
  const verdict = (v: 'pick' | 'reject') => () => decide([{ op: 'decision.verdict', id: decision.id, candidate: key, verdict: candidate.verdict === v ? null : v }]);
  const threads = view.threads.filter((t) => t.anchor.on === 'decision' && t.anchor.candidate === key);
  const fileState = view.files[key];
  const meta = candidateMetaLine(candidate);
  const faded = candidate.verdict === 'reject' || (decision.state === 'decided' && !decision.decided?.picks.includes(key));
  // A text candidate whose label is its words says them once, in its body.
  const label = candidate.media || candidate.label !== candidate.text ? candidate.label : '';
  return (
    <Box
      aria-label={candidate.label}
      aria-current={key === focused || undefined}
      onClick={() => focus(key)}
      onDoubleClick={() => openTwoUp(key)}
      {...stylex.props(stylex.defaultMarker(), styles.frame, !meta && styles.bare, key === focused && styles.focused, candidate.verdict === 'pick' && styles.picked)}
    >
      <Group gap="gap" wrap="nowrap">
        <HotkeyTooltip name={decisionCandidateKeyName(key)} hotkey={decisionCandidateKeyName(key)}>
          {/* The number is the key that focuses it: the letter alone reads as a key, and B or X mean other things. */}
          <Text component="span" inherit>{index < DECISION_NUMBER_KEYS && <Readout>{index + 1} </Readout>}<Readout bright={key === focused}>{key.toUpperCase()}</Readout></Text>
        </HotkeyTooltip>
        {candidate.verdict === 'reject' && <Text component="span" size="sm" aria-label="rejected" {...stylex.props(styles.reject)}>✕</Text>}
        <Text component="span" size="sm" {...stylex.props(styles.label)}>{label}</Text>
        {candidateThreadGlyphs(threads).map((g) => (
          <HotkeyTooltip key={g.tone} name={g.word}>
            <Text component="span" size="sm" {...stylex.props(styles[g.tone])}>{g.glyph}{g.count > 1 && g.count}</Text>
          </HotkeyTooltip>
        ))}
        {fileState && (
          <HotkeyTooltip name={FILE_STATE_GLYPHS[fileState].name}>
            <Text component="span" size="sm" {...stylex.props(styles.quiet)}>{FILE_STATE_GLYPHS[fileState].glyph}</Text>
          </HotkeyTooltip>
        )}
        {decision.state === 'open' && (
          <Box {...stylex.props(styles.verdicts, key === focused && styles.verdictsShown)}>
            <DecisionVerdictButton name={candidate.verdict === 'pick' ? 'Unflag' : 'Pick'} hotkey={candidate.verdict === 'pick' ? 'Unflag' : 'Pick'} keyCap={candidate.verdict === 'pick' ? 'U' : 'P'} on={candidate.verdict === 'pick'} onClick={verdict('pick')}><Check size={12} /></DecisionVerdictButton>
            <DecisionVerdictButton name={candidate.verdict === 'reject' ? 'Unflag' : 'Reject'} hotkey={candidate.verdict === 'reject' ? 'Unflag' : 'Reject'} keyCap={candidate.verdict === 'reject' ? 'U' : 'X'} on={candidate.verdict === 'reject'} onClick={verdict('reject')}><X size={12} /></DecisionVerdictButton>
          </Box>
        )}
      </Group>
      <Box {...stylex.props(styles.media, !candidate.media && styles.words, faded && styles.faded)}>
        <DecisionCandidateMedia candidate={candidate} missing={fileState === 'missing'} />
      </Box>
      {meta && <Box title={meta} {...stylex.props(styles.meta)}><Readout>{meta}</Readout></Box>}
    </Box>
  );
}
