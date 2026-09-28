import { Group, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { AnchorLink } from './anchor-link.tsx';
import { colors, fonts, spacing, typography } from './theme.stylex.ts';

const styles = stylex.create({
  header: { paddingBottom: spacing.gap, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  brand: { fontFamily: fonts.display, fontSize: typography.section, fontWeight: 900, fontStretch: '80%', textTransform: 'uppercase' },
  link: { fontFamily: fonts.mono, fontSize: typography.readout, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.accent },
});

/** The app's masthead: its name and the way back to the projects. */
export function StudioHeader() {
  return (
    <Group gap="lg" align="baseline" {...stylex.props(styles.header)}>
      <Title order={1} {...stylex.props(styles.brand)}>Studio</Title>
      <AnchorLink to="/" {...stylex.props(styles.link)}>Projects</AnchorLink>
    </Group>
  );
}
