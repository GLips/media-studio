import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStoryboardLinesEdit, type StoryboardLinesEdit } from './storyboard-lines-edit.ts';

const source = `import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';

export const storyboard = defineStoryboard({
  title: 'Fixture',
  scenes: {
    open: {
      onScreen: 'The app.',
      motion: 'Still.',
      lines: {
        hello: { text: 'Say hello, then the plan: every scene, then hello again.', paragraph: true, cues: { hi: 'hello', plan: 'every scene', again: { phrase: 'hello', nth: 2 }, start: { at: 'start' } } },
        bye: { text: 'Say bye.' },
      },
    },
    close: { onScreen: 'End.', motion: 'Still.', lines: { every: { text: 'Every last one.' } } },
  },
});
`;

function edited(edit: StoryboardLinesEdit): { source: string; line: string } {
  const result = applyStoryboardLinesEdit(source, edit);
  assert.ok('source' in result, JSON.stringify(result));
  return result;
}

test('a split keeps the first half and its cues under the line, and moves the rest to a new line after it', () => {
  const { source: out, line } = edited({
    op: 'splitLine', scene: 'open', line: 'hello', was: 'Say hello, then the plan: every scene, then hello again.',
    first: 'Say hello, then the plan:', second: 'every scene, then hello again.',
  });
  // "every" is taken in another scene, so the id takes a second word.
  assert.equal(line, 'everyScene');
  assert.ok(out.includes(`hello: { text: 'Say hello, then the plan:', paragraph: true, cues: { hi: 'hello', start: { at: 'start' } } },
        everyScene: { text: 'every scene, then hello again.', cues: { plan: 'every scene', again: 'hello' } },
        bye:`), out);
  // A cue whose phrase straddles the split stays with the first half, where the plan's diagnostics name it.
  const { source: straddled } = edited({
    op: 'splitLine', scene: 'open', line: 'hello', was: 'Say hello, then the plan: every scene, then hello again.',
    first: 'Say hello, then the plan: every', second: 'scene, then hello again.',
  });
  assert.ok(straddled.includes("cues: { hi: 'hello', plan: 'every scene', start: { at: 'start' } }"), straddled);
  assert.ok(straddled.includes("scene: { text: 'scene, then hello again.', cues: { again: 'hello' } }"), straddled);
});

test('a split over a line changed since the page read it is refused with the current text', () => {
  assert.deepEqual(
    applyStoryboardLinesEdit(source, { op: 'splitLine', scene: 'open', line: 'bye', was: 'Say goodbye.', first: 'Say', second: 'goodbye.' }),
    { conflict: { current: 'Say bye.' } },
  );
});

test('an added line goes after the one named, or last, with an id no other scene uses', () => {
  const afterHello = edited({ op: 'addLine', scene: 'open', after: 'hello', text: 'Bye for now.' });
  assert.equal(afterHello.line, 'byeFor');
  assert.match(afterHello.source, /cues: \{[^\n]*\} \},\n {8}byeFor: \{ text: 'Bye for now\.' \},\n {8}bye:/);
  const atEnd = edited({ op: 'addLine', scene: 'close', after: null, text: 'Every last one.' });
  // Written on one line, the lines object stays on one line.
  assert.ok(atEnd.source.includes("lines: { every: { text: 'Every last one.' }, everyLast: { text: 'Every last one.' } }"), atEnd.source);
});
