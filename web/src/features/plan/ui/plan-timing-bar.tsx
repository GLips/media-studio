import { Box, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
import { useRef, type PointerEvent } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PlanTransport } from './plan-transport.tsx';
import { formatPlanSeconds, PLAN_HOLD_FLAG_SECONDS, PLAN_SILENCE_FLAG_SECONDS, type PlanFlag, type PlanTiming } from './plan-timing.ts';

// PLAN_FRAME_VAR spelled out: StyleX compiles each file alone and can't read an imported value.
const FRAME = 'var(--plan-frame, 0)';
/** A readout character's width, for deciding which labels fit beside each other. */
const READOUT_CHAR_PX = 7;

const styles = stylex.create({
  bar: {
    position: 'relative', paddingInline: spacing.inset, paddingBlock: spacing.gap, backgroundColor: colors.panel,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line, userSelect: 'none',
  },
  strip: { position: 'relative', cursor: 'pointer', touchAction: 'none' },
  row: { position: 'relative', overflow: 'hidden' },
  labels: { height: spacing.laneGutter },
  scenes: { height: spacing.rowDense },
  lines: { height: spacing.row, backgroundColor: colors.ground, borderRadius: radius.control },
  flags: { height: spacing.gap, marginTop: spacing.hairline },
  ruler: { height: spacing.inset },
  at: (from: number, to: number) => ({ left: `${from * 100}%`, width: `${Math.max(0, to - from) * 100}%` }),
  left: (at: number) => ({ left: `${at * 100}%` }),
  scene: {
    position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: spacing.tight, paddingInline: spacing.tight,
    overflow: 'hidden', whiteSpace: 'nowrap', color: colors.dim, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  sceneA: { backgroundColor: colors.laneA },
  sceneB: { backgroundColor: colors.laneB },
  sceneFocused: { color: colors.cream },
  sceneN: { fontFamily: fonts.mono },
  shade: {
    position: 'absolute', top: 0, bottom: 0,
    backgroundImage: `repeating-linear-gradient(135deg, transparent 0 3px, ${colors.hatch} 3px 4px)`,
  },
  line: {
    position: 'absolute', top: '2px', bottom: '2px', overflow: 'hidden', borderRadius: radius.control, backgroundColor: colors.raised,
    outlineWidth: '1px', outlineStyle: 'solid', outlineColor: colors.line, outlineOffset: '-1px',
  },
  lineText: {
    position: 'absolute', insetInline: spacing.tight, top: 0, bottom: 0, display: 'flex', alignItems: 'center',
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: colors.cream, pointerEvents: 'none',
  },
  estimated: { backgroundColor: colors.laneB },
  word: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line },
  // The word being said: lit from its first frame to its last, pure CSS on the frame variable.
  wordLit: (from: number, to: number) => ({
    backgroundColor: colors.cobalt,
    opacity: `calc(0.55 * min(clamp(0, calc((${FRAME} - ${from}) * 1000 + 1), 1), clamp(0, calc((${to} - ${FRAME}) * 1000), 1)))`,
  }),
  cue: { position: 'absolute', top: 0, bottom: 0, width: '1px', backgroundColor: colors.mark, pointerEvents: 'none' },
  cueLabel: {
    position: 'absolute', bottom: 0, transform: 'translateX(-50%)', fontFamily: fonts.mono,
    lineHeight: typography.lineHeight, color: colors.mark, whiteSpace: 'nowrap', cursor: 'default',
  },
  beat: { position: 'absolute', bottom: 0, height: spacing.tight, width: '1px', backgroundColor: colors.mark },
  flag: { position: 'absolute', top: 0, bottom: 0, minWidth: spacing.hairline },
  flagFill: { position: 'absolute', inset: 0, borderRadius: radius.control, backgroundColor: colors.caution },
  flagHold: { opacity: 0.55 },
  // The flag the playhead is in, which `F` lands on: lit cream, pure CSS on the frame variable as the lit word is.
  flagCurrent: (from: number, to: number) => ({
    position: 'absolute', inset: 0, borderRadius: radius.control, backgroundColor: colors.cream,
    opacity: `min(clamp(0, calc((${FRAME} - ${from}) * 1000 + 1), 1), clamp(0, calc((${to} - ${FRAME}) * 1000), 1))`,
  }),
  tick: { position: 'absolute', top: 0, height: spacing.tight, width: '1px', backgroundColor: colors.line },
  tickLabel: {
    position: 'absolute', top: 0, paddingInlineStart: spacing.hairline, fontFamily: fonts.mono,
    lineHeight: typography.lineHeight, color: colors.dim,
  },
  target: { position: 'absolute', top: 0, bottom: 0, width: 0, borderLeftWidth: '1px', borderLeftStyle: 'dashed', borderLeftColor: colors.dim, pointerEvents: 'none' },
  max: { borderLeftColor: colors.danger },
  playhead: {
    position: 'absolute', top: 0, bottom: 0, width: '1px', backgroundColor: colors.cream, pointerEvents: 'none',
  },
  playheadAt: (end: number) => ({ left: `calc(${FRAME} / ${end} * 100%)` }),
  broken: { color: colors.danger, paddingBlock: spacing.gap },
});

