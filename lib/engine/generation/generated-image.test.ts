import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { studioTempRoot } from '../temp/studio-temp.ts';
import { generateProjectImage } from './generated-image.ts';

// A 3×2 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8wwACLGAEBQATOAEGMgPs4gAAAABJRU5ErkJggg==', 'base64');
const MODELS = {
  data: [
    { id: 'example/fixed-frame', architecture: { input_modalities: ['text', 'image'] }, supported_parameters: {} },
    { id: 'recraft/recraft-v4.1', architecture: { input_modalities: ['text', 'image'] }, supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] } } },
  ],
};
let generations: any[] = [];
let project = '', projects = 0;

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  project = join(studioTempRoot(), `generated-image-${++projects}`);
  mkdirSync(project);
  generations = [];
  stubOpenRouterImages();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// OpenRouter at the network boundary: the model list, and an image for each generation.
function stubOpenRouterImages() {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    if (String(input).endsWith('/images/models')) return Response.json(MODELS);
    if (String(input).endsWith('/endpoints')) return Response.json({ endpoints: [{ provider_name: 'Recraft' }] });
    generations.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ b64_json: PNG.toString('base64') }], usage: { cost: 0.01 } }, { headers: { 'X-Generation-Id': `gen-img-${generations.length}` } });
  }) as typeof fetch;
}

test('an aspect ratio the model would ignore is refused before anything is paid for', async () => {
  await assert.rejects(
    generateProjectImage(project, { name: 'bg', prompt: 'a dusk sky', model: 'example/fixed-frame', references: [], aspect: '16:9', transparent: false }),
    /fixed-frame ignores --aspect/,
  );
  await assert.rejects(
    generateProjectImage(project, { name: 'bg', prompt: 'a dusk sky', model: 'recraft/recraft-v4.1', references: [], aspect: '21:9', transparent: false }),
    /takes --aspect 1:1, 16:9/,
  );
  assert.equal(generations.length, 0);
});

test('a generated image is listed by name with its size, and generating the name again replaces it', async () => {
  const request = { name: 'title-bg', prompt: 'a dusk sky', model: 'recraft/recraft-v4.1', references: [], aspect: '16:9', transparent: false };
  const { file, index } = await generateProjectImage(project, request);
  assert.equal(generations[0].aspect_ratio, '16:9');
  const provenance = JSON.parse(readFileSync(join(project, 'generated', 'provenance.json'), 'utf8'));
  assert.equal((Object.values(provenance)[0] as any).requestId, 'gen-img-1');

  // Listed again from the cache without asking OpenRouter anything, even with no provider serving the model.
  globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal((await generateProjectImage(project, request)).file, file);
  globalThis.fetch = realFetch;
  stubOpenRouterImages();

  const second = await generateProjectImage(project, { ...request, prompt: 'a dawn sky' });
  assert.notEqual(second.file, file);
  const source = readFileSync(index, 'utf8');
  assert.match(source, /"title-bg": \{ src: g0, w: 3, h: 2 \}/);
  assert.ok(source.includes(`import g0 from './${second.file.split('/').pop()}'`));
  assert.equal(source.match(/import /g)?.length, 1);
});
