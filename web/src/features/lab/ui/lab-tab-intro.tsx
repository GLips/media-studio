import { Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  title: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '80%', lineHeight: 1.02, textTransform: 'uppercase' },
  what: { maxWidth: '72ch' },
  card: { borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}`, borderTopWidth: '3px', borderTopStyle: 'solid', borderTopColor: colors.line },
  bad: { borderTopColor: colors.accent },
  good: { borderTopColor: colors.pass },
});

type LabTabIntroProps = {
  readonly number: number;
  readonly title: string;
  readonly what: ReactNode;
  readonly when: ReactNode;
  readonly bad: ReactNode;
  readonly good: ReactNode;
};

/**
 * A tab's opening: what the capability is, when a video reaches for it, and what it looks like done badly and well.
 * Written for someone who has never made a video.
 */
export function LabTabIntro({ number, title, what, when, bad, good }: LabTabIntroProps) {
  const cards = [['when a video uses it', when, undefined], ['done badly', bad, styles.bad], ['done well', good, styles.good]] as const;
  return (
    <Stack gap="sm">
      <Readout>{String(number).padStart(2, '0')} —</Readout>
      <Title order={2} {...stylex.props(styles.title)}>{title}</Title>
      <Text size="lg" {...stylex.props(styles.what)}>{what}</Text>
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
        {cards.map(([label, body, accent]) => (
          <Paper key={label} {...stylex.props(styles.card, accent)}>
            <Readout label>{label}</Readout>
            <Text size="sm" mt="tight">{body}</Text>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
