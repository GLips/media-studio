import { Box, Modal, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useLocation, useRouter } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { FadeScroll } from './fade-scroll.tsx';
import { useQuickOpenEntriesSource, type QuickOpenEntry } from './quick-open-entries.tsx';
import { TextInput } from './text-input.tsx';
import { colors, radius, spacing, typography } from './theme.stylex.ts';

/** How many matches are drawn: past this, typing another letter is quicker than scrolling. */
const QUICK_OPEN_SHOWN = 60;

/** Rows the list shows at once: its height holds whole rows, so the fade alone says more lie below. */
const QUICK_OPEN_ROWS_SEEN = 15;

/** The rows' glyph column: their list's inset, the row's inset and rule, the glyph's width; the field's icon sits in it. */
const QUICK_OPEN_GLYPH_SIZE = 12;
const QUICK_OPEN_TEXT_START = `calc(${spacing.tight} + ${spacing.hairline} + ${spacing.gap} + ${QUICK_OPEN_GLYPH_SIZE}px + ${spacing.gap})`;

const styles = stylex.create({
  input: { borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  field: { paddingInlineStart: QUICK_OPEN_TEXT_START, paddingInlineEnd: spacing.inset },
  search: { color: colors.dim, paddingInlineStart: `calc(${spacing.tight} + ${spacing.hairline} + ${spacing.gap})`, justifyContent: 'flex-start' },
  list: { height: `calc(${QUICK_OPEN_ROWS_SEEN} * ${spacing.row} + 2 * ${spacing.tight})` },
  rows: { padding: spacing.tight },
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.gap, width: '100%', height: spacing.row, paddingInline: spacing.gap,
    color: colors.cream, fontSize: typography.body, lineHeight: typography.lineHeight, borderRadius: radius.control,
    borderLeftWidth: spacing.hairline, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
  },
  // No hover fill: moving the mouse over a row makes it the active one, so one row is ever lit.
  active: { backgroundColor: colors.raised, borderLeftColor: colors.cream },
  matched: { fontWeight: 700 },
  glyph: { display: 'grid', placeItems: 'center', color: colors.dim, flexShrink: 0 },
  label: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  context: { color: colors.dim, whiteSpace: 'nowrap', marginInlineStart: 'auto', fontSize: typography.chrome },
  none: { padding: spacing.inset, color: colors.dim, fontSize: typography.chrome },
});

/**
 * How well one query word matches `text`, or null for no match: every letter in order, scored up for a run of letters
 * together, for starting a word, and for a shorter text, so `vid` puts `out/video.mp4` above `out/wip/v1-draft`.
 */
function quickOpenWordScore(word: string, t: string): number | null {
  let score = 0, at = -1, run = 0;
  for (const letter of word) {
    const found = t.indexOf(letter, at + 1);
    if (found === -1) return null;
    run = found === at + 1 ? run + 1 : 0;
    score += 1 + run * 2 + (found === 0 || /[\s/._-]/.test(t[found - 1]) ? 3 : 0);
    at = found;
  }
  return score;
}

/** The label's letters the query's words land on, as quickOpenWordScore finds them; a word that matched only the context marks none. */
function quickOpenMatchedLetters(query: string, label: string): Set<number> {
  const t = label.toLowerCase(), matched = new Set<number>();
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const found: number[] = [];
    for (const letter of word) {
      const at = t.indexOf(letter, (found.at(-1) ?? -1) + 1);
      if (at === -1) break;
      found.push(at);
    }
    if (found.length === word.length) found.forEach((at) => matched.add(at));
  }
  return matched;
}

/** The label with the letters the query matched in bold, in runs. */
function QuickOpenLabel({ label, query }: { readonly label: string; readonly query: string }) {
  const matched = quickOpenMatchedLetters(query, label);
  if (!matched.size) return label;
  const runs: { at: number; text: string; matched: boolean }[] = [];
  label.split('').forEach((letter, at) => {
    const last = runs.at(-1);
    if (last && last.matched === matched.has(at)) last.text += letter;
    else runs.push({ at, text: letter, matched: matched.has(at) });
  });
  return runs.map((run) => (run.matched ? <b key={run.at} {...stylex.props(styles.matched)}>{run.text}</b> : run.text));
}

/** Each word of `query` matched on its own, in any order (`video sandbox` finds the sandbox's video); all must match. */
function quickOpenScore(query: string, text: string): number | null {
  const t = text.toLowerCase();
  let score = 0;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const found = quickOpenWordScore(word, t);
    if (found === null) return null;
    score += found;
  }
  return score - t.length / 100;
}

