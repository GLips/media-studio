import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStoryboardTextEdit, type StoryboardTextEdit } from './storyboard-source-edit.ts';

const source = `// A plan → with a comment.
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';

export const storyboard = defineStoryboard({
  title: 'Fixture',
  target: { seconds: 10 },
  brief: {
    For: \`Two lines
of brief.\`,
    'What it keeps': "The \\"old\\" band.",
  },
  scenes: {
    open: {
      onScreen: 'The app, open.',   // trailing comment
      motion: "It's still.",
      reads: ['First read.', 'Second read.'],
      lines: {
        hello: { text: 'Say hello.', cues: { hi: 'hello' } },
        later: { text: \`Say \${'later'}.\` },
      },
    },
  },
  leftOut: ['Settings.'],
});
`;

/** The edited source, failing the test on a conflict or refusal. */
function edited(text: string, edit: StoryboardTextEdit): string {
  const result = applyStoryboardTextEdit(text, edit);
  assert.ok('source' in result, JSON.stringify(result));
  return result.source;
}

test('a line edit replaces only its literal, every other byte kept', () => {
  const out = edited(source, { field: 'line', scene: 'open', line: 'hello', was: 'Say hello.', text: 'Say hi there.' });
  assert.equal(out, source.replace("'Say hello.'", "'Say hi there.'"));
});

test('new text round-trips through the quote it is written in', () => {
  const cases: [StoryboardTextEdit, string][] = [
    [{ field: 'onScreen', scene: 'open', was: 'The app, open.', text: "The app's home." }, `"The app's home."`],
    [{ field: 'motion', scene: 'open', was: "It's still.", text: `It's "still".` }, `"It's \\"still\\"."`],
    [{ field: 'brief', section: 'For', was: 'Two lines\nof brief.', text: 'Three `lines`\nof ${brief}\\.' }, '`Three \\`lines\\`\nof \\${brief}\\\\.`'],
    [{ field: 'brief', section: 'What it keeps', was: 'The "old" band.', text: 'One\nand two.' }, '`One\nand two.`'],
    [{ field: 'reads', scene: 'open', index: 1, was: 'Second read.', text: 'Back\\slash.' }, "'Back\\\\slash.'"],
    [{ field: 'leftOut', index: 0, was: 'Settings.', text: 'History.' }, "'History.'"],
  ];
  for (const [edit, literal] of cases) {
    const out = edited(source, edit);
    assert.ok(out.includes(literal), `${edit.field}: ${literal} not in\n${out}`);
    // Editing again from the new text proves the file now holds exactly it.
    edited(out, { ...edit, was: edit.text, text: 'x' });
  }
});

test('an edit over a value changed since the page loaded is a conflict with the current value', () => {
  assert.deepEqual(
    applyStoryboardTextEdit(source, { field: 'onScreen', scene: 'open', was: 'The app, closed.', text: 'New.' }),
    { conflict: { current: 'The app, open.' } },
  );
});

test('a computed value or a missing target is refused, naming where', () => {
  const computed = applyStoryboardTextEdit(source, { field: 'line', scene: 'open', line: 'later', was: 'Say later.', text: 'New.' });
  assert.deepEqual(computed, { refused: 'scenes.open.lines.later.text is computed, not a string literal: edit it in storyboard.ts' });
  const missing = applyStoryboardTextEdit(source, { field: 'reads', scene: 'open', index: 5, was: '', text: 'New.' });
  assert.deepEqual(missing, { refused: 'scenes.open.reads has no item 5' });
});
