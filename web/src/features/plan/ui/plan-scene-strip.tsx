import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Check, CircleHelp, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore, type MouseEvent } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { formatPlanSeconds, planSceneTitle } from './plan-timing.ts';

// PLAN_FRAME_VAR spelled out: StyleX compiles each file alone and can't read an imported value.
const FRAME = 'var(--plan-frame, 0)';

const styles = stylex.create({
  dock: {
    paddingBlock: spacing.inset, paddingInline: spacing.row, display: 'flex', flexDirection: 'column', gap: spacing.inset,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
  transport: { display: 'flex', alignItems: 'center', gap: spacing.inset },
  play: {
    width: '36px', height: '36px', borderRadius: radius.pill, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: colors.ground, backgroundColor: colors.cream, filter: { default: null, ':hover': 'brightness(1.08)' },
  },
  clock: { fontFamily: fonts.mono, color: colors.cream, fontVariantNumeric: 'tabular-nums' },
  total: { color: colors.dim },
  hint: { color: colors.dim },
  strip: { position: 'relative', height: '64px', marginTop: '14px', marginBottom: spacing.row, cursor: 'pointer' },
  scene: {
    position: 'absolute', top: 0, bottom: 0, paddingBlock: spacing.gap, paddingInline: '10px', borderRadius: radius.control,
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden', textAlign: 'start',
    backgroundColor: { default: colors.laneA, ':hover': colors.raised },
    outlineWidth: '1px', outlineStyle: 'solid', outlineColor: 'transparent', outlineOffset: '-1px',
  },
  span: (left: number, width: number) => ({ left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)` }),
  focused: { backgroundColor: colors.raised, outlineColor: colors.cream },
  name: { color: colors.cream, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  facts: { color: colors.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  state: { position: 'absolute', top: spacing.gap, right: spacing.gap, display: 'flex', gap: spacing.tight },
  pass: { color: colors.pass },
  caution: { color: colors.caution },
  // Dim, not amber: amber is what waits on someone, and a stretch with nothing in it is only worth knowing.
  flag: {
    // Under the strip, so its label never covers a scene's own text; a label too long for its stretch is cut off.
    position: 'absolute', top: '100%', marginTop: spacing.hairline, height: spacing.row, display: 'flex', alignItems: 'flex-start',
    overflow: 'hidden', borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: colors.dim, pointerEvents: 'auto',
  },
  flagLabel: { color: colors.dim, whiteSpace: 'nowrap', paddingInline: spacing.tight, paddingTop: spacing.hairline },
  playhead: {
    position: 'absolute', top: '-6px', bottom: '-6px', width: '2px', marginLeft: '-1px', backgroundColor: colors.cream, pointerEvents: 'none',
  },
  playheadAt: (scale: number) => ({ left: `calc(${FRAME} / ${scale} * 100%)` }),
  target: { position: 'absolute', top: '-18px', bottom: '-6px', borderLeftWidth: '1px', borderLeftStyle: 'dashed', borderLeftColor: colors.caution, pointerEvents: 'none' },
  targetAt: (left: number) => ({ left: `${left}%` }),
  targetLabel: { position: 'absolute', top: '-2px', left: spacing.tight, color: colors.caution, whiteSpace: 'nowrap' },
});

/** The playhead's time, written each tick without a render. */
function PlanClock() {
  const { playback, timing } = usePlanScreen();
  const ref = useRef<HTMLSpanElement>(null);
  const fps = timing?.fps ?? 30;
  useEffect(() => {
    const write = (frame: number) => {
      if (ref.current) ref.current.textContent = formatReviewClock(frame / fps);
    };
    write(playback.frameNow());
    const stopTicks = playback.onTick(write);
    const stopState = playback.subscribe(() => write(playback.frameNow()));
    return () => {
      stopTicks();
      stopState();
    };
  }, [playback, fps]);
  return <Text component="span" inherit ref={ref} />;
}

/**
 * The foot of the page: play, the clock, and the whole video as a strip of its scenes, each as wide as it runs, with
 * its state, the timing flags along its foot, the playhead, and the target length dashed where it falls. A click
 * anywhere on the strip plays from there.
 */
export function PlanSceneStrip() {
  const { plan, timing, playback, signoffs, threads, focusedScene, setSearch } = usePlanScreen();
  const playing = useSyncExternalStore(playback.subscribe, () => playback.getState().playing);
  if (!timing) return null;
  const { fps, end } = timing;
  const target = plan.storyboard.target.seconds * fps;
  // The strip runs to the longer of the video and its target, so the target's line is always on it.
  const scale = Math.max(end, target) * 1.02;
  const pct = (frame: number) => (frame / scale) * 100;
  const seekAt = (event: MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const frame = Math.min(end - 1, ((event.clientX - box.left) / box.width) * scale);
    playback.seek(frame);
  };
  const over = end - target;
  return (
    <Box {...stylex.props(styles.dock)}>
      <Box {...stylex.props(styles.transport)}>
        <HotkeyTooltip name={playing ? 'Pause' : 'Play'} hotkey="Play">
          <UnstyledButton aria-label={playing ? 'Pause' : 'Play'} onClick={playback.toggle} {...stylex.props(styles.play)}>
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </UnstyledButton>
        </HotkeyTooltip>
        <Text component="span" {...stylex.props(styles.clock)}>
          <PlanClock /> <Text component="span" inherit {...stylex.props(styles.total)}>/ {formatReviewClock(end / fps)}</Text>
        </Text>
        <Text component="span" {...stylex.props(styles.hint)}>Space plays · click a word or the strip to jump there · select words to comment</Text>
      </Box>
      <Box onClick={seekAt} {...stylex.props(styles.strip)}>
        {timing.scenes.map((scene) => {
          const state = signoffs.get(scene.id)?.state;
          const open = (threads ?? []).filter((t) => t.plan.scene === scene.id && t.state !== 'resolved');
          const questions = open.filter((t) => t.entries.at(-1)?.author === 'agent' && t.entries.at(-1)?.asks).length;
          const notes = open.length - questions;
          const lines = scene.lines.length;
          const facts = [
            formatPlanSeconds((scene.to - scene.from) / fps), lines > 0 && `${lines} ${lines === 1 ? 'line' : 'lines'}`,
            questions > 0 && `${questions} ${questions === 1 ? 'question' : 'questions'}`, notes > 0 && `${notes} ${notes === 1 ? 'note' : 'notes'}`,
          ].filter(Boolean).join(' · ');
          return (
            <UnstyledButton key={scene.id}
              onClick={(event) => {
                event.stopPropagation();
                setSearch({ scene: scene.id });
                playback.seek(scene.from);
              }}
              {...stylex.props(styles.scene, styles.span(pct(scene.from), pct(scene.to - scene.from)), focusedScene === scene.id && styles.focused)}>
              <Text component="span" size="md" {...stylex.props(styles.name)}>{scene.n} · {planSceneTitle(scene.id)}</Text>
              <Text component="span" size="xs" {...stylex.props(styles.facts)}>{facts}</Text>
              <Box component="span" {...stylex.props(styles.state)}>
                {questions > 0 && <Box component="span" aria-label="The agent asks you something here" {...stylex.props(styles.caution)}><CircleHelp size={14} /></Box>}
                {state === 'signed' && <Box component="span" aria-label="Approved" {...stylex.props(styles.pass)}><Check size={14} /></Box>}
                {state === 'stale' && <Box component="span" aria-label="Changed since approved" {...stylex.props(styles.caution)}><RotateCcw size={14} /></Box>}
              </Box>
            </UnstyledButton>
          );
        })}
        {timing.flags.map((flag) => {
          const said = `${formatPlanSeconds((flag.to - flag.from) / fps)} ${flag.kind === 'silence' ? 'silent' : 'with nothing happening'}`;
          return (
            <HotkeyTooltip key={`${flag.kind}-${flag.from}`} name={said}>
              <Box {...stylex.props(styles.flag, styles.span(pct(flag.from), pct(flag.to - flag.from)))}>
                <Text component="span" size="xs" {...stylex.props(styles.flagLabel)}>{said}</Text>
              </Box>
            </HotkeyTooltip>
          );
        })}
        <Box {...stylex.props(styles.target, styles.targetAt(pct(target)))}>
          <Text component="span" size="xs" {...stylex.props(styles.targetLabel)}>{plan.storyboard.target.seconds} s target{over > 0 ? ` · ${formatPlanSeconds(over / fps)} over` : ''}</Text>
        </Box>
        <Box {...stylex.props(styles.playhead, styles.playheadAt(scale))} />
      </Box>
    </Box>
  );
}
