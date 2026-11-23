import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play } from 'lucide-react';
import { useRef, type PointerEvent } from 'react';
import { formatReviewClock, formatReviewClockRange } from '#lib/output/review/models/review-timeline-geometry.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { useLinkedMediaTick } from '#web/shared/ui/linked-media-clock.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen } from './library-item-context.tsx';
import { LIBRARY_CLOCK_FPS, useLibraryPlaybackState } from './library-item-playback.ts';

// LIBRARY_TIME_VAR spelled out: StyleX compiles each file alone and can't read an imported value.
const TIME = 'var(--library-time, 0)';

/** How far a press must move before it marks a range rather than seeks: a hand's tremor isn't a range. */
const LIBRARY_DRAG_PX = 4;

const styles = stylex.create({
  bar: {
    height: spacing.bar, paddingInline: spacing.tight, minWidth: 0,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line, backgroundColor: colors.ground,
  },
  strip: {
    position: 'relative', height: '44px', cursor: 'pointer', touchAction: 'none', backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line, userSelect: 'none',
  },
  // What's said: each line of the transcript a band, so the quiet stretches between takes show.
  line: { position: 'absolute', bottom: '6px', height: '8px', backgroundColor: colors.laneB, borderRadius: radius.control, pointerEvents: 'none' },
  flag: {
    position: 'absolute', top: '6px', height: '14px', minWidth: '3px', borderRadius: radius.control, cursor: 'pointer',
    opacity: { default: 0.75, ':hover': 1 }, borderWidth: 0, padding: 0,
    outlineStyle: 'solid', outlineColor: colors.cream, outlineWidth: 0, outlineOffset: '1px',
  },
  agent: { backgroundColor: colors.caution },
  reviewer: { backgroundColor: colors.cobalt },
  focused: { opacity: 1, outlineWidth: '1px' },
  marked: { position: 'absolute', insetBlock: 0, backgroundColor: colors.rangeWash, borderInlineWidth: '1px', borderInlineStyle: 'solid', borderInlineColor: colors.cobalt, pointerEvents: 'none' },
  span: (left: number, width: number) => ({ left: `${left * 100}%`, width: `${width * 100}%` }),
  head: { position: 'absolute', insetBlock: 0, width: spacing.hairline, backgroundColor: colors.cream, pointerEvents: 'none', translate: '-1px 0' },
  headAt: (seconds: number) => ({ left: `calc(${TIME} / ${seconds} * 100%)` }),
  range: { color: colors.cobalt, fontFamily: fonts.mono },
});

/**
 * The transport and the item's whole length as one strip: what's said as bands, flags above them (an agent's in
 * caution, Graham's in cobalt), the marked range and the playhead. A press seeks; a drag marks a range to flag; a
 * flag's bar opens it.
 */
export function LibraryTimeline({ reach }: { readonly reach: { start: number; end: number } }) {
  const { view, playback, lines, flags, focused, focusFlag, marked, setMarked } = useLibraryItemScreen();
  const playing = useLibraryPlaybackState(playback, (s) => s.playing);
  const time = useLibraryPlaybackState(playback, (s) => s.time);
  const clock = useRef<HTMLSpanElement>(null);
  const press = useRef<{ x: number; seconds: number } | null>(null);
  const duration = view.item.durationSeconds;
  // The text node React rendered, not textContent: replacing the node would leave React updating a detached one.
  useLinkedMediaTick(playback, (frame) => {
    const node = clock.current?.firstChild;
    if (node) node.nodeValue = formatReviewClock(frame / LIBRARY_CLOCK_FPS);
  });
  const secondsAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const seconds = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration;
    return Math.max(reach.start, Math.min(reach.end, seconds));
  };
  return (
    <Box>
      <Group gap="gap" wrap="nowrap" {...stylex.props(styles.bar)}>
        <IconButton name="Play" onClick={playback.toggle} active={playing}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
        <Readout bright ref={clock} chars={8}>{formatReviewClock(time)}</Readout>
        <Readout>{formatReviewClock(duration)}</Readout>
        {marked && (
          <HotkeyTooltip name="Flag the marked range" hotkey="Flag range">
            <Text component="span" size="xs" {...stylex.props(styles.range)}>{formatReviewClockRange(marked.start, marked.end)}</Text>
          </HotkeyTooltip>
        )}
      </Group>
      <Box
        role="slider"
        tabIndex={-1}
        aria-label="Time"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={formatReviewClock(time)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const seconds = secondsAt(event);
          press.current = { x: event.clientX, seconds };
          playback.seek(seconds);
        }}
        onPointerMove={(event) => {
          const from = press.current;
          if (!from || !event.buttons || Math.abs(event.clientX - from.x) < LIBRARY_DRAG_PX) return;
          const seconds = secondsAt(event);
          setMarked({ start: Math.min(from.seconds, seconds), end: Math.max(from.seconds, seconds) });
        }}
        onPointerUp={() => { press.current = null; }}
        {...stylex.props(styles.strip)}
      >
        {lines.map((line) => <Box key={line.firstWord} {...stylex.props(styles.line, styles.span(line.start / duration, (line.end - line.start) / duration))} />)}
        {marked && <Box {...stylex.props(styles.marked, styles.span(marked.start / duration, (marked.end - marked.start) / duration))} />}
        {flags.flags.map((flag) => (
          <HotkeyTooltip key={flag.id} name={`#${flag.id} ${formatReviewClockRange(flag.start, flag.end)}${flag.note ? `: ${flag.note}` : ''}`}>
            <UnstyledButton
              aria-label={`Flag ${flag.id}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => focusFlag(flag)}
              {...stylex.props(styles.flag, styles[flag.by], focused?.id === flag.id && styles.focused, styles.span(flag.start / duration, (flag.end - flag.start) / duration))}
            />
          </HotkeyTooltip>
        ))}
        <Box {...stylex.props(styles.head, styles.headAt(duration))} />
      </Box>
    </Box>
  );
}
