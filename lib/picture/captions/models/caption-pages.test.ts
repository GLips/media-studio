import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineTimeline, fixedSpan } from '#lib/timing/timeline/models/timeline.ts';
import { CAPTION_WORD_LEAD_SECONDS, captionStateAt, pageCaptions, READABLE_CAPTION_RULE, type CaptionPagingRule } from './caption-pages.ts';
import { captionsToSrt } from './caption-sidecar.ts';
import { captionTable, captionTokens, type CaptionPhrase } from './caption-track.ts';

// Words 0.3 s apart, each 0.25 s long, from `at`.
const phrase = (id: string, text: string, at: number, paragraph = false): CaptionPhrase => ({
  id, paragraph, words: captionTokens(text).map((token, k) => ({ ...token, start: at + k * 0.3, end: at + k * 0.3 + 0.25 })),
});
const pageTexts = (track: CaptionPhrase[], rule: CaptionPagingRule) => pageCaptions(track, rule).map((p) => p.lines.map((l) => l.map((w) => w.text).join(' ')).join(' / '));

test('pages break on paragraphs, pauses and length, and never leave a word alone', () => {
  const rule = { ...READABLE_CAPTION_RULE, maxChars: 20, maxLines: 1 };
  const track = [
    phrase('a', 'Filter, search,', 0),
    // A pause after one word isn't a break: "and" would flash alone.
    phrase('b', 'and', 0.6),
    phrase('c', 'sort every list you have.', 2),
    phrase('d', 'Then ship it.', 5, true),
  ];
  assert.deepEqual(pageTexts(track, rule), ['Filter, search, and', 'sort every list', 'you have.', 'Then ship it.']);
  // A lone word that can't share a line with its neighbour stands alone rather than overflow the rule.
  assert.deepEqual(pageTexts([phrase('e', 'abcdefghi abcdefghij k', 0)], rule), ['abcdefghi abcdefghij', 'k']);
});

test('the sidecar pages as the burned-in captions do, and a held gap shows no blank', () => {
  const track = [phrase('a', 'One *two* `Enter`, four', 0), phrase('b', 'five six seven', 1.9)];
  const pages = pageCaptions(track, READABLE_CAPTION_RULE);
  assert.equal(pages[0].end, pages[1].start);
  assert.equal(captionStateAt(pages, pages[0].end - 0.001)?.page, pages[0]);
  assert.equal(captionStateAt(pages, pages[0].end)?.held.before, true);
  assert.equal(captionsToSrt(pages), '1\n00:00:00,000 --> 00:00:01,600\nOne two Enter, four\n\n2\n00:00:01,600 --> 00:00:02,900\nfive six seven\n');
});

test('a word lights a quarter second before it is spoken, on a page already showing', () => {
  const pages = pageCaptions([phrase('a', 'zero one two three', 2)], { ...READABLE_CAPTION_RULE, leadIn: 0 });
  const twoStarts = 2.6;
  assert.equal(CAPTION_WORD_LEAD_SECONDS, 0.25);
  assert.equal(captionStateAt(pages, twoStarts - 0.26)?.word, 1);
  assert.equal(captionStateAt(pages, twoStarts - 0.25)?.word, 2);
  // The page is up before its first word lights, though the rule asked for no lead-in.
  assert.equal(captionStateAt(pages, 2 - 0.26)?.word, -1);
});

test('a caption table places each row from its moment until the next row or its scene ends', () => {
  const timeline = defineTimeline({ scenes: { a: fixedSpan(2), b: fixedSpan(4, { cues: { press: 1 } }) } });
  const track = captionTable(timeline, { b: [[0.2, 'Press `⇧D`'], [{ cue: 'press', seconds: 0.5 }, 'It *opens*']] });
  assert.deepEqual(track.map((p) => [p.words[0].start, p.words.at(-1)!.end]), [[2.2, 3.5], [3.5, 6]]);
  assert.deepEqual(track[0].words[1], { text: '⇧D', emphasis: false, key: true, trail: '', start: track[0].words[1].start, end: 3.5 });
  assert.equal(track[1].words[1].emphasis, true);
  // A keycap of the markup's own characters, and markup inside punctuation.
  assert.deepEqual(captionTokens('Press `*`, then ("*Assign*")').map((w) => [w.text, w.key, w.emphasis]), [['Press', false, false], ['*', true, false], ['then', false, false], ['("Assign")', false, true]]);
});

test('a page past clauseLines ends at a clause in its middle, and one with no clause runs on', () => {
  const rule = { ...READABLE_CAPTION_RULE, maxChars: 24, maxLines: 4, maxSeconds: 9, pauseBreak: 3, clauseLines: 3 };
  const menu = [phrase('a', "At a restaurant, photograph the menu, and you'll see the FODMAPs in each dish before you order.", 0)];
  assert.deepEqual(pageTexts(menu, rule).map((p) => p.replaceAll(' / ', ' ')), ['At a restaurant, photograph the menu,', "and you'll see the FODMAPs in each dish before you order."]);
  const barcode = [phrase('b', 'Scan a barcode at the grocery store to spot hidden FODMAPs before you pick it up.', 0)];
  assert.equal(pageTexts(barcode, rule).length, 1);
});
