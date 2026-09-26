// main.tsx: the `studio review` page. Graham plays a render, pins notes on its frames (a click for a moment and a
// point, a drag along the scrubber for a range, a sound's marker for that sound), and copies them as markdown for a
// chat. Every change saves to the project's review/notes-<render>.json. A still takes the same pins, without time.
// The header names the render on screen by its hash and offers the others; a banner says when it's replaced on disk.
// A note written on an earlier render arrives already moved to its moment here (the server places it), and says so.
import '../../app/lab.css';
import './review.css';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { formatReviewMomentPlace } from '#models/review/review-moment.ts';
import { formatReviewMoment, formatReviewNotesMarkdown, formatStillAxes, reviewFrameAt, reviewNoteContext, reviewNoteRenderOf, type ReviewContextSources, type ReviewNote } from '#models/review/review-notes.ts';
import type { ReviewManifest, ReviewRenderStatus } from '../server.ts';

/** How often the page asks whether its render is still the one on disk. */
const REVIEW_RENDER_POLL_MS = 2000;

/** The render the page is on, from `?media=`; the server's own target when absent. */
const reviewMediaParam = () => new URLSearchParams(location.search).get('media');
const withMedia = (path: string, media = reviewMediaParam()) => (media ? `${path}?${new URLSearchParams({ media })}` : path);
/** `Sep 25 08:55:12`, local time: enough to tell two renders of a day apart. */
const renderTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

type Draft = Omit<ReviewNote, 'id' | 'context'>;

function ReviewPage() {
  const [manifest, setManifest] = useState<ReviewManifest | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(withMedia('/review.json')).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t))))).then(setManifest, (e: Error) => setError(e.message));
  }, []);
  if (error) return <main className="review"><p className="review-banner">{error}</p></main>;
  if (!manifest) return <main className="review"><p className="hud">loading…</p></main>;
  return <Review manifest={manifest} />;
}

