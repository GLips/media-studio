import { Group, Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioHeader } from '#web/shared/ui/studio-header.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { labCatalogQueryOptions } from '../controllers/lab-catalog-query.ts';
import { LAB_TABS } from '#models/lab/lab-tabs.ts';

const styles = stylex.create({
  page: { maxWidth: spacing.pageMaxWidth, marginInline: 'auto', padding: `${spacing.sectionGap} ${spacing.pageMargin} 6rem` },
  title: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '75%', lineHeight: 1, textTransform: 'uppercase' },
  tab: {
    paddingBlock: '0.5rem', paddingInline: '0.875rem', borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, borderRadius: radius.pill,
    fontWeight: 600, color: colors.cream, textDecoration: 'none',
    ':hover': { borderColor: colors.dim, textDecoration: 'none' },
  },
  activeTab: { backgroundColor: colors.accent, borderColor: colors.accent, color: colors.ground },
});

/** The lab's frame: the studio's masthead, what the lab is, and a pill per tab, the open one lit. */
export function LabPage({ children }: { readonly children: ReactNode }) {
  const { data: catalog } = useSuspenseQuery(labCatalogQueryOptions);
  return (
    <Stack gap="xl" {...stylex.props(styles.page)}>
      <StudioHeader projects={!catalog.exported} />
      <Stack gap="xs">
        <Readout label>media studio</Readout>
        <Title order={1} {...stylex.props(styles.title)}>Studio Lab</Title>
        <Text c="dimmed" maw="60ch">Every lever the studio pulls when it makes a video, one tab each. Drag things. Nothing here costs money.</Text>
      </Stack>
      <Group gap="tight" component="nav">
        {LAB_TABS.map((tab, i) => (
          <AnchorLink key={tab.id} to="/lab/$tab" params={{ tab: tab.id }} {...stylex.props(styles.tab)}
            activeProps={stylex.props(styles.tab, styles.activeTab)}>
            {String(i + 1).padStart(2, '0')} {tab.label}
          </AnchorLink>
        ))}
      </Group>
      {children}
    </Stack>
  );
}
