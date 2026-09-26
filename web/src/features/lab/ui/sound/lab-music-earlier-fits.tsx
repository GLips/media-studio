import { Button, Group } from '@mantine/core';
import type { LabMusicTrack } from '#models/lab/lab-catalog.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { playLabBuffer } from './lab-audio.ts';
import { decodeLabMusicTrack } from './lab-music-fit.ts';

/** Fits `studio music fit` already wrote into a project from this song, to hear beside the live one. */
export function LabMusicEarlierFits({ fits }: { readonly fits: readonly LabMusicTrack[] }) {
  if (fits.length === 0) return null;
  return (
    <Group gap="xs">
      <Readout label>Fits made earlier for a real video</Readout>
      {fits.map((t) => {
        const seams = t.fit?.seams.length ?? 0;
        return (
          <Button key={t.id} radius="xl" size="sm" onClick={() => void decodeLabMusicTrack(t).then((d) => playLabBuffer('music-earlier', d.buffer))}>
            ▶ {t.name} · {t.duration.toFixed(1)} s · {seams} seam{seams === 1 ? '' : 's'}
          </Button>
        );
      })}
    </Group>
  );
}
