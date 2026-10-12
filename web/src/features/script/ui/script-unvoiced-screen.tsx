import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewScriptRead } from '../controllers/review-script.ts';
import { ScriptLineRow, type ScriptLineActions } from './script-line-row.tsx';

const styles = stylex.create({
  crumb: { color: colors.cream, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  project: { color: colors.dim },
  // The read-along's column (script-lines.tsx).
  list: { paddingBlock: spacing.inset, maxWidth: '84ch', marginInline: 'auto' },
});

const SCRIPT_UNVOICED_ACTIONS: ScriptLineActions = { seek: () => undefined, openThread: () => undefined };

/**
 * A script with no take yet (`studio voice` hasn't run): its lines, dim, with nothing to play. Notes and the sign-off
 * need the take the review's thread is read against.
 */
export function ScriptUnvoicedScreen({ project, script }: { readonly project: string; readonly script: ReviewScriptRead }) {
  return (
    <StudioShell start={<Text component="span" size="sm" {...stylex.props(styles.crumb)}><Text component="span" inherit {...stylex.props(styles.project)}>{project} / </Text>script</Text>}>
      <FadeScroll>
        <Text component="div" size="lg" {...stylex.props(styles.list)}>
          {script.lines.map((line, i) => (
            <ScriptLineRow key={line.id} line={line} index={i} timed={null} threads={[]} draftRun={null} actions={SCRIPT_UNVOICED_ACTIONS}
              highlight={{ current: false, focused: false }} />
          ))}
        </Text>
      </FadeScroll>
    </StudioShell>
  );
}
