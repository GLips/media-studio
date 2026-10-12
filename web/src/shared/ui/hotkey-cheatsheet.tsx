import { Box, Group, Kbd, Modal, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useMemo } from 'react';
import { FadeScroll } from './fade-scroll.tsx';
import type { StudioHotkeyGroup } from './hotkey-meta.d.ts';
import { colors, fonts, spacing, typography } from './theme.stylex.ts';
import { studioHotkeyBindings, useHotkeyRegistryString } from './use-hotkey-label.ts';

/** The cheatsheet's sections in reading order: what works everywhere, then the screen's own groups. */
const HOTKEY_GROUP_ORDER: readonly StudioHotkeyGroup[] = [
  'global', 'playback', 'still', 'timeline', 'notes', 'composer', 'compare', 'draw', 'board', 'decision', 'script', 'dashboard',
];

/**
 * A group's heading where its id doesn't read as one. The notes' keys act in the thread: on a decision, X, U, F and
 * Enter outside it are the decision's.
 */
const HOTKEY_GROUP_HEADINGS: Partial<Record<StudioHotkeyGroup, string>> = { global: 'anywhere', notes: 'in the thread' };

const styles = stylex.create({
  // Up to four balanced columns of at least 200px, each group held whole in one column so a heading never strands
  // its rows in the next.
  columns: { columns: '4 200px', columnGap: spacing.inset },
  // Capped to the window so a taller sheet scrolls in its own fading panel, not the modal past the window's edge.
  body: { display: 'flex', flexDirection: 'column', maxHeight: 'calc(100dvh - 160px)' },
  section: { paddingBottom: spacing.inset, breakInside: 'avoid' },
  group: { color: colors.dim, fontSize: typography.chrome },
  row: { fontSize: typography.chrome, lineHeight: typography.lineHeight },
  off: { opacity: 0.4 },
  kbd: { fontFamily: fonts.mono, fontSize: typography.readout },
});

type CheatsheetRow = { group: StudioHotkeyGroup; name: string; keys: string; enabled: boolean };

/** Every binding registered now; one that's off in this mode is dimmed rather than hidden. */
function cheatsheetRowsOf(): CheatsheetRow[] {
  const rows = studioHotkeyBindings()
    .flatMap(({ meta, keys, enabled }) => (meta ? [{ group: meta.group, name: meta.name ?? keys, keys, enabled }] : []));
  // A binding two components both register (two playheads, two tooltips) is listed once, on if either is; one action
  // on two keys (`N`, `Enter`) is one row with both.
  const byName = new Map<string, CheatsheetRow>();
  for (const row of rows) {
    const key = `${row.group}\u0000${row.name}`;
    const seen = byName.get(key);
    const keys = !seen || seen.keys.split(' · ').includes(row.keys) ? row.keys : `${seen.keys} · ${row.keys}`;
    byName.set(key, { ...row, keys, enabled: row.enabled || (seen?.enabled ?? false) });
  }
  return [...byName.values()];
}

/** The rows, re-read only when the registry's contents change. */
function useCheatsheetRows(): CheatsheetRow[] {
  const json = useHotkeyRegistryString(() => JSON.stringify(cheatsheetRowsOf()));
  // SAFETY: the string is cheatsheetRowsOf's own rows, serialized one line above.
  return useMemo(() => JSON.parse(json) as CheatsheetRow[], [json]);
}

/** The sheet's groups, mounted only while it's open: closed, the sheet doesn't watch the registry. */
function HotkeyCheatsheetGroups() {
  const rows = useCheatsheetRows();
  const groups = HOTKEY_GROUP_ORDER.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length);
  return (
    <Box {...stylex.props(styles.body)}>
      <FadeScroll>
        <Box {...stylex.props(styles.columns)}>
          {groups.map(({ group, rows: groupRows }) => (
            <Stack key={group} gap="tight" {...stylex.props(styles.section)}>
              <Text component="span" {...stylex.props(styles.group)}>{HOTKEY_GROUP_HEADINGS[group] ?? group}</Text>
              {groupRows.map((row) => (
                <Group key={`${row.name}-${row.keys}`} justify="space-between" wrap="nowrap" gap="gap" {...stylex.props(styles.row, !row.enabled && styles.off)}>
                  <Text component="span" size="sm">{row.name}</Text>
                  <Kbd size="xs" {...stylex.props(styles.kbd)}>{row.keys}</Kbd>
                </Group>
              ))}
            </Stack>
          ))}
        </Box>
      </FadeScroll>
    </Box>
  );
}

/** `Shift+/`: the keys of the screen as it is now, read back from the registry, so it never lists a dead key. */
export function HotkeyCheatsheet({ opened, onClose }: { readonly opened: boolean; readonly onClose: () => void }) {
  return (
    // Keys pressed over the sheet stay in it: the screen's under it (`→`, `M`) mustn't act unseen. Escape (Mantine
    // closes on the window) and `?` (`Shift+/` closes it too) go through, and every key once it's closing: focus stays
    // in it while it fades, and `Mod+K` pressed then must still open quick-open.
    <Modal opened={opened} onClose={onClose} title="Keys" size="960px" centered
      onKeyDown={(event) => opened && event.key !== '?' && event.key !== 'Escape' && event.stopPropagation()}>
      <HotkeyCheatsheetGroups />
    </Modal>
  );
}