/** The ruler's step: the smallest of 1, 2, 5, 10 s whose labels sit at least 48px apart. */
function rulerStepOf(seconds: number, width: number): number {
  return [1, 2, 5, 10, 30].find((step) => (width / seconds) * step >= 48) ?? 60;
}

/** Labels left to right, each kept only when it clears the one before. */
function fittingLabels<T extends { at: number; label: string }>(items: readonly T[], width: number): Set<T> {
  const kept = new Set<T>();
  let clearFrom = -Infinity;
  for (const item of items.toSorted((a, b) => a.at - b.at)) {
    const half = (item.label.length * READOUT_CHAR_PX) / 2;
    const x = item.at * width;
    if (x - half < clearFrom) continue;
    kept.add(item);
    clearFrom = x + half + READOUT_CHAR_PX;
  }
  return kept;
}

const flagWords = (flag: PlanFlag, fps: number) => {
  const seconds = formatPlanSeconds((flag.to - flag.from) / fps);
  return flag.kind === 'silence'
    ? `${seconds} of silence, over ${PLAN_SILENCE_FLAG_SECONDS} s · ${formatReviewClock(flag.from / fps)}`
    : `${seconds} with nothing planned, over ${PLAN_HOLD_FLAG_SECONDS} s · ${formatReviewClock(flag.from / fps)}`;
};

