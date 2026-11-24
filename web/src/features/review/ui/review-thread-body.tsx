import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useLayoutEffect, useRef, useState } from 'react';
import { StudioMarkdown } from '#web/shared/ui/studio-markdown.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';

/** Lines a clamped note shows before its `… more`. */
const REVIEW_NOTE_CLAMP_LINES = 4;

const styles = stylex.create({
  body: { color: colors.cream },
  dim: { color: colors.dim },
  clamped: (height: number) => ({ maxHeight: `${height}px`, overflow: 'hidden' }),
  more: {
    paddingInline: spacing.hairline, marginInlineStart: `calc(-1 * ${spacing.hairline})`,
    color: { default: colors.dim, ':hover': colors.cream },
  },
});

/**
 * How tall `lines` lines of the element's text stand, measured from its laid-out line boxes, or null when it has no
 * more lines than that. CSS line-clamp can't do this: a note's paragraphs and lists sit in a flex column, which it
 * doesn't count through.
 */
function reviewClampHeightOf(element: HTMLElement, lines: number): number | null {
  const range = document.createRange();
  range.selectNodeContents(element);
  const top = element.getBoundingClientRect().top;
  const bottoms = [...new Set([...range.getClientRects()].map((r) => Math.round(r.bottom - top)))].filter((b) => b > 0).toSorted((a, b) => a - b);
  return bottoms.length > lines ? bottoms[lines - 1] : null;
}

type ReviewThreadBodyProps = {
  readonly text: string;
  readonly dim?: boolean;
  /** Held to a few whole lines with a `… more` that lets the rest out, when the words run longer. */
  readonly clamp?: boolean;
};

/**
 * A note or reply as written, in the markdown agents write (bold, emphasis, `code` and lists), its single line breaks
 * kept. Headings, links and tables stay as typed: a note is prose, and a thread is no place for a document.
 */
export function ReviewThreadBody({ text, dim = false, clamp = false }: ReviewThreadBodyProps) {
  const box = useRef<HTMLDivElement>(null);
  const [unclamped, setUnclamped] = useState(false);
  const [clampHeight, setClampHeight] = useState<number | null>(null);
  const clamped = clamp && !unclamped;
  // Measured at the panel's width, and again as it changes: only layout knows where the fourth line ends.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !clamped) return undefined;
    const measure = () => setClampHeight(reviewClampHeightOf(element, REVIEW_NOTE_CLAMP_LINES));
    measure();
    const observer = new ResizeObserver(measure);
    // The panel's width and the words both move the fourth line: the parent shows the one, the markdown the other.
    if (element.parentElement) observer.observe(element.parentElement);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [clamped]);
  return (
    <>
      <Box ref={box} {...stylex.props(styles.body, dim && styles.dim, clamped && clampHeight !== null && styles.clamped(clampHeight))}>
        <StudioMarkdown markdown={text} breaks />
      </Box>
      {clamp && clampHeight !== null && (
        <UnstyledButton
          aria-expanded={unclamped}
          onClick={(event) => {
            // The row's own click opens the note and seeks: this one only lets the words out.
            event.stopPropagation();
            setUnclamped(!unclamped);
          }}
          {...stylex.props(styles.more)}
        >
          <Text component="span" size="sm" inherit>{unclamped ? 'less' : '… more'}</Text>
        </UnstyledButton>
      )}
    </>
  );
}
