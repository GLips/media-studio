import { Code, Text } from '@mantine/core';
import type { LabMusicTrack } from '#models/lab/lab-catalog.ts';
import { musicTrackLabel } from '#models/lab/lab-sound-music-fit.ts';
import { LabBench } from '../lab-bench.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabSlider } from '../lab-slider.tsx';
import { playLabBuffer } from './lab-audio.ts';
import { LabMusicEarlierFits } from './lab-music-earlier-fits.tsx';
import { LabMusicFitStage } from './lab-music-fit-stage.tsx';
import { LabMusicSeamRoughness } from './lab-music-seam-roughness.tsx';
import { LabMusicSeams } from './lab-music-seams.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabSoundPart } from './lab-sound-part.tsx';
import { useLabMusicFit } from './use-lab-music-fit.ts';

/**
 * The Sound tab's music: a project's track decoded in the browser and fitted to a video's length with
 * lib/models/music/music-fit.ts, played, and drawn as where each stretch of the fit came from.
 */
export function LabMusicFitPanel({ tracks }: { readonly tracks: readonly LabMusicTrack[] }) {
  const music = useLabMusicFit(tracks);
  const { track, decoded, fit, sources } = music;
  if (!track) return <LabNote>No music in any project yet. <Code>studio music add</Code> puts a track in a project.</LabNote>;
  const madeEarlier = tracks.filter((t) => t.fit && t.project === track.project && t.fit.source === track.name);
  const playOriginal = (offset = 0) => decoded && playLabBuffer('music-original', decoded.buffer, { offset });
  const playFit = (offset = 0) => fit && playLabBuffer('music-fitted', fit.fitted, { offset: Math.max(0, offset) });

  return (
    <LabSoundPart kicker="02 — Music fit" title="Making a song exactly as long as the video">
      <LabNote>
        Say the video is <b>23.4 seconds</b> and the song is <b>30</b>. The easy fix is to fade the song out at 23.4 s, but
        then it dies mid-phrase and the video ends on a shrug. Instead the studio finds two moments in the song, a few bars
        apart, that sound almost the same, and <b>jumps from one to the other</b>, cutting out the bars between (or, for a
        longer video, going back and playing some twice). Jumps land only on the first beat of a bar, so the rhythm never
        stumbles, and the song still ends on <b>its real ending</b>.
      </LabNote>

      <LabBench stage={<LabMusicFitStage music={music} onPlayFit={playFit} onPlayOriginal={playOriginal} />}>
        <LabControls stacked>
          <LabChoice label="Song" value={track.id} options={sources.map((t) => ({ value: t.id, label: musicTrackLabel(t, sources) }))}
            onChange={music.chooseTrack}
            hint={`From ${track.project}. ${Math.round(track.bpm)} beats a minute, so a bar of four beats is ${(240 / track.bpm).toFixed(2)} s.`} />
          <LabSlider label="Video length" value={music.draftSeconds} min={Math.max(5, Math.round(track.duration * 0.35))} max={Math.round(track.duration * 2.2)} step={0.1}
            onChange={music.setVideoSeconds} format={(v) => `${v.toFixed(1)} s`}
            hint={`The song is ${track.duration.toFixed(1)} s. Shorter cuts bars out; longer repeats some.`} />
        </LabControls>
        {fit && fit.plan.seams.length > 0 && <LabMusicSeamRoughness db={fit.plan.worstSeamDb} />}
        {fit && <LabMusicSeams plan={fit.plan} bpm={track.bpm} onPlayFit={playFit} />}
        {fit && (
          <LabForAgents>
            <Text size="xs" c="dimmed">
              <Code>studio music fit</Code> runs this same plan (lib/models/music/music-fit.ts) and writes the fitted track into the project.
              Roughest seam: <Code>worstSeamDb</Code> {fit.plan.worstSeamDb.toFixed(2)}, the average difference per frequency band
              between the bars either side of it. Beat 1 of the bar was guessed as source beat {fit.plan.downbeatPhase}.
            </Text>
          </LabForAgents>
        )}
      </LabBench>

      <LabMusicEarlierFits fits={madeEarlier} />
    </LabSoundPart>
  );
}