function PlanTimingStrip({ timing }: { readonly timing: PlanTiming }) {
  const { playback, plan, focusedScene, setSearch } = usePlanScreen();
  const { ref: sizeRef, width } = useElementSize();
  const stripRef = useRef<HTMLDivElement>(null);
  const { end, fps } = timing;
  const x = (frame: number) => frame / end;
  const cues = timing.scenes.flatMap((scene) => scene.cues.map((cue) => ({ ...cue, scene: scene.id, at: x(cue.frame), label: cue.name })));
  const shownCues = fittingLabels(cues, width);
  const seconds = end / fps;
  const step = rulerStepOf(seconds, width || 1);
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step);
  const { target } = plan.storyboard;

  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = stripRef.current?.getBoundingClientRect();
    if (!box) return;
    const frame = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * end;
    playback.seek(frame);
    const scene = timing.scenes.findLast((s) => s.from <= frame);
    if (scene && scene.id !== focusedScene) setSearch({ scene: scene.id });
  };

  return (
    <Box
      ref={(element: HTMLDivElement | null) => {
        stripRef.current = element;
        sizeRef(element);
      }}
      aria-label="Timing"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekAt(event);
      }}
      onPointerMove={(event) => event.buttons === 1 && seekAt(event)}
      {...stylex.props(styles.strip)}
    >
      <Box {...stylex.props(styles.row, styles.labels)}>
        {cues.filter((c) => shownCues.has(c)).map((cue) => (
          <HotkeyTooltip key={`${cue.scene}.${cue.name}`} name={`${cue.scene}.${cue.name} · ${formatReviewClock(cue.frame / fps)}`}>
            <Text component="span" size="xs" {...stylex.props(styles.cueLabel, styles.left(cue.at))}>{cue.name}</Text>
          </HotkeyTooltip>
        ))}
      </Box>
      <Box {...stylex.props(styles.row, styles.scenes)}>
        {timing.scenes.map((scene, i) => (
          <HotkeyTooltip key={scene.id} name={`${scene.n} ${scene.id} · ${formatReviewClock(scene.from / fps)}–${formatReviewClock(scene.to / fps)} · ${formatPlanSeconds((scene.to - scene.from) / fps)}`}>
            <Box {...stylex.props(styles.scene, i % 2 ? styles.sceneB : styles.sceneA, scene.id === focusedScene && [styles.sceneFocused, shadows.focusTopRule], styles.at(x(scene.from), x(scene.to)))}>
              <Text component="span" size="xs" {...stylex.props(styles.sceneN)}>{scene.n}</Text>
              <Text component="span" size="sm" inherit>{scene.id}</Text>
              {scene.beats.map((beat) => <Box key={beat} {...stylex.props(styles.beat, styles.left((beat - scene.from) / Math.max(1, scene.to - scene.from)))} />)}
            </Box>
          </HotkeyTooltip>
        ))}
      </Box>
      <Box {...stylex.props(styles.row, styles.lines)}>
        {timing.scenes.flatMap((scene) => scene.shades.map((shade) => (
          <HotkeyTooltip key={`${scene.id}:${shade.kind}:${shade.from}`} name={`${shade.kind} · ${formatPlanSeconds((shade.to - shade.from) / fps)}`}>
            <Box {...stylex.props(styles.shade, styles.at(x(shade.from), x(shade.to)))} />
          </HotkeyTooltip>
        )))}
        {timing.lines.map((line) => (
          <HotkeyTooltip key={line.id} name={`${line.id} · ${formatPlanSeconds((line.to - line.from) / fps)} · ${line.read}`}>
            <Box {...stylex.props(styles.line, line.read === 'estimated' && styles.estimated, styles.at(x(line.from), x(line.to)))}>
              {line.words.map((word, k) => (
                <Box
                  // oxlint-disable-next-line react/no-array-index-key -- a word's place in its line is its identity
                  key={k}
                  {...stylex.props(styles.word, styles.wordLit(word.from, word.to), styles.at((word.from - line.from) / (line.to - line.from), (word.to - line.from) / (line.to - line.from)))}
                />
              ))}
              <Text component="span" size="xs" {...stylex.props(styles.lineText)}>{line.words.map((w) => w.text).join(' ')}</Text>
            </Box>
          </HotkeyTooltip>
        ))}
        {cues.map((cue) => <Box key={`${cue.scene}.${cue.name}`} {...stylex.props(styles.cue, styles.left(cue.at))} />)}
      </Box>
      <Box {...stylex.props(styles.row, styles.flags)}>
        {timing.flags.map((flag) => (
          <HotkeyTooltip key={`${flag.kind}:${flag.from}`} name={flagWords(flag, fps)}>
            <Box {...stylex.props(styles.flag, styles.at(x(flag.from), x(flag.to)))}>
              <Box {...stylex.props(styles.flagFill, flag.kind === 'hold' && styles.flagHold)} />
              <Box aria-hidden {...stylex.props(styles.flagCurrent(flag.from, flag.to))} />
            </Box>
          </HotkeyTooltip>
        ))}
      </Box>
      <Box {...stylex.props(styles.row, styles.ruler)}>
        {ticks.map((t) => (
          <Box key={t}>
            <Box {...stylex.props(styles.tick, styles.left(t / seconds))} />
            <Text component="span" size="xs" {...stylex.props(styles.tickLabel, styles.left(t / seconds))}>{t}</Text>
          </Box>
        ))}
      </Box>
      {target.seconds <= seconds && <Box aria-hidden {...stylex.props(styles.target, styles.left(target.seconds / seconds))} />}
      {target.max !== undefined && target.max <= seconds && <Box aria-hidden {...stylex.props(styles.target, styles.max, styles.left(target.max / seconds))} />}
      <Box aria-hidden {...stylex.props(styles.playhead, shadows.groundRing, styles.playheadAt(end))} />
    </Box>
  );
}

/**
 * The whole video to scale: its scenes; its lines, each word lit as it's read; cue ticks labelled with their names; the
 * leads, gaps and tails hatched; amber flags under silences and stretches with nothing planned, the one the playhead
 * is in lit cream; the target as a dashed line. Click or drag to seek.
 */
export function PlanTimingBar() {
  const { timing } = usePlanScreen();
  return (
    <Box {...stylex.props(styles.bar)}>
      <PlanTransport />
      {timing ? <PlanTimingStrip timing={timing} /> : <Text size="sm" {...stylex.props(styles.broken)}>The plan doesn't time: its diagnostics below say why.</Text>}
    </Box>
  );
}
