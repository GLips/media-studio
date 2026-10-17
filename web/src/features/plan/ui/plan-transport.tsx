import { Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PLAN_HOLD_FLAG_SECONDS, PLAN_SILENCE_FLAG_SECONDS } from './plan-timing.ts';
import { usePlanFlagHotkeys } from './use-plan-flag-hotkeys.ts';

const styles = stylex.create({
  transport: { height: spacing.row, marginBottom: spacing.tight },
  step: { paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised } },
  flags: { color: colors.caution, whiteSpace: 'nowrap' },
  quiet: { color: colors.dim, cursor: 'default', whiteSpace: 'nowrap' },
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * `▶ 0:03.40 / 0:24.13`, and on the right what the flags found, a button that steps to the next: the plan's
 * transport. While playing, the time is written into its node on each tick, as the playhead is.
 */
export function PlanTransport() {
  const screen = usePlanScreen();
  const { playback, timing } = screen;
  const stepFlag = usePlanFlagHotkeys(screen);
  const playing = useSyncExternalStore(playback.subscribe, () => playback.getState().playing);
  const frame = useSyncExternalStore(playback.subscribe, () => playback.getState().frame);
  const time = useRef<HTMLSpanElement>(null);
  const fps = timing?.fps ?? 1;
  useEffect(() => playback.onTick((now) => {
    if (time.current) time.current.textContent = formatReviewClock(now / fps);
  }), [playback, fps]);
  const silences = timing?.flags.filter((f) => f.kind === 'silence').length ?? 0;
  const holds = timing?.flags.filter((f) => f.kind === 'hold').length ?? 0;
  return (
    <Group justify="space-between" wrap="nowrap" {...stylex.props(styles.transport)}>
      <Group gap="tight" wrap="nowrap">
        <IconButton name={playing ? 'Pause' : 'Play'} hotkey="Play" onClick={playback.toggle}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
        <Readout bright ref={time} chars={7}>{formatReviewClock(frame / fps)}</Readout>
        {timing && <Readout>/ {formatReviewClock(timing.end / fps)}</Readout>}
      </Group>
      {timing && (silences + holds > 0
        ? (
          <HotkeyTooltip name={`Next flag: silences over ${PLAN_SILENCE_FLAG_SECONDS} s, and stretches over ${PLAN_HOLD_FLAG_SECONDS} s with no cut, cue, speech or move`} hotkey="Next flag">
            <UnstyledButton onClick={() => stepFlag(1)} {...stylex.props(styles.step)}>
              <Text component="span" size="sm" {...stylex.props(styles.flags)}>
                {[silences > 0 && plural(silences, 'silence', 'silences'), holds > 0 && plural(holds, 'hold', 'holds')].filter(Boolean).join(' · ')}
              </Text>
            </UnstyledButton>
          </HotkeyTooltip>
        )
        : <Text component="span" size="sm" {...stylex.props(styles.quiet)}>no long silences or holds</Text>)}
    </Group>
  );
}
