import { Box, Button, Text } from '@mantine/core';
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
  // The field sits exactly where the text read and takes all its type from what surrounds it, so opening it moves
  // nothing; the hint floats below rather than pushing the next row down.
  editing: { position: 'relative', borderRadius: radius.control, backgroundColor: colors.raised, outlineWidth: '1px', outlineStyle: 'solid', outlineColor: colors.cobalt, outlineOffset: spacing.tight },
  field: {
    font: 'inherit', letterSpacing: 'inherit', color: 'inherit',
    padding: 0, margin: 0, borderWidth: 0, minHeight: 0, backgroundColor: 'transparent', resize: 'none',
  },
  // Mantine's input root and wrapper set their own line height; the field can only inherit the text's through them.
  passType: { lineHeight: 'inherit' },
  hint: { position: 'absolute', insetInlineStart: 0, top: `calc(100% + ${spacing.gap})`, zIndex: 2, whiteSpace: 'nowrap', color: colors.dim },
  problem: { color: colors.danger },
  // Below the field like the hint, but it must be read and answered, so it is a raised panel over what follows.
  changed: {
    position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: `calc(100% + ${spacing.gap})`, zIndex: 3,
    display: 'flex', flexDirection: 'column', gap: spacing.tight, padding: spacing.gap,
    borderRadius: radius.control, backgroundColor: colors.raised, outlineWidth: '1px', outlineStyle: 'solid', outlineColor: colors.danger,
  },
  theirs: { whiteSpace: 'pre-wrap' },
  choices: { display: 'flex', gap: spacing.tight },
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
  /** Opens as a field at once (its pencil was clicked), and calls `onDone` once saved or cancelled. */
  readonly startEditing?: boolean;
  readonly onDone?: () => void;
};

/**
 * Plan text edited where it reads: a click (not the end of a drag, which selects words to comment on) opens it as a
 * field, and saving writes storyboard.ts. The save names the text the field opened on, so it never overwrites an
 * agent's edit made meanwhile: the field stays open with what was typed and asks which to keep.
 */
export function PlanEditableText({ value, target, children, multiline = false, startEditing = false, onDone }: PlanEditableTextProps) {
  const { project, playback } = usePlanScreen();
  const [draft, setDraft] = useState<string | null>(startEditing ? value : null);
  // The text the field opened on. `value` follows the file while the field is open, so saving against it would
  // write over an agent's edit made meanwhile.
  const [base, setBase] = useState(value);
  // What the file held when a save was refused, until Vite's copy of the change arrives as `value`.
  const [refusedOver, setRefusedOver] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Escape closes the field, and its blur on the way out must not save what was just thrown away.
  const settled = useRef(false);
  const changedUnder = draft === null ? null : refusedOver ?? (value === base ? null : value);
  const open = (text: string) => {
    settled.current = false;
    setBase(text);
    setRefusedOver(null);
    setDraft(text);
  };
  const close = () => {
    hide();
    onDone?.();
  };
  // The field closes at once on a save, but `onDone` waits for the answer: a spoken line's caller unmounts this on
  // it, and a refused save must reopen here with what was typed.
  const hide = () => {
    settled.current = true;
    setDraft(null);
    setRefusedOver(null);
  };
  const save = async (text: string, was: string) => {
    if (settled.current) return;
    const next = multiline ? text.trim() : text.replace(/\s+/g, ' ').trim();
    hide();
    if (!next || next === was) return onDone?.();
    const answer = await editStoryboardTextFn({ data: { project, edit: { ...target, text: next, was } } });
    if ('conflict' in answer) {
      // Reopen on what was typed; the panel below it shows the file's text and asks which to keep.
      settled.current = false;
      setBase(was);
      setRefusedOver(answer.conflict.current);
      setDraft(text);
      setProblem(null);
      return;
    }
    setProblem('refused' in answer ? `Not saved: ${answer.refused}` : null);
    onDone?.();
  };
  // While the file holds other text than the field opened on, Enter and blur don't save: the reviewer picks.
  const saveUnlessChanged = (text: string) => {
    if (changedUnder === null) void save(text, base);
  };
  if (draft !== null) {
    return (
      <Box {...stylex.props(styles.editing)}>
        <Textarea
          autoFocus autosize minRows={1} variant="unstyled" aria-label="Edit"
          value={draft}
          onFocus={(event) => { if (refusedOver === null) event.currentTarget.select(); }}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => saveUnlessChanged(draft)}
          onEscape={close}
          onEnter={() => saveUnlessChanged(draft)}
          onKeyDown={(event) => event.stopPropagation()}
          classNames={{ root: stylex.props(styles.passType).className, wrapper: stylex.props(styles.passType).className, input: stylex.props(styles.field).className }}
        />
        {changedUnder === null
          ? <Text component="span" size="xs" {...stylex.props(styles.hint)}>{multiline ? '↵ saves to storyboard.ts · ⇧↵ breaks the line · Esc cancels' : '↵ saves to storyboard.ts · Esc cancels'}</Text>
          : (
            <Box {...stylex.props(styles.changed)}>
              <Text component="div" size="xs">storyboard.ts changed while you were typing. It now reads:</Text>
              <Text component="div" size="sm" {...stylex.props(styles.theirs)}>{changedUnder}</Text>
              <Box {...stylex.props(styles.choices)}>
                {/* mousedown is held so the field keeps focus and its blur doesn't run before the click. */}
                <Button size="compact-xs" onMouseDown={(event) => event.preventDefault()} onClick={() => void save(draft, changedUnder)}>Keep mine</Button>
                <Button size="compact-xs" variant="default" onMouseDown={(event) => event.preventDefault()} onClick={close}>Take the new text</Button>
              </Box>
            </Box>
          )}
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
        open(value);
      }}
      {...stylex.props(styles.shown)}
    >
      {value ? children : <Text component="span" inherit {...stylex.props(styles.empty)}>Empty: click to write it</Text>}
      {problem !== null && <Text component="div" {...stylex.props(styles.problem)}>{problem}</Text>}
    </Box>
  );
}
