import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LabGalleryItem } from './lab-catalog.ts';
import { splitLabGallery } from './lab-generated-media.ts';

const piece = (name: string, kind: LabGalleryItem['kind'], references: string[] = []): LabGalleryItem => ({
  id: `p/${name}`, project: 'p', name, kind, model: 'm', prompt: '', params: {}, cost: null, generatedAt: null,
  files: [`/media/p?path=generated%2F${name}`], references,
});

// A served URL names its file in the query and an exported one in its path; a previs render is found by either.
test('a render with a blockout is previs, whether its URLs are served or exported', () => {
  const served = piece('orbit', 'video', ['/media/p?path=generated%2Fblockout-orbit.mp4', '/media/p?path=refs%2Fmachine.png']);
  const exported = piece('push-in', 'video', ['/media/p/generated/blockout-push-in.webm']);
  const unguided = piece('loop', 'video', ['/media/p?path=refs%2Fmachine.png']);
  const track = piece('music-bed', 'audio');
  const still = piece('title-bg', 'image');
  const sections = splitLabGallery([served, exported, unguided, track, still]);
  assert.deepEqual(sections, { previs: [served, exported], music: [track], others: [unguided, still] });
});
