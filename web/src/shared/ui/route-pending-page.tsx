import { Loader, Stack } from '@mantine/core';

/** The router's default while a route loads. */
export function RoutePendingPage() {
  return (
    <Stack p="pageMargin" align="flex-start">
      <Loader size="sm" />
    </Stack>
  );
}
