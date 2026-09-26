import { Button, Checkbox, Group, SegmentedControl, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import type { LabCueEditorState } from './use-lab-cue-editor.ts';

const LAB_CUE_ZOOMS = [1, 2, 4, 8];

const styles = stylex.create({
  unsaved: { color: colors.accent, fontWeight: 700 },
  save: { textTransform: 'uppercase', fontWeight: 800 },
});

/** Above the timeline: whether the list's sounds play, the zoom, and what's unsaved with the button that keeps it. */
export function LabCueBar({ editor }: { readonly editor: LabCueEditorState }) {
  const { unsaved, saveState, exported } = editor;
  return (
    <Group justify="space-between" gap="sm" wrap="wrap">
      <Checkbox checked={editor.hearList} onChange={(e) => editor.setHearList(e.currentTarget.checked)}
        label={<>Play the cues' sounds <Text component="small" size="xs" c="dimmed">(off: just voice, music and the scenes' own sounds)</Text></>} />
      <Group gap="xs">
        <Readout label>Zoom</Readout>
        <SegmentedControl value={String(editor.zoom)} onChange={(z) => editor.setZoom(Number(z))}
          data={LAB_CUE_ZOOMS.map((z) => ({ value: String(z), label: `${z}×` }))} />
      </Group>
      <Group gap="sm">
        {unsaved
          ? <Text {...stylex.props(styles.unsaved)}>{unsaved} unsaved change{unsaved === 1 ? '' : 's'}</Text>
          : <Readout label>No unsaved changes</Readout>}
        {exported
          ? <Button variant="filled" radius="xl" size="sm" disabled={!unsaved} onClick={editor.persist} {...stylex.props(styles.save)}
              title="This copy of the lab is read-only: your edits stay in this page, and you can download them">Download cues.json</Button>
          : <Button variant="filled" radius="xl" size="sm" disabled={!unsaved || saveState.kind === 'saving'} onClick={editor.persist} {...stylex.props(styles.save)}>
              {saveState.kind === 'saving' ? 'Saving…' : 'Save'}
            </Button>}
      </Group>
    </Group>
  );
}
