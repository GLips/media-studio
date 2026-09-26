import { Button, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

type LabButtonsProps = {
  readonly label: string;
  readonly buttons: readonly { label: string; onClick: () => void }[];
  readonly hint?: ReactNode;
};

/** A row of one-shot buttons, such as presets that set several controls at once. Nothing stays selected. */
export function LabButtons({ label, buttons, hint }: LabButtonsProps) {
  return (
    <Stack gap="tight">
      <Text fw={600} size="sm">{label}</Text>
      <Group gap="tight">
        {buttons.map((b) => <Button key={b.label} size="compact-sm" variant="default" onClick={b.onClick}>{b.label}</Button>)}
      </Group>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Stack>
  );
}
