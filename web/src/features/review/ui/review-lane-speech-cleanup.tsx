import { Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { ReviewSpeechCleanup, ReviewSpeechRemoval } from '#lib/output/review/models/review-speech.ts';
import { reviewTimelineSpan, reviewTimelineXOf, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { editStoryboardSpeechFn, type StoryboardSpeechEdit } from '#web/features/storyboard/index.ts';
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
  // A strip along the lane's foot, dotted, that cuts the speech over it on a click.
  unheard: {
    position: 'absolute', bottom: 0, height: '4px', cursor: 'pointer', zIndex: 1,
    backgroundImage: `repeating-linear-gradient(90deg, ${colors.dim} 0 3px, transparent 3px 6px)`,
    backgroundSize: '100% 2px', backgroundRepeat: 'no-repeat', backgroundPosition: 'bottom',
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
  return r.cut ? { list: 'cut' as const, within: span } : { list: 'keep' as const, add: r.keepAt };
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
 * dotted underline under speech the transcript wrote no word for, to cut. A click writes the line's keep or cut into
 * storyboard.ts; the change plays from the next render.
 */
export function ReviewLaneSpeechCleanup({ view, cleanup }: { readonly view: ReviewTimelineView; readonly cleanup: ReviewSpeechCleanup }) {
  const { artifact, playback } = useReviewScreen();
  // What each mark's click answered on this render, by its key: written, or why not. Another render starts afresh.
  const [answers, setAnswers] = useState<{ hash: string; said: Readonly<Record<string, string>> }>({ hash: artifact.render.hash, said: {} });
  const answered = answers.hash === artifact.render.hash ? answers.said : {};
  const answer = (key: string, text: string) => setAnswers({ hash: artifact.render.hash, said: { ...answered, [key]: text } });
  const write = (key: string, edit: StoryboardSpeechEdit) => {
    void editStoryboardSpeechFn({ data: { project: artifact.project, edit } })
      .then((result) => answer(key, 'ok' in result ? 'Written to storyboard.ts: it plays so from the next render.' : result.refused));
  };
  return (
    <>
      {cleanup.unheard.map((u) => {
        const span = reviewTimelineSpan(view, u.from, u.to);
        if (!span) return null;
        const key = `${u.line}:unheard@${u.cutAt}`, said = answered[key];
        const action = said ?? 'Speech the transcript has no words for. Click to cut it.';
        return (
          <Tooltip key={key} label={action} openDelay={300} withinPortal multiline maw={320}>
            <UnstyledButton aria-label={action} {...stylex.props(styles.unheard, styles.span(`${span.x}px`, `${span.w}px`))}
              onClick={(event) => {
                event.stopPropagation();
                playback.seek(u.from);
                if (said === undefined) write(key, { scene: u.scene, line: u.line, list: 'cut', add: u.cutAt });
              }} />
          </Tooltip>
        );
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
                write(key, { scene: r.scene, line: r.line, ...reviewSpeechEditOf(r) });
              }}>
              {reviewRemovalGlyph(r, said !== undefined)}
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </>
  );
}
