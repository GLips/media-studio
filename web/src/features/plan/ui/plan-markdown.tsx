import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { PlanInline } from './plan-inline.tsx';

const styles = stylex.create({
  blocks: { display: 'flex', flexDirection: 'column', gap: spacing.gap },
  paragraph: { margin: 0, overflowWrap: 'anywhere' },
  list: { margin: 0, paddingInlineStart: spacing.inset, display: 'flex', flexDirection: 'column', gap: spacing.tight },
});

type PlanMarkdownBlock = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

const LIST_ITEM = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/;

/** Blank-line-separated blocks: a list where its lines start `- ` or `1. ` (an indented line runs on its item), else a paragraph. */
function planMarkdownBlocks(markdown: string): PlanMarkdownBlock[] {
  return markdown.trim().split(/\n\s*\n/).map((block): PlanMarkdownBlock => {
    const lines = block.split('\n');
    const first = LIST_ITEM.exec(lines[0]);
    if (!first) return { kind: 'p', text: lines.map((l) => l.trim()).join(' ') };
    const items: string[] = [];
    for (const line of lines) {
      const item = LIST_ITEM.exec(line);
      if (item) items.push(item[3]);
      else items[items.length - 1] += ` ${line.trim()}`;
    }
    return { kind: first[1] ? 'ul' : 'ol', items };
  });
}

/** A brief section as markdown: paragraphs (their hard line breaks joined) and lists, each with inline markdown. */
export function PlanMarkdown({ markdown }: { readonly markdown: string }) {
  return (
    <Box {...stylex.props(styles.blocks)}>
      {planMarkdownBlocks(markdown).map((block, i) => (block.kind === 'p'
        // oxlint-disable-next-line react/no-array-index-key -- blocks of one fixed string, keyed by their order in it
        ? <Text key={i} component="p" size="md" inherit {...stylex.props(styles.paragraph)}><PlanInline text={block.text} /></Text>
        : (
          // oxlint-disable-next-line react/no-array-index-key -- as above
          <Box key={i} component={block.kind} {...stylex.props(styles.list)}>
            {/* oxlint-disable-next-line react/no-array-index-key -- as above */}
            {block.items.map((item, k) => <Text key={k} component="li" size="md" inherit><PlanInline text={item} /></Text>)}
          </Box>
        )))}
    </Box>
  );
}
