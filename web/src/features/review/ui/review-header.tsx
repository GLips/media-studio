import { Anchor, Button, Group, NativeSelect, Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import type { ProjectArtifact, ReviewArtifact } from '#models/review/review-artifact.ts';
import { formatReviewNotesMarkdown, type ReviewNote } from '#models/review/review-notes.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';
import { formatRenderTime } from './review-note-format.ts';
import { projectFileUrl, reviewMediaUrl } from './review-media-urls.ts';

const styles = stylex.create({
  header: { paddingBottom: spacing.inset, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  title: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '80%', lineHeight: 1.05, textTransform: 'uppercase' },
  hash: { color: colors.cream, fontWeight: 700 },
});

type ReviewHeaderProps = {
  readonly artifact: ReviewArtifact;
  /** The project's reviewable files as they are on disk now, newest first. */
  readonly artifacts: readonly ProjectArtifact[];
  readonly notes: readonly ReviewNote[];
  readonly saveState: string;
};

/** Which file, which render of it by hash, the others to switch to, its downloads, and the notes as markdown. */
export function ReviewHeader({ artifact, artifacts, notes, saveState }: ReviewHeaderProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState('');
  const copyNotes = () => {
    const markdown = formatReviewNotesMarkdown(
      { media: `work/projects/${artifact.project}/${artifact.path}`, kind: artifact.kind, fps: artifact.fps ?? 30, notes: [...notes] },
      { title: artifact.title, savedTo: artifact.notesPath, render: artifact.render },
    );
    navigator.clipboard.writeText(markdown).then(
      () => setCopied(`copied ${notes.length} note${notes.length === 1 ? '' : 's'}`),
      (error: Error) => setCopied(`copy failed: ${error.message}`),
    );
  };
  return (
    <Group justify="space-between" align="flex-end" wrap="nowrap" {...stylex.props(styles.header)}>
      <Stack gap={4}>
        <Group gap="xs"><AnchorLink to="/" size="xs">← projects</AnchorLink><Readout label>{artifact.project} · {artifact.path}</Readout></Group>
        <Title order={1} size="h2" {...stylex.props(styles.title)}>{artifact.title}</Title>
        <Group gap="sm">
          {artifact.storyboard && <Anchor href="#storyboard" size="xs">storyboard ↓</Anchor>}
          <Readout>render <Text component="b" inherit {...stylex.props(styles.hash)}>{artifact.render.hash}</Text> · modified {formatRenderTime(artifact.render.modified)}</Readout>
          {artifacts.length > 1 && (
            <NativeSelect size="xs" aria-label="Review another file" value={artifact.path}
              onChange={(e) => void navigate({ to: '/projects/$project/artifacts/$', params: { project: artifact.project, _splat: e.currentTarget.value } })}
              data={artifacts.map((a, i) => ({ value: a.path, label: `${a.path} · ${formatRenderTime(a.modified)}${i === 0 ? ' · newest' : ''}` }))} />
          )}
          <Anchor href={reviewMediaUrl(artifact)} download={artifact.path.split('/').at(-1)} size="xs"><Download size={12} /> file</Anchor>
          {artifact.srt && <Anchor href={projectFileUrl(artifact.project, artifact.srt)} download="video.srt" size="xs"><Download size={12} /> captions</Anchor>}
        </Group>
      </Stack>
      <Group gap="sm" wrap="nowrap">
        <Readout>{copied || saveState}</Readout>
        <Button leftSection={<Copy size={14} />} onClick={copyNotes} disabled={!notes.length}>Copy notes</Button>
      </Group>
    </Group>
  );
}
