import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { readReviewScript } from './review-script-source.ts';

// A two-line project as `studio voice` leaves it: the take, what whisper heard in it, and each line's clip with its
// words timed from the clip's start.
const manifestLine = (text: string, words: [string, number, number][], duration: number, pauseBefore: number | null) => ({
  src: 'audio/x.wav', duration, text, caption: text, paragraph: false, lufs: -16, pauseBefore,
  words: words.map(([w, start, end]) => ({ text: w, start, end })),
});

function writeVoicedProject(dir: string) {
  mkdirSync(join(dir, 'audio'));
  const take = wavFromSamples(new Int16Array(24000 * 3), 24000);
  writeFileSync(join(dir, 'audio', 'take.wav'), take);
  const takeKey = createHash('sha256').update(take).digest('hex').slice(0, 16);
  writeFileSync(join(dir, 'audio', 'take.json'), JSON.stringify({
    source: 'tts', hash: 'request', heard: { [takeKey]: [{ text: 'Snap', start: 0.3, end: 0.5 }, { text: 'it.', start: 0.5, end: 0.7 }, { text: 'Then', start: 1.6, end: 1.8 }] },
  }));
  writeFileSync(join(dir, 'audio', 'manifest.json'), JSON.stringify({
    a: manifestLine('Snap it.', [['Snap', 0.06, 0.26], ['it.', 0.26, 0.46]], 0.6, null),
    b: manifestLine('Then eat.', [['Then', 0.05, 0.25], ['eat.', 0.25, 0.5]], 0.7, 0.8),
  }));
}

const writeScript = (dir: string, second: string) =>
  writeFileSync(join(dir, 'voiceover.json'), JSON.stringify({ voice: 'Kore', lines: [{ id: 'a', text: 'Snap *it.*' }, { id: 'b', text: second }] }));

test('the script reads its words in time on the take, under a hash that moves only when the words do', () => {
  withStudioTemp('review-script', (dir) => {
    writeVoicedProject(dir);
    writeScript(dir, 'Then eat.');
    const script = readReviewScript(dir);

    const starts = script.lines.flatMap((l) => l.words ?? []).map((w) => w.start);
    assert.deepEqual(starts, [0.3, 0.5, 1.69, 1.89], 'line b starts after line a and the pause the take left');
    assert.equal(script.lines[0].text, 'Snap it.');
    assert.equal(script.takes[0].label, 'paid');
    assert.match(script.hash, /^[0-9a-f]{10}$/);
    assert.equal(readReviewScript(dir).hash, script.hash);

    writeScript(dir, 'Then eat well.');
    const edited = readReviewScript(dir);
    assert.notEqual(edited.hash, script.hash);
    assert.equal(edited.lines[1].words, undefined, 'an edited line is unvoiced until the take is cut again');
    assert.equal(edited.lines[0].words?.length, 2);
  });
});
