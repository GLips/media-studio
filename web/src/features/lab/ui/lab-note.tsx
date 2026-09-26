import { Text } from '@mantine/core';
import type { ReactNode } from 'react';

/** A short aside under a stage: a takeaway, or how to read what's on it. */
export function LabNote({ children }: { readonly children: ReactNode }) {
  return <Text c="dimmed" maw="80ch">{children}</Text>;
}
