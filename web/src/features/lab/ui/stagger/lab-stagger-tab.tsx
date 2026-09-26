import { Stack } from '@mantine/core';
import { LabNote } from '../lab-note.tsx';
import { LabTabIntro } from '../lab-tab-intro.tsx';
import { LabStaggerHeroBench } from './lab-stagger-hero-bench.tsx';
import { LabStaggerRowBench } from './lab-stagger-row-bench.tsx';

/** The Stagger tab: a row of cards entering on the studio's `stagger`, then one page entering with and without a lead. */
export function LabStaggerTab() {
  return (
    <Stack gap="xl">
      <LabTabIntro
        number={2}
        title="Stagger & choreography"
        what={<>A <b>stagger</b> is when a group of things arrives one after another instead of all together, like a row of dominoes falling. Each card makes the same move; only its start time shifts. It turns a crowd of moving things into a single ripple the eye can follow.</>}
        when="Whenever a video shows a list, a grid or a set of cards appearing: search results, product tiles, the steps of a plan, the rows of a table."
        bad="Everything pops in at the same instant, so the eye has nowhere to land. Or the gap between cards is so long that a list of twenty takes five seconds and the viewer is waiting for the last one."
        good="One element leads with the big move and the rest follow in a quick, even ripple that finishes while it still feels like one gesture. Long lists get squeezed so they never drag."
      />
      <LabStaggerRowBench />
      <Stack gap="md">
        <LabStaggerHeroBench />
        <LabNote>
          <b>Takeaway:</b> decide what the viewer should look at first and give only that the big move. Everything else arrives smaller, a little later, and close together.
        </LabNote>
      </Stack>
    </Stack>
  );
}
