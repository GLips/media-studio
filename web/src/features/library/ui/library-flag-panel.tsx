import { Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatForDisplay } from '@tanstack/react-hotkeys';
import { Flag, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { libraryFlagsInOrder, type LibraryFlag, type LibraryFlagFilter } from '#lib/footage/library/models/library-flags.ts';
import { formatReviewClockRange } from '#lib/output/review/models/review-timeline-geometry.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { focusNoteFieldAtEnd, Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen, type LibraryComposing } from './library-item-context.tsx';

/** One flag's row: a line of note over the button's block padding. */
const FLAG_ROW_HEIGHT = '28px';

const styles = stylex.create({
  // The rail's top section, as tall as the rail's row lets it (library-item-screen.tsx): the heading, the way to flag a
  // range, then the list, which keeps at least one flag's row so an open composer never hides every flag.
  panel: { display: 'grid', gridTemplateRows: `auto auto minmax(${FLAG_ROW_HEIGHT}, 1fr) auto`, height: '100%', minHeight: 0 },
  head: { height: spacing.bar, paddingInline: spacing.inset },
  heading: { color: colors.cream, fontWeight: 600 },
  count: { color: colors.dim, marginInlineEnd: 'auto' },
  action: {
    paddingInline: spacing.inset, paddingBlockEnd: spacing.gap,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  chip: { paddingInline: spacing.tight, borderRadius: radius.control, color: colors.dim, backgroundColor: { default: 'transparent', ':hover': colors.raised } },
  chipOn: { color: colors.cream, backgroundColor: colors.raised },
  hint: { minWidth: 0, flex: 1, color: colors.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  // The row's tools sit beside its button, not in it: a button can't hold buttons.
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.tight, paddingInlineEnd: spacing.tight,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    borderInlineStartWidth: '2px', borderInlineStartStyle: 'solid', borderInlineStartColor: 'transparent',
  },
  focused: { backgroundColor: colors.raised, borderInlineStartColor: colors.cream },
  open: {
    flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '28px auto minmax(0, 1fr)', columnGap: spacing.gap, alignItems: 'baseline',
    paddingInlineStart: spacing.gap, paddingBlock: spacing.tight, textAlign: 'start',
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  agent: { color: colors.caution },
  reviewer: { color: colors.cobalt },
  note: { color: colors.cream, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  bare: { color: colors.dim },
  tools: { flexShrink: 0 },
  empty: { padding: spacing.gap, color: colors.dim },
  composer: { padding: spacing.gap, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  composerHead: { color: colors.dim },
  // The draft's edge, as every composer's: cobalt.
  field: { borderColor: colors.cobalt },
  keys: { color: colors.dim, marginInlineEnd: 'auto' },
  save: { color: colors.cream, backgroundColor: colors.accent },
  // A disabled button takes no pointer, so its hint's tooltip hangs on this wrapper.
  hinted: { display: 'inline-flex' },
  refusal: { color: colors.danger },
  undoRow: { paddingInline: spacing.inset, paddingBlock: spacing.tight, color: colors.dim, backgroundColor: { default: 'transparent', ':hover': colors.raised }, width: '100%', textAlign: 'start' },
  undo: { color: colors.cream },
});

/** Written out, not read from the registry, as the render review's Undo row does: the key shows before it binds. */
const LIBRARY_UNDO_KEYS = formatForDisplay('Mod+Z');

const FILTER_LABELS: Record<LibraryFlagFilter, string> = { all: 'all', agent: 'agent', reviewer: 'yours' };

/** Who set a flag, as its row says it. */
const BY_GLYPHS: Record<LibraryFlag['by'], { glyph: string; word: string }> = { agent: { glyph: '◆', word: 'an agent' }, reviewer: { glyph: '●', word: 'you' } };

/**
 * The composer: a new flag's note over the marked range, or a flag's note changed. Enter saves, Esc leaves it. It
 * closes once the server has the change; a refused save keeps it open with the draft and says why.
 */
function LibraryFlagComposer({ composing }: { readonly composing: LibraryComposing }) {
  const { flags, changeFlags, setComposing, setMarked, refusal, saving } = useLibraryItemScreen();
  const editing = composing.kind === 'note' ? flags.flags.find((f) => f.id === composing.flag) : undefined;
  const [text, setText] = useState(editing?.note ?? '');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => focusNoteFieldAtEnd(field.current), []);
  const range = composing.kind === 'new' ? composing.range : editing;
  const save = () => {
    if (saving) return;
    if (composing.kind === 'new') {
      changeFlags({ op: 'flag.add', start: composing.range.start, end: composing.range.end, ...(text.trim() && { note: text }) }, () => {
        setMarked(null);
        setComposing(null);
      });
    } else changeFlags({ op: 'flag.note', id: composing.flag, note: text }, () => setComposing(null));
  };
  return (
    <Stack gap="tight" {...stylex.props(styles.composer)}>
      <Text size="sm" {...stylex.props(styles.composerHead)}>
        {composing.kind === 'new' ? 'New flag' : `Note on flag ${composing.flag}`} {range && <Readout>{formatReviewClockRange(range.start, range.end)}</Readout>}
      </Text>
      <Textarea ref={field} value={text} onChange={(event) => setText(event.currentTarget.value)} onEnter={save} onEscape={() => setComposing(null)}
        placeholder="What it is: a good take, a line to use, a stretch to cut (or nothing)" autosize minRows={1} maxRows={4} aria-label="Flag note"
        classNames={{ input: stylex.props(styles.field).className }} />
      {refusal && <Text size="sm" role="alert" {...stylex.props(styles.refusal)}>Not saved: {refusal}</Text>}
      <Group gap="gap" wrap="nowrap">
        <Text component="span" size="sm" {...stylex.props(styles.keys)}>Enter saves, Esc cancels</Text>
        <Button onClick={() => setComposing(null)}>Cancel</Button>
        <Button onClick={save} loading={saving} {...stylex.props(styles.save)}>{refusal ? 'Try again' : 'Save'}</Button>
      </Group>
    </Stack>
  );
}

/** `Removed #3 · Undo ⌘Z`, in the removed flag's place for a few seconds. */
function LibraryFlagUndoRow({ flag, onUndo }: { readonly flag: LibraryFlag; readonly onUndo: () => void }) {
  return (
    <UnstyledButton onClick={onUndo} {...stylex.props(styles.undoRow)}>
      <Text component="span" size="sm" inherit>
        Removed #{flag.id} · <Text component="span" inherit {...stylex.props(styles.undo)}>Undo</Text> <Readout>{LIBRARY_UNDO_KEYS}</Readout>
      </Text>
    </UnstyledButton>
  );
}

function LibraryFlagRow({ flag }: { readonly flag: LibraryFlag }) {
  const { focused, focusFlag, setComposing, removeFlag } = useLibraryItemScreen();
  const on = focused?.id === flag.id;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on) row.current?.scrollIntoView({ block: 'nearest' });
  }, [on]);
  return (
    <Box ref={row} {...stylex.props(styles.row, on && styles.focused)}>
      <UnstyledButton aria-current={on || undefined} onClick={() => focusFlag(on ? undefined : flag)} onDoubleClick={() => setComposing({ kind: 'note', flag: flag.id })}
        {...stylex.props(styles.open)}>
        <HotkeyTooltip name={`Set by ${BY_GLYPHS[flag.by].word}`}>
          <Text component="span" size="sm" {...stylex.props(styles[flag.by])}>{BY_GLYPHS[flag.by].glyph} {flag.id}</Text>
        </HotkeyTooltip>
        <Readout bright={on}>{formatReviewClockRange(flag.start, flag.end)}</Readout>
        <Text component="span" size="sm" {...stylex.props(flag.note ? styles.note : styles.bare)}>{flag.note ?? 'no note'}</Text>
      </UnstyledButton>
      <Group gap={0} wrap="nowrap" {...stylex.props(styles.tools)}>
        <IconButton name="Edit note" onClick={() => setComposing({ kind: 'note', flag: flag.id })}><Pencil size={12} /></IconButton>
        <IconButton name="Remove flag" onClick={() => removeFlag(flag)}><Trash2 size={12} /></IconButton>
      </Group>
    </Box>
  );
}

/**
 * The rail's flags: a heading with their count and whose to show, the way to flag a range, then the flags in the
 * order N steps through. A row's click opens it looping; a double click edits its note; a removed one offers Undo in
 * its place. The composer below writes a new flag's note or edits one.
 */
export function LibraryFlagPanel() {
  const { flags, queue, filter, setFilter, focused, marked, composing, setComposing, removedShown, undoRemove } = useLibraryItemScreen();
  const at = focused ? queue.findIndex((f) => f.id === focused.id) : -1;
  // The removed flag's Undo stands where it stood in the queue, so the rows under the pointer don't shift.
  const undoAt = removedShown && libraryFlagsInOrder([...queue, removedShown], filter).indexOf(removedShown);
  const rows = queue.map((flag) => <LibraryFlagRow key={flag.id} flag={flag} />);
  if (removedShown && undoRemove && undoAt !== undefined && undoAt >= 0) {
    rows.splice(undoAt, 0, <LibraryFlagUndoRow key={`removed ${removedShown.id}`} flag={removedShown} onUndo={undoRemove} />);
  }
  return (
    <Box {...stylex.props(styles.panel)}>
      <Group gap="gap" wrap="nowrap" {...stylex.props(styles.head)}>
        <Text component="h2" size="sm" m={0} {...stylex.props(styles.heading)}>Flags</Text>
        <Text component="span" size="sm" {...stylex.props(styles.count)}>{at >= 0 ? `${at + 1} of ${queue.length}` : flags.flags.length || ''}</Text>
        <Group gap="hairline" wrap="nowrap">
          {(['all', 'agent', 'reviewer'] as const).map((by) => (
            <HotkeyTooltip key={by} name={`Flags: ${FILTER_LABELS[by]}`} hotkey="Whose flags">
              <UnstyledButton aria-pressed={filter === by} onClick={() => setFilter(by)} {...stylex.props(styles.chip, filter === by && styles.chipOn)}>
                <Text component="span" size="sm" inherit>{FILTER_LABELS[by]}</Text>
              </UnstyledButton>
            </HotkeyTooltip>
          ))}
        </Group>
      </Group>
      <Group gap="gap" wrap="nowrap" {...stylex.props(styles.action)}>
        <Text component="span" size="sm" {...stylex.props(styles.hint)}>
          {marked ? 'F flags the marked range' : 'Drag on the timeline or select words to mark a range'}
        </Text>
        <HotkeyTooltip name={marked ? 'Flag the marked range' : 'Or mark one with I and O as it plays'} hotkey="Flag range">
          <Box component="span" {...stylex.props(styles.hinted)}>
            <Button size="compact-xs" leftSection={<Flag size={12} />} disabled={!marked || composing !== null}
              onClick={() => marked && setComposing({ kind: 'new', range: marked })}>
              Flag range
            </Button>
          </Box>
        </HotkeyTooltip>
      </Group>
      <FadeScroll>
        {queue.length === 0 && !removedShown && (
          <Text size="sm" {...stylex.props(styles.empty)}>
            {flags.flags.length ? 'None of these.' : 'No flags yet.'}
          </Text>
        )}
        {rows}
      </FadeScroll>
      {composing && <LibraryFlagComposer key={composing.kind === 'note' ? composing.flag : 'new'} composing={composing} />}
    </Box>
  );
}
