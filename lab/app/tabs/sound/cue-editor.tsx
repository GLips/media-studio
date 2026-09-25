// cue-editor.tsx: the Sound tab's cue editor. It loads a project's sfx/cues.json (the sound-effect list `studio sfx
// draft` writes) through lab/sfx-cue-api.ts, plays the rendered video with the list's sounds laid over it, and lets a
// person swap, mute, fill, nudge and level each cue, seeing live which of the studio's rules an edit breaks.
//
// The demo video doesn't play its cue list (its audio is voice, music and the scenes' own placed sounds), so the list's
// sounds are rendered here with lib/sfx itself and scheduled with Web Audio against the video's clock. Placed cues
// are already in the video's audio and are never scheduled twice.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { SfxEvent } from '../../../../lib/sfx/cue-events.ts';
import { sfxCueOverrides, sfxCuePlays, sfxCueSound, type SfxCue, type SfxCueList, type SfxCueProblem } from '../../../../lib/sfx/cues.ts';
import { SFX_RATE } from '../../../../lib/sfx/dsp.ts';
import { renderSfx, type SfxRequest } from '../../../../lib/sfx/library.ts';
import type { LabSfxCuePayload, LabSfxCueSave } from '../../../sfx-cue-api.ts';
import { LabSlider } from '../../ui.tsx';
import { labAudio } from './lab-audio.ts';
import './cue-editor.css';

const SFX_CUE_DEMO_PROJECT = '2026-09-simple-buy-box-story';
const sfxCueApiUrl = (project: string) => `/api/sfx-cues?project=${encodeURIComponent(project)}`;
/** A moment played from a marker: this long before the cue, and this long in all. */
const MOMENT_LEAD = 1.5;
const MOMENT_LENGTH = 3;
/** How far ahead of the video's playhead cue sounds are handed to Web Audio. */
const SCHEDULE_AHEAD = 0.3;

// ——— Sounds: rendered in the browser by lib/sfx, so what plays here is what a render plays ——————————————————————

type LabCueRender = { buffer: AudioBuffer; landsAt: number };
const labCueRenders = new Map<string, LabCueRender>();

/** A request rendered once and kept; the same request always renders the same samples, so the key is the request. */
function renderLabCueSound(sound: SfxRequest): LabCueRender {
  const key = JSON.stringify(sound);
  let rendered = labCueRenders.get(key);
  if (!rendered) {
    const { samples, landsAt } = renderSfx(sound);
    const buffer = labAudio().createBuffer(1, samples.length, SFX_RATE);
    buffer.copyToChannel(Float32Array.from(samples, (v) => v / 32767), 0);
    rendered = { buffer, landsAt };
    labCueRenders.set(key, rendered);
  }
  return rendered;
}

let labCuePreview: AudioBufferSourceNode | undefined;
/** One sound on its own, at a cue's volume. Another preview cuts it off. */
function previewLabCueSound(sound: SfxRequest, volume = 1) {
  const ctx = labAudio(), { buffer } = renderLabCueSound(sound);
  void ctx.resume();
  labCuePreview?.stop();
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  source.start();
  labCuePreview = source;
}

/**
 * Plays the list's sounds in step with `video`: every tick, sounds starting within SCHEDULE_AHEAD of its playhead are
 * started on the audio clock. A seek, pause or edit stops them all and starts over, joining any sound already under way
 * part-way through, so the two clocks never drift apart for long.
 */
