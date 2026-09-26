import { Group, Stack, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Readout } from '#web/shared/ui/readout.tsx';
import { fonts } from '#web/shared/ui/theme.stylex.ts';
import { LabTabIntro } from '../lab-tab-intro.tsx';
import { LabCurvesEasesBench } from './lab-curves-eases-bench.tsx';
import { LabCurvesSpringsBench } from './lab-curves-springs-bench.tsx';

const styles = stylex.create({
  part: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '80%', textTransform: 'uppercase' },
});

/** The Curves & springs tab: the studio's easing curves racing the same move, then its spring at four bounces landing on one beat. */
export function LabCurvesTab() {
  return (
    <Stack gap="xl">
      <LabTabIntro
        number={1}
        title="Curves & springs"
        what={<>How something gets from A to B. Almost nothing in the real world moves at a steady speed: it picks up speed, then slows to a stop. An <b>easing curve</b> is that speed-up and slow-down, written down so every move in a video shares it; the studio has a few named ones. A <b>spring</b> is the physical version: the object is pulled home as if by a rubber band, and can overshoot and wobble before it settles.</>}
        when="Every move in every video: a card sliding in, a caption popping up, the camera pushing in on a detail. Walkthroughs of an app use calm curves; teasers and showreels cut to music use snappier ones and springs."
        bad="Linear motion: the thing starts at full speed and stops dead, like a robot. Or a mix of unrelated curves, so the video feels twitchy, or a slow, lazy spring that wobbles long after the moment has passed."
        good="Things arrive fast and slow into place, so the eye knows exactly when they’ve landed. One family of curves throughout, and springs kept quick, saved for things that should feel alive."
      />
      <Stack gap="md" component="section">
        <Group gap="sm" align="baseline"><Readout>A</Readout><Title order={3} {...stylex.props(styles.part)}>Easing curves</Title></Group>
        <LabCurvesEasesBench />
      </Stack>
      <Stack gap="md" component="section">
        <Group gap="sm" align="baseline"><Readout>B</Readout><Title order={3} {...stylex.props(styles.part)}>Springs: one pace at every bounce, landing on the beat</Title></Group>
        <LabCurvesSpringsBench />
      </Stack>
    </Stack>
  );
}
