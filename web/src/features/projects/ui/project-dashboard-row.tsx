import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Folder, MessageSquare, ScrollText, Split } from 'lucide-react';
import { reviewRowAwaitsYou, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectAge } from './project-age.tsx';
import { ProjectRow } from './project-row.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';

const styles = stylex.create({
  // Heavier than a row's title, not a headline: twenty of them stack, and the awaiting rows above must outweigh them.
  name: { fontWeight: 600 },
  // A project with nothing rendered yet: listed, but out of the way of the ones with work to look at.
  unrendered: { color: colors.dim, fontWeight: 400 },
  mark: { display: 'inline-flex', alignItems: 'center', gap: spacing.hairline, fontFamily: fonts.mono, color: colors.caution, cursor: 'default' },
  glyph: { verticalAlign: 'middle', marginInlineEnd: '2px' },
});

const GLYPH_SIZE = 12;

/** A project on the dashboard: its newest picture, its name, what waits on whom, and when it was last rendered and reviewed. */
export function ProjectDashboardRow({ summary, now }: { readonly summary: ReviewProjectSummary; readonly now: number }) {
  const { project, rows, threads, reviewedAt } = summary;
  const newest = rows.find((r) => r.on === 'file');
  const openDecisions = rows.filter((r) => r.on === 'decision' && reviewRowAwaitsYou(r)).length;
  const script = rows.find((r) => r.on === 'script');
  const marks = (
    <>
      {openDecisions > 0 && (
        <HotkeyTooltip name={`${openDecisions} open decision${openDecisions === 1 ? '' : 's'}`}><Text component="span" size="sm" {...stylex.props(styles.mark)}><Split size={GLYPH_SIZE} />{openDecisions}</Text></HotkeyTooltip>
      )}
      {script?.on === 'script' && script.signoff !== 'signed' && (
        <HotkeyTooltip name={script.signoff === 'stale' ? 'script changed since signed off' : 'script not signed off'}>
          <Text component="span" size="sm" {...stylex.props(styles.mark)}><ScrollText size={GLYPH_SIZE} /></Text>
        </HotkeyTooltip>
      )}
    </>
  );
  const end = (
    <>
      {newest?.on === 'file' && <Readout>{newest.artifact.path}</Readout>}
      {newest?.on === 'file' && <ProjectAge now={now} at={newest.artifact.modified} what={newest.artifact.kind === 'video' ? 'rendered' : 'made'} />}
      {reviewedAt && <ProjectAge now={now} at={reviewedAt} what="reviewed" glyph={<MessageSquare size={10} {...stylex.props(styles.glyph)} />} />}
    </>
  );
  return (
    <ProjectRow
      target={{ project, on: 'project' }}
      thumbnail={newest?.on === 'file'
        ? <ProjectThumbnail key={newest.thumbnail.kind === 'video' ? newest.thumbnail.hash : newest.artifact.path} project={project} thumbnail={newest.thumbnail} />
        : <ProjectThumbnail glyph={<Folder size={14} />} />}
      title={<Text component="span" size="xl" {...stylex.props(styles.name, !newest && styles.unrendered)}>{project}</Text>}
      threads={threads}
      marks={marks}
      end={end}
    />
  );
}
