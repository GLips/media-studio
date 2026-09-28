import { Stack } from '@mantine/core';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { labCatalogQueryOptions } from '#web/features/lab/controllers/lab-catalog-query.ts';
import { LabTabIntro } from '../lab-tab-intro.tsx';
import { stopLabAudio } from './lab-audio.ts';
import { LabCueLists } from './lab-cue-lists.tsx';
import { LabMusicFitPanel } from './lab-music-fit-panel.tsx';
import { LabSfxPanel } from './lab-sfx-panel.tsx';
import { LabSoundPart } from './lab-sound-part.tsx';

/**
 * The lab's Sound tab: sound effects synthesised from lib/sfx's recipes and played live, a music track fitted to a
 * video's length, and the cue list that places sounds in a real video.
 */
export function LabSoundTab() {
  const { data: catalog } = useSuspenseQuery(labCatalogQueryOptions);
  // Leaving the tab silences it: a song or a take playing on would outlive what drew it.
  useEffect(() => stopLabAudio, []);
  return (
    <Stack gap="xl">
      <LabTabIntro
        number={5}
        title="Sound"
        what="Two kinds of sound go under a video's pictures: small effects that make things on screen feel physical (a click, a whoosh as something flies in, a chime when a task is done) and a music track underneath it all. The studio makes the effects itself and trims the music to fit. Put your sound on."
        when="Effects go on moments you should feel: a cursor press, a card landing, a reveal. Music runs under a whole video, most of all a teaser with no voice, where it sets the pace."
        bad="Every click is the identical recording, so it sounds like a machine. A whoosh peaks a beat after the move it's for. The music fades out halfway through a phrase because the video ran out."
        good="Sounds land exactly on what you see, vary a little like real ones, and sit quietly under the voice. The music's last note lands on the last frame, and you can't hear where it was cut."
      />
      <LabSfxPanel />
      <LabMusicFitPanel tracks={catalog.music} />
      <LabSoundPart kicker="03 — The cue list" title="Every sound in a real video">
        <LabCueLists payloads={catalog.sfxCues} exported={catalog.exported} />
      </LabSoundPart>
    </Stack>
  );
}