function useLabCueScheduler(videoRef: RefObject<HTMLVideoElement | null>, list: SfxCueList | null, enabled: boolean) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !list || !enabled) return;
    const plays = sfxCuePlays(list).filter((p) => !p.inline);
    const ctx = labAudio();
    let live: AudioBufferSourceNode[] = [], started = new Set<string>();
    const stopAll = () => {
      live.forEach((s) => s.stop());
      live = [];
      started = new Set();
    };
    const tick = () => {
      if (video.paused || video.seeking) return;
      void ctx.resume();
      const now = video.currentTime;
      for (const play of plays) {
        if (started.has(play.id)) continue;
        const { buffer, landsAt } = renderLabCueSound(play.sound), start = play.at - landsAt;
        if (start > now + SCHEDULE_AHEAD || start + buffer.duration < now) continue;
        // A few ticks late plays whole (a clipped attack sounds worse than 50 ms late); after a seek, join part-way.
        const late = now - start, offset = late > 0.08 ? late : 0;
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = play.volume;
        source.connect(gain).connect(ctx.destination);
        source.start(ctx.currentTime + Math.max(0, -late), offset);
        live.push(source);
        started.add(play.id);
      }
    };
    const timer = setInterval(tick, 40);
    const restart = () => {
      stopAll();
      tick();
    };
    video.addEventListener('playing', restart);
    video.addEventListener('seeked', restart);
    video.addEventListener('pause', stopAll);
    video.addEventListener('seeking', stopAll);
    tick();
    return () => {
      clearInterval(timer);
      stopAll();
      video.removeEventListener('playing', restart);
      video.removeEventListener('seeked', restart);
      video.removeEventListener('pause', stopAll);
      video.removeEventListener('seeking', stopAll);
    };
  }, [videoRef, list, enabled]);
}

// ——— Plain words: the draft's reasons and the check's warnings, for someone who has never read cues.ts ————————————————

const sec = (x: number) => `${x.toFixed(1)} s`;

const SFX_SOUND_WORDS: Record<string, string> = {
  click: 'a mouse click', key: 'a key press', toggle: 'a switch flipping', impact: 'a soft thud', whoosh: 'a whoosh of air sweeping past',
  riser: 'a swell that rises into the moment', chime: 'a little chime', ding: 'a bell ding', pop: 'a bubbly pop', typing: 'a burst of typing', scroll: 'scroll-wheel ticks',
};
const SFX_PRESET_WORDS: Record<string, string> = {
  soft: 'gentler', fast: 'quicker', swell: 'slower and fuller', short: 'short', crisp: 'crisp', trackpad: 'a quiet trackpad tap',
  mechanical: 'clacky', heavy: 'heavy', slam: 'hard', whip: 'a whip pan',
};
/** A sound as words: its recipe, and how its preset differs ("a whoosh of air sweeping past, gentler"). */
function sfxSoundWords(sound: SfxRequest): string {
  const [recipe, preset] = sound.sound.split('.');
  const how = preset && SFX_PRESET_WORDS[preset];
  return `${SFX_SOUND_WORDS[recipe] ?? recipe}${how ? `, ${how}` : ''}`;
}

const REVEAL_KINDS = new Set(['highlight', 'dialog', 'card']);
/** A reveal's track (`sale/left/highlight`, `title/Simple buy box`) as what appears. */
function revealWords(track: string): string {
  const parts = track.split('/').slice(1), last = parts.at(-1)!.replace(/\s+/g, ' ').trim();
  const side = parts.length > 1 ? ` on the ${parts[0]}` : '';
  if (REVEAL_KINDS.has(last)) return `a ${last}${side}`;
  return /[A-Z ]/.test(last) ? `the words “${last.replace(/^\d+ /, '')}”` : `the ${last}${side}`;
}

/** An event as a sentence: "a click at 16.2 s in the photos scene". */
function sfxEventWords(e: SfxEvent): string {
  switch (e.kind) {
    case 'click': return `a click at ${sec(e.at)} in the ${e.scene} scene`;
    case 'key': return `a key press at ${sec(e.at)} in the ${e.scene} scene`;
    case 'placed': return `${sfxSoundWords(e.request)} that the ${e.scene} scene plays itself, at ${sec(e.at)}`;
    case 'scene': return e.dissolve ? `the dissolve into the ${e.scene} scene, at ${sec(e.at)}` : `the cut to the ${e.scene} scene, at ${sec(e.at)}`;
    case 'camera-move': return `a ${e.big ? 'big' : 'small'} camera move in the ${e.scene} scene (${sec(e.from)}–${sec(e.to)}), fastest at ${sec(e.at)}`;
    case 'reveal': return `${revealWords(e.track)} appearing at ${sec(e.at)} in the ${e.scene} scene`;
  }
}

