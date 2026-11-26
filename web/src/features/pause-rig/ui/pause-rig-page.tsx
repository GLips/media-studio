// pause-rig-page.tsx: a rig for tuning how recorded lines pace their pauses (library-pause-pacing.ts). Its first mode
// asks "1 or 2?" (pause-rig-tuner.ts), then confirms the values it settles on over whole lines. The others play the
// playlist, his face and voice through the real cleanup, as short clips around each changed pause or taken filler or
// as whole lines, under DialKit's knobs. Anything playing takes a note. A scratch page: it comes down once the values
// are baked.
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
import { PauseRigNote } from './pause-rig-note.tsx';
import { PauseRigPickPanel } from './pause-rig-pick-panel.tsx';
import { PAUSE_RIG_LINES, pauseRigClipsOf, pauseRigPickClipsOf } from './pause-rig-lines.ts';
import { usePauseRigPick } from './use-pause-rig-pick.ts';
import { usePauseRigPlayback, type PauseRigEntry } from './use-pause-rig-playback.ts';
// oxlint-disable-next-line import/no-unassigned-import -- DialKit's panel styles, which its components need loaded
import 'dialkit/styles.css';

const styles = stylex.create({
  page: { display: 'grid', gridTemplateColumns: `1fr ${spacing.queueWidth} ${spacing.sideWidth}`, gap: spacing.inset, padding: spacing.inset, height: '100vh', backgroundColor: colors.ground, color: colors.cream },
  stage: { minHeight: 0, overflowY: 'auto' },
  video: { display: 'block', width: '100%', height: '50vh', objectFit: 'contain', backgroundColor: colors.panel, borderRadius: radius.control },
  on: { borderColor: colors.accent, color: colors.accent },
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
const DIAL = {
  mode: { type: 'select' as const, options: ['1 or 2', 'clips', 'lines'], default: '1 or 2' },
  bypass: false,
  manual: {
    _collapsed: true,
    hesitation: slider(p.hesitation, 0.05, 1.5, 0.01),
    boundary: slider(p.boundary, 0.1, 2, 0.01),
    boundaryExcess: slider(p.boundaryExcess, 0, 1, 0.05),
    topSpeed: slider(p.topSpeed, 1, 8, 0.1),
    ramp: slider(p.ramp, 0, 0.6, 0.01),
    longest: slider(p.longest, 0.5, 5, 0.05),
    voicedCutFade: slider(0.06, 0, 0.2, 0.005),
  },
};

// Keys each mode answers to, by the action they take.
const PICK_KEYS = new Map(Object.entries({
  '1': 'first', '2': 'second', '3': 'same', '0': 'same', ' ': 'both', r: 'both', a: 'play-first', b: 'play-second', u: 'undo',
  q: 'rushed', w: 'draggy', e: 'choppy', f: 'fine', y: 'natural', n: 'unnatural',
}));
const PLAYLIST_KEYS = new Map(Object.entries({ ' ': 'play', r: 'replay', ArrowLeft: 'previous', ArrowRight: 'next' }));

export function PauseRigPage() {
  const items = useMemo(() => [...new Set(PAUSE_RIG_LINES.map((l) => l.item))], []);
  const views = useQueries({ queries: items.map((item) => libraryItemViewQueryOptions(item)) });
  const loaded = views.map((v) => v.data);
  const footage = useMemo(() => new Map(loaded.flatMap((view) => (view?.transcript ? [[view.item.id, libraryFootage(view.item, view.transcript)] as const] : []))),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- each view's data, not the array useQueries makes anew each render
    loaded);
  const dial = useDialKit('Pauses', DIAL, { id: 'pause-rig-tuning', persist: true });
  const picking = dial.mode === '1 or 2';
  const { voicedCutFade, ...manual } = dial.manual;
  const takeOf = (line: number) => footage.get(PAUSE_RIG_LINES[line].item);
  const cutLine = (line: number, cleanup: LibraryLineCleanup): RecordedSpeech | string => {
    const spec = PAUSE_RIG_LINES[line], take = footage.get(spec.item);
    if (!take) return `${spec.item} isn't loaded, or has no transcript`;
    try {
      return take.speech(spec.from, spec.to, cleanup);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const cutAll = (cleanup: LibraryLineCleanup) => PAUSE_RIG_LINES.map((_, line) => cutLine(line, cleanup));
  const pickClips = useMemo(() => cutAll({ voicedCutFade }).flatMap((s, line) => (typeof s === 'string' ? [] : pauseRigPickClipsOf(line, s))),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- cutAll reads only these
    [footage, voicedCutFade]);

  const video = useRef<HTMLVideoElement>(null);
  const pick = usePauseRigPick({ active: picking, clips: pickClips, cut: (line, values) => cutLine(line, { voicedCutFade, pauses: values }), takeOf, video, start: manual });
  const [confirmNote, setConfirmNote] = useState('');
  const values = picking ? pick.best : manual;

  const key = JSON.stringify([values, voicedCutFade, dial.bypass, picking]);
  const { speeches, clips } = useMemo(() => {
    const paced = cutAll({ voicedCutFade, pauses: values });
    // Clips come from the paced cut even under bypass, so A and B play the same stretches of the take.
    return {
      speeches: dial.bypass && !picking ? cutAll({ voicedCutFade, pauses: false }) : paced,
      clips: paced.flatMap((s, line) => (typeof s === 'string' ? [] : pauseRigClipsOf(line, s))),
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` holds every value read
  }, [footage, key]);
  const entries = useMemo((): PauseRigEntry[] => {
    if (picking) return [];
    return dial.mode === 'lines' ? PAUSE_RIG_LINES.map((_, line) => ({ line })) : clips.map((clip) => ({ line: clip.line, clip }));
  }, [picking, dial.mode, clips]);
  const playback = usePauseRigPlayback({ entries, speeches, takeOf, video });

  const act = useRef<(name: string) => void>(() => undefined);
  act.current = (name) => {
    if (name === 'first' || name === 'second' || name === 'same') pick.pick(name);
    if (name === 'both') {
      if (pick.confirmLine === undefined) pick.playBoth();
      else pick.play('line');
    }
    if (name === 'play-first') pick.play('first');
    if (name === 'play-second') pick.play('second');
    if (name === 'undo') pick.undo();
    if (name === 'rushed' || name === 'draggy' || name === 'choppy' || name === 'fine') pick.setFeel((now) => (now === name ? undefined : name));
    if (name === 'natural' || name === 'unnatural') {
      pick.confirm(name === 'natural', confirmNote);
      setConfirmNote('');
    }
    if (name === 'play') playback.toggle();
    if (name === 'replay') playback.replay();
    if (name === 'previous') playback.step(-1);
    if (name === 'next') playback.step(1);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return;
      const name = (picking ? PICK_KEYS : PLAYLIST_KEYS).get(event.key);
      if (!name) return;
      event.preventDefault();
      act.current(name);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const line = picking ? pick.line : playback.entry?.line;
  const shownClip = picking ? pick.clip : playback.entry?.clip;
  const spec = line === undefined ? undefined : PAUSE_RIG_LINES[line];
  const take = line === undefined ? undefined : takeOf(line);
  const speech = line === undefined ? undefined : speeches[line];
  const camera = take?.item.tracks.camera;
  const copied = `pauses: ${JSON.stringify(values)}, voicedCutFade: ${voicedCutFade}`;
  const noteAbout = () => ({
    mode: dial.mode,
    clip: spec && { item: spec.item, from: shownClip?.from ?? spec.from, to: shownClip?.to ?? spec.to, about: shownClip?.about ?? spec.about },
    values: { ...values, voicedCutFade },
    shown: picking ? pick.shown() : { version: dial.bypass ? 'A: every pause as recorded' : 'B: pauses paced' },
  });

  return (
    <Box {...stylex.props(styles.page)}>
      <Stack gap="gap" {...stylex.props(styles.stage)}>
        {take && camera
          ? <Box component="video" ref={video} key={take.item.id} src={libraryMediaUrl(take.item.id, camera.proxy?.file ?? camera.file)} muted playsInline preload="auto" {...stylex.props(styles.video)} />
          : <Box {...stylex.props(styles.video)} />}
        {picking
          ? <PauseRigPickPanel pick={pick} confirmNote={confirmNote} onConfirmNote={setConfirmNote} act={(name) => act.current(name)} />
          : (
            <Group gap="gap">
              <Button onClick={() => playback.step(-1)}>← Prev</Button>
              <Button onClick={playback.toggle} {...stylex.props(playback.running && styles.on)}>{playback.running ? 'Stop' : 'Play'} (space)</Button>
              <Button onClick={playback.replay}>Replay (r)</Button>
              <Button onClick={() => playback.step(1)}>Next →</Button>
              <Text size="xs" {...stylex.props(styles.mono)}>
                {entries.length ? `${dial.mode === 'clips' ? 'clip' : 'line'} ${playback.index + 1} of ${entries.length}` : 'nothing to play'}
                {' · '}{dial.bypass ? 'A: every pause as recorded' : 'B: pauses paced (manual knobs)'}
              </Text>
            </Group>
          )}
        <Group gap="gap">
          <CopyValues text={copied} />
          <Text size="xs" {...stylex.props(styles.mono)}>{copied}</Text>
        </Group>
        {spec && <Text size="xs" {...stylex.props(styles.mono)}>{spec.item} {spec.from}–{spec.to} s: {spec.about}{shownClip && ` · this clip: ${shownClip.about}`}</Text>}
        {typeof speech === 'string' && <Text {...stylex.props(styles.failure)}>{speech}</Text>}
        {typeof speech === 'object' && <PauseRigTranscript speech={speech} line={!picking && playback.head.playing ? playback.head.line : -1} />}
        {spec && <PauseRigNote key={`${spec.item}@${shownClip?.from ?? spec.from}`} about={noteAbout} />}
      </Stack>
      <Stack gap="tight" {...stylex.props(styles.side)}>
        {PAUSE_RIG_LINES.map((l, k) => (
          <PauseRigLineRow key={`${l.item}@${l.from}`} about={l.about} speech={speeches[k]} clips={clips.filter((c) => c.line === k).length}
            current={line === k} onPick={() => {
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
