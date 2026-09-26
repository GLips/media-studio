import { Button, Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Readout } from '#web/shared/ui/readout.tsx';
import { fonts } from '#web/shared/ui/theme.stylex.ts';
import { LabBench } from '../lab-bench.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabStage } from '../lab-stage.tsx';
import type { LabKitPieceId, LabKitPropsById } from './lab-kit-piece.ts';
import { LAB_KIT_PIECES } from './lab-kit-pieces.tsx';

const styles = stylex.create({
  title: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '80%', lineHeight: 1, textTransform: 'uppercase' },
  reset: { alignSelf: 'flex-start' },
});

type LabKitPieceBenchProps<K extends LabKitPieceId> = {
  readonly pieceId: K;
  /** Every piece's settings as changed so far; a piece not yet touched plays its defaults. */
  readonly propsById: Partial<LabKitPropsById>;
  readonly onPropsChange: (pieceId: K, props: LabKitPropsById[K]) => void;
};

/** One piece: its heading and when a video uses it, its stage beside its controls, and how to read the stage. */
export function LabKitPieceBench<K extends LabKitPieceId>({ pieceId, propsById, onPropsChange }: LabKitPieceBenchProps<K>) {
  const piece = LAB_KIT_PIECES[pieceId];
  const props = propsById[pieceId] ?? piece.defaults;
  return (
    <Stack gap="md" component="section">
      <Stack gap="tight">
        <Title order={3} {...stylex.props(styles.title)}>{piece.title}</Title>
        <Text size="md" maw="80ch"><Readout label>When a video uses it</Readout> {piece.whenUsed}</Text>
      </Stack>
      <LabBench
        // Keyed by piece, so switching pieces starts the new one from its first frame.
        stage={<LabStage key={pieceId} component={piece.Stage} inputProps={props} seconds={piece.seconds(props)} label={piece.title} />}
      >
        <LabControls stacked><piece.Controls props={props} set={(patch) => onPropsChange(pieceId, { ...props, ...patch })} /></LabControls>
        <Button variant="default" size="compact-sm" {...stylex.props(styles.reset)} onClick={() => onPropsChange(pieceId, piece.defaults)}>Reset to the starting settings</Button>
      </LabBench>
      {piece.note && <LabNote>{piece.note}</LabNote>}
    </Stack>
  );
}
