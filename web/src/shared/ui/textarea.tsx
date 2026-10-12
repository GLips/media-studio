import { Textarea as MantineTextarea, type TextareaProps } from '@mantine/core';

/** A note field: Enter commits when the field asks for it, Shift+Enter and IME input keep editing, Esc cancels. */
export function Textarea({ onEnter, onEscape, ...props }: TextareaProps & { readonly onEnter?: () => void; readonly onEscape?: () => void }) {
  return (
    <MantineTextarea
      {...props}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && onEscape) {
          event.preventDefault();
          onEscape();
        } else if (event.key === 'Enter' && !event.shiftKey && onEnter) {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/** Puts the cursor in a note field after what's written, so a restored draft is typed on from its end, not its start. */
export function focusNoteFieldAtEnd(field: HTMLTextAreaElement | null | undefined) {
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}