/** A shorter name for an event another cue's reason points at. */
function sfxEventShortWords(e: SfxEvent | undefined, id: string): string {
  if (!e) return id;
  switch (e.kind) {
    case 'scene': return `the change to ${e.scene} (${sec(e.at)})`;
    case 'reveal': return `${revealWords(e.track)} appearing (${sec(e.at)})`;
    case 'camera-move': return `the camera move at ${sec(e.at)}`;
    default: return `the ${e.kind} at ${sec(e.at)}`;
  }
}

/**
 * A rule from lib/sfx/cues.ts (a draft's `why`, or a warning from sfxCueOverrides) in plain words. Matches the
 * wording cues.ts writes; anything it doesn't know comes through as written.
 */
function sfxRuleWords(rule: string, events: ReadonlyMap<string, SfxEvent>): string {
  let m: RegExpExecArray | null;
  if ((m = /([\d.]+) s after the click before/.exec(rule))) return `It comes only ${m[1]} s after the click before it. Two clicks that close sound like a stutter, so the second stays quiet.`;
  if ((m = /^an accent on (.+?): accents go on/.exec(rule))) return `${m[1][0].toUpperCase()}${m[1].slice(1)} is too small a moment for a big sound. Those are kept for scene changes, big camera moves and things appearing.`;
  if ((m = /^([\d.]+) s from the accent on (.+): at most one every ([\d.]+) s$/.exec(rule))) {
    return `It's only ${m[1]} s from the big sound on ${sfxEventShortWords(events.get(m[2]), m[2])}. Big sounds are kept at least ${m[3]} s apart, so the video doesn't turn into a pinball machine.`;
  }
  if ((m = /^the scene change beside (.+) has an accent/.exec(rule))) return `The scene change next to it, ${sfxEventShortWords(events.get(m[1]), m[1])}, already has a big sound. A sound on every cut soon wears thin.`;
  if ((m = /^under "(.+)" \(([\d.]+)–([\d.]+) s\)$/.exec(rule))) return `It would land on the spoken word “${m[1]}” (${m[2]}–${m[3]} s), and a loud sound over a word makes the word hard to hear.`;
  if ((m = /^lands (-?[\d.]+) s off its event/.exec(rule))) return `It's nudged ${Math.abs(Number(m[1])).toFixed(2)} s ${Number(m[1]) > 0 ? 'late' : 'early'}, off the moment it marks.`;
  if (/^a whoosh of .* it should last as long$/.test(rule)) return 'The whoosh is a different length from the movement it rides on. It should last as long as the move.';
  if (rule.startsWith('edits do nothing to a placed sound')) return "Edits do nothing to a sound the scene plays itself: change it in the scene's code.";
  return rule;
}

/** Why the draft chose what it did, as a sentence. */
function sfxDraftWords(cue: SfxCue, list: SfxCueList, events: ReadonlyMap<string, SfxEvent>): string {
  const { why } = cue.draft;
  if (why.startsWith('click style')) return `Every click in the video gets the same click sound (the “${list.clickStyle}” style).`;
  if (why === 'typing') return 'Typing always gets key sounds.';
  if (why.startsWith('plays from its <Sfx>')) return "The scene plays this sound itself: someone placed it by hand in the scene's code. The list only counts it, so other sounds keep clear of it.";
  if (why === 'a scene change') return 'A new scene is the best place for a big sound: it marks a turn in the story.';
  if (why === 'a big camera move') return 'A big, fast camera move gets a whoosh as long as the move.';
  if (why === 'a reveal') return 'Something important appearing gets a small accent, with no big sound or spoken word in the way.';
  return sfxRuleWords(why.replace(/^debounced: /, ''), events);
}

// ——— Cue state ———————————————————————————————————————————————————————————————————————————————————————————————————————

type LabCueState = 'sounding' | 'silent' | 'edited' | 'placed';
const isCueEdited = (c: SfxCue) => c.sound !== undefined || c.nudge !== undefined || c.volume !== undefined;
const labCueState = (c: SfxCue): LabCueState => (c.event.kind === 'placed' ? 'placed' : isCueEdited(c) ? 'edited' : c.draft.sound ? 'sounding' : 'silent');
const cueEditsKey = (c: SfxCue) => JSON.stringify({ s: c.sound === undefined ? 'draft' : c.sound, n: c.nudge ?? null, v: c.volume ?? null });
const sameSfxRequest = (a: SfxRequest | null | undefined, b: SfxRequest | null | undefined) => JSON.stringify(a) === JSON.stringify(b);
/** The volume a cue plays at unedited: a marked event's own, else full. */
const cueOwnVolume = (c: SfxCue) => ('volume' in c.event ? c.event.volume : 1);

