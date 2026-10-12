import { TextInput as MantineTextInput, type TextInputProps } from '@mantine/core';

/**
 * A one-line field. Password managers stay out of it unless `autoComplete` names what it holds: the studio's fields are
 * searches and names, and a filled-in login would land in quick-open's query.
 */
export function TextInput({ autoComplete = 'off', ...props }: TextInputProps) {
  return <MantineTextInput autoComplete={autoComplete} data-1p-ignore={autoComplete === 'off' || undefined} data-lpignore={autoComplete === 'off' || undefined} {...props} />;
}
