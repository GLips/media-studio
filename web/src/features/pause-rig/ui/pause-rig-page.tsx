// pause-rig-page.tsx: a rig for tuning how recorded lines pace their pauses (library-pause-pacing.ts). DialKit's knobs
// are the pacing's own values; the preview plays a playlist of lines from several takes, his face and voice through
// the real cleanup, as short clips around each changed pause or taken filler, or as whole lines. A scratch page: it
// comes down once the values are baked.
import { Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useQueries } from '@tanstack/react-query';
import { DialRoot, useDialKit } from 'dialkit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { libraryFootage } from '#lib/footage/library/models/library-footage.ts';
import type { LibraryLineCleanup } from '#lib/footage/library/models/library-line-cut.ts';
import { LIBRARY_PAUSE_PACING } from '#lib/footage/library/models/library-pause-pacing.ts';
import { libraryMediaUrl } from '#lib/footage/library/studio/library-media.ts';
import { spokenStretchSeconds, type RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { libraryItemViewQueryOptions } from '#web/features/library/index.ts';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PAUSE_RIG_LINES, pauseRigClipsOf } from './pause-rig-lines.ts';
import { usePauseRigPlayback, type PauseRigEntry } from './use-pause-rig-playback.ts';
// oxlint-disable-next-line import/no-unassigned-import -- DialKit's panel styles, which its components need loaded
import 'dialkit/styles.css';

const styles = stylex.create({
  page: { display: 'grid', gridTemplateColumns: `1fr ${spacing.queueWidth} ${spacing.sideWidth}`, gap: spacing.inset, padding: spacing.inset, height: '100vh', backgroundColor: colors.ground, color: colors.cream },
  stage: { minHeight: 0, overflowY: 'auto' },
  video: { display: 'block', width: '100%', height: '55vh', objectFit: 'contain', backgroundColor: colors.panel, borderRadius: radius.control },
  on: { borderColor: colors.accent },
  mono: { fontFamily: fonts.mono, color: colors.dim },
  word: { color: colors.dim },
  said: { color: colors.cream },
  chip: { fontFamily: fonts.mono, paddingInline: spacing.tight, borderRadius: radius.control, borderWidth: 1, borderStyle: 'solid', borderColor: colors.line, color: colors.dim },
  hesitation: { borderColor: colors.caution, color: colors.caution },
  boundary: { borderColor: colors.cobalt, color: colors.cream },
  taken: { textDecoration: 'line-through', borderColor: colors.danger, color: colors.danger },
  now: { backgroundColor: colors.raised },
  side: { overflowY: 'auto' },
  row: { padding: spacing.gap, borderRadius: radius.control, backgroundColor: { default: colors.panel, ':hover': colors.raised }, borderWidth: 1, borderStyle: 'solid', borderColor: colors.panel },
  current: { borderColor: colors.accent },
  failure: { color: colors.danger },
});

const p = LIBRARY_PAUSE_PACING;
/** A slider: its default, least, most and step. */
const slider = (value: number, min: number, max: number, step: number): [number, number, number, number] => [value, min, max, step];
const button = (label: string) => ({ type: 'action' as const, label });
const DIAL = {
  bypass: false,
  mode: { type: 'select' as const, options: ['clips', 'lines'], default: 'clips' },
  hesitation: slider(p.hesitation, 0.05, 1.5, 0.01),
  boundary: slider(p.boundary, 0.1, 2, 0.01),
  boundaryExcess: slider(p.boundaryExcess, 0, 1, 0.05),
  topSpeed: slider(p.topSpeed, 1, 8, 0.1),
  ramp: slider(p.ramp, 0, 0.6, 0.01),
  longest: slider(p.longest, 0.5, 5, 0.05),
  voicedCutFade: slider(0.06, 0, 0.2, 0.005),
  play: button('Play / stop (space)'),
  replay: button('Replay (r)'),
  previous: button('Previous (←)'),
  next: button('Next (→)'),
};

const HOTKEYS: Record<string, string> = { ' ': 'play', r: 'replay', ArrowLeft: 'previous', ArrowRight: 'next' };

