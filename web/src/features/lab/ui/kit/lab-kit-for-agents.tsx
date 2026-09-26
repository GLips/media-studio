import { Code, List, Text } from '@mantine/core';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LAB_KIT_PIECES } from './lab-kit-pieces.tsx';

/** Each piece's real component name and file: the plain-words names above are for people. */
export function LabKitForAgents() {
  return (
    <LabForAgents>
      <List size="sm" c="dimmed">
        {Object.values(LAB_KIT_PIECES).map((p) => <List.Item key={p.id}>{p.title}: <Code>{p.name}</Code> in <Code>{p.source}</Code></List.Item>)}
      </List>
      <Text c="dimmed">
        Not shown: <Code>MotionTitle</Code>, <Code>ClickToBlur</Code>, <Code>Phone</Code> and <Code>SplitCompare</Code> need a captured page (a Shot).{' '}
        <Code>ThreeStage</Code> is left out while it is being reworked.
      </Text>
    </LabForAgents>
  );
}