/** What a place in the project on screen gains: about a word's start, so a closer match elsewhere still wins. */
const QUICK_OPEN_NEAR_BONUS = 4;

/**
 * An entry's best match, on its label alone or with its context (`sandbox video`), raised in the project on screen.
 * The label alone scores free of its context's length, so a long project name doesn't sink its files.
 */
function quickOpenEntryScore(query: string, entry: QuickOpenEntry): number | null {
  const scores = [quickOpenScore(query, entry.label), entry.context ? quickOpenScore(query, `${entry.context} ${entry.label}`) : null]
    .filter((score) => score !== null);
  return scores.length ? Math.max(...scores) + (entry.near ? QUICK_OPEN_NEAR_BONUS : 0) : null;
}

/** With no query: the place on screen, then the rest of its project, then every other project's. */
function rankQuickOpenEntries(entries: readonly QuickOpenEntry[], query: string, here: string): QuickOpenEntry[] {
  if (!query.trim()) {
    const rankOf = (entry: QuickOpenEntry) => {
      if (entry.href === here) return 0;
      return entry.near ? 1 : 2;
    };
    return entries.toSorted((a, b) => rankOf(a) - rankOf(b)).slice(0, QUICK_OPEN_SHOWN);
  }
  return entries
    .flatMap((entry) => {
      const score = quickOpenEntryScore(query, entry);
      return score === null ? [] : [{ entry, score }];
    })
    .toSorted((a, b) => b.score - a.score)
    .slice(0, QUICK_OPEN_SHOWN)
    .map(({ entry }) => entry);
}

type QuickOpenBodyProps = { readonly entries: readonly QuickOpenEntry[] | undefined; readonly onClose: () => void };

/** The open palette's body: mounted only while open, so its places load and its query resets each time. */
function QuickOpenBody({ entries, onClose }: QuickOpenBodyProps) {
  const router = useRouter();
  const here = useLocation({ select: (location) => location.pathname });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const shown = rankQuickOpenEntries(entries ?? [], query, here);
  const go = (entry: QuickOpenEntry | undefined) => {
    if (!entry) return;
    onClose();
    void router.navigate({ href: entry.href });
  };
  const move = (by: number) => {
    const next = Math.min(Math.max(active + by, 0), shown.length - 1);
    setActive(next);
    viewportRef.current?.querySelector(`[data-quick-open-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (by !== undefined) {
      event.preventDefault();
      move(by);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(shown[active]);
    }
  };
  return (
    <>
      <TextInput
        data-autofocus variant="unstyled" size="md" placeholder="Open…" aria-label="Open…" value={query} onKeyDown={onKeyDown}
        leftSection={<Search size={QUICK_OPEN_GLYPH_SIZE} />} leftSectionWidth={QUICK_OPEN_TEXT_START}
        classNames={{ input: stylex.props(styles.field).className, section: stylex.props(styles.search).className }}
        onChange={(event) => { setQuery(event.currentTarget.value); setActive(0); }}
        {...stylex.props(styles.input)}
      />
      <Box {...stylex.props(styles.list)}>
        <FadeScroll viewportRef={viewportRef}>
          <Box role="listbox" {...stylex.props(styles.rows)}>
            {entries && shown.length === 0 && <Text {...stylex.props(styles.none)}>—</Text>}
            {shown.map((entry, i) => (
              <UnstyledButton
                key={entry.key} role="option" aria-selected={i === active} data-quick-open-row={i} tabIndex={-1}
                onMouseMove={() => setActive(i)} onClick={() => go(entry)}
                {...stylex.props(styles.row, i === active && styles.active)}
              >
                <Box component="span" {...stylex.props(styles.glyph)}>{entry.glyph}</Box>
                <Text component="span" inherit {...stylex.props(styles.label)}><QuickOpenLabel label={entry.label} query={query} /></Text>
                {entry.context && <Text component="span" {...stylex.props(styles.context)}>{entry.context}</Text>}
              </UnstyledButton>
            ))}
          </Box>
        </FadeScroll>
      </Box>
    </>
  );
}

/** `Mod+K`: jump to any project, file, decision or plan by typing a few letters of its name. */
export function QuickOpen({ opened, onClose }: { readonly opened: boolean; readonly onClose: () => void }) {
  const withEntries = useQuickOpenEntriesSource();
  return (
    <Modal opened={opened} onClose={onClose} withCloseButton={false} size="lg" padding={0} yOffset="12vh" aria-label="Open…">
      {withEntries((entries) => <QuickOpenBody entries={entries} onClose={onClose} />)}
    </Modal>
  );
}
