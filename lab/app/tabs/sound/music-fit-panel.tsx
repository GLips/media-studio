// music-fit-panel.tsx: the music half of the Sound tab. It decodes a project's track in the browser and runs
// lib/music-fit.ts on it, as `studio music fit` does (mono at 22.05 kHz to plan, the source's own channels to splice),
// then plays the fit and draws where each stretch of it came from.
import { useEffect, useRef, useState } from 'react';
import { planMusicFit, spliceMusicSpans, type MusicFitPlan } from '../../../../lib/music-fit.ts';
import type { LabMusicTrack } from '../../../server.ts';
import { LabBench, LabChoice, LabNote, LabSlider } from '../../ui.tsx';
import { audioBufferFromChannels, labAudio, playLabBuffer, stopLabAudio, useLabPlayhead } from './lab-audio.ts';
import { MUSIC_SPAN_COLORS, MusicFitTimeline } from './music-fit-timeline.tsx';
import { SoundForAgents } from './sound-words.tsx';

// lib/music-track.ts plans on mono at this rate; matching it gives the same spans the CLI would.
const MUSIC_FIT_ANALYSIS_RATE = 22050;
const MUSIC_FIT_DEFAULT_SECONDS = 23.4;
/** Seconds of lead-in before a seam when you jump to hear it. */
const SEAM_LEAD_IN = 3;

type DecodedMusic = { buffer: AudioBuffer; mono: Float32Array };
type MusicFitResult = { plan: MusicFitPlan; fitted: AudioBuffer; seconds: number; planMs: number } | { error: string; seconds: number };

const decodedMusic = new Map<string, Promise<DecodedMusic>>();

/** The track as the browser decodes it, and a mono mixdown resampled for planning. Cached per track. */
function decodeMusicTrack(track: LabMusicTrack): Promise<DecodedMusic> {
  let decoding = decodedMusic.get(track.id);
  if (!decoding) {
    decoding = (async () => {
      const buffer = await labAudio().decodeAudioData(await (await fetch(track.url)).arrayBuffer());
      const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * MUSIC_FIT_ANALYSIS_RATE), MUSIC_FIT_ANALYSIS_RATE);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      return { buffer, mono: (await offline.startRendering()).getChannelData(0) };
    })();
    decodedMusic.set(track.id, decoding);
    // A failed fetch or decode isn't kept, so choosing the track again retries it.
    decoding.catch(() => decodedMusic.delete(track.id));
  }
  return decoding;
}

