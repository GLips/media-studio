import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { LabKitPieceId } from './lab-kit-piece.ts';
import { LAB_KIT_PIECES } from './lab-kit-pieces.tsx';

const styles = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' },
  card: {
    display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left',
    backgroundColor: colors.panel, borderWidth: '1px', borderStyle: 'solid', borderColor: { default: colors.line, ':hover': colors.dim },
    borderRadius: radius.surface, paddingBlock: spacing.gap, paddingInline: '14px', transition: 'border-color 0.15s, background-color 0.15s',
  },
  picked: { borderColor: { default: colors.accent, ':hover': colors.accent }, backgroundColor: colors.pickedPanel },
  name: { fontFamily: fonts.display, fontWeight: 800, fontStretch: '85%', lineHeight: 1.2, textTransform: 'uppercase', color: colors.cream },
  pickedName: { color: colors.accent },
  blurb: { color: colors.dim, lineHeight: 1.4 },
});

type LabKitPiecePickerProps = { readonly chosenId: LabKitPieceId; readonly onChoose: (id: LabKitPieceId) => void };

/** A card per piece, its name and what the viewer sees, the chosen one lit. */
export function LabKitPiecePicker({ chosenId, onChoose }: LabKitPiecePickerProps) {
  return (
    <Box component="nav" aria-label="Kit pieces" {...stylex.props(styles.grid)}>
      {Object.values(LAB_KIT_PIECES).map((piece) => {
        const picked = piece.id === chosenId;
        return (
          <UnstyledButton key={piece.id} aria-pressed={picked} onClick={() => onChoose(piece.id)} {...stylex.props(styles.card, picked && styles.picked)}>
            <Text component="span" size="lg" {...stylex.props(styles.name, picked && styles.pickedName)}>{piece.title}</Text>
            <Text component="span" size="sm" {...stylex.props(styles.blurb)}>{piece.blurb}</Text>
          </UnstyledButton>
        );
      })}
    </Box>
  );
}