function Review({ manifest }: { manifest: ReviewManifest }) {
  const isVideo = manifest.media.kind === 'video';
  const fps = manifest.fps ?? 30;
  const video = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [fileFrames, setFileFrames] = useState<number | null>(null);
  const total = manifest.durationInFrames ?? fileFrames ?? 1;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notes, setNotes] = useState<ReviewNote[]>(manifest.notes);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [saveState, setSaveState] = useState(`notes in ${manifest.notesPath}`);
  const [copied, setCopied] = useState('');
  const [disk, setDisk] = useState<ReviewRenderStatus | { error: string }>(manifest);

  useEffect(() => {
    const check = () => fetch(withMedia('/api/render'))
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then(setDisk, (e: Error) => setDisk({ error: e.message }));
    const timer = setInterval(check, REVIEW_RENDER_POLL_MS);
    window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  const replaced = 'error' in disk ? null : disk.render.hash !== manifest.render.hash ? disk.render : null;
  const renders = 'error' in disk ? manifest.renders : disk.renders;
  const newer = renders[0] && renders[0].path !== manifest.media.path && renders[0].modified > manifest.render.modified ? renders[0] : null;

  const sources: ReviewContextSources = useMemo(() => ({
    fps, frameSize: manifest.frameSize, scenes: manifest.scenes, sounds: manifest.sounds, motion: manifest.motion, cells: manifest.cells, timing: manifest.timing,
  }), [manifest, fps]);
  const sorted = useMemo(() => [...notes].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0)), [notes]);

  // Seek to a frame's middle, so the decoder can't land on its neighbour.
  const seek = useCallback((f: number) => {
    const clamped = Math.max(0, Math.min(total - 1, Math.round(f)));
    if (video.current) video.current.currentTime = (clamped + 0.5) / fps;
    setFrame(clamped);
  }, [fps, total]);
  const pause = () => video.current?.pause();

  // The frame on screen, from each presented frame's own timestamp while playing.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0;
    const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
      setFrame(reviewFrameAt(meta.mediaTime, fps));
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    const sync = () => { setPlaying(!v.paused); if (v.paused) setFrame(reviewFrameAt(v.currentTime, fps)); };
    const events = ['play', 'pause', 'seeked'] as const;
    events.forEach((e) => v.addEventListener(e, sync));
    return () => { v.cancelVideoFrameCallback(handle); events.forEach((e) => v.removeEventListener(e, sync)); };
  }, [fps]);

  // Every change saves; the first render is the file as loaded. Saves go one after another, so an older one can't
  // land after a newer one and put back what was just deleted.
  const loaded = useRef(true);
  const saving = useRef(Promise.resolve());
  useEffect(() => {
    if (loaded.current) return void (loaded.current = false);
    setSaveState('saving…');
    const body = JSON.stringify({ notes, fps: isVideo ? fps : undefined });
    saving.current = saving.current.then(() => fetch(withMedia('/api/notes'), { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then((r) => r.json())
      .then((r: { savedTo?: string; error?: string }) => setSaveState(r.error ? `not saved: ${r.error}` : `saved to ${r.savedTo}`))
      .catch((e: Error) => setSaveState(`not saved: ${e.message}`)));
  }, [notes, fps, isVideo]);

  const commitDraft = () => {
    if (!draft || !draft.text.trim()) return;
    // Stamped with the render the page loaded, even once it's replaced: that's the one the note is about.
    setNotes((all) => [...all, { ...draft, text: draft.text.trim(), id: crypto.randomUUID(), render: manifest.render.hash, context: reviewNoteContext(draft, sources) }]);
    setDraft(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const v = video.current;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === ' ' && v) { e.preventDefault(); if (v.paused) void v.play(); else v.pause(); }
      else if ((e.key === ',' || e.key === '<' || e.key === 'ArrowLeft') && v) { e.preventDefault(); v.pause(); seek(frame - step); }
      else if ((e.key === '.' || e.key === '>' || e.key === 'ArrowRight') && v) { e.preventDefault(); v.pause(); seek(frame + step); }
      else if (e.key === 'Escape') setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frame, seek]);

  // A click on the frame pins a point: onto the note being written, or a new note at this frame.
  const onStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    pause();
    // A moment note follows the playhead; a range or a sound's note keeps its time.
    setDraft((d) => (d ? { ...d, x, y, ...(isVideo && d.end === undefined && !d.cue && { frame }) } : { ...(isVideo && { frame }), x, y, text: '' }));
  };
  const aimAtSound = (id: string, at: number) => {
    pause();
    seek(at);
    // A moment note moves to the sound it's aimed at; a range keeps its span.
    setDraft((d) => (d ? { ...d, cue: id, ...(d.end === undefined && { frame: at }) } : { frame: at, cue: id, text: '' }));
  };

  const markdown = () => formatReviewNotesMarkdown({ media: manifest.media.path, kind: manifest.media.kind, fps, notes }, { title: manifest.title, savedTo: manifest.notesPath, render: manifest.render });
  const copy = () => navigator.clipboard.writeText(markdown()).then(() => setCopied(`copied ${notes.length} note${notes.length === 1 ? '' : 's'}`), (e: Error) => setCopied(`copy failed: ${e.message}`));

  const pinsNow = sorted.map((n, i) => ({ n, i })).filter(({ n }) => n.x !== undefined && (!isVideo || (n.frame! <= frame && frame <= (n.end ?? n.frame!))));

  return (
    <main className="review">
      <header className="review-header">
        <div>
          <span className="hud">studio review · {manifest.media.path}</span>
          <h1>{manifest.title}</h1>
          <div className="review-render">
            <span className="hud">render <b>{manifest.render.hash}</b> · modified {renderTime(manifest.render.modified)}</span>
            {renders.length > 1 && (
              <select value={manifest.media.path} onChange={(e) => { location.search = new URLSearchParams({ media: e.target.value }).toString(); }}>
                {renders.map((r, i) => <option key={r.path} value={r.path}>{r.name} · {renderTime(r.modified)}{i === 0 ? ' · newest' : ''}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="review-actions">
          <span className="hud">{copied || saveState}</span>
          <button className="review-primary" onClick={copy} disabled={!notes.length}>Copy notes</button>
        </div>
      </header>
      {replaced && (
        <p className="review-banner review-replaced">
          <span><b>{manifest.media.path} was replaced on disk</b> (render {replaced.hash}, {renderTime(replaced.modified)}). You're reviewing render {manifest.render.hash} from {renderTime(manifest.render.modified)}, and new notes are stamped with it.</span>
          <button className="review-primary" onClick={() => location.reload()}>Load the new render</button>
        </p>
      )}
      {'error' in disk && <p className="review-banner review-replaced">Can't read {manifest.media.path} on disk: {disk.error}</p>}
      {newer && !replaced && (
        <p className="review-banner">
          <span>A newer render is on disk: {newer.name}, {renderTime(newer.modified)}.</span>{' '}
          <button onClick={() => { location.search = new URLSearchParams({ media: newer.path }).toString(); }}>Open it</button>
        </p>
      )}
      {manifest.missing.map((m) => <p key={m} className="review-banner">No {m}</p>)}
      {manifest.cueListPlayed === false && <p className="review-banner">This render doesn't play sfx/cues.json: its cue-list markers show where the list would sound.</p>}
      {manifest.startsAt ? <p className="review-banner">A slice: its frame 0 is the video's frame {manifest.startsAt}, and frames here count from it.</p> : null}
      {isVideo && !manifest.fps && <p className="review-banner">Not a project render: frames are counted at 30 fps.</p>}

      <div className="review-body">
        <section className="review-left">
          <div className="review-stage" style={{ aspectRatio: aspect, width: `min(100%, calc(72vh * ${aspect}))` }} onClick={onStageClick}>
            {isVideo ? (
              <video ref={video} src={manifest.media.url} preload="auto" playsInline
                onLoadedMetadata={(e) => { const v = e.currentTarget; setAspect(v.videoWidth / v.videoHeight); setFileFrames(Math.round(v.duration * fps)); }} />
            ) : (
              <img src={manifest.media.url} alt="" onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
            )}
            {pinsNow.map(({ n, i }) => <span key={n.id} className="review-pin" style={{ left: `${n.x! * 100}%`, top: `${n.y! * 100}%` }}>{i + 1}</span>)}
            {draft?.x !== undefined && <span className="review-pin draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y! * 100}%` }}>+</span>}
          </div>
          {isVideo && (
            <>
              <div className="review-transport">
                <button onClick={() => { const v = video.current!; if (v.paused) void v.play(); else v.pause(); }}>{playing ? 'Pause' : 'Play'}</button>
                <button onClick={() => { pause(); seek(frame - 1); }} title="Back a frame (,)">‹</button>
                <button onClick={() => { pause(); seek(frame + 1); }} title="Forward a frame (.)">›</button>
                <span className="review-now">{formatReviewMoment(frame, fps)} <span className="hud">of {total} · {fps} fps</span></span>
                <span className="hud review-keys">space play · , . a frame (shift: 10) · click the frame to pin · drag the scrubber for a range · click a sound to aim at it</span>
              </div>
              <Scrubber manifest={manifest} fps={fps} total={total} frame={frame} notes={sorted} draft={draft}
                onSeek={(f) => { pause(); seek(f); }} onRange={(first, last) => { pause(); setDraft((d) => ({ ...d, text: d?.text ?? '', frame: first, end: last })); }}
                onSound={aimAtSound} />
            </>
          )}
        </section>

        <aside className="review-side">
          {draft ? (
            <Composer draft={draft} fps={fps} context={reviewNoteContext(draft, sources)} onChange={setDraft} onSave={commitDraft} onCancel={() => setDraft(null)} />
          ) : (
            <p className="review-hint">{isVideo ? 'Pause where something feels off and click the frame there.' : 'Click the image where something feels off.'}</p>
          )}
          <ol className="review-notes">
            {sorted.map((n, i) => {
              const active = isVideo && n.frame! <= frame && frame <= (n.end ?? n.frame!);
              const on = reviewNoteRenderOf(n, manifest.render);
              return (
                <li key={n.id} className={active ? 'on' : ''} onClick={() => { if (n.frame !== undefined) { pause(); seek(n.frame); } }}>
                  <div className="review-note-head">
                    <span className="review-num">{i + 1}</span>
                    <span className="hud">{noteWhen(n, fps)}</span>
                    {on !== 'this' && <span className="review-other-render" title={n.unplaced ? `Its moment isn't in this render: ${n.unplaced}` : 'This note may not be about the render on screen'}>{on === 'other' ? `render ${n.render}${n.unplaced ? ', moment gone' : ''}` : 'render unknown'}</span>}
                    {n.movedFrom && <span className="review-moved" title={`Written on render ${n.movedFrom.render} at f${n.movedFrom.frame}, and moved to its moment here`}>moved from f{n.movedFrom.frame}</span>}
                    <span className="review-note-tools">
                      <button onClick={(e) => { e.stopPropagation(); setEditing({ id: n.id, text: n.text }); }}>Edit</button>
                      <button onClick={(e) => { e.stopPropagation(); setNotes((all) => all.filter((m) => m.id !== n.id)); }}>Delete</button>
                    </span>
                  </div>
                  {editing?.id === n.id ? (
                    <textarea autoFocus value={editing.text} onClick={(e) => e.stopPropagation()} onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                        if (e.key === 'Enter' && !e.shiftKey && editing.text.trim()) { e.preventDefault(); setNotes((all) => all.map((m) => (m.id === n.id ? { ...m, text: editing.text.trim() } : m))); setEditing(null); }
                      }} />
                  ) : <p>{n.text}</p>}
                  <ContextLines context={n.context} />
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </main>
  );
}

function noteWhen(n: Pick<ReviewNote, 'frame' | 'end' | 'x' | 'y'>, fps: number) {
  const when = n.frame === undefined ? '' : n.end !== undefined && n.end !== n.frame ? `${formatReviewMoment(n.frame, fps)} – ${formatReviewMoment(n.end, fps)}` : formatReviewMoment(n.frame, fps);
  const where = n.x !== undefined ? `(${n.x.toFixed(2)}, ${n.y!.toFixed(2)})` : '';
  return [when, where].filter(Boolean).join(' · ') || 'no point yet';
}

function ContextLines({ context }: { context: ReviewNote['context'] }) {
  const { cell, scenes, sounds, elements, moment } = context;
  return (
    <dl className="review-context">
      {moment && <><dt>moment</dt><dd>{formatReviewMomentPlace(moment)}</dd></>}
      {cell && <><dt>variant</dt><dd>{cell.variant} ({formatStillAxes(cell.axes)}){cell.refused ? ' · refused' : ''}</dd></>}
      {!!scenes?.length && <><dt>scene</dt><dd>{scenes.join(' → ')}</dd></>}
      {!!sounds?.length && <><dt>sound</dt><dd>{sounds.map((s) => `${s.sound} ${s.id} f${s.frame}${s.targeted ? ' ◀' : ''}`).join(' · ')}</dd></>}
      {!!elements?.length && <><dt>under</dt><dd>{elements.map((e) => `${e.id}${e.kind ? ` (${e.kind})` : ''}`).join(' ⊂ ')}</dd></>}
    </dl>
  );
}

function Composer({ draft, fps, context, onChange, onSave, onCancel }: {
  draft: Draft; fps: number; context: ReviewNote['context']; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="review-composer">
      <span className="hud">new note · {noteWhen(draft, fps)}{draft.cue ? ` · aimed at ${draft.cue}` : ''}</span>
      <textarea autoFocus placeholder="What feels off? (Enter saves, Shift-Enter for a new line, Esc cancels)" value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(); }
        }} />
      <ContextLines context={context} />
      <div className="review-composer-row">
        <span className="hud">click the frame to {draft.x === undefined ? 'add' : 'move'} its point</span>
        <button onClick={onCancel}>Cancel</button>
        <button className="review-primary" onClick={onSave} disabled={!draft.text.trim()}>Save note</button>
      </div>
    </div>
  );
}

/** Scenes above, notes on, sounds under the track. A press seeks; dragging past a frame or two marks a range. */
function Scrubber({ manifest, fps, total, frame, notes, draft, onSeek, onRange, onSound }: {
  manifest: ReviewManifest; fps: number; total: number; frame: number; notes: ReviewNote[]; draft: Draft | null;
  onSeek: (f: number) => void; onRange: (first: number, last: number) => void; onSound: (id: string, frame: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const press = useRef<{ from: number; range: boolean } | null>(null);
  const [live, setLive] = useState<[number, number] | null>(null);
  const pct = (f: number) => `${(f / total) * 100}%`;
  const frameAt = (e: ReactPointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total - 1, Math.floor(((e.clientX - box.left) / box.width) * total)));
  };
  const range = live ?? (draft?.frame !== undefined && draft.end !== undefined ? [draft.frame, draft.end] : null);
  return (
    <div className="review-scrubber">
      <div className="review-scenes">
        {manifest.scenes?.map((s, i) => (
          <span key={s.id} className={i % 2 ? 'odd' : ''} style={{ left: pct(s.start * fps), width: pct(s.dur * fps) }} title={s.id}>{s.id}</span>
        ))}
      </div>
      <div ref={track} className="review-track"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const f = frameAt(e); press.current = { from: f, range: false }; onSeek(f); }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          const f = frameAt(e);
          if (Math.abs(f - p.from) >= 2) p.range = true;
          if (p.range) setLive([Math.min(p.from, f), Math.max(p.from, f)]);
          onSeek(f);
        }}
        onPointerCancel={() => { press.current = null; setLive(null); }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          setLive(null);
          if (p?.range) { const f = frameAt(e); onRange(Math.min(p.from, f), Math.max(p.from, f)); }
        }}>
        {range && <span className="review-range" style={{ left: pct(range[0]), width: pct(range[1] - range[0] + 1) }} />}
        {notes.filter((n) => n.frame !== undefined).map((n, i) => (
          <span key={n.id} className="review-note-mark" style={{ left: pct(n.frame!), width: n.end !== undefined ? pct(n.end - n.frame! + 1) : undefined }} title={`${i + 1}. ${n.text}`} />
        ))}
        <span className="review-playhead" style={{ left: pct(frame + 0.5) }} />
      </div>
      {manifest.sounds && (
        <div className="review-sounds">
          {manifest.sounds.map((s) => (
            <button key={`${s.source}:${s.id}`} className={`review-sound ${s.source}${draft?.cue === s.id ? ' on' : ''}`} style={{ left: pct(s.frame + 0.5) }}
              title={`${s.sound} · ${s.id} · ${formatReviewMoment(s.frame, fps)}${s.source === 'cue-list' ? ' · cue list' : ''}`}
              onClick={() => onSound(s.id, s.frame)} />
          ))}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ReviewPage />);
