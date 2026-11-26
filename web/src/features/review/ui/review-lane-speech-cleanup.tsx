import { Box, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { ReviewSpeechCleanup, ReviewSpeechRemoval } from '#lib/output/review/models/review-speech.ts';
import { reviewTimelineSpan, reviewTimelineXOf, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { editStoryboardSpeechFn } from '#web/features/storyboard/index.ts';
import { colors, fonts, typography } from '#web/shared/ui/theme.stylex.ts';
import { useReviewScreen } from './review-screen-context.tsx';

const styles = stylex.create({
  mark: {
    position: 'absolute', top: 0, height: '100%', marginLeft: '-5px', width: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, cursor: 'pointer', zIndex: 1,
    color: { default: colors.mark, ':hover': colors.cream },
  },
  // Left in: hollow, a step quieter.
  left: { color: { default: colors.dim, ':hover': colors.cream } },
  written: { color: colors.cream, cursor: 'default' },
  unheard: {
    position: 'absolute', bottom: 0, height: '2px', pointerEvents: 'none',
    backgroundImage: `repeating-linear-gradient(90deg, ${colors.dim} 0 3px, transparent 3px 6px)`,
  },
  at: (left: string) => ({ left }),
  span: (left: string, width: string) => ({ left, width }),
});

/** The storyboard edit that undoes what review sees: restore a removal, or take out what was left in. */
function reviewSpeechEditOf(r: ReviewSpeechRemoval) {
  const span = [r.from, r.to] as const;
  if (r.left === 'kept') return { list: 'keep' as const, within: span };
  if (r.left === 'no quiet') return { list: 'cut' as const, add: r.keepAt };
  // A cut the line asked for is undone by dropping it; a cleanup's removal by keeping it.
  return r.kind === 'cut' ? { list: 'cut' as const, within: span } : { list: 'keep' as const, add: r.keepAt };
}

/** ✓ once a click wrote it, ◌ left in, ✂ taken out. */
function reviewRemovalGlyph(r: ReviewSpeechRemoval, written: boolean): string {
  if (written) return '✓';
  return r.left ? '◌' : '✂';
}

const reviewRemovalTitle = (r: ReviewSpeechRemoval) => `${r.kind}${r.text ? ` “${r.text}”` : ''} · ${r.from}–${r.to} s of the take`;

function reviewRemovalAction(r: ReviewSpeechRemoval): string {
  if (r.left === 'kept') return 'Restored by its line. Click to take it out again.';
  if (r.left === 'no quiet') return 'Left in: no quiet beside it to cut in. Click to cut it anyway, into sound.';
  return 'Taken out. Click to restore it.';
}

/**
 * Over the voice lane: ✂ where a recorded line jumps over what its cleanup took out, ◌ where it left one in, and a
 * dotted underline under speech the transcript wrote no word for. A click writes the line's keep or cut into
 * storyboard.ts; the change plays from the next render.
 */
export function ReviewLaneSpeechCleanup({ view, cleanup }: { readonly view: ReviewTimelineView; readonly cleanup: ReviewSpeechCleanup }) {
  const { artifact, playback } = useReviewScreen();
  // What each mark's click answered, by its key: written, or why not.
  const [answered, setAnswered] = useState<Readonly<Record<string, string>>>({});
  const answer = (key: string, text: string) => setAnswered((was) => ({ ...was, [key]: text }));
  return (
    <>
      {cleanup.unheard.map((u) => {
        const span = reviewTimelineSpan(view, u.from, u.to);
        return span && <Box key={`${u.line}@${u.from}`} aria-hidden {...stylex.props(styles.unheard, styles.span(`${span.x}px`, `${span.w}px`))} />;
      })}
      {cleanup.removals.map((r) => {
        const x = reviewTimelineXOf(view, r.frame);
        if (x < -10 || x > view.width) return null;
        const key = `${r.line}:${r.kind}@${r.keepAt}`, said = answered[key];
        const label = (
          <Stack gap={0}>
            <Text component="span" size="sm">{reviewRemovalTitle(r)}</Text>
            {r.flag && <Text component="span" size="sm" c="dimmed">{r.flag}</Text>}
            <Text component="span" size="sm">{said ?? reviewRemovalAction(r)}</Text>
          </Stack>
        );
        return (
          <Tooltip key={key} label={label} openDelay={300} withinPortal multiline maw={320}>
            <UnstyledButton aria-label={`${reviewRemovalTitle(r)}. ${said ?? reviewRemovalAction(r)}`} fz="xs"
              {...stylex.props(styles.mark, r.left && styles.left, said !== undefined && styles.written, styles.at(`${x}px`))}
              onClick={(event) => {
                event.stopPropagation();
                playback.seek(r.frame);
                if (said !== undefined) return;
                void editStoryboardSpeechFn({ data: { project: artifact.project, edit: { scene: r.scene, line: r.line, ...reviewSpeechEditOf(r) } } })
                  .then((result) => answer(key, 'ok' in result ? 'Written to storyboard.ts: it plays so from the next render.' : result.refused));
              }}>
              {reviewRemovalGlyph(r, said !== undefined)}
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </>
  );
}
