// sound.tsx: the lab's Sound tab: sound effects synthesised from lib/sfx's recipes and played live, a music track
// fitted to a video's length with lib/music-fit.ts, and the cue list that places sounds in a real video.
import { useEffect } from 'react';
import { LabTabIntro } from '../ui.tsx';
import { SfxCueEditor } from './sound/cue-editor.tsx';
import { stopLabAudio } from './sound/lab-audio.ts';
import { MusicFitPanel } from './sound/music-fit-panel.tsx';
import { SfxPanel } from './sound/sfx-panel.tsx';
import './sound.css';

export function SoundTab() {
  useEffect(() => stopLabAudio, []);
  return (
    <>
      <LabTabIntro
        number={5}
        title="Sound"
        what="Two kinds of sound go under a video's pictures: small effects that make things on screen feel physical (a click, a whoosh as something flies in, a chime when a task is done) and a music track underneath it all. The studio makes the effects itself and trims the music to fit. Put your sound on."
        when="Effects go on moments you should feel: a cursor press, a card landing, a reveal. Music runs under a whole video, most of all a teaser with no voice, where it sets the pace."
        bad="Every click is the identical recording, so it sounds like a machine. A whoosh peaks a beat after the move it's for. The music fades out halfway through a phrase because the video ran out."
        good="Sounds land exactly on what you see, vary a little like real ones, and sit quietly under the voice. The music's last note lands on the last frame, and you can't hear where it was cut."
      />
      <SfxPanel />
      <MusicFitPanel />
      <section className="sound-part">
        <header className="sound-part-head">
          <span className="hud">03 — The cue list</span>
          <h3>Every sound in a real video</h3>
        </header>
        <SfxCueEditor />
      </section>
    </>
  );
}
