import { Group, Slider, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Readout } from '#web/shared/ui/readout.tsx';

type LabSliderProps = {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  readonly format?: (value: number) => string;
  readonly hint?: ReactNode;
};

/** A labelled slider with its value shown, and an optional plain-words hint under it. */
export function LabSlider({ label, value, min, max, step = 0.01, onChange, format = String, hint }: LabSliderProps) {
  return (
    <Stack gap="tight">
      <Group justify="space-between" align="baseline">
        <Text fw={600} size="sm">{label}</Text>
        <Readout>{format(value)}</Readout>
      </Group>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={null} size="sm" />
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Stack>
  );
}
