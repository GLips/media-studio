// track-player.tsx: a music track as a play/pause button and a progress bar in the lab's look, in place of the
// browser's own audio controls. Only one track on the page plays at a time.
import { useRef, useState, type PointerEvent } from 'react';

const formatTrackTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function GeneratedTrackPlayer({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audio.current!;
    if (!a.paused) return a.pause();
    for (const other of document.querySelectorAll('audio')) if (other !== a) other.pause();
    void a.play();
  };

  const seek = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.buttons) return;
    const box = e.currentTarget.getBoundingClientRect();
    const a = audio.current!;
    if (!duration) return;
    a.currentTime = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * duration;
    setTime(a.currentTime);
  };

  return (
    <div className="track-player">
      <audio ref={audio} src={url} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
      <button type="button" className="track-player-toggle" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="track-player-bar" onPointerDown={seek} onPointerMove={seek} role="slider" aria-label="Position in the track"
        aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}>
        <div style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
      </div>
      <span className="hud">{formatTrackTime(time)} / {duration ? formatTrackTime(duration) : '–:––'}</span>
    </div>
  );
}
