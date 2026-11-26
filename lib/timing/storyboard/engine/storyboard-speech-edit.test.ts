import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStoryboardSpeechEdit, type StoryboardSpeechChange } from './storyboard-speech-edit.ts';

const board = (speech: string) => `export const storyboard = defineStoryboard({
  scenes: { open: { lines: { hi: { speech: ${speech} } } } }, // kept
});
`;
const edited = (speech: string, edit: { list: 'keep' | 'cut' } & StoryboardSpeechChange) => {
  const result = applyStoryboardSpeechEdit(board(speech), { scene: 'open', line: 'hi', ...edit });
  return 'source' in result ? result.source : result;
};

test('a restore adds its moment to the line\'s keep, writing the edits argument when it has none', () => {
  assert.equal(edited('rec.speech(1, 4)', { list: 'keep', add: 2.3 }), board('rec.speech(1, 4, { keep: [2.3] })'));
  assert.equal(edited(`rec.speech(1, 4, { track: 'system' })`, { list: 'keep', add: 2.3 }), board(`rec.speech(1, 4, { keep: [2.3], track: 'system' })`));
  assert.equal(edited('rec.speech(1, 4, { keep: [3.1] })', { list: 'keep', add: 2.3 }), board('rec.speech(1, 4, { keep: [2.3, 3.1] })'));
});

test('taking a restore back removes its moment, and the edits argument once nothing is left in it', () => {
  assert.equal(edited('rec.speech(1, 4, { keep: [2.3] })', { list: 'keep', within: [2.2, 2.5] }), board('rec.speech(1, 4)'));
  assert.equal(edited(`rec.speech(1, 4, { track: 'system', keep: [2.3] })`, { list: 'keep', within: [2.2, 2.5] }), board(`rec.speech(1, 4, { track: 'system' })`));
  assert.equal(edited(`rec.speech(1, 4, { cut: [2.3], track: 'system' })`, { list: 'cut', within: [2.2, 2.5] }), board(`rec.speech(1, 4, { track: 'system' })`));
  assert.deepEqual(edited('rec.speech(1, 4, { keep: [3.1] })', { list: 'keep', within: [2.2, 2.5] }), { refused: 'scenes.open.lines.hi.speech\'s keep names no moment from 2.2 to 2.5 s' });
  assert.ok('refused' in (edited('shared.hiSpeech', { list: 'keep', add: 2.3 }) as object));
});
