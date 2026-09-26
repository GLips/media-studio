import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatReviewMomentPlace } from '#models/review/review-moment.ts';
import { formatStillAxes, type ReviewNoteContext } from '#models/review/review-notes.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  lines: {
    display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '0.5rem', rowGap: '1px', margin: 0,
    fontFamily: fonts.mono, lineHeight: 1.45,
  },
  term: { color: colors.dim, textTransform: 'uppercase', letterSpacing: '0.06em' },
  detail: { margin: 0, color: colors.cream, overflowWrap: 'anywhere' },
});

/** What the timeline, motion and sheet say is at a note's moment and point: the fields an agent acts on. */
export function ReviewNoteContextLines({ context }: { readonly context: ReviewNoteContext }) {
  const { cell, scenes, sounds, elements, moment } = context;
  const all: [string, string | undefined][] = [
    ['moment', moment && formatReviewMomentPlace(moment)],
    ['variant', cell && `${cell.variant} (${formatStillAxes(cell.axes)})${cell.refused ? ' · refused' : ''}`],
    ['scene', scenes?.join(' → ')],
    ['sound', sounds?.map((s) => `${s.sound} ${s.id} f${s.frame}${s.targeted ? ' ◀' : ''}`).join(' · ')],
    ['under', elements?.map((e) => `${e.id}${e.kind ? ` (${e.kind})` : ''}`).join(' ⊂ ')],
  ];
  const lines = all.filter((line): line is [string, string] => !!line[1]);
  if (!lines.length) return null;
  return (
    <Text component="dl" size="xs" {...stylex.props(styles.lines)}>
      {lines.map(([term, detail]) => [
        <Text key={`${term}:t`} component="dt" inherit {...stylex.props(styles.term)}>{term}</Text>,
        <Text key={`${term}:d`} component="dd" inherit {...stylex.props(styles.detail)}>{detail}</Text>,
      ])}
    </Text>
  );
}
