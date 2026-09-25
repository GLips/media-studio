// previs.tsx: a Seedance render beside the grey 3D blockout it was told to follow, both playing off one clock, so
// the previs idea shows for itself: block the shot for free, then pay once for a render that keeps its camera.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { LabGalleryItem } from '../../../manifest.ts';
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

// play() rejects whenever a pause interrupts it, which is expected here. `playing` is what the viewer asked for, not
// the element's state: Chrome pauses an autoplay-attribute video while it's scrolled offscreen, and mirroring that
// pause left the clips stopped once they scrolled into view. So play() is called from code, never autoPlay.
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
  const wantsPlay = useRef(playing);
  wantsPlay.current = playing;
  const item = items.find((i) => i.id === pick) ?? items[0];
  const photos = item.references.filter((r) => r !== previsBlockoutUrl(item));

  // The render is the clock; the blockout is nudged back onto it only when it drifts, since seeking every frame stutters.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const m = render.current;
      const f = blockout.current;
      if (m && f) {
        // Chrome pauses muted video in a background tab and doesn't always resume it, so hold it to what was asked.
        if (wantsPlay.current && m.paused && !document.hidden) playPrevisVideo(m);
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
  }, [speed, pick]);

  useEffect(() => {
    if (!playing) render.current?.pause();
  }, [playing]);

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

  // Both videos stay mounted in the same places in either view, so switching views keeps their time and play state
  // and the section keeps its height: Wipe stacks the two in one pane the size of a side-by-side one.
  const wiping = view === 'wipe';
  return (
    <div className="previs">
      <div className={`previs-view ${view}`}>
        <div className="previs-captions hud">
          {wiping ? <span>Drag across the picture: blockout on the left of the line, render on the right</span> : <>
            <span>1 · The blockout · free, drawn in code</span>
            <span>2 · The render · {item.cost === null ? '' : formatGenerationCost(item.cost)} from Seedance</span>
          </>}
        </div>
        <div className="previs-panes" onPointerDown={wiping ? dragWipe : undefined} onPointerMove={wiping ? dragWipe : undefined}>
          <video ref={blockout} key={`b-${item.id}`} src={previsBlockoutUrl(item)} muted loop playsInline preload="auto" />
          <div className="previs-render" style={wiping ? { clipPath: `inset(0 0 0 ${wipe}%)` } : undefined}>
            <video ref={render} key={`r-${item.id}`} src={item.files[0]} muted loop playsInline preload="auto"
              onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); e.currentTarget.playbackRate = speed; }} />
          </div>
          {wiping && <>
            <div className="previs-wipe-bar" style={{ left: `${wipe}%` }} />
            <span className="hud previs-wipe-label left">Blockout</span>
            <span className="hud previs-wipe-label right">Render</span>
          </>}
        </div>
      </div>

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
