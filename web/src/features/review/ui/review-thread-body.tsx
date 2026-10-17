import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { StudioMarkdown } from '#web/shared/ui/studio-markdown.tsx';
import { colors } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  body: { color: colors.cream },
  dim: { color: colors.dim },
});

/**
 * A note or reply as written, in the markdown agents write (bold, emphasis, `code` and lists), its single line breaks
 * kept. Headings, links and tables stay as typed: a note is prose, and a thread is no place for a document.
 */
export function ReviewThreadBody({ text, dim = false }: { readonly text: string; readonly dim?: boolean }) {
  return (
    <Box {...stylex.props(styles.body, dim && styles.dim)}>
      <StudioMarkdown markdown={text} breaks />
    </Box>
  );
}
