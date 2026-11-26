// pause-rig-note.tsx: a note on what the rig is playing, appended to notes.jsonl with the clip, the mode, the values
// and which version was showing, so whoever reads it after knows what the words were about.
import { Button, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { Textarea } from '#web/shared/ui/textarea.tsx';
import { appendPauseRigLogFn, type PauseRigLogEntry } from '../controllers/pause-rig-log.ts';

/** `about` is read when the note is saved, so it says what was showing then. */
export function PauseRigNote({ about }: { about: () => PauseRigLogEntry }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | undefined>();
  const save = async () => {
    const file = await appendPauseRigLogFn({ data: { log: 'notes', entry: JSON.stringify({ at: new Date().toISOString(), ...about(), text }) } });
    setSaved(file);
    setText('');
  };
  return (
    <Stack gap="hairline">
      <Group gap="gap" align="flex-end">
        <Textarea flex={1} autosize minRows={1} placeholder="A note on this clip (↵ saves)" value={text} onChange={(event) => setText(event.currentTarget.value)}
          onEnter={() => {
            if (text.trim()) void save();
          }} onEscape={() => setText('')} />
        <Button disabled={!text.trim()} onClick={() => void save()}>Save note</Button>
      </Group>
      {saved && <Text size="xs" c="dimmed">Saved to {saved}</Text>}
    </Stack>
  );
}
