import { Box, Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { projectFileUrl } from '#web/shared/media-urls.ts';
import { AgentPresence, formatStudioClock } from '#web/shared/ui/agent-presence.tsx';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewReplacementHashOf } from '../controllers/review-queries.ts';
import { useReviewOps } from '../controllers/use-review-ops.ts';
import { ReviewRenderMenu } from './review-render-menu.tsx';
import { useReviewScreen } from './review-screen-context.tsx';
import { reviewVersionLabelOf, useReviewRenderVersions } from './use-review-render-versions.ts';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: {
    color: colors.cream, paddingInline: spacing.tight,
    borderRadius: radius.control, whiteSpace: 'nowrap', backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  project: { color: colors.dim },
  // A long project's files scroll inside the menu instead of running off the window.
  files: { display: 'flex', flexDirection: 'column', maxHeight: '60dvh' },
  here: { backgroundColor: colors.raised },
  failed: { color: colors.danger },
  // Decoration: it says a render is on its way and reacts to nothing.
  rendering: { color: colors.dim, whiteSpace: 'nowrap', cursor: 'default' },
});

/** The project's files by folder, folders and files each in name order; the root's files under no heading. */
function reviewFileFoldersOf(files: readonly { path: string }[]): { folder: string; paths: string[] }[] {
  const byFolder = new Map<string, string[]>();
  for (const path of files.map((f) => f.path).toSorted()) {
    const folder = path.split('/').slice(0, -1).join('/');
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  return [...byFolder].toSorted(([a], [b]) => a.localeCompare(b)).map(([folder, paths]) => ({ folder, paths }));
}

function downloadReviewFile(project: string, path: string) {
  const link = document.createElement('a');
  link.href = projectFileUrl(project, path);
  link.download = path.split('/').at(-1) ?? path;
  link.click();
}

/**
 * The review's part of the shell's bar. Left: `project / file ▾`, the render, a newer render waiting while a draft is
 * open (with none open the route loads it by itself), and a render under way. Right: a save that failed
 * (a save that works says nothing), the agent's presence, and the download, unpinned so a replaced render never 410s.
 */
export function ReviewHeader({ onLoadReplacement }: { readonly onLoadReplacement: () => void }) {
  const { project, artifact, pulse, draft, search } = useReviewScreen();
  const navigate = useNavigate();
  const ops = useReviewOps(project);
  const { versions } = useReviewRenderVersions();
  const { files, rendering } = pulse;
  const replacement = reviewReplacementHashOf(pulse, artifact, search.r);
  return (
    <Group justify="space-between" wrap="nowrap" gap="gap" {...stylex.props(styles.header)}>
      <Group gap="tight" wrap="nowrap">
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <UnstyledButton {...stylex.props(styles.crumb)}>
              <Text component="span" size="sm"><Text component="span" inherit {...stylex.props(styles.project)}>{project} / </Text>{artifact.path} ▾</Text>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Box {...stylex.props(styles.files)}>
              <FadeScroll>
                {reviewFileFoldersOf(files).map(({ folder, paths }) => (
                  <Box key={folder}>
                    {folder && <Menu.Label>{folder}</Menu.Label>}
                    {paths.map((path) => (
                      <Menu.Item key={path} onClick={() => void navigate({ to: '/projects/$project/artifacts/$', params: { project, _splat: path } })}
                        {...stylex.props(path === artifact.path && styles.here)}>
                        {path.slice(folder.length + (folder ? 1 : 0))}
                      </Menu.Item>
                    ))}
                  </Box>
                ))}
              </FadeScroll>
            </Box>
          </Menu.Dropdown>
        </Menu>
        <ReviewRenderMenu />
        {rendering && (
          <Tooltip label={`${rendering.paths.join(', ')} since ${formatStudioClock(rendering.startedAt)}`} openDelay={400} withinPortal>
            <Text component="span" size="sm" {...stylex.props(styles.rendering)}>
              ⟳ {rendering.paths.includes(artifact.path) || rendering.paths.length > 1 ? 'rendering' : `rendering ${rendering.paths[0]}`}
            </Text>
          </Tooltip>
        )}
        {replacement !== undefined && draft.isOpen && (
          <HotkeyTooltip name="Load the newer render">
            <UnstyledButton onClick={onLoadReplacement} {...stylex.props(styles.crumb)}><Text component="span" size="sm">{reviewVersionLabelOf(versions.find((v) => v.hash === replacement), replacement)} ↻</Text></UnstyledButton>
          </HotkeyTooltip>
        )}
      </Group>
      <Group gap="tight" wrap="nowrap">
        {ops.failed && (
          <UnstyledButton onClick={ops.retry} {...stylex.props(styles.crumb)}><Text component="span" size="sm" {...stylex.props(styles.failed)}>not saved · retry</Text></UnstyledButton>
        )}
        <AgentPresence agent={pulse.agent} />
        <IconButton name="Download" onClick={() => downloadReviewFile(project, artifact.path)}>
          <Download size={14} />
        </IconButton>
      </Group>
    </Group>
  );
}
