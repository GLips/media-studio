import { Code, Group, NativeSelect, Stack } from '@mantine/core';
import { getRouteApi } from '@tanstack/react-router';
import type { LabSfxCuePayload } from '#models/lab/lab-catalog.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabCueEditor } from './lab-cue-editor.tsx';

const labTabRoute = getRouteApi('/lab/$tab');

type LabCueListsProps = {
  readonly payloads: readonly LabSfxCuePayload[];
  readonly exported: boolean;
};

/**
 * The cue editor over one project's list, picked by the URL's `project` (the first when it names none that has one),
 * so a link opens the same list.
 */
export function LabCueLists({ payloads, exported }: LabCueListsProps) {
  const { project } = labTabRoute.useSearch();
  const navigate = labTabRoute.useNavigate();
  const payload = payloads.find((p) => p.project === project) ?? payloads[0];
  if (!payload) {
    return <LabNote>No project has a cue list yet: <Code>studio sfx draft {'<project>'}</Code> drafts one into its sfx/cues.json.</LabNote>;
  }
  return (
    <Stack gap="md">
      {payloads.length > 1 && (
        <Group gap="xs">
          <Readout label>Project</Readout>
          <NativeSelect size="xs" aria-label="The project whose cue list to edit" value={payload.project}
            onChange={(e) => void navigate({ search: { project: e.currentTarget.value } })}
            data={payloads.map((p) => p.project)} />
        </Group>
      )}
      {/* Keyed by project: the editor's edits, picks and video are one list's, so another list starts it afresh. */}
      <LabCueEditor key={payload.project} payload={payload} exported={exported} />
    </Stack>
  );
}
