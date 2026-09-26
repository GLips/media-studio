import { useEffect, useRef, useState } from 'react';
import type { LabMusicTrack } from '#models/lab/lab-catalog.ts';
import { stopLabAudio } from './lab-audio.ts';
import { decodeLabMusicTrack, fitDecodedLabMusic, type DecodedLabMusic, type LabMusicFitResult } from './lab-music-fit.ts';

const MUSIC_FIT_DEFAULT_SECONDS = 23.4;

/**
 * The music fit panel's state: the chosen song, decoded once, and its fit to the video length on the slider, planned
 * once the slider settles. `busy` while a new plan is on its way.
 */
export function useLabMusicFit(tracks: readonly LabMusicTrack[]) {
  const sources = tracks.filter((t) => !t.fit);
  // The showcase's 30 s track, when it's there: the length the intro's example talks about.
  const [trackId, setTrackId] = useState(() => (sources.find((t) => t.name === 'pulse') ?? sources.at(0))?.id);
  const [draftSeconds, setDraftSeconds] = useState(MUSIC_FIT_DEFAULT_SECONDS);
  const [seconds, setSeconds] = useState(MUSIC_FIT_DEFAULT_SECONDS);
  // Tagged with its track, so a song still decoding never shows as the one just chosen.
  const [decodedTrack, setDecodedTrack] = useState<{ id: string; music: DecodedLabMusic }>();
  const [result, setResult] = useState<LabMusicFitResult>();
  const track = tracks.find((t) => t.id === trackId);
  const decoded = track && decodedTrack?.id === track.id ? decodedTrack.music : undefined;

  useEffect(() => {
    if (!track) return undefined;
    let live = true;
    void decodeLabMusicTrack(track).then((music) => live && setDecodedTrack({ id: track.id, music }));
    return () => { live = false; };
  }, [track]);

  useEffect(() => {
    if (!track || !decoded) return undefined;
    // A frame's pause first, so the busy state paints before planning holds the page.
    const timer = setTimeout(() => setResult(fitDecodedLabMusic(decoded, track.beats, seconds)), 30);
    return () => clearTimeout(timer);
  }, [track, decoded, seconds]);

  // The slider plans once you let go (or pause), not on every pixel of a drag.
  const commit = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setVideoSeconds = (v: number) => {
    setDraftSeconds(v);
    clearTimeout(commit.current);
    commit.current = setTimeout(() => setSeconds(v), 350);
  };
  const chooseTrack = (id: string) => {
    stopLabAudio();
    setTrackId(id);
    setResult(undefined);
  };

  return {
    sources, track, decoded, result, draftSeconds, setVideoSeconds, chooseTrack,
    fit: result && 'plan' in result ? result : undefined,
    busy: !decoded || result?.seconds !== seconds,
  };
}

export type LabMusicFit = ReturnType<typeof useLabMusicFit>;
