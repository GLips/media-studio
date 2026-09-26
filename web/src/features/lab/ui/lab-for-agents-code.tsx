import { Code } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  // Wrapped rather than scrolled: a check's message is a long line of prose, and the controls column is narrow.
  block: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
});

/** A block of code or a check's output inside `LabForAgents`, copied as it's shown. */
export function LabForAgentsCode({ children }: { readonly children: ReactNode }) {
  return <Code block {...stylex.props(styles.block)}>{children}</Code>;
}
