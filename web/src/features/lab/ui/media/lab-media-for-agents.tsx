import { Code, Text } from '@mantine/core';
import { Fragment } from 'react';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { LabForAgents } from '../lab-for-agents.tsx';

/** Where everything on the page comes from, for someone working on the studio. */
export function LabMediaForAgents({ gallery }: { readonly gallery: readonly LabGalleryItem[] }) {
  const projects = [...new Set(gallery.map((i) => i.project))].toSorted();
  return (
    <LabForAgents>
      <Text c="dimmed">
        New media is made with <Code>studio gen image</Code>, <Code>studio gen video</Code> and <Code>studio music gen</Code>,
        which record each file's model, prompt, settings and cost in its project's <Code>generated/provenance.json</Code>.
        This tab reads every one under <Code>projects/</Code>.
      </Text>
      <Text c="dimmed">
        Projects read: {projects.map((p, i) => <Fragment key={p}>{i ? ', ' : ''}<Code>{p}</Code></Fragment>)}.
      </Text>
    </LabForAgents>
  );
}
