import { Box, Paper, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { LabSfxCuePayload } from '#models/lab/lab-catalog.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { LabNote } from '../lab-note.tsx';
import { LabCueBar } from './lab-cue-bar.tsx';
import { LabCueDetail } from './lab-cue-detail.tsx';
import { LabCueExplainer } from './lab-cue-explainer.tsx';
import { LabCueLegend } from './lab-cue-legend.tsx';
import { LabCueTimeline } from './lab-cue-timeline.tsx';
import { LabCueWarnings } from './lab-cue-warnings.tsx';
import { useLabCueEditor } from './use-lab-cue-editor.ts';

const NARROW = '@media (max-width: 900px)';

const styles = stylex.create({
  top: { display: 'grid', gap: '16px', gridTemplateColumns: { default: 'minmax(0, 560px) minmax(320px, 1fr)', [NARROW]: '1fr' } },
  videoBox: { position: 'relative' },
  video: { display: 'block', width: '100%', aspectRatio: '16 / 9', backgroundColor: colors.screen, borderRadius: radius.control },
  loading: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' },
  error: { color: colors.accent },
  saved: { color: colors.pass },
});

type LabCueEditorProps = {
  readonly payload: LabSfxCuePayload;
  /** An exported lab has no server: the edited list downloads instead of saving. */
  readonly exported: boolean;
};

/**
 * A project's sfx/cues.json (the list `studio sfx draft` writes) over its rendered video: the list's sounds play
 * with it, and each cue can be swapped, muted, filled, nudged and levelled, seeing live which of the studio's rules an
 * edit breaks.
 */
export function LabCueEditor({ payload, exported }: LabCueEditorProps) {
  const editor = useLabCueEditor(payload, exported);
  const { list, saved, videoRef, videoSrc, saveState } = editor;
  const selected = list.cues.find((c) => c.event.id === editor.selectedId);
  const step = (dir: -1 | 1) => {
    const next = selected && list.cues[list.cues.indexOf(selected) + dir];
    if (next) editor.setSelectedId(next.event.id);
  };

  return (
    <Stack gap={10}>
      <Stack gap={4} component="header" mb={4}>
        <Readout label>Cue editor · {saved.project}</Readout>
        <LabNote>
          A <b>cue</b> is one moment in the video where a sound could go: a click, a scene change, something appearing. The
          studio drafted a sound, or a reason to stay silent, for each. Click a marker to hear that moment: the video jumps to
          just before it and plays three seconds with the sound. Then swap its sound, mute it, or give a silent one a sound.
        </LabNote>
      </Stack>

      <Box {...stylex.props(styles.top)}>
        <Box {...stylex.props(styles.videoBox)}>
          {saved.video
            ? <>
                <video ref={videoRef} src={videoSrc} controls playsInline {...stylex.props(styles.video)} />
                {!videoSrc && <Box {...stylex.props(styles.loading)}><Readout label>Loading the video…</Readout></Box>}
              </>
            : <Text {...stylex.props(styles.error)}>This project has no rendered video (out/video.mp4) to play the cues over.</Text>}
        </Box>
        {selected
          ? <LabCueDetail cue={selected} list={list} events={editor.events} warnings={editor.warningsById.get(selected.event.id) ?? []}
              onEdit={(edit) => editor.editCue(selected.event.id, edit)} onPlayMoment={() => editor.playMoment(selected)} onStep={step} />
          : <Paper component="aside" p="md"><LabNote>Pick a marker on the timeline.</LabNote></Paper>}
      </Box>

      <LabCueBar editor={editor} />
      {(saveState.kind === 'saved' || saveState.kind === 'error') && (
        <Text {...stylex.props(saveState.kind === 'saved' ? styles.saved : styles.error)}>{saveState.text}</Text>
      )}
      <LabCueTimeline editor={editor} />
      <LabCueLegend editor={editor} />
      <LabCueWarnings editor={editor} />
      <LabCueExplainer project={saved.project} list={list} />
    </Stack>
  );
}
