import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type PointerEvent } from 'react';
import type { ReviewArtifact } from '#models/review/review-artifact.ts';
import { formatReviewMoment, type ReviewNote } from '#models/review/review-notes.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewNoteDraft } from './review-note-format.ts';
import { ReviewSceneRung } from './review-scene-rung.tsx';
import { ReviewTimingMarks } from './review-timing-marks.tsx';
import type { ReviewPlayback } from './use-review-playback.ts';

const styles = stylex.create({
  scrubber: { userSelect: 'none' },
  row: { position: 'relative' },
  scenes: { height: '20px' },
  scene: {
    position: 'absolute', top: 0, height: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    padding: '2px 5px', fontFamily: fonts.mono, color: colors.dim,
    backgroundColor: colors.panel, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  oddScene: { backgroundColor: colors.line },
  track: { height: '34px', backgroundColor: colors.panel, borderRadius: '3px', cursor: 'pointer', touchAction: 'none' },
  cut: { position: 'absolute', top: 0, bottom: 0, width: '1px', backgroundColor: colors.dim, opacity: 0.7, pointerEvents: 'none' },
  range: {
    position: 'absolute', top: 0, bottom: 0, pointerEvents: 'none', borderWidth: '1px', borderStyle: 'solid', borderColor: colors.cobalt,
    backgroundColor: `color-mix(in srgb, ${colors.cobalt} 33%, transparent)`,
  },
  noteMark: { position: 'absolute', top: '6px', height: '8px', minWidth: '3px', backgroundColor: colors.accent, borderRadius: '2px', pointerEvents: 'none' },
  playhead: { position: 'absolute', top: '-22px', bottom: '-4px', width: '2px', marginLeft: '-1px', backgroundColor: colors.cream, pointerEvents: 'none' },
  sounds: { height: '22px', marginTop: '3px' },
  sound: {
    position: 'absolute', top: '2px', width: '6px', height: '16px', marginLeft: '-3px', borderRadius: '2px', backgroundColor: colors.pass,
    ':hover': { backgroundColor: colors.cream, transform: 'scaleY(1.2)' },
  },
  cueListSound: { backgroundColor: colors.cue },
  aimedSound: { backgroundColor: colors.cream, transform: 'scaleY(1.2)' },
  span: (left: string, width?: string) => ({ left, width: width ?? null }),
});

type ReviewScrubberProps = {
  readonly artifact: ReviewArtifact;
  readonly fps: number;
  readonly playback: ReviewPlayback;
  /** In frame order, numbered as the list numbers them. */
  readonly notes: readonly ReviewNote[];
  readonly draft: ReviewNoteDraft | null;
  readonly onRange: (first: number, last: number) => void;
  readonly onSound: (id: string, frame: number) => void;
};

/** Scenes above, notes on, sounds under the track. A press seeks; dragging past a frame or two marks a range. */
export function ReviewScrubber({ artifact, fps, playback, notes, draft, onRange, onSound }: ReviewScrubberProps) {
  const { frame, total, seekToFrame } = playback;
  const track = useRef<HTMLDivElement>(null);
  const press = useRef<{ from: number; range: boolean } | null>(null);
  const [liveRange, setLiveRange] = useState<[number, number] | null>(null);
  const pct = (f: number) => `${(f / total) * 100}%`;
  const frameAt = (e: PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total - 1, Math.floor(((e.clientX - box.left) / box.width) * total)));
  };
  const range = liveRange ?? (draft?.frame !== undefined && draft.end !== undefined ? [draft.frame, draft.end] : null);
  return (
    <Box {...stylex.props(styles.scrubber)}>
      <Box {...stylex.props(styles.row, styles.scenes)}>
        {artifact.scenes?.map((s, i) => (
          <Text key={s.id} component="span" size="xs" title={s.rung ? `${s.id}: ${s.rung}` : s.id}
            {...stylex.props(styles.scene, i % 2 === 1 && styles.oddScene, styles.span(pct(s.start * fps), pct(s.dur * fps)))}>
            {s.rung && <ReviewSceneRung rung={s.rung} />}{s.id}
          </Text>
        ))}
      </Box>
      {artifact.marks && <ReviewTimingMarks marks={artifact.marks} fps={fps} pct={pct} onSeek={seekToFrame} />}
      <Box ref={track} {...stylex.props(styles.row, styles.track)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const f = frameAt(e);
          press.current = { from: f, range: false };
          seekToFrame(f);
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          const f = frameAt(e);
          if (Math.abs(f - p.from) >= 2) p.range = true;
          if (p.range) setLiveRange([Math.min(p.from, f), Math.max(p.from, f)]);
          seekToFrame(f);
        }}
        onPointerCancel={() => { press.current = null; setLiveRange(null); }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          setLiveRange(null);
          if (p?.range) { const f = frameAt(e); onRange(Math.min(p.from, f), Math.max(p.from, f)); }
        }}>
        {artifact.storyboard?.slice(1).map((card) => <Box key={card.id} {...stylex.props(styles.cut, styles.span(pct(card.from)))} />)}
        {range && <Box {...stylex.props(styles.range, styles.span(pct(range[0]), pct(range[1] - range[0] + 1)))} />}
        {notes.map((n, i) => n.frame !== undefined && (
          <Box key={n.id} title={`${i + 1}. ${n.text}`}
            {...stylex.props(styles.noteMark, styles.span(pct(n.frame), n.end !== undefined ? pct(n.end - n.frame + 1) : undefined))} />
        ))}
        <Box {...stylex.props(styles.playhead, styles.span(pct(frame + 0.5)))} />
      </Box>
      {artifact.sounds && (
        <Box {...stylex.props(styles.row, styles.sounds)}>
          {artifact.sounds.map((s) => (
            <UnstyledButton key={`${s.source}:${s.id}`} aria-label={`${s.sound} ${s.id}`}
              title={`${s.sound} · ${s.id} · ${formatReviewMoment(s.frame, fps)}${s.source === 'cue-list' ? ' · cue list' : ''}`}
              {...stylex.props(styles.sound, s.source === 'cue-list' && styles.cueListSound, draft?.cue === s.id && styles.aimedSound, styles.span(pct(s.frame + 0.5)))}
              onClick={() => onSound(s.id, s.frame)} />
          ))}
        </Box>
      )}
    </Box>
  );
}
