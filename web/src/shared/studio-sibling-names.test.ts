import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioSiblingNameOf } from './studio-sibling-names.ts';

test('a name among siblings drops their shared start at a word break, and keeps its last word whole', () => {
  const siblings = ['03-menu-appstore-iphone-detail.jpg', '03-menu-appstore-iphone-photo-detail.jpg', '03-menu-appstore-iphone-card.jpg'];
  assert.deepEqual(studioSiblingNameOf(siblings[1], siblings), { shown: 'photo-detail.jpg', head: 'photo', tail: '-detail.jpg' });
  assert.deepEqual(studioSiblingNameOf(siblings[2], siblings), { shown: 'card.jpg', head: '', tail: 'card.jpg' });
});

test('names sharing no whole word, or standing alone, show whole', () => {
  const siblings = ['03-menu-appstore-iphone-detail.jpg', '02-barcode-appstore-iphone-detail.jpg'];
  assert.equal(studioSiblingNameOf(siblings[0], siblings).shown, '03-menu-appstore-iphone-detail.jpg');
  assert.equal(studioSiblingNameOf('video.mp4', ['video.mp4']).shown, 'video.mp4');
  assert.equal(studioSiblingNameOf('a.png', ['a.png', 'a.png-old.png']).shown, 'a.png');
});
