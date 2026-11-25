import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useRef, type PointerEvent } from 'react';
import { formatLibraryLength } from '#lib/footage/library/models/library-item.ts';
import { formatReviewClock, formatReviewClockRange, reviewRulerTicks, reviewTimelineFit } from '#lib/output/review/models/review-timeline-geometry.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { useLinkedMediaTick } from '#web/shared/ui/linked-media-clock.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { LibraryClockHover } from './library-clock-hover.tsx';
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
    position: 'relative', height: '60px', cursor: 'pointer', touchAction: 'none', backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line, userSelect: 'none',
  },
  // What's said: each line of the transcript a band, so the quiet stretches between takes show.
  line: { position: 'absolute', bottom: '6px', height: '8px', backgroundColor: colors.mark, borderRadius: radius.control, pointerEvents: 'none' },
  // The time ruler, across the strip's top: a tick and its time wherever a label has room, as the render review's.
  ruler: { position: 'absolute', insetInline: 0, top: 0, height: spacing.laneGutter, pointerEvents: 'none', overflow: 'hidden' },
  tick: { position: 'absolute', top: 0, width: '1px', height: spacing.tight, backgroundColor: colors.mark },
  label: { position: 'absolute', top: spacing.hairline, paddingLeft: spacing.tight, fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.dim, whiteSpace: 'nowrap' },
  at: (x: number) => ({ left: `${x}px` }),
  flag: {
    position: 'absolute', top: '24px', height: '14px', minWidth: '3px', borderRadius: radius.control, cursor: 'pointer',
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
  // A readout that steps on a click, so the speed reads as a value, as the render review's rate does.
  rate: {
    paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
});

/**
 * The track heard, as a readout that steps through the item's tracks with sound on a click, as the speed does: the mic,
 * say, then the Mac's own sound. None for an item with one track of sound.
 */
function LibraryHeardSwitch() {
  const { playback, audible, hear } = useLibraryItemScreen();
  if (audible.length < 2) return null;
  const at = audible.findIndex(({ track }) => track === playback.heard);
  const next = audible[(at + 1) % audible.length];
  const label = audible[at]?.label ?? playback.heard;
  return (
    <HotkeyTooltip name={`Hearing ${label}: hear ${next.label}`}>
      <UnstyledButton aria-label={`Hearing ${label}`} onClick={() => hear(next.track)} {...stylex.props(styles.rate)}>
        <Readout bright={playback.heard !== audible[0].track}>{label}</Readout>
      </UnstyledButton>
    </HotkeyTooltip>
  );
}

/** Play, the time, the speed and the sound: the render review's transport, on the library's clock. */
function LibraryTransport() {
  const { view, playback, marked } = useLibraryItemScreen();
  const playing = useLibraryPlaybackState(playback, (s) => s.playing);
  const time = useLibraryPlaybackState(playback, (s) => s.time);
  const rate = useLibraryPlaybackState(playback, (s) => s.rate);
  const muted = useLibraryPlaybackState(playback, (s) => s.muted);
  const clock = useRef<HTMLSpanElement>(null), exactClock = useRef<HTMLSpanElement>(null);
  // The text nodes React rendered, not textContent: replacing a node would leave React updating a detached one.
  useLinkedMediaTick(playback, (frame) => {
    const exact = formatReviewClock(frame / LIBRARY_CLOCK_FPS);
    const node = clock.current?.firstChild, exactNode = exactClock.current?.firstChild;
    if (node) node.nodeValue = exact.slice(0, -3);
    if (exactNode) exactNode.nodeValue = exact;
  });
  const length = view.item.durationSeconds;
  return (
    <Group gap="gap" wrap="nowrap" {...stylex.props(styles.bar)}>
      <IconButton name="Play" onClick={playback.toggle} active={playing}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
      <LibraryClockHover
        whole={<><Readout bright ref={clock} chars={5}>{formatReviewClock(time).slice(0, -3)}</Readout><Readout>/ {formatLibraryLength(length)}</Readout></>}
        exact={<><Readout bright ref={exactClock}>{formatReviewClock(time)}</Readout><Readout>/ {formatReviewClock(length)}</Readout></>}
      />
      <HotkeyTooltip name="Speed">
        <UnstyledButton aria-label={`Speed ${rate}×`} onClick={playback.cycleRate} {...stylex.props(styles.rate)}>
          <Readout bright={rate !== 1}>{`${rate}×`}</Readout>
        </UnstyledButton>
      </HotkeyTooltip>
      <IconButton name="Mute" active={muted} onClick={() => playback.setMuted(!muted)}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</IconButton>
      <LibraryHeardSwitch />
      {marked && (
        <HotkeyTooltip name="Flag the marked range" hotkey="Flag range">
          <Text component="span" size="xs" {...stylex.props(styles.range)}>{formatReviewClockRange(marked.start, marked.end)}</Text>
        </HotkeyTooltip>
      )}
    </Group>
  );
}

/**
 * The transport and the item's whole length as one strip: what's said as bands, flags above them (an agent's in
 * caution, Graham's in cobalt), the marked range and the playhead. A press seeks; a drag marks a range to flag; a
 * flag's bar opens it.
 */
export function LibraryTimeline({ reach }: { readonly reach: { start: number; end: number } }) {
  const { view, playback, lines, flags, focused, focusFlag, marked, setMarked } = useLibraryItemScreen();
  const time = useLibraryPlaybackState(playback, (s) => s.time);
  const press = useRef<{ x: number; seconds: number } | null>(null);
  const duration = view.item.durationSeconds;
  const { ref: sized, width } = useElementSize<HTMLDivElement>();
  const ticks = reviewRulerTicks(reviewTimelineFit(Math.round(duration * LIBRARY_CLOCK_FPS), width), { fps: LIBRARY_CLOCK_FPS, beats: [] });
  const secondsAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const seconds = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration;
    return Math.max(reach.start, Math.min(reach.end, seconds));
  };
  return (
    <Box>
      <LibraryTransport />
      <Box
        ref={sized}
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
        <Box aria-hidden {...stylex.props(styles.ruler)}>
          {ticks.map((tick) => (
            <Box key={tick.frame}>
              <Box {...stylex.props(styles.tick, styles.at(tick.x))} />
              {/* The start needs no `0:00`. */}
              {tick.kind === 'time' && tick.frame > 0 && <Text component="span" fz="xs" {...stylex.props(styles.label, styles.at(tick.x))}>{tick.label}</Text>}
            </Box>
          ))}
        </Box>
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
