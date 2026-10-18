import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type ReactNode } from 'react';
import { editStoryboardTextFn } from '#web/features/storyboard/index.ts';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';

const styles = stylex.create({
  shown: {
    position: 'relative', borderRadius: radius.control, cursor: 'text', minWidth: 0,
    outlineWidth: '1px', outlineStyle: 'solid', outlineColor: { default: 'transparent', ':hover': colors.line }, outlineOffset: spacing.tight,
  },
  empty: { color: colors.dim, fontStyle: 'italic' },
  editing: { display: 'flex', flexDirection: 'column', gap: spacing.tight },
  field: {
    borderRadius: radius.control, backgroundColor: colors.raised,
    outlineWidth: '1px', outlineStyle: 'solid', outlineColor: colors.cobalt, outlineOffset: spacing.tight,
  },
  hint: { color: colors.dim },
  problem: { color: colors.danger },
});

/** Where an edited text lives in storyboard.ts, as editStoryboardTextFn takes it. */
export type PlanTextTarget =
  | { field: 'onScreen' | 'motion'; scene: string }
  | { field: 'reads'; scene: string; index: number }
  | { field: 'line'; scene: string; line: string }
  | { field: 'brief'; section: string }
  | { field: 'leftOut'; index: number };

type PlanEditableTextProps = {
  /** The text as storyboard.ts holds it now. */
  readonly value: string;
  /** Where in storyboard.ts it lives. */
  readonly target: PlanTextTarget;
  /** How it reads when not being edited. */
  readonly children: ReactNode;
  /** Keeps its line breaks (a brief section); a spoken line is folded onto one. Shift+Enter breaks a line either way. */
  readonly multiline?: boolean;
  /** The field's text size while editing, to match what it replaces. */
  readonly size?: 'md' | 'prose' | 'line';
  /** Opens as a field at once (its pencil was clicked), and calls `onDone` once saved or cancelled. */
  readonly startEditing?: boolean;
  readonly onDone?: () => void;
};

/**
 * Plan text edited where it reads: a click (not the end of a drag, which selects words to comment on) opens it as a
 * field, and saving writes storyboard.ts, which the page re-times from once Vite sends the new copy. An edit to text
 * the agent changed meanwhile is refused, never merged.
 */
export function PlanEditableText({ value, target, children, multiline = false, size = 'md', startEditing = false, onDone }: PlanEditableTextProps) {
  const { project, playback } = usePlanScreen();
  const [draft, setDraft] = useState<string | null>(startEditing ? value : null);
  const [problem, setProblem] = useState<string | null>(null);
  // Escape closes the field, and its blur on the way out must not save what was just thrown away.
  const settled = useRef(false);
  const close = () => {
    settled.current = true;
    setDraft(null);
    onDone?.();
  };
  const save = async (text: string) => {
    if (settled.current) return;
    close();
    const next = multiline ? text.trim() : text.replace(/\s+/g, ' ').trim();
    if (!next || next === value) return;
    const answer = await editStoryboardTextFn({ data: { project, edit: { ...target, text: next, was: value } } });
    if ('conflict' in answer) setProblem(`Not saved: storyboard.ts changed meanwhile, and now reads “${answer.conflict.current}”.`);
    else if ('refused' in answer) setProblem(`Not saved: ${answer.refused}`);
    else setProblem(null);
  };
  if (draft !== null) {
    return (
      <Box {...stylex.props(styles.editing)}>
        <Textarea
          autoFocus autosize minRows={1} maxRows={14} size={size} variant="unstyled" aria-label="Edit"
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => void save(draft)}
          onEscape={close}
          onEnter={() => void save(draft)}
          onKeyDown={(event) => event.stopPropagation()}
          {...stylex.props(styles.field)}
        />
        <Text component="span" size="xs" {...stylex.props(styles.hint)}>{multiline ? '↵ saves to storyboard.ts · ⇧↵ breaks the line · Esc cancels' : '↵ saves to storyboard.ts · Esc cancels'}</Text>
      </Box>
    );
  }
  return (
    <Box
      onClick={(event) => {
        if (!(window.getSelection()?.isCollapsed ?? true)) return;
        event.stopPropagation();
        playback.pause();
        setProblem(null);
        settled.current = false;
        setDraft(value);
      }}
      {...stylex.props(styles.shown)}
    >
      {value ? children : <Text component="span" inherit {...stylex.props(styles.empty)}>Empty: click to write it</Text>}
      {problem !== null && <Text component="div" {...stylex.props(styles.problem)}>{problem}</Text>}
    </Box>
  );
}