function groupLabCues<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** What an edit did, in a word or two. */
function labCueEditWords(c: SfxCue): string {
  const parts: string[] = [];
  if (c.sound === null) parts.push('muted');
  else if (c.sound) parts.push(c.draft.sound ? 'swapped' : 'filled');
  if (c.nudge !== undefined) parts.push(`nudged ${c.nudge > 0 ? '+' : ''}${c.nudge.toFixed(2)} s`);
  if (c.volume !== undefined) parts.push(`volume ${c.volume.toFixed(2)}`);
  return parts.join(', ');
}

const SFX_CUE_LANES: readonly { label: string; kinds: readonly SfxEvent['kind'][] }[] = [
  { label: 'Clicks & keys', kinds: ['click', 'key'] },
  { label: 'Scene changes', kinds: ['scene'] },
  { label: 'Camera moves', kinds: ['camera-move'] },
  { label: 'Things appearing', kinds: ['reveal'] },
  { label: "Scenes' own", kinds: ['placed'] },
];

// ——— The editor ——————————————————————————————————————————————————————————————————————————————————————————————————————

export function SfxCueEditor() {
  const [saved, setSaved] = useState<LabSfxCuePayload | null>(null);
  const [list, setList] = useState<SfxCueList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hearList, setHearList] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const momentEnd = useRef<number | null>(null);

  useEffect(() => {
    fetch(sfxCueApiUrl(SFX_CUE_DEMO_PROJECT))
      .then(async (r) => (r.ok ? (r.json() as Promise<LabSfxCuePayload>) : Promise.reject(new Error((await r.json()).error))))
      .then((payload) => {
        setSaved(payload);
        setList(payload.list);
        setSelectedId(payload.list.cues.find((c) => c.event.kind === 'scene' && c.draft.sound)?.event.id ?? null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // Render every sound the list plays up front, a few per frame, so the first play and the first click are instant.
  useEffect(() => {
    if (!list) return;
    const pending = sfxCuePlays(list).filter((p) => !p.inline).map((p) => p.sound);
    let timer = 0;
    const next = () => {
      pending.splice(0, 3).forEach(renderLabCueSound);
      if (pending.length) timer = window.setTimeout(next, 0);
    };
    next();
    return () => clearTimeout(timer);
  }, [list]);

  useLabCueScheduler(videoRef, list, hearList);

  const events = useMemo(() => new Map(list?.cues.map((c) => [c.event.id, c.event]) ?? []), [list]);
  const warnings = useMemo(() => (list && saved ? sfxCueOverrides(list, saved.words) : []), [list, saved]);
  const warningsById = useMemo(() => groupLabCues(warnings, (w) => w.id), [warnings]);
  const unsaved = useMemo(() => {
    if (!list || !saved) return 0;
    const before = new Map(saved.list.cues.map((c) => [c.event.id, cueEditsKey(c)]));
    return list.cues.filter((c) => before.get(c.event.id) !== cueEditsKey(c)).length;
  }, [list, saved]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // A moment played from a marker stops itself; a seek away from it (the video's own controls) lets the video run on.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const check = () => {
      const end = momentEnd.current;
      if (end !== null && !video.paused && video.currentTime >= end) {
        momentEnd.current = null;
        if (video.currentTime < end + 0.5) video.pause();
      }
    };
    const watch = () => {
      check();
      frame = requestAnimationFrame(watch);
    };
    // timeupdate too: a hidden tab gets no animation frames, and the moment would play on.
    video.addEventListener('timeupdate', check);
    watch();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('timeupdate', check);
    };
  }, [saved]);

  if (loadError) return <section className="cue-editor"><p className="cue-error">The cue editor couldn't load {SFX_CUE_DEMO_PROJECT}: {loadError}</p></section>;
  if (!list || !saved) return <section className="cue-editor"><p className="note">Loading the cue list…</p></section>;

  const selected = list.cues.find((c) => c.event.id === selectedId) ?? null;
  const shown = list.cues.find((c) => c.event.id === hoverId) ?? selected;
  const counts = groupLabCues(list.cues, labCueState);

  const editCue = (id: string, edit: (c: SfxCue) => SfxCue) => {
    setList((l) => l && { ...l, cues: l.cues.map((c) => (c.event.id === id ? edit(c) : c)) });
    setSaveState({ kind: 'idle' });
  };
  const seekVideo = (at: number) => {
    const video = videoRef.current!;
    momentEnd.current = null;
    video.currentTime = Math.max(0, Math.min(saved.duration, at));
  };
  const playMoment = (cue: SfxCue) => {
    const video = videoRef.current!;
    void labAudio().resume();
    setSelectedId(cue.event.id);
    const at = cue.event.at + (cue.nudge ?? 0);
    video.currentTime = Math.max(0, at - MOMENT_LEAD);
    momentEnd.current = Math.max(0, at - MOMENT_LEAD) + MOMENT_LENGTH;
    void video.play();
  };

  const save = async () => {
    setSaveState({ kind: 'saving' });
    const sent = list;
    const body: LabSfxCueSave = { revision: saved.revision, list: sent };
    const response = await fetch(sfxCueApiUrl(saved.project), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .catch((error: Error) => ({ ok: false, json: async () => ({ error: `the lab server didn't answer (${error.message}): is studio lab still running?` }) }));
    const reply = await response.json();
    if (!response.ok) return setSaveState({ kind: 'error', text: reply.error });
    setSaved(reply as LabSfxCuePayload);
    // Edits made while the save was in flight stay; only an untouched list takes the saved one.
    setList((current) => (current === sent ? (reply as LabSfxCuePayload).list : current));
    setSaveState({ kind: 'saved', text: `Saved projects/${saved.project}/sfx/cues.json and regenerated generated/sfx-cues.ts` });
  };

  return (
    <section className="cue-editor">
      <header className="cue-head">
        <span className="hud">Cue editor · {saved.project}</span>
        <h3>Every sound effect in a real video, one marker each</h3>
        <p className="note">
          Click a marker to hear that moment: the video jumps to just before it and plays three seconds with the sound. Pick a
          cue to swap its sound, mute it, or give a silent one a sound, then save.
        </p>
      </header>

      <div className="intro-grid cue-explainer">
        <div>
          <span className="hud">What a cue list is</span>
          <p>
            <code>studio sfx draft</code> watches the finished video and lists every moment a sound could go: each click, key
            press, scene change, camera move and thing appearing. Each is a <b>cue</b>, with the sound the studio picked for
            it, or a note on why it left it silent, plus a few other sounds that would fit.
          </p>
        </div>
        <div>
          <span className="hud">Why it drafts with rules</span>
          <p>
            A sound on every moment turns a walkthrough into a pinball machine. So the draft keeps big sounds (whooshes, risers,
            hits) to scene changes, big camera moves and things appearing; at most one every 4 s; never on two cuts in a row;
            and never on top of a spoken word. Clicks all sound, except one right after another. Break a rule here and a
            warning says which.
          </p>
        </div>
        <div className="good">
          <span className="hud">Does re-drafting undo my edits?</span>
          <p>
            <b>No: re-running <code>studio sfx draft</code> keeps your hand edits</b> (sound, nudge, volume), matched by each
            event's id. It rewrites only the draft and the alternatives, and plans the new draft around your edits. It drops an
            edit only if that event is gone, or its numbered series (like the clicks in one scene) gained or lost events so the
            ids shifted, and it prints what it dropped.
          </p>
        </div>
      </div>

      <div className="cue-top">
        <div className="cue-video">
          {saved.video
            ? <video ref={videoRef} src={saved.video} controls preload="auto" playsInline />
            : <p className="cue-error">This project has no rendered video (out/video.mp4) to play the cues over.</p>}
          <label className="cue-toggle">
            <input type="checkbox" checked={hearList} onChange={(e) => setHearList(e.target.checked)} />
            Play the cue list's sounds over the video <small>(off: just voice, music and the scenes' own sounds)</small>
          </label>
        </div>
        {selected
          ? <SfxCueDetail cue={selected} list={list} events={events} warnings={warningsById.get(selected.event.id) ?? []} onEdit={(edit) => editCue(selected.event.id, edit)} onPlayMoment={() => playMoment(selected)}
              onStep={(dir) => {
                const i = list.cues.indexOf(selected), next = list.cues[i + dir];
                if (next) setSelectedId(next.event.id);
              }} />
          : <aside className="cue-detail"><p className="note">Pick a marker on the timeline.</p></aside>}
      </div>

      <div className="cue-bar">
        <div className="cue-legend">
          {(['sounding', 'silent', 'edited', 'placed'] as const).map((s) => (
            <span key={s} className="cue-legend-item"><i className={`cue-swatch ${s}`} />{LAB_CUE_STATE_WORDS[s]} <b>{counts.get(s)?.length ?? 0}</b></span>
          ))}
          <span className="cue-legend-item"><i className="cue-swatch warn" />breaks a rule <b>{warnings.length}</b></span>
        </div>
        <div className="cue-zoom">
          <span className="hud">Zoom</span>
          {[1, 2, 4, 8].map((z) => <button key={z} type="button" className={z === zoom ? 'on' : undefined} onClick={() => setZoom(z)}>{z}×</button>)}
        </div>
        <div className="cue-save">
          <span className={unsaved ? 'cue-unsaved' : 'hud'}>{unsaved ? `${unsaved} unsaved change${unsaved === 1 ? '' : 's'}` : 'No unsaved changes'}</span>
          <button type="button" className="cue-save-button" disabled={!unsaved || saveState.kind === 'saving'} onClick={() => void save()}>
            {saveState.kind === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {(saveState.kind === 'saved' || saveState.kind === 'error') && <p className={saveState.kind === 'saved' ? 'cue-saved' : 'cue-error'}>{saveState.text}</p>}

      <SfxCueTimeline payload={saved} list={list} zoom={zoom} selectedId={selectedId} warningsById={warningsById} videoRef={videoRef}
        onHover={setHoverId} onPick={playMoment} onSeek={seekVideo} />

      <p className="cue-readout">
        {shown
          ? <><b>{sec(shown.event.at)}</b> · {sfxEventWords(shown.event)} · <span className={`cue-state ${labCueState(shown)}`}>{labCueStateLine(shown, list)}</span></>
          : 'Hover a marker to see what it is.'}
      </p>

      {warnings.length > 0 && (
        <div className="cue-warnings">
          <span className="hud">Rules your edits break · what studio check will report</span>
          <ul>
            {warnings.map((w) => (
              <li key={`${w.id}|${w.problem}`}>
                <button type="button" onClick={() => setSelectedId(w.id)}><b>{sec(w.at)}</b> {sfxEventShortWords(events.get(w.id), w.id)}</button>
                <span>{sfxRuleWords(w.problem, events)}</span>
              </li>
            ))}
          </ul>
          <p className="note">A warning doesn't stop anything: the video plays your edit. It's there so breaking a rule is a choice, not an accident.</p>
        </div>
      )}
    </section>
  );
}

const LAB_CUE_STATE_WORDS: Record<LabCueState, string> = { sounding: 'sounds (draft)', silent: 'silent (draft)', edited: 'edited by hand', placed: "the scene's own sound" };

function labCueStateLine(cue: SfxCue, list: SfxCueList): string {
  const now = sfxCueSound(cue, list.clickStyle);
  switch (labCueState(cue)) {
    case 'placed': return `plays ${cue.event.kind === 'placed' ? cue.event.request.sound : ''} from the scene itself`;
    case 'edited': return `edited (${labCueEditWords(cue)})${now ? `: plays ${now.sound}` : ': silent'}`;
    case 'sounding': return `plays ${now!.sound}`;
    case 'silent': return `silent: ${sfxDraftWords(cue, list, new Map(list.cues.map((c) => [c.event.id, c.event])))}`;
  }
}

function SfxCueTimeline({ payload, list, zoom, selectedId, warningsById, videoRef, onHover, onPick, onSeek }: {
  payload: LabSfxCuePayload; list: SfxCueList; zoom: number; selectedId: string | null; warningsById: ReadonlyMap<string, SfxCueProblem[]>;
  videoRef: RefObject<HTMLVideoElement | null>; onHover: (id: string | null) => void; onPick: (cue: SfxCue) => void; onSeek: (at: number) => void;
}) {
  const { duration } = payload;
  const x = (t: number) => `${(t / duration) * 100}%`;
  const seekFromClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - box.left) / box.width) * duration);
  };
  const ticks = Array.from({ length: Math.floor(duration / 10) + 1 }, (_, i) => i * 10);
  return (
    <div className="cue-timeline">
      <div className="cue-lane-labels">
        <span>Time</span><span>Scenes</span><span>Voice</span>
        {SFX_CUE_LANES.map((lane) => <span key={lane.label}>{lane.label}</span>)}
      </div>
      <div className="cue-scroll">
        <div className="cue-rows" style={{ width: `${zoom * 100}%` }}>
          <div className="cue-row cue-ruler" onClick={seekFromClick}>
            {ticks.map((t) => <span key={t} style={{ left: x(t) }}>{t}s</span>)}
          </div>
          <div className="cue-row cue-scenes" onClick={seekFromClick}>
            {payload.scenes.map((s, i) => (
              <span key={s.id} className={i % 2 ? 'odd' : undefined} style={{ left: x(s.start), width: x(s.end - s.start) }} title={`${s.id}: ${sec(s.start)}–${sec(s.end)}`}
                onClick={() => onSeek(s.start)}>{s.id}</span>
            ))}
          </div>
          <div className="cue-row cue-words" onClick={seekFromClick}>
            {payload.words.map((w, i) => <i key={i} style={{ left: x(w.start), width: x(w.end - w.start) }} title={`“${w.text}” ${sec(w.start)}`} />)}
          </div>
          {SFX_CUE_LANES.map((lane) => (
            <div key={lane.label} className="cue-row cue-lane" onClick={seekFromClick}>
              {list.cues.filter((c) => lane.kinds.includes(c.event.kind)).map((c) => {
                const state = labCueState(c), warned = warningsById.has(c.event.id);
                return (
                  <button key={c.event.id} type="button" style={{ left: x(c.event.at + (c.nudge ?? 0)) }}
                    className={`cue-marker ${state}${c.event.id === selectedId ? ' selected' : ''}${warned ? ' warn' : ''}`}
                    aria-label={`${sfxEventWords(c.event)}: ${LAB_CUE_STATE_WORDS[state]}`}
                    onMouseEnter={() => onHover(c.event.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(c.event.id)} onBlur={() => onHover(null)}
                    onClick={() => onPick(c)} />
                );
              })}
            </div>
          ))}
          <SfxCuePlayhead videoRef={videoRef} duration={duration} />
        </div>
      </div>
    </div>
  );
}

