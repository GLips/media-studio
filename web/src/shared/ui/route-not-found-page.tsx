import { Stack, Text } from '@mantine/core';

/** The router's default for a URL no route matches, or a route that throws notFound(). */
export function RouteNotFoundPage() {
  return (
    <Stack p="pageMargin">
      <Text c="dimmed">Nothing here.</Text>
    </Stack>
  );
}
