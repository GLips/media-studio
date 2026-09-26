import { Code, Paper, SimpleGrid, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { SFX_CLICK_STYLES, type SfxCueList } from '#sfx/cues.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { LabForAgents } from '../lab-for-agents.tsx';

const styles = stylex.create({
  card: { borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}`, borderTopWidth: '3px', borderTopStyle: 'solid', borderTopColor: colors.line },
  good: { borderTopColor: colors.pass },
});

/** Where the cue list comes from, why its draft follows rules, and what a redraft does to hand edits. */
export function LabCueExplainer({ project, list }: { readonly project: string; readonly list: SfxCueList }) {
  return (
    <>
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm" mt="sm">
        <Paper {...stylex.props(styles.card)}>
          <Readout label>Where the list comes from</Readout>
          <Text mt="tight">
            The studio watches the finished video and lists every moment a sound could go: each click, key press, scene
            change, camera move and thing appearing. For each it picks a sound, or notes why it stayed silent, and suggests a
            few others that would fit.
          </Text>
        </Paper>
        <Paper {...stylex.props(styles.card)}>
          <Readout label>Why it drafts with rules</Readout>
          <Text mt="tight">
            A sound on every moment turns a walkthrough into a pinball machine. So the draft keeps big sounds (whooshes, risers,
            hits) to scene changes, big camera moves and things appearing; at most one every 4 s; never on two cuts in a row;
            and never on top of a spoken word. Clicks all sound, except one right after another. Break a rule here and a
            warning says which.
          </Text>
        </Paper>
        <Paper {...stylex.props(styles.card, styles.good)}>
          <Readout label>Does redrafting undo my edits?</Readout>
          <Text mt="tight">
            <b>No.</b> When the video changes and the studio drafts its list again, it keeps what you changed by hand (sound,
            nudge, volume) and plans the new draft around it. An edit is lost only if its moment is gone from the video, or if
            a scene gained or lost clicks so the studio can't tell which click was which. It says which edits it lost.
          </Text>
        </Paper>
      </SimpleGrid>
      <LabForAgents>
        <Text size="xs" c="dimmed">
          The list is <Code>projects/{project}/sfx/cues.json</Code>, written by <Code>studio sfx draft</Code> (lib/sfx/cues.ts).
          Save writes it and regenerates <Code>generated/sfx-cues.ts</Code>; the warnings are what <Code>studio check</Code> reports.
        </Text>
        <Text size="xs" c="dimmed">
          A redraft matches hand edits by event id (like <Code>click:photos:3</Code>). Ids in a numbered series shift when the
          series gains or loses events, so a changed count drops that series' edits, and the CLI prints what it dropped.
          Clicks use the list's click style, <Code>{list.clickStyle}</Code> (<Code>{SFX_CLICK_STYLES[list.clickStyle]}</Code>).
        </Text>
      </LabForAgents>
    </>
  );
}
