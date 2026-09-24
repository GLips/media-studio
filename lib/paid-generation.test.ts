import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { generatePaidMedia } from './paid-generation.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]);
let calls: { url: string; body: any }[] = [];
let project = '';

// OpenRouter at the network boundary: each test answers requests by URL.
function stubOpenRouter(answer: (url: string) => object | Buffer) {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const answered = answer(url);
    return Buffer.isBuffer(answered) ? new Response(new Uint8Array(answered)) : Response.json(answered);
  }) as typeof fetch;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  project = mkdtempSync(join(tmpdir(), 'paid-generation-'));
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a request already made costs nothing, whatever order its params come in, until a reference file changes', async () => {
  stubOpenRouter(() => ({ data: [{ b64_json: PNG.toString('base64') }], usage: { cost: 0.04 } }));
  const still = join(project, 'still.png');
  writeFileSync(still, PNG);
  const request = { kind: 'image', model: 'meta/muse-image', name: 'title', prompt: 'a title card', references: [{ path: still }] } as const;

  const [first] = await generatePaidMedia(project, { ...request, params: { aspect_ratio: '16:9', resolution: '2K' } });
  assert.match(basename(first), /^title-[0-9a-f]{16}\.png$/);
  assert.equal(calls[0].body.input_references[0].image_url.url, `data:image/png;base64,${PNG.toString('base64')}`);
  const provenance = JSON.parse(readFileSync(join(project, 'generated', 'provenance.json'), 'utf8'));
  assert.deepEqual(Object.values(provenance).map((p: any) => [p.prompt, p.cost, p.references[0].path]), [['a title card', 0.04, 'still.png']]);

  assert.deepEqual(await generatePaidMedia(project, { ...request, params: { resolution: '2K', aspect_ratio: '16:9' } }), [first]);
  assert.equal(calls.length, 1);

  writeFileSync(still, Buffer.concat([PNG, Buffer.from([1])]));
  const [second] = await generatePaidMedia(project, { ...request, params: { aspect_ratio: '16:9', resolution: '2K' } });
  assert.notEqual(second, first);
  assert.equal(calls.length, 2);
});

test('a finished video job whose download failed is picked up, not paid for again', async () => {
  const request = { kind: 'video', model: 'bytedance/seedance-2.5', name: 'orbit', prompt: 'orbit the box', params: { duration: 5 } } as const;
  const done = { id: 'job-1', status: 'completed', generation_id: 'gen-vid-1', unsigned_urls: ['https://openrouter.ai/api/v1/videos/job-1/content?index=0'], usage: { cost: 1.2 } };
  // The first run submits and the job completes, but the download drops.
  stubOpenRouter((url) => {
    if (url.endsWith('/videos')) return { id: 'job-1', status: 'pending' };
    if (url.endsWith('/videos/job-1')) return done;
    throw new Error('connection reset');
  });
  await assert.rejects(generatePaidMedia(project, request), /connection reset/);

  calls = [];
  stubOpenRouter((url) => (url.endsWith('/videos/job-1') ? done : MP4));
  const [file] = await generatePaidMedia(project, request);

  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/api/v1/videos/job-1', '/api/v1/videos/job-1/content']);
  assert.match(basename(file), /^orbit-[0-9a-f]{16}\.mp4$/);
  assert.deepEqual(JSON.parse(readFileSync(join(project, 'generated', 'pending.json'), 'utf8')), {});
});