export function PauseRigPage() {
  const items = useMemo(() => [...new Set(PAUSE_RIG_LINES.map((l) => l.item))], []);
  const views = useQueries({ queries: items.map((item) => libraryItemViewQueryOptions(item)) });
  const loaded = views.map((v) => v.data);
  const footage = useMemo(() => new Map(loaded.flatMap((view) => (view?.transcript ? [[view.item.id, libraryFootage(view.item, view.transcript)] as const] : []))),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- each view's data, not the array useQueries makes anew each render
    loaded);
  const onAction = useRef<(name: string) => void>(() => undefined);
  const dial = useDialKit('Pauses', DIAL, { id: 'pause-rig', persist: true, onAction: (name) => onAction.current(name) });

  const values = { hesitation: dial.hesitation, boundary: dial.boundary, boundaryExcess: dial.boundaryExcess, topSpeed: dial.topSpeed, ramp: dial.ramp, longest: dial.longest };
  const key = JSON.stringify([values, dial.voicedCutFade, dial.bypass]);
  const { speeches, clips } = useMemo(() => {
    const cutAll = (cleanup: LibraryLineCleanup) => PAUSE_RIG_LINES.map((spec): RecordedSpeech | string => {
      const take = footage.get(spec.item);
      if (!take) return `${spec.item} isn't loaded, or has no transcript`;
      try {
        return take.speech(spec.from, spec.to, cleanup);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    const paced = cutAll({ voicedCutFade: dial.voicedCutFade, pauses: values });
    // Clips come from the paced cut even under bypass, so A and B play the same stretches of the take.
    return {
      speeches: dial.bypass ? cutAll({ voicedCutFade: dial.voicedCutFade, pauses: false }) : paced,
      clips: paced.flatMap((s, line) => (typeof s === 'string' ? [] : pauseRigClipsOf(line, s))),
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` holds every value read
  }, [footage, key]);
  const entries = useMemo((): PauseRigEntry[] => (dial.mode === 'lines' ? PAUSE_RIG_LINES.map((_, line) => ({ line })) : clips.map((clip) => ({ line: clip.line, clip }))), [dial.mode, clips]);

  const video = useRef<HTMLVideoElement>(null);
  const playback = usePauseRigPlayback({ entries, speeches, takeOf: (line) => footage.get(PAUSE_RIG_LINES[line].item), video });
  const { entry, speech, take, head } = playback;
  onAction.current = (name) => {
    if (name === 'play') playback.toggle();
    if (name === 'replay') playback.replay();
    if (name === 'previous') playback.step(-1);
    if (name === 'next') playback.step(1);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const name = HOTKEYS[event.key];
      if (!name || event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      onAction.current(name);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const spec = entry && PAUSE_RIG_LINES[entry.line];
  const camera = take?.item.tracks.camera;
  return (
    <Box {...stylex.props(styles.page)}>
      <Stack gap="inset" {...stylex.props(styles.stage)}>
        {take && camera
          ? <Box component="video" ref={video} key={take.item.id} src={libraryMediaUrl(take.item.id, camera.proxy?.file ?? camera.file)} muted playsInline preload="auto" {...stylex.props(styles.video)} />
          : <Box {...stylex.props(styles.video)} />}
        <Group gap="gap">
          <Button onClick={() => playback.step(-1)}>← Prev</Button>
          <Button onClick={playback.toggle} {...stylex.props(playback.running && styles.on)}>{playback.running ? 'Stop' : 'Play'} (space)</Button>
          <Button onClick={playback.replay}>Replay (r)</Button>
          <Button onClick={() => playback.step(1)}>Next →</Button>
          <Text size="xs" {...stylex.props(styles.mono)}>
            {entries.length ? `${dial.mode === 'clips' ? 'clip' : 'line'} ${playback.index + 1} of ${entries.length}` : 'nothing to play'}
            {' · '}{dial.bypass ? 'A: every pause as recorded' : 'B: pauses paced'}
            {head.playing && ` · line ${head.line.toFixed(2)} s, take ${head.item.toFixed(2)} s`}
          </Text>
          <CopyValues text={`pauses: ${JSON.stringify(values)}, voicedCutFade: ${dial.voicedCutFade}`} />
        </Group>
        <Text size="xs" {...stylex.props(styles.mono)}>defaults {JSON.stringify(LIBRARY_PAUSE_PACING)}, voicedCutFade 0.06</Text>
        {spec && <Text size="xs" {...stylex.props(styles.mono)}>{spec.item} {spec.from}–{spec.to} s: {spec.about}{entry?.clip && ` · this clip: ${entry.clip.about}`}</Text>}
        {typeof speech === 'string' && <Text {...stylex.props(styles.failure)}>{speech}</Text>}
        {typeof speech === 'object' && <PauseRigTranscript speech={speech} line={head.playing ? head.line : -1} />}
      </Stack>
      <Stack gap="tight" {...stylex.props(styles.side)}>
        {PAUSE_RIG_LINES.map((line, k) => (
          <PauseRigLineRow key={`${line.item}@${line.from}`} about={line.about} speech={speeches[k]} clips={clips.filter((c) => c.line === k).length}
            current={entry?.line === k} onPick={() => {
              const first = entries.findIndex((e) => e.line === k);
              if (first >= 0) playback.jumpTo(first);
            }} />
        ))}
      </Stack>
      <Box {...stylex.props(styles.side)}><DialRoot mode="inline" defaultOpen productionEnabled /></Box>
    </Box>
  );
}

function CopyValues({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy values'}</Button>;
}

/** A playlist line: what it tests, how long it plays recorded and paced, and what its cleanup changed. */
function PauseRigLineRow({ about, speech, clips, current, onPick }: { about: string; speech: RecordedSpeech | string; clips: number; current: boolean; onPick: () => void }) {
  const paced = (kind: string) => (typeof speech === 'string' ? 0 : speech.pauses.filter((x) => x.kind === kind && x.speed > 1).length);
  return (
    <UnstyledButton onClick={onPick} {...stylex.props(styles.row, current && styles.current)}>
      <Text size="sm">{about}</Text>
      <Text size="xs" {...stylex.props(styles.mono)}>
        {typeof speech === 'string' ? speech : `${(speech.to - speech.from).toFixed(1)} s recorded → ${spokenStretchSeconds(speech).toFixed(1)} s · ${paced('hesitation')} hesitations, ${paced('boundary')} boundaries paced · ${clips} clips`}
      </Text>
    </UnstyledButton>
  );
}

// Pauses shorter than this are the gaps any fluent speech has, and aren't marked.
const MARKED_PAUSE = 0.15;

/** The line's words as it plays them, each pause marked by its kind with what it plays as, and each filler it took. */
function PauseRigTranscript({ speech, line }: { speech: RecordedSpeech; line: number }) {
  const marks = [
    ...speech.heard.map((w) => ({ key: `w${w.start}`, at: w.start, end: w.end, word: w.text })),
    ...speech.pauses.filter((x) => x.to - x.from >= MARKED_PAUSE).map((x) => ({ key: `p${x.from}`, at: x.at, end: x.at + x.plays, pause: x })),
    ...speech.removals.filter((r) => r.kind !== 'pause' && !r.left).map((r) => ({ key: `r${r.from}`, at: r.at, end: r.at, taken: r.text })),
  ].toSorted((a, b) => a.at - b.at);
  return (
    <Group gap="tight">
      {marks.map((m) => {
        const now = line >= m.at && line < m.end;
        if ('word' in m) return <Text key={m.key} component="span" size="prose" {...stylex.props(styles.word, now && styles.said)}>{m.word}</Text>;
        if ('taken' in m) return <Text key={m.key} component="span" size="xs" {...stylex.props(styles.chip, styles.taken)}>{m.taken}</Text>;
        const { pause } = m;
        return (
          <Text key={m.key} component="span" size="xs" title={`${pause.kind}${pause.kept ? ', kept by review' : ''}`} {...stylex.props(styles.chip, pause.speed > 1 && styles[pause.kind], now && styles.now)}>
            {pause.kind === 'hesitation' ? 'H' : 'B'} {(pause.to - pause.from).toFixed(2)}→{pause.plays.toFixed(2)}{pause.speed > 1 ? ` ×${pause.speed.toFixed(1)}` : ''}
          </Text>
        );
      })}
    </Group>
  );
}
