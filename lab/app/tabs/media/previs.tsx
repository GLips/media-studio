// previs.tsx: a Seedance render beside the grey 3D blockout it was told to follow, both playing off one clock, so
// the previs idea shows for itself: block the shot for free, then pay once for a render that keeps its camera.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { LabGalleryItem } from '../../../server.ts';
import { LabChoice, LabControls } from '../../ui.tsx';
import { formatGenerationCost } from './lightbox.tsx';

type PrevisView = 'side' | 'wipe';
const PREVIS_SPEEDS = [{ value: 1, label: 'Normal' }, { value: 0.5, label: '½ speed' }, { value: 0.25, label: '¼ speed' }] as const;

/**
 * The part of a previs prompt that names the scene. Every one opens with the same paragraph telling the model to
 * follow @Video1; what differs, and what a reader wants, is what each grey shape becomes.
 */
const previsSceneText = (prompt: string) => prompt.split('\n\n').slice(1).join('\n\n') || prompt;

/** The blockout is the reference that's a video; any other reference is a photo of a real subject. */
export const previsBlockoutUrl = (item: LabGalleryItem) => item.references.find((r) => /\.(mp4|webm)$/i.test(r));

// play() rejects whenever a pause (ours, or the browser saving power in a hidden tab) interrupts it. That's not an
// error here: the render's pause event already flips the button back to Play.
const playPrevisVideo = (v: HTMLVideoElement) => void v.play().catch(() => {});

export function PrevisComparison({ items, onDetail }: { items: LabGalleryItem[]; onDetail: (item: LabGalleryItem) => void }) {
  const [pick, setPick] = useState(items[0].id);
  const [view, setView] = useState<PrevisView>('side');
  const [speed, setSpeed] = useState<number>(1);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(5);
  const [wipe, setWipe] = useState(50);
  const render = useRef<HTMLVideoElement>(null);
  const blockout = useRef<HTMLVideoElement>(null);
  const item = items.find((i) => i.id === pick) ?? items[0];
  const photos = item.references.filter((r) => r !== previsBlockoutUrl(item));

  // The render is the clock; the blockout is nudged back onto it only when it drifts, since seeking every frame stutters.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const m = render.current;
      const f = blockout.current;
      if (m && f) {
        if (Math.abs(f.currentTime - m.currentTime) > 0.08) f.currentTime = Math.min(m.currentTime, f.duration || m.currentTime);
        if (m.paused && !f.paused) f.pause();
        if (!m.paused && f.paused) playPrevisVideo(f);
        setTime(m.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    for (const v of [render.current, blockout.current]) if (v) v.playbackRate = speed;
  }, [speed, pick, view]);

  useEffect(() => {
    const m = render.current;
    if (m && playing) playPrevisVideo(m);
    if (m && !playing) m.pause();
  }, [playing, pick, view]);

  const seek = (t: number) => {
    for (const v of [render.current, blockout.current]) if (v) v.currentTime = t;
    setTime(t);
  };

  const dragWipe = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.buttons) return;
    const box = e.currentTarget.getBoundingClientRect();
    setWipe(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)));
  };

  const blockoutVideo = <video ref={blockout} key={`b-${item.id}`} src={previsBlockoutUrl(item)} muted loop playsInline preload="auto" />;
  const renderVideo = (
    <video ref={render} key={`r-${item.id}`} src={item.files[0]} muted loop playsInline autoPlay={playing} preload="auto"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); e.currentTarget.playbackRate = speed; }} />
  );

  return (
    <div className="previs">
      {view === 'side' ? (
        <div className="previs-side">
          <figure className="stage"><figcaption className="hud">1 · The blockout · free, drawn in code</figcaption>{blockoutVideo}</figure>
          <figure className="stage"><figcaption className="hud">2 · The render · {item.cost === null ? '' : formatGenerationCost(item.cost)} from Seedance</figcaption>{renderVideo}</figure>
        </div>
      ) : (
        <figure className="stage previs-wipe-stage">
          <figcaption className="hud">Drag across the picture</figcaption>
          <div className="previs-wipe" onPointerDown={dragWipe} onPointerMove={dragWipe}>
            {blockoutVideo}
            <div className="previs-wipe-top" style={{ clipPath: `inset(0 0 0 ${wipe}%)` }}>{renderVideo}</div>
            <div className="previs-wipe-bar" style={{ left: `${wipe}%` }} />
            <span className="hud previs-wipe-label left">Blockout</span>
            <span className="hud previs-wipe-label right">Render</span>
          </div>
        </figure>
      )}

      <div className="previs-transport">
        <button type="button" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={duration} step={0.01} value={time}
          onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} aria-label="Scrub both clips" />
        <output className="hud">{time.toFixed(2)}s / {duration.toFixed(2)}s</output>
      </div>

      <LabControls>
        <LabChoice label="Shot" options={items.map((i) => ({ value: i.id, label: i.name }))} value={item.id}
          onChange={(id) => { setPick(id); setTime(0); }} hint="Three test shots, each blocked in 3D and then rendered once." />
        <LabChoice label="Compare" options={[{ value: 'side', label: 'Side by side' }, { value: 'wipe', label: 'Wipe' }] as const} value={view} onChange={setView}
          hint="Wipe lays the render over its blockout, so you can check the camera and each object land in the same place." />
        <LabChoice label="Speed" options={PREVIS_SPEEDS} value={speed} onChange={setSpeed} hint="Slow it down to follow one object through the move." />
      </LabControls>

      <div className="previs-scene">
        <div>
          <span className="hud">What each grey shape was told to become</span>
          <p>{previsSceneText(item.prompt)}</p>
          <button type="button" className="media-link" onClick={() => onDetail(item)}>The full prompt, settings and cost →</button>
        </div>
        {photos.length > 0 && (
          <div className="previs-photos">
            <span className="hud">Plus a photo of the real thing</span>
            {photos.map((p) => <img key={p} src={p} alt="" />)}
          </div>
        )}
      </div>
    </div>
  );
}
