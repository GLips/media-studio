import { Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  paragraph: { color: colors.cream, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 },
  dim: { color: colors.dim },
  code: {
    fontFamily: fonts.mono, backgroundColor: colors.raised,
    borderRadius: radius.control, paddingInline: spacing.hairline,
  },
});

/** A piece of text keyed by where it starts, which is stable for text that never changes in place. */
type ReviewTextPiece = { at: number; text: string };

function piecesOf(text: string, separator: RegExp): ReviewTextPiece[] {
  const pieces: ReviewTextPiece[] = [];
  let at = 0;
  for (const match of text.matchAll(separator)) {
    pieces.push({ at, text: text.slice(at, match.index) });
    at = match.index + match[0].length;
  }
  return [...pieces, { at, text: text.slice(at) }];
}

/** Odd pieces between backticks are inline code; with an unclosed backtick the paragraph is all text. */
function inlineCodeOf(paragraph: string): (ReviewTextPiece & { code: boolean })[] {
  const pieces = piecesOf(paragraph, /`/g);
  if (pieces.length % 2 === 0) return [{ at: 0, text: paragraph, code: false }];
  return pieces.map(({ at, text }, i) => ({ at, text, code: i % 2 === 1 })).filter((p) => p.text);
}

/**
 * A note or reply as written: its paragraphs kept, single line breaks kept, and `inline code` set in mono. Nothing
 * more of markdown: a note is prose, and anything else reads as typed.
 */
export function ReviewThreadBody({ text, dim = false }: { readonly text: string; readonly dim?: boolean }) {
  // A blank line between paragraphs reads as one: a gap that holds it apart from a single line break.
  return (
    <Stack gap="gap">
      {piecesOf(text.trim(), /\n{2,}/g).map((paragraph) => (
        <Text key={paragraph.at} component="p" size="md" {...stylex.props(styles.paragraph, dim && styles.dim)}>
          {inlineCodeOf(paragraph.text).map((span) => (span.code
            ? <Text key={span.at} component="code" size="xs" {...stylex.props(styles.code)}>{span.text}</Text>
            : <Text key={span.at} component="span" inherit>{span.text}</Text>))}
        </Text>
      ))}
    </Stack>
  );
}
