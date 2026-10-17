import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { planAnchorOn, planTargetAttributes, type PlanTarget } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';

const styles = stylex.create({
  box: {
    position: 'relative', minWidth: 0, borderRadius: radius.control, cursor: 'text',
    outlineWidth: '1px', outlineStyle: 'solid', outlineColor: 'transparent', outlineOffset: spacing.hairline,
    backgroundColor: { default: 'transparent', ':hover': colors.panel },
  },
  // The target `N` notes: lifted onto the panel, with a quiet outline.
  targeted: { outlineColor: colors.line, backgroundColor: colors.panel },
  // The draft's: cobalt, the draft's colour everywhere in the studio.
  drafted: { outlineColor: colors.cobalt },
});

const sameTarget = (a: PlanTarget | null, b: PlanTarget) => a !== null && JSON.stringify(a) === JSON.stringify(b);

type PlanTargetBoxProps = {
  readonly target: PlanTarget;
  readonly children: ReactNode;
  readonly component?: 'div' | 'li' | 'span';
};

/**
 * Something a note can be on: a cell, a line, a brief section or a left-out item. A click (not the end of a drag across
 * words, which is a selection to quote) makes it what `N` notes; the draft's own target carries a cobalt outline.
 */
export function PlanTargetBox({ target, children, component = 'div' }: PlanTargetBoxProps) {
  const { target: current, setTarget, draft, plan } = usePlanScreen();
  const drafted = draft.isOpen && draft.anchor.on === 'plan' && planAnchorOn(draft.anchor, target, plan.storyboard.leftOut);
  return (
    <Box
      component={component}
      onClick={() => {
        if (window.getSelection()?.isCollapsed ?? true) setTarget(target);
      }}
      {...planTargetAttributes(target)}
      {...stylex.props(styles.box, sameTarget(current, target) && styles.targeted, drafted && styles.drafted)}
    >
      {children}
    </Box>
  );
}
