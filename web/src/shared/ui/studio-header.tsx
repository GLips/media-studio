import { Group, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useMatchRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AnchorLink } from './anchor-link.tsx';
import { colors, fonts, spacing, typography } from './theme.stylex.ts';

const styles = stylex.create({
  header: { paddingBottom: spacing.gap, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  brand: { fontFamily: fonts.display, fontSize: typography.section, fontWeight: 900, fontStretch: '80%', textTransform: 'uppercase' },
  link: { fontFamily: fonts.mono, fontSize: typography.readout, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.dim },
  active: { color: colors.accent },
});

/**
 * The app's masthead: its name and the two places in it, the projects and the lab. An exported lab has no projects to
 * show, so it passes `projects={false}`.
 */
export function StudioHeader({ projects = true, children }: { readonly projects?: boolean; readonly children?: ReactNode }) {
  const matchRoute = useMatchRoute();
  const inLab = !!matchRoute({ to: '/lab', fuzzy: true });
  return (
    <Group justify="space-between" {...stylex.props(styles.header)}>
      <Group gap="lg" align="baseline">
        <Title order={1} {...stylex.props(styles.brand)}>Studio</Title>
        {projects && <AnchorLink to="/" {...stylex.props(styles.link, !inLab && styles.active)}>Projects</AnchorLink>}
        <AnchorLink to="/lab" {...stylex.props(styles.link, inLab && styles.active)}>Lab</AnchorLink>
      </Group>
      {children}
    </Group>
  );
}
