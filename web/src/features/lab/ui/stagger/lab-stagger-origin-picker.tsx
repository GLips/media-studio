import { Box, Button, Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { STAGGER_INKS } from '#studio/lab/stagger/stagger-ink-row.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  picker: { paddingInline: spacing.gap },
  lead: { whiteSpace: 'nowrap' },
  // Each button wears its card's ink along its bottom edge, so it reads as that card in the row above.
  card: (ink: string) => ({ minWidth: '30px', borderBottomWidth: '3px', borderBottomColor: ink }),
});

type LabStaggerOriginPickerProps = {
  readonly count: number;
  /** The card the ripple starts at, counting from 1, or null when it starts at a named place instead. */
  readonly picked: number | null;
  readonly onPick: (card: number) => void;
};

/** A numbered button per card in the row, to start the ripple at that card. */
export function LabStaggerOriginPicker({ count, picked, onPick }: LabStaggerOriginPickerProps) {
  return (
    <Group gap="sm" wrap="nowrap" mt="xs" {...stylex.props(styles.picker)}>
      <Box {...stylex.props(styles.lead)}><Readout label>start the ripple at card</Readout></Box>
      <Group gap={4}>
        {STAGGER_INKS.slice(0, count).map((ink, i) => (
          <Button key={ink.name} title={ink.name} size="compact-xs" variant={picked === i + 1 ? 'white' : 'default'} color="dark"
            onClick={() => onPick(i + 1)} {...stylex.props(styles.card(ink.hex))}>
            {i + 1}
          </Button>
        ))}
      </Group>
    </Group>
  );
}