/** The playhead, moved straight on the DOM every frame so the timeline itself doesn't re-render 60 times a second. */
function SfxCuePlayhead({ videoRef, duration }: { videoRef: RefObject<HTMLVideoElement | null>; duration: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const move = () => {
      const video = videoRef.current;
      if (video && ref.current) ref.current.style.left = `${(video.currentTime / duration) * 100}%`;
      frame = requestAnimationFrame(move);
    };
    move();
    return () => cancelAnimationFrame(frame);
  }, [videoRef, duration]);
  return <div ref={ref} className="cue-playhead" />;
}

function SfxCueDetail({ cue, list, events, warnings, onEdit, onPlayMoment, onStep }: {
  cue: SfxCue; list: SfxCueList; events: ReadonlyMap<string, SfxEvent>; warnings: readonly SfxCueProblem[];
  onEdit: (edit: (c: SfxCue) => SfxCue) => void; onPlayMoment: () => void; onStep: (dir: -1 | 1) => void;
}) {
  const { event } = cue, state = labCueState(cue), now = sfxCueSound(cue, list.clickStyle), own = cueOwnVolume(cue);
  const volume = cue.volume ?? own;
  const options = [...(cue.draft.sound ? [cue.draft.sound] : []), ...cue.alternatives];
  const choose = (sound: SfxRequest) => onEdit(({ sound: _, ...c }) => (sameSfxRequest(sound, cue.draft.sound) ? c : { ...c, sound }));
  const mute = () => onEdit(({ sound: _, ...c }) => (cue.draft.sound ? { ...c, sound: null } : c));
  const reset = () => onEdit(({ sound: _s, nudge: _n, volume: _v, ...c }) => c);
  const setNudge = (nudge: number) => onEdit(({ nudge: _, ...c }) => (Math.abs(nudge) < 0.005 ? c : { ...c, nudge }));
  const setVolume = (v: number) => onEdit(({ volume: _, ...c }) => (Math.abs(v - own) < 0.005 ? c : { ...c, volume: v }));

  return (
    <aside className="cue-detail">
      <div className="cue-detail-head">
        <span className="hud">{event.kind === 'camera-move' ? 'camera move' : event.kind} · {sec(event.at)}</span>
        <span className="cue-step">
          <button type="button" onClick={() => onStep(-1)} aria-label="Previous cue">‹</button>
          <button type="button" onClick={() => onStep(1)} aria-label="Next cue">›</button>
        </span>
      </div>
      <h4>{sfxEventWords(event)[0].toUpperCase() + sfxEventWords(event).slice(1)}</h4>
      <button type="button" className="cue-moment" onClick={onPlayMoment}>▶ Play this moment</button>

      <div className="cue-draft">
        <span className="hud">The studio's draft</span>
        <p>
          <b>{cue.draft.sound ? `Sounds: ${sfxSoundWords(cue.draft.sound)}.` : event.kind === 'placed' ? 'Plays from the scene.' : 'Left silent.'}</b>{' '}
          {sfxDraftWords(cue, list, events)}
        </p>
        <code>{cue.draft.why}</code>
      </div>

      {warnings.map((w) => (
        <p key={w.problem} className="cue-warning"><b>Breaks a rule:</b> {sfxRuleWords(w.problem, events)}</p>
      ))}

      {state === 'placed' ? (
        <p className="note">
          This sound isn't the list's to change: the {event.scene} scene plays it with its own <code>&lt;Sfx&gt;</code>. It's
          listed so the list's big sounds keep clear of it.
          {now && <> <button type="button" className="cue-link" onClick={() => previewLabCueSound(now)}>▶ hear it</button></>}
        </p>
      ) : (
        <>
          <div className="cue-now">
            <span className="hud">Plays now</span>
            <p>
              {now ? <><b>{now.sound}</b>, {sfxSoundWords(now)}</> : <b>Nothing: silent</b>}
              {isCueEdited(cue) && <span className="cue-edit-tag">{labCueEditWords(cue)}</span>}
            </p>
          </div>
          <ul className="cue-options">
            {options.map((o) => {
              const on = sameSfxRequest(o, now);
              return (
                <li key={JSON.stringify(o)} className={on ? 'on' : undefined}>
                  <button type="button" className="cue-hear" onClick={() => previewLabCueSound(o, volume)} aria-label={`Hear ${o.sound}`}>▶</button>
                  <span><b>{o.sound}</b>{o === cue.draft.sound && <em> draft</em>}<small>{sfxSoundWords(o)}</small></span>
                  <button type="button" disabled={on} onClick={() => choose(o)}>{on ? 'Playing' : now ? 'Swap to this' : 'Fill with this'}</button>
                </li>
              );
            })}
          </ul>
          <div className="cue-actions">
            <button type="button" disabled={!now} onClick={mute}>Mute</button>
            <button type="button" disabled={!isCueEdited(cue)} onClick={reset}>Reset to the draft</button>
          </div>
          <div className="cue-sliders">
            <LabSlider label="Nudge" value={cue.nudge ?? 0} min={-0.5} max={0.5} step={0.01} onChange={setNudge}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} s`} hint="Move the sound earlier or later than its moment." />
            <LabSlider label="Volume" value={volume} min={0} max={2} step={0.05} onChange={setVolume}
              format={(v) => `${Math.round(v * 100)}%`} hint="100% is the level the studio mixes effects at under the voice." />
          </div>
        </>
      )}
    </aside>
  );
}
