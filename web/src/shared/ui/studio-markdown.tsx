import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { StudioInline } from './studio-inline.tsx';
import { spacing } from './theme.stylex.ts';

const styles = stylex.create({
  blocks: { display: 'flex', flexDirection: 'column', gap: spacing.gap },
  paragraph: { margin: 0, overflowWrap: 'anywhere' },
  breaks: { whiteSpace: 'pre-wrap' },
  list: { margin: 0, paddingInlineStart: spacing.inset, display: 'flex', flexDirection: 'column', gap: spacing.tight },
});

type StudioMarkdownBlock = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

const LIST_ITEM = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/;

/**
 * Blank-line-separated blocks, each split into runs: lines starting `- ` or `1. ` are a list (an indented line runs on
 * its item), the rest paragraphs. A list straight under its lead-in (`Changed:` then `- …`) is a list, as written.
 */
function studioMarkdownBlocks(markdown: string): StudioMarkdownBlock[] {
  const blocks: StudioMarkdownBlock[] = [];
  for (const block of markdown.trim().split(/\n\s*\n/)) {
    let last: StudioMarkdownBlock | undefined;
    for (const line of block.split('\n')) {
      const item = LIST_ITEM.exec(line);
      if (item) {
        const kind = item[1] ? 'ul' : 'ol';
        if (last?.kind === kind) last.items.push(item[3]);
        else blocks.push(last = { kind, items: [item[3]] });
      } else if (last && last.kind !== 'p' && /^\s/.test(line)) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
      } else if (last?.kind === 'p') {
        last.lines.push(line.trim());
      } else {
        blocks.push(last = { kind: 'p', lines: [line.trim()] });
      }
    }
  }
  return blocks;
}

type StudioMarkdownProps = {
  readonly markdown: string;
  /** Keep a paragraph's single line breaks, as a note typed by hand means them; else they join, as a wrapped brief's do. */
  readonly breaks?: boolean;
};

/** Markdown as the studio writes it: paragraphs and lists, each with inline markdown. Its text inherits its colour. */
export function StudioMarkdown({ markdown, breaks = false }: StudioMarkdownProps) {
  return (
    <Box {...stylex.props(styles.blocks)}>
      {studioMarkdownBlocks(markdown).map((block, i) => (block.kind === 'p'
        // oxlint-disable-next-line react/no-array-index-key -- blocks of one fixed string, keyed by their order in it
        ? <Text key={i} component="p" size="md" inherit {...stylex.props(styles.paragraph, breaks && styles.breaks)}><StudioInline text={block.lines.join(breaks ? '\n' : ' ')} /></Text>
        : (
          // oxlint-disable-next-line react/no-array-index-key -- as above
          <Box key={i} component={block.kind} {...stylex.props(styles.list)}>
            {/* oxlint-disable-next-line react/no-array-index-key -- as above */}
            {block.items.map((item, k) => <Text key={k} component="li" size="md" inherit><StudioInline text={item} /></Text>)}
          </Box>
        )))}
    </Box>
  );
}
