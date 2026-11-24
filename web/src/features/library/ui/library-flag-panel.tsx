import { Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Flag, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LibraryFlag, LibraryFlagFilter } from '#lib/footage/library/models/library-flags.ts';
import { formatReviewClockRange } from '#lib/output/review/models/review-timeline-geometry.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { focusNoteFieldAtEnd, Textarea } from '#web/shared/ui/textarea.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen, type LibraryComposing } from './library-item-context.tsx';

const styles = stylex.create({
  panel: { display: 'grid', gridTemplateRows: `${spacing.row} minmax(0, 1fr) auto`, height: '100%', minHeight: 0 },
  head: { paddingInline: spacing.gap, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  chip: { paddingInline: spacing.tight, borderRadius: radius.control, color: colors.dim, backgroundColor: { default: 'transparent', ':hover': colors.raised } },
  chipOn: { color: colors.cream, backgroundColor: colors.raised },
  step: { color: colors.dim, marginInlineStart: 'auto' },
  // The row's tools sit beside its button, not in it: a button can't hold buttons.
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.tight, paddingInlineEnd: spacing.tight,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    borderInlineStartWidth: '2px', borderInlineStartStyle: 'solid', borderInlineStartColor: 'transparent',
  },
  focused: { backgroundColor: colors.raised, borderInlineStartColor: colors.cream },
  open: {
    flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '28px 120px minmax(0, 1fr)', columnGap: spacing.gap, alignItems: 'baseline',
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
});

const FILTER_LABELS: Record<LibraryFlagFilter, string> = { all: 'all', agent: 'agent', reviewer: 'yours' };

/** Who set a flag, as its row says it. */
const BY_GLYPHS: Record<LibraryFlag['by'], { glyph: string; word: string }> = { agent: { glyph: '◆', word: 'an agent' }, reviewer: { glyph: '●', word: 'you' } };

/** The composer: a new flag's note over the marked range, or a flag's note changed. Enter saves, Esc leaves it. */
function LibraryFlagComposer({ composing }: { readonly composing: LibraryComposing }) {
  const { flags, changeFlags, setComposing, setMarked, refusal } = useLibraryItemScreen();
  const editing = composing.kind === 'note' ? flags.flags.find((f) => f.id === composing.flag) : undefined;
  const [text, setText] = useState(editing?.note ?? '');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => focusNoteFieldAtEnd(field.current), []);
  const range = composing.kind === 'new' ? composing.range : editing;
  const save = () => {
    if (composing.kind === 'new') {
      changeFlags({ op: 'flag.add', start: composing.range.start, end: composing.range.end, ...(text.trim() && { note: text }) });
      setMarked(null);
    } else changeFlags({ op: 'flag.note', id: composing.flag, note: text });
    setComposing(null);
  };
  return (
    <Stack gap="tight" {...stylex.props(styles.composer)}>
      <Text size="sm" {...stylex.props(styles.composerHead)}>
        {composing.kind === 'new' ? 'New flag' : `Note on flag ${composing.flag}`} {range && <Readout>{formatReviewClockRange(range.start, range.end)}</Readout>}
      </Text>
      <Textarea ref={field} value={text} onChange={(event) => setText(event.currentTarget.value)} onEnter={save} onEscape={() => setComposing(null)}
        placeholder="What it is: a good take, a line to use, a stretch to cut (or nothing)" autosize minRows={1} maxRows={4} aria-label="Flag note"
        classNames={{ input: stylex.props(styles.field).className }} />
      {refusal && <Text size="sm" {...stylex.props(styles.refusal)}>{refusal}</Text>}
      <Group gap="gap" wrap="nowrap">
        <Text component="span" size="sm" {...stylex.props(styles.keys)}>Enter saves, Esc cancels</Text>
        <Button onClick={() => setComposing(null)}>Cancel</Button>
        <Button onClick={save} {...stylex.props(styles.save)}>Save</Button>
      </Group>
    </Stack>
  );
}

function LibraryFlagRow({ flag }: { readonly flag: LibraryFlag }) {
  const { focused, focusFlag, setComposing, changeFlags } = useLibraryItemScreen();
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
        <IconButton name="Remove flag" onClick={() => changeFlags({ op: 'flag.remove', id: flag.id })}><Trash2 size={12} /></IconButton>
      </Group>
    </Box>
  );
}

/**
 * The item's flags in order, everyone's or one author's: the queue N steps through, each opened looping. A row's
 * click opens it; a double click edits its note. The composer below writes a new flag's note or edits one.
 */
export function LibraryFlagPanel() {
  const { flags, queue, filter, setFilter, focused, marked, composing, setComposing } = useLibraryItemScreen();
  const at = focused ? queue.findIndex((f) => f.id === focused.id) : -1;
  const count = (by: LibraryFlagFilter) => flags.flags.filter((f) => by === 'all' || f.by === by).length;
  return (
    <Box {...stylex.props(styles.panel)}>
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.head)}>
        <Flag size={12} />
        {(['all', 'agent', 'reviewer'] as const).map((by) => (
          <HotkeyTooltip key={by} name={`Flags: ${FILTER_LABELS[by]}`} hotkey="Whose flags">
            <UnstyledButton aria-pressed={filter === by} onClick={() => setFilter(by)} {...stylex.props(styles.chip, filter === by && styles.chipOn)}>
              <Text component="span" size="sm" inherit>{FILTER_LABELS[by]} {count(by) > 0 && count(by)}</Text>
            </UnstyledButton>
          </HotkeyTooltip>
        ))}
        {at >= 0 && <Readout>{at + 1} of {queue.length}</Readout>}
        <Box {...stylex.props(styles.step)}>
          <HotkeyTooltip name={marked ? 'Flag the marked range' : 'Mark a range first: drag on the timeline, select words, or press I and O'} hotkey="Flag range">
            <Box component="span" {...stylex.props(styles.hinted)}>
              <Button size="compact-xs" leftSection={<Flag size={12} />} disabled={!marked || composing !== null}
                onClick={() => marked && setComposing({ kind: 'new', range: marked })}>
                Flag range
              </Button>
            </Box>
          </HotkeyTooltip>
        </Box>
      </Group>
      <FadeScroll>
        {queue.length === 0 && (
          <Text size="sm" {...stylex.props(styles.empty)}>
            {flags.flags.length ? 'None of these.' : 'No flags. Drag on the timeline, or select words, then F flags the range.'}
          </Text>
        )}
        {queue.map((flag) => <LibraryFlagRow key={flag.id} flag={flag} />)}
      </FadeScroll>
      {composing && <LibraryFlagComposer key={composing.kind === 'note' ? composing.flag : 'new'} composing={composing} />}
    </Box>
  );
}
