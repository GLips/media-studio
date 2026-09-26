import { TextInput as MantineTextInput, type TextInputProps } from '@mantine/core';

/** A one-line field in the studio's look. The app's fields come through web/src/shared/ui, so they read alike. */
export function TextInput(props: TextInputProps) {
  return <MantineTextInput size="xs" {...props} />;
}
