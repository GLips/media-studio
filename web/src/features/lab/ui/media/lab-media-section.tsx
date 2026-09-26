import { Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  section: { paddingTop: spacing.sectionGap, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  tag: { fontFamily: fonts.mono, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.accent },
  title: {
    fontFamily: fonts.display, fontWeight: 900, fontStretch: '80%', lineHeight: 1.05,
    textTransform: 'uppercase',
  },
  intro: { maxWidth: '80ch' },
});

type LabMediaSectionProps = {
  /** The kind and source, over the title: "Video · previs". */
  readonly tag: string;
  readonly title: string;
  readonly intro: ReactNode;
  readonly children: ReactNode;
};

/** One of the Generated media tab's sections: a heading that says what the pieces are, then the pieces. */
export function LabMediaSection({ tag, title, intro, children }: LabMediaSectionProps) {
  return (
    <Stack component="section" gap="md" {...stylex.props(styles.section)}>
      <Stack component="header" gap={4}>
        <Text component="span" size="xs" {...stylex.props(styles.tag)}>{tag}</Text>
        <Title order={3} {...stylex.props(styles.title)}>{title}</Title>
        <Text {...stylex.props(styles.intro)}>{intro}</Text>
      </Stack>
      {children}
    </Stack>
  );
}
