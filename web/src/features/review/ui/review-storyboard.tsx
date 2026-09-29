import { Box, Group, Image, Paper, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { formatReviewMoment, type ReviewNote } from '#lib/output/review/models/review-notes.ts';
import type { ReviewStoryboardCard, ReviewStoryboardStill } from '#lib/output/review/models/review-storyboard.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { formatTimelineMomentName } from './review-note-format.ts';
import { reviewStillUrl } from './review-media-urls.ts';
import { ReviewNoteNumber } from './review-note-number.tsx';
import { ReviewSceneRung } from './review-scene-rung.tsx';

const styles = stylex.create({
  storyboard: { marginTop: spacing.sectionGap, scrollMarginTop: spacing.gap },
  card: { borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}`, borderColor: 'transparent' },
  onScreen: { borderColor: colors.cream },
  still: { display: 'block', width: '100%' },
  image: { aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '4px', backgroundColor: colors.screen, borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line },
  stillOn: { borderColor: colors.cream },
  checker: {
    backgroundColor: colors.checkerLight,
    backgroundImage: `repeating-conic-gradient(${colors.checkerDark} 0 25%, transparent 0 50%)`,
    backgroundSize: '16px 16px',
  },
  code: { fontFamily: fonts.mono, color: colors.dim },
  kind: { fontFamily: fonts.mono, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontStyle: 'normal' },
  cue: { color: colors.cue },
  replay: { color: colors.replay },
  landmark: { color: colors.accent },
  line: { color: colors.dim },
  estimated: { fontFamily: fonts.mono, color: colors.accent, fontStyle: 'normal' },
});

type ReviewStoryboardProps = {
  readonly artifact: ReviewArtifact;
  readonly cards: readonly ReviewStoryboardCard[];
  readonly fps: number;
  readonly frame: number;
  /** In frame order, numbered as the list numbers them. */
  readonly notes: readonly ReviewNote[];
  readonly onSeek: (frame: number) => void;
};

/**
 * A card per scene: its number, id, rung, time and timing, its note, the review notes inside it, and its stills, each
 * captioned with what the timeline names on that frame or the line spoken there. The card on screen lights up.
 */
export function ReviewStoryboard({ artifact, cards, fps, frame, notes, onSeek }: ReviewStoryboardProps) {
  return (
    <Stack id="storyboard" gap="sm" {...stylex.props(styles.storyboard)}>
      <Title order={2}><Readout label>storyboard · {cards.length} scenes · click a still to go to it</Readout></Title>
      {cards.map((card) => (
        <Paper key={card.id} withBorder {...stylex.props(styles.card, frame >= card.from && frame < card.to && styles.onScreen)}>
          <UnstyledButton onClick={() => onSeek(Math.max(card.from, 0))}>
            <Group gap="xs" align="baseline">
              <Readout>{card.n}</Readout>
              <Text fw={700}>{card.id}</Text>
              {card.rung && <ReviewSceneRung rung={card.rung} />}
              {notes.map((n, i) => n.frame !== undefined && n.frame >= card.from && n.frame < card.to && <ReviewNoteNumber key={n.id} n={i + 1} title={n.text} />)}
              <Readout>{formatReviewMoment(Math.max(card.from, 0), fps)} · {((card.to - card.from) / fps).toFixed(1)}s{card.timing ? ` · ${card.timing}` : ''}</Readout>
            </Group>
          </UnstyledButton>
          {card.note && <Text size="sm" c="dimmed">{card.note}</Text>}
          <SimpleGrid cols={{ base: 2, lg: 3, xl: 4 }} spacing="sm" mt="sm">
            {card.stills.map((still) => (
              <UnstyledButton key={`${still.frame}:${still.line?.id ?? 'named'}`} {...stylex.props(styles.still)} onClick={() => onSeek(still.frame)}>
                <Image src={reviewStillUrl(artifact, still.frame, fps)} loading="lazy" alt="" {...stylex.props(styles.image, artifact.transparent && styles.checker, frame === still.frame && styles.stillOn)} />
                <ReviewStillCaption still={still} scene={card.id} />
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Paper>
      ))}
    </Stack>
  );
}

/** The frame's named moments, the scene's own first (landmark, then cue), the replays landing there counted, and its line. */
function ReviewStillCaption({ still, scene }: { readonly still: ReviewStoryboardStill; readonly scene: string }) {
  const rank = { landmark: 0, cue: 1, line: 2, replay: 3 };
  const own = still.moments.filter((m) => m.kind !== 'replay').toSorted((a, b) => rank[a.kind] - rank[b.kind]);
  const replays = still.moments.filter((m) => m.kind === 'replay');
  return (
    <Stack gap={1} mt={4}>
      <Readout>f{still.frame}</Readout>
      {own.map((m) => (
        <Text key={`${m.kind}:${m.name}`} size="xs">
          <Text component="i" size="micro" {...stylex.props(styles.kind, styles[m.kind])}>{m.kind}</Text>{' '}
          <Text component="b" inherit>{formatTimelineMomentName(m, scene)}</Text>{' '}
          <Text component="code" size="xs" {...stylex.props(styles.code)}>{m.at}</Text>
        </Text>
      ))}
      {replays.length > 0 && (
        <Text size="xs">
          <Text component="i" size="micro" {...stylex.props(styles.kind, styles.replay)}>{replays.length === 1 ? 'replay' : `${replays.length} replays`}</Text>{' '}
          <Text component="code" size="xs" {...stylex.props(styles.code)}>{replays.map((m) => m.at.split(' on ')[0]).join(', ')}</Text>
        </Text>
      )}
      {still.line && (
        <Box>
          <Text component="code" size="xs" {...stylex.props(styles.code)}>{still.line.id}</Text>
          {!still.line.voiced && <Text component="em" size="micro" {...stylex.props(styles.estimated)}> estimated</Text>}
          <Text size="xs">“{still.line.text}”</Text>
        </Box>
      )}
    </Stack>
  );
}
