import { Alert, Stack } from '@mantine/core';
import type { ErrorComponentProps } from '@tanstack/react-router';

/** The router's default when a route's loader or component throws. */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  return (
    <Stack p="pageMargin">
      <Alert color="red" title="Couldn't load this">{error.message}</Alert>
    </Stack>
  );
}
