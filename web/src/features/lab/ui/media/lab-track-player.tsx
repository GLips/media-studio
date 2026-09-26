import { ActionIcon, Box, Group, Slider } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { Readout } from '#web/shared/ui/readout.tsx';

const styles = stylex.create({
  bar: { flex: 1 },
  time: { flex: 'none', minWidth: '84px', textAlign: 'right' },
});

const formatTrackTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A music track as a play/pause button and a bar to seek on. Only one track on the page plays at a time. */
export function LabTrackPlayer({ url }: { readonly url: string }) {
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

  return (
    <Group gap="sm" wrap="nowrap">
      <audio ref={audio} src={url} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
      <ActionIcon size="lg" radius="xl" variant="white" color="dark" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </ActionIcon>
      <Slider {...stylex.props(styles.bar)} size="sm" label={null} min={0} max={duration || 1} step={0.01} value={time}
        disabled={!duration} aria-label="Position in the track"
        onChange={(t) => {
          audio.current!.currentTime = t;
          setTime(t);
        }} />
      <Box {...stylex.props(styles.time)}>
        <Readout>{formatTrackTime(time)} / {duration ? formatTrackTime(duration) : '–:––'}</Readout>
      </Box>
    </Group>
  );
}
