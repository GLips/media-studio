import { Box, Paper, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { MouseEvent } from 'react';
import { formatLabCueSeconds, sfxEventWords } from '#models/lab/lab-sound-cue-words.ts';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { LabCuePlayhead } from './lab-cue-playhead.tsx';
import { LAB_CUE_STATE_MARK, LAB_CUE_STATE_WORDS, LAB_SFX_CUE_LANES, labCueState } from './lab-cue-state.ts';
import type { LabCueEditorState } from './use-lab-cue-editor.ts';

const styles = stylex.create({
  timeline: { display: 'grid', gridTemplateColumns: '142px minmax(0, 1fr)', paddingBlock: '6px' },
  labels: { display: 'flex', flexDirection: 'column', paddingLeft: '12px', fontFamily: fonts.mono, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.dim },
  label: { display: 'flex', alignItems: 'center', height: '26px' },
  scroll: { overflowX: 'auto', padding: '0 12px 4px 8px' },
  rows: { position: 'relative', minWidth: '100%' },
  row: {
    position: 'relative', display: 'flex', alignItems: 'center', height: '26px', cursor: 'pointer',
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  short: { height: '22px' },
  last: { borderBottomWidth: 0 },
  tick: { position: 'absolute', transform: 'translateX(-50%)', fontFamily: fonts.mono, color: colors.dim, pointerEvents: 'none' },
  scene: {
    position: 'absolute', top: '3px', bottom: '3px', borderRadius: '3px', paddingInline: '5px', overflow: 'hidden', whiteSpace: 'nowrap',
    textOverflow: 'ellipsis', lineHeight: '16px', fontFamily: fonts.mono, textTransform: 'uppercase',
    backgroundColor: colors.line, color: { default: colors.dim, ':hover': colors.cream },
  },
  oddScene: { backgroundColor: `color-mix(in srgb, ${colors.line} 60%, ${colors.panel})` },
  word: { position: 'absolute', top: '7px', height: '8px', borderRadius: '1px', backgroundColor: `color-mix(in srgb, ${colors.cobalt} 55%, transparent)` },
  marker: {
    position: 'absolute', top: '3px', width: '8px', height: '18px', borderRadius: '3px', borderWidth: '2px', borderStyle: 'solid',
    transform: { default: 'translateX(-50%)', ':hover': 'translateX(-50%) scaleY(1.2)' }, zIndex: { default: null, ':hover': 2 },
    transition: 'transform 0.1s, height 0.1s',
  },
  warned: { outlineWidth: '2px', outlineStyle: 'dashed', outlineColor: colors.accent, outlineOffset: '2px' },
  selected: { top: 0, height: '24px', zIndex: 3 },
  mark: (fill: string, edge: string) => ({ backgroundColor: fill, borderColor: edge }),
  span: (left: string, width?: string) => ({ left, width: width ?? null }),
  width: (width: string) => ({ width }),
});

/**
 * The whole video as lanes: time, scenes, the spoken words, then a lane of markers per kind of cue. A marker plays its
 * moment; a click on a row's empty space seeks there. Zoom widens the rows, which scroll.
 */
export function LabCueTimeline({ editor }: { readonly editor: LabCueEditorState }) {
  const { saved: payload, list, zoom, selectedId, warningsById, seekVideo, videoRef } = editor;
  const { duration } = payload;
  const x = (t: number) => `${(t / duration) * 100}%`;
  const seekFromClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const box = e.currentTarget.getBoundingClientRect();
    seekVideo(((e.clientX - box.left) / box.width) * duration);
  };
  const ticks = Array.from({ length: Math.floor(duration / 10) + 1 }, (_, i) => i * 10);
  return (
    <Paper {...stylex.props(styles.timeline)}>
      <Box fz="xs" {...stylex.props(styles.labels)}>
        {['Time', 'Scenes', 'Voice'].map((l) => <Text key={l} component="span" inherit {...stylex.props(styles.label, styles.short)}>{l}</Text>)}
        {LAB_SFX_CUE_LANES.map((lane) => <Text key={lane.label} component="span" inherit {...stylex.props(styles.label)}>{lane.label}</Text>)}
      </Box>
      <Box {...stylex.props(styles.scroll)}>
        <Box {...stylex.props(styles.rows, styles.width(`${zoom * 100}%`))}>
          <Box fz="xs" onClick={seekFromClick} {...stylex.props(styles.row, styles.short)}>
            {ticks.map((t) => <Text key={t} component="span" inherit {...stylex.props(styles.tick, styles.span(x(t)))}>{t}s</Text>)}
          </Box>
          <Box fz="xs" onClick={seekFromClick} {...stylex.props(styles.row, styles.short)}>
            {payload.scenes.map((s, i) => (
              <Text key={s.id} component="span" inherit title={`${s.id}: ${formatLabCueSeconds(s.start)}–${formatLabCueSeconds(s.end)}`}
                onClick={() => seekVideo(s.start)}
                {...stylex.props(styles.scene, i % 2 === 1 && styles.oddScene, styles.span(x(s.start), x(s.end - s.start)))}>{s.id}</Text>
            ))}
          </Box>
          <Box onClick={seekFromClick} {...stylex.props(styles.row, styles.short)}>
            {payload.words.map((w) => (
              <Box key={`${w.start}/${w.text}`} component="i" title={`“${w.text}” ${formatLabCueSeconds(w.start)}`} {...stylex.props(styles.word, styles.span(x(w.start), x(w.end - w.start)))} />
            ))}
          </Box>
          {LAB_SFX_CUE_LANES.map((lane, li) => (
            <Box key={lane.label} onClick={seekFromClick} {...stylex.props(styles.row, li === LAB_SFX_CUE_LANES.length - 1 && styles.last)}>
              {list.cues.filter((c) => lane.kinds.includes(c.event.kind)).map((c) => {
                const state = labCueState(c), { fill, edge } = LAB_CUE_STATE_MARK[state];
                return (
                  <UnstyledButton key={c.event.id} aria-label={`${sfxEventWords(c.event)}: ${LAB_CUE_STATE_WORDS[state]}`}
                    onMouseEnter={() => editor.setHoverId(c.event.id)} onMouseLeave={() => editor.setHoverId(null)}
                    onFocus={() => editor.setHoverId(c.event.id)} onBlur={() => editor.setHoverId(null)}
                    onClick={() => editor.pickCue(c)}
                    {...stylex.props(styles.marker, styles.mark(fill, edge), warningsById.has(c.event.id) && styles.warned,
                      c.event.id === selectedId && [styles.selected, shadows.selectedRing], styles.span(x(c.event.at + (c.nudge ?? 0))))} />
                );
              })}
            </Box>
          ))}
          <LabCuePlayhead videoRef={videoRef} duration={duration} />
        </Box>
      </Box>
    </Paper>
  );
}
