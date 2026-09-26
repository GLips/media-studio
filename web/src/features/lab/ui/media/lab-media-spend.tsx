import { Box, Paper, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { formatGenerationCost, sumGenerationCost } from '#models/lab/lab-generated-media.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

const LAB_SPEND_KINDS = [
  { kind: 'video', label: 'video clips' }, { kind: 'image', label: 'images' }, { kind: 'audio', label: 'music tracks' },
] as const;

const NARROW = '@media (max-width: 900px)';

const styles = stylex.create({
  strip: { display: 'grid', gap: spacing.gap, gridTemplateColumns: { default: '1.4fr repeat(3, 1fr)', [NARROW]: '1fr' } },
  card: { backgroundColor: colors.panel, borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}`, display: 'flex', flexDirection: 'column', gap: '2px' },
  totalCard: { borderTopWidth: '3px', borderTopStyle: 'solid', borderTopColor: colors.accent },
  figure: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '80%', lineHeight: 1.1 },
  total: { color: colors.accent },
  free: { gridColumn: '1 / -1' },
  freeLead: { color: colors.pass },
});

/** What's been spent on the pieces shown on the page, in all and by kind. */
export function LabMediaSpend({ shown }: { readonly shown: readonly LabGalleryItem[] }) {
  return (
    <Box {...stylex.props(styles.strip)}>
      <Paper {...stylex.props(styles.card, styles.totalCard)}>
        <Readout label>Spent so far</Readout>
        <Text component="strong" size="stat" {...stylex.props(styles.figure, styles.total)}>{formatGenerationCost(sumGenerationCost(shown))}</Text>
        <Text size="xs" c="dimmed">{shown.length} pieces, all shown below</Text>
      </Paper>
      {LAB_SPEND_KINDS.map(({ kind, label }) => {
        const items = shown.filter((i) => i.kind === kind);
        return (
          <Paper key={kind} {...stylex.props(styles.card)}>
            <Readout label>{items.length} {label}</Readout>
            <Text component="strong" size="xl" {...stylex.props(styles.figure)}>{formatGenerationCost(sumGenerationCost(items))}</Text>
          </Paper>
        );
      })}
      <Text c="dimmed" {...stylex.props(styles.free)}>
        <Text component="b" fw={700} {...stylex.props(styles.freeLead)}>This tab costs nothing.</Text>{' '}
        Making new media is a separate, deliberate step that the lab can't take.
      </Text>
    </Box>
  );
}
