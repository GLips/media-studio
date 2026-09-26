import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import type { ReviewArtifact, ReviewArtifactStatus } from '#models/review/review-artifact.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { formatRenderTime } from './review-note-format.ts';

type ReviewBannersProps = {
  readonly artifact: ReviewArtifact;
  /** The file on disk now, or why it can't be read. */
  readonly disk: { status: ReviewArtifactStatus } | { error: string };
  readonly onLoadReplacement: () => void;
};

/**
 * What the person should know before trusting what's on screen: the voice is a draft, the file was replaced or there's
 * a newer one, a note field can't be filled, the cue list isn't the one playing, frames count from a slice's start or
 * at a guessed rate.
 */
export function ReviewBanners({ artifact, disk, onLoadReplacement }: ReviewBannersProps) {
  const status = 'status' in disk ? disk.status : null;
  const replaced = status && status.render.hash !== artifact.render.hash ? status.render : null;
  const newest = status?.artifacts[0];
  const newer = !replaced && newest && newest.path !== artifact.path && newest.modified > artifact.render.modified ? newest : null;
  return (
    <Stack gap="xs">
      {artifact.voice === 'draft' && (
        <Alert color="red" variant="filled" title="DRAFT VOICE">
          macOS say read this render's lines (studio voice --read=draft): judge its timing, not its voice, and don't share it.
        </Alert>
      )}
      {replaced && (
        <Alert color="red" variant="filled">
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">
              <b>{artifact.path} was replaced on disk</b> (render {replaced.hash}, {formatRenderTime(replaced.modified)}). You're reviewing render{' '}
              {artifact.render.hash} from {formatRenderTime(artifact.render.modified)}, and new notes are stamped with it.
            </Text>
            <Button color="dark" onClick={onLoadReplacement}>Load the new render</Button>
          </Group>
        </Alert>
      )}
      {'error' in disk && <Alert color="red">Can't read {artifact.path} on disk: {disk.error}</Alert>}
      {newer && (
        <Alert color="orange">
          A newer file is on disk: {newer.path}, {formatRenderTime(newer.modified)}.{' '}
          <AnchorLink to="/projects/$project/artifacts/$" params={{ project: artifact.project, _splat: newer.path }}>Open it</AnchorLink>
        </Alert>
      )}
      {artifact.missing.map((m) => <Alert key={m} color="gray">No {m}</Alert>)}
      {artifact.cueListPlayed === false && <Alert color="gray">This render doesn't play sfx/cues.json: its cue-list markers show where the list would sound.</Alert>}
      {!!artifact.startsAt && <Alert color="gray">A slice: its frame 0 is the video's frame {artifact.startsAt}, and frames here count from it.</Alert>}
      {artifact.kind === 'video' && !artifact.fps && <Alert color="gray">No snapshot for this file: frames are counted at 30 fps.</Alert>}
    </Stack>
  );
}