function fitDecodedMusic({ buffer, mono }: DecodedMusic, beats: readonly number[], seconds: number): MusicFitResult {
  const started = performance.now();
  try {
    const plan = planMusicFit({ samples: mono, rate: MUSIC_FIT_ANALYSIS_RATE, beats, targetSeconds: seconds });
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const fitted = audioBufferFromChannels(spliceMusicSpans(channels, buffer.sampleRate, plan.spans, seconds), buffer.sampleRate);
    return { plan, fitted, seconds, planMs: performance.now() - started };
  } catch (error) {
    // The failures worth showing are planMusicFit's own about the track (a length it can't reach on its bar lines, too
    // few beats); anything else is a bug and should surface as one.
    const message = (error as Error).message;
    if (!/can't fit|fitting needs|is silent/.test(message)) throw error;
    return { error: message, seconds };
  }
}

/** A track's name and length, and its project too when another project has a track of the same name. */
const musicTrackLabel = (t: LabMusicTrack, all: readonly LabMusicTrack[]) =>
  `${t.name}${all.filter((o) => o.name === t.name).length > 1 ? ` (${t.project.replace(/^\d{4}-\d{2}-/, '')})` : ''} · ${t.duration.toFixed(0)} s`;

const bars = (seconds: number, bpm: number) => Math.round((seconds * bpm) / 60 / 4);

export function MusicFitPanel() {
  const [tracks, setTracks] = useState<LabMusicTrack[]>();
  const [trackId, setTrackId] = useState<string>();
  const [draftSeconds, setDraftSeconds] = useState(MUSIC_FIT_DEFAULT_SECONDS);
  const [seconds, setSeconds] = useState(MUSIC_FIT_DEFAULT_SECONDS);
  const [decoded, setDecoded] = useState<DecodedMusic>();
  const [result, setResult] = useState<MusicFitResult>();
  const busy = !decoded || result?.seconds !== seconds;

  useEffect(() => {
    void fetch('/api/music').then((r) => r.json()).then((all: LabMusicTrack[]) => {
      setTracks(all);
      const sources = all.filter((t) => !t.fit);
      // The showcase's 30 s track, when it's there: the length the intro's example talks about.
      setTrackId((sources.find((t) => t.name === 'pulse') ?? sources[0])?.id);
    });
  }, []);
  const track = tracks?.find((t) => t.id === trackId);

  useEffect(() => {
    if (!track) return;
    setDecoded(undefined);
    let live = true;
    void decodeMusicTrack(track).then((d) => live && setDecoded(d));
    return () => { live = false; };
  }, [track]);

  useEffect(() => {
    if (!track || !decoded) return;
    // A frame's pause first, so the busy state paints before planning holds the page.
    const timer = setTimeout(() => setResult(fitDecodedMusic(decoded, track.beats, seconds)), 30);
    return () => clearTimeout(timer);
  }, [track, decoded, seconds]);

  // The slider plans once you let go (or pause), not on every pixel of a drag.
  const commit = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onDraft = (v: number) => {
    setDraftSeconds(v);
    clearTimeout(commit.current);
    commit.current = setTimeout(() => setSeconds(v), 350);
  };

  const originalPlayhead = useLabPlayhead('music-original');
  const fadePlayhead = useLabPlayhead('music-fade');
  const fittedPlayhead = useLabPlayhead('music-fitted');
  const fit = result && 'plan' in result ? result : undefined;

  if (!tracks) return <p className="note">Loading the studio's music…</p>;
  const sources = tracks.filter((t) => !t.fit);
  if (!track) return <LabNote>No music in any project yet. <code>studio music add</code> puts a track in a project.</LabNote>;
  const madeEarlier = tracks.filter((t) => t.fit && t.project === track.project && t.fit.source === track.name);
  const playOriginal = (offset = 0) => decoded && playLabBuffer('music-original', decoded.buffer, { offset });
  const playFit = (offset = 0) => fit && playLabBuffer('music-fitted', fit.fitted, { offset: Math.max(0, offset) });

  const stage = (
    <div className="fit-bench-stage">
      <div className={`fit-stage${busy ? ' busy' : ''}`}>
        {fit ? (
          <MusicFitTimeline plan={fit.plan} sourceSeconds={track.duration} sourceBeats={track.beats} targetSeconds={fit.seconds}
            originalPlayhead={originalPlayhead ?? fadePlayhead} fittedPlayhead={fittedPlayhead}
            onSeekOriginal={playOriginal} onSeekFitted={playFit} />
        ) : (
          <p className="fit-message">{result && 'error' in result ? result.error : decoded ? 'Finding the seams…' : 'Decoding the song…'}</p>
        )}
        {busy && fit && <span className="fit-busy hud">Finding the seams…</span>}
      </div>
      {fit && (
        <>
          <div className="fit-actions">
            <button type="button" className="sound-button primary" onClick={() => playFit()}>▶ Play the fit</button>
            <button type="button" className="sound-button" onClick={() => playFit(fit.seconds - 8)}>▶ Its last 8 s</button>
            <button type="button" className="sound-button" onClick={() => playOriginal()}>▶ The song as written</button>
            {fit.seconds < track.duration && decoded && (
              <button type="button" className="sound-button bad" onClick={() => playLabBuffer('music-fade', decoded.buffer, { offset: Math.max(0, fit.seconds - 8), fadeOutAt: fit.seconds })}>
                ▶ The lazy way: fade out at {fit.seconds.toFixed(1)} s
              </button>
            )}
            <button type="button" className="sound-button" onClick={stopLabAudio}>■ Stop</button>
          </div>
          <LabNote>
            Click either row to play from that point. Colours match: each coloured stretch of the fit is the same colour
            in the song above. White lines are the seams, tall ticks the first beat of each bar.{fit.plan.spans[0].from < 0 && ' The striped stretch at the start is silence: the music comes in a moment after the picture, rather than cut into its first bar.'} Try
            to hear the seams: if you can't, the fit worked. Planned in {Math.round(fit.planMs)} ms, right here in the
            browser, with the same code a render uses.
          </LabNote>
        </>
      )}
    </div>
  );

  return (
    <section className="sound-part">
      <header className="sound-part-head">
        <span className="hud">02 — Music fit</span>
        <h3>Making a song exactly as long as the video</h3>
      </header>
      <LabNote>
        Say the video is <b>23.4 seconds</b> and the song is <b>30</b>. The easy fix is to fade the song out at 23.4 s, but
        then it dies mid-phrase and the video ends on a shrug. Instead the studio finds two moments in the song, a few bars
        apart, that sound almost the same, and <b>jumps from one to the other</b>, cutting out the bars between (or, for a
        longer video, going back and playing some twice). Jumps land only on the first beat of a bar, so the rhythm never
        stumbles, and the song still ends on <b>its real ending</b>.
      </LabNote>

      <LabBench stage={stage}>
        <div className="controls">
          <LabChoice label="Song" value={track.id} options={sources.map((t) => ({ value: t.id, label: musicTrackLabel(t, sources) }))}
            onChange={(id) => { stopLabAudio(); setTrackId(id); setResult(undefined); }}
            hint={`From ${track.project}. ${Math.round(track.bpm)} beats a minute, so a bar of four beats is ${(240 / track.bpm).toFixed(2)} s.`} />
          <LabSlider label="Video length" value={draftSeconds} min={Math.max(5, Math.round(track.duration * 0.35))} max={Math.round(track.duration * 2.2)} step={0.1}
            onChange={onDraft} format={(v) => `${v.toFixed(1)} s`}
            hint={`The song is ${track.duration.toFixed(1)} s. Shorter cuts bars out; longer repeats some.`} />
        </div>
        {fit && fit.plan.seams.length > 0 && <MusicSeamRoughness db={fit.plan.worstSeamDb} />}
        {fit && (
          <div className="fit-seams">
            {fit.plan.seams.length === 0 && <p className="note">No seams needed: the song fits by trimming its quiet start, or waiting a moment before it comes in.</p>}
            {fit.plan.seams.map((t, i) => {
              const from = fit.plan.spans[i].to, to = fit.plan.spans[i + 1].from, jump = to - from;
              return (
                <button key={t} type="button" className="fit-seam" onClick={() => playFit(t - SEAM_LEAD_IN)}
                  style={{ borderLeftColor: MUSIC_SPAN_COLORS[(i + 1) % MUSIC_SPAN_COLORS.length] }}>
                  <b>▶ Seam {i + 1} · {t.toFixed(1)} s</b>
                  <span>jumps from {from.toFixed(1)} s to {to.toFixed(1)} s in the song: {jump > 0 ? `skips ${bars(jump, track.bpm)}` : `repeats ${bars(-jump, track.bpm)}`} bars</span>
                  <small>plays from {SEAM_LEAD_IN} s before it</small>
                </button>
              );
            })}
          </div>
        )}
        {fit && (
          <SoundForAgents>
            <p>
              <code>studio music fit</code> runs this same plan (lib/music-fit.ts) and writes the fitted track into the project.
              Roughest seam: <code>worstSeamDb</code> {fit.plan.worstSeamDb.toFixed(2)}, the average difference per frequency band
              between the bars either side of it. Beat 1 of the bar was guessed as source beat {fit.plan.downbeatPhase}.
            </p>
          </SoundForAgents>
        )}
      </LabBench>

      {madeEarlier.length > 0 && (
        <div className="fit-earlier">
          <span className="hud">Fits made earlier for a real video</span>
          {madeEarlier.map((t) => (
            <button key={t.id} type="button" className="sound-button"
              onClick={() => void decodeMusicTrack(t).then((d) => playLabBuffer('music-earlier', d.buffer))}>
              ▶ {t.name} · {t.duration.toFixed(1)} s · {t.fit!.seams.length} seam{t.fit!.seams.length === 1 ? '' : 's'}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Worst-seam differences, in dB per band, past which the meter is full, and the rough end of the usual range. */
const SEAM_ROUGH_FULL = 8, SEAM_ROUGH_USUAL = 5;

/** The roughest seam as a meter from smooth to rough, with the top of the usual range marked. */
function MusicSeamRoughness({ db }: { db: number }) {
  const at = Math.min(1, db / SEAM_ROUGH_FULL), usual = SEAM_ROUGH_USUAL / SEAM_ROUGH_FULL;
  const verdict = db <= 2 ? 'Very smooth: hard to hear at all.' : db <= SEAM_ROUGH_USUAL ? 'Normal: where most fits land.' : 'Rougher than usual: have a listen to it.';
  return (
    <div className="fit-rough">
      <span className="hud">How well the roughest seam matches</span>
      <div className="fit-rough-bar">
        <i className={db > SEAM_ROUGH_USUAL ? 'over' : undefined} style={{ width: `${at * 100}%` }} />
        <b style={{ left: `${usual * 100}%` }} title="the rough end of the usual range" />
      </div>
      <div className="fit-rough-scale"><span>smooth</span><span style={{ left: `${usual * 100}%` }}>usual limit</span><span>rough</span></div>
      <small>{verdict} It compares how the bars either side of the jump sound, pitch by pitch.</small>
    </div>
  );
}
