import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { listProjectArtifactsIn } from './project-artifacts.ts';

const put = (dir: string, path: string, body = '') => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
};

test('a project lists what it made beyond its renders: footage with its blockout, music, images, assets and scene renders', async () => {
  await withStudioTemp('project-artifacts', async (dir) => {
    for (const path of ['generated/blockout-establish-c1.mp4', 'generated/establish-a7.mp4', 'generated/establish-b8.mp4', 'generated/sign-d4.png',
      'generated/music-themeSax-e5.mp3', 'music/theme-sax.mp3', 'assets/plates/couch.png', 'assets/.cache/x.png', 'out/wip/slices/scene-home.mp4',
      'out/wip/slices/frames-0-30.mp4']) put(dir, path);
    const generation = { params: {}, requestId: null, generatedAt: '2026-11-25T00:00:00Z' };
    put(dir, 'generated/provenance.json', JSON.stringify({
      a7: { ...generation, name: 'establish', kind: 'video', model: 'bytedance/seedance-2.5', prompt: 'a house', cost: 1.11, files: ['generated/establish-a7.mp4'], references: [{ path: 'generated/blockout-establish-c1.mp4', sha256: 'c1' }] },
      b8: { ...generation, name: 'establish', kind: 'video', model: 'bytedance/seedance-2.5', prompt: 'a house', cost: 1.11, files: ['generated/establish-b8.mp4'], references: [] },
      d4: { ...generation, name: 'sign', kind: 'image', model: 'openai/gpt-image', prompt: 'a sign', cost: 0.02, files: ['generated/sign-d4.png'], references: [] },
      e5: { ...generation, name: 'music-themeSax', kind: 'audio', model: 'google/lyria', prompt: 'sax', cost: 0.04, files: ['generated/music-themeSax-e5.mp3'], references: [] },
    }));
    put(dir, 'generated/previs-clips.json', JSON.stringify({ establish: { file: 'establish-a7.mp4', from: 0, duration: 4, blockout: 'blockout-establish-c1.mp4', model: 'bytedance/seedance-2.5' } }));
    put(dir, 'music/manifest.json', JSON.stringify({ 'theme-sax': { file: 'theme-sax.mp3', duration: 29.5, lufs: -12.1, bpm: 120, beats: [], generated: { model: 'google/lyria', prompt: 'sax' } } }));

    const listed = Object.fromEntries(listProjectArtifactsIn(dir).map(({ path, kind, made }) => [path, { kind, made }]));
    assert.deepEqual(listed, {
      'generated/establish-a7.mp4': { kind: 'video', made: { as: 'footage', scene: 'establish', plays: true, blockout: 'generated/blockout-establish-c1.mp4', model: 'bytedance/seedance-2.5', cost: 1.11 } },
      'generated/establish-b8.mp4': { kind: 'video', made: { as: 'footage', scene: 'establish', plays: false, blockout: null, model: 'bytedance/seedance-2.5', cost: 1.11 } },
      'generated/sign-d4.png': { kind: 'still', made: { as: 'image', name: 'sign', model: 'openai/gpt-image', cost: 0.02 } },
      'music/theme-sax.mp3': { kind: 'audio', made: { as: 'music', name: 'theme-sax', seconds: 29.5, bpm: 120, lufs: -12.1, model: 'google/lyria', cost: 0.04, fitOf: null } },
      'assets/plates/couch.png': { kind: 'still', made: { as: 'asset' } },
      'out/wip/slices/scene-home.mp4': { kind: 'video', made: { as: 'scene-render', scene: 'home' } },
      'generated/blockout-establish-c1.mp4': { kind: 'video', made: undefined },
      'generated/music-themeSax-e5.mp3': { kind: 'audio', made: undefined },
      'out/wip/slices/frames-0-30.mp4': { kind: 'video', made: undefined },
    });
  });
});

test('a project lists every media file wherever it sits, leaving out working matter', async () => {
  await withStudioTemp('project-artifacts', async (dir) => {
    const listed = ['out/wip/clapper-wip/connected-preview.mp4', 'out/wip/clapper-wip/glove-drawings.jpg', 'scenes/shots/plate.webp',
      'audio/takes/line-1.wav', 'out/decisions/limbs/a.mp4', 'generated/plate-1.png', 'generated/plate-2.png'];
    const left = ['out/.review/peaks/video.png', '.cache/x.mp4', 'node_modules/pkg/logo.png', 'review/frames/f120.jpg', 'out/notes.txt',
      'out/captions.srt', ...Array.from({ length: 12 }, (_, i) => `out/hud/mask/f-${String(i).padStart(3, '0')}.png`)];
    for (const path of [...listed, ...left]) put(dir, path);
    assert.deepEqual(listProjectArtifactsIn(dir).map((a) => a.path).toSorted(), listed.toSorted());
  });
});
