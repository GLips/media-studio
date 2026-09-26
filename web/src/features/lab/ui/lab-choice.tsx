import { Button, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

type LabChoiceProps<T extends string | number> = {
  readonly label: string;
  readonly options: readonly { value: T; label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly hint?: ReactNode;
};

/** One of a few named options, as a row of buttons, the chosen one lit. */
export function LabChoice<T extends string | number>({ label, options, value, onChange, hint }: LabChoiceProps<T>) {
  return (
    <Stack gap="tight">
      <Text fw={600} size="sm">{label}</Text>
      <Group gap="tight">
        {options.map((o) => (
          <Button key={String(o.value)} size="compact-sm" variant={o.value === value ? 'white' : 'default'} color="dark" onClick={() => onChange(o.value)}>
            {o.label}
          </Button>
        ))}
      </Group>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Stack>
  );
}
