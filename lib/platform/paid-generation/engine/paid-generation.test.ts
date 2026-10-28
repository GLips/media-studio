import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { generatePaidMedia } from './paid-generation.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]);
let calls: { url: string; body: any }[] = [];
let project = '', projects = 0;

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
  project = join(studioTempRoot(), `paid-generation-${++projects}`);
  mkdirSync(project);
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a request already made costs nothing, whatever order its params come in, until a reference file changes', async () => {
  stubOpenRouter(() => ({ data: [{ b64_json: PNG.toString('base64') }], usage: { cost: 0.04 } }));
  const still = join(project, 'still.png');
  writeFileSync(still, PNG);
  const request = { kind: 'image', model: 'example/image-model', name: 'title', prompt: 'a title card', references: [{ path: still }] } as const;

  const { files: [first] } = await generatePaidMedia(project, { ...request, params: { aspect_ratio: '16:9', resolution: '2K' } });
  assert.match(basename(first), /^title-[0-9a-f]{16}\.png$/);
  assert.equal(calls[0].body.input_references[0].image_url.url, `data:image/png;base64,${PNG.toString('base64')}`);
  const provenance = JSON.parse(readFileSync(join(project, 'generated', 'provenance.json'), 'utf8'));
  assert.deepEqual(Object.values(provenance).map((p: any) => [p.prompt, p.cost, p.references[0].path]), [['a title card', 0.04, 'still.png']]);

  assert.deepEqual((await generatePaidMedia(project, { ...request, params: { resolution: '2K', aspect_ratio: '16:9' } })).files, [first]);
  assert.equal(calls.length, 1);

  writeFileSync(still, Buffer.concat([PNG, Buffer.from([1])]));
  const { files: [second] } = await generatePaidMedia(project, { ...request, params: { aspect_ratio: '16:9', resolution: '2K' } });
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
  const { files: [file] } = await generatePaidMedia(project, request);

  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/api/v1/videos/job-1', '/api/v1/videos/job-1/content']);
  assert.match(basename(file), /^orbit-[0-9a-f]{16}\.mp4$/);
  assert.deepEqual(JSON.parse(readFileSync(join(project, 'generated', 'pending.json'), 'utf8')), {});
});

test('a reference video goes to the bucket once, and the job gets a link to it instead of its bytes', async () => {
  Object.assign(process.env, {
    STUDIO_UPLOAD_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', STUDIO_UPLOAD_S3_BUCKET: 'studio',
    STUDIO_UPLOAD_S3_ACCESS_KEY_ID: 'id', STUDIO_UPLOAD_S3_SECRET_ACCESS_KEY: 'secret',
  });
  const uploaded = new Set<string>();
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: `${init?.method ?? 'GET'} ${url.origin}${url.pathname}`, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (url.host === 'acct.r2.cloudflarestorage.com') {
      if (init?.method === 'PUT') uploaded.add(url.pathname);
      return new Response(null, { status: init?.method === 'HEAD' && !uploaded.has(url.pathname) ? 404 : 200 });
    }
    if (url.pathname.endsWith('/videos')) return Response.json({ id: `job-${calls.length}`, status: 'pending' });
    if (url.pathname.includes('/content')) return new Response(new Uint8Array(MP4));
    return Response.json({ id: url.pathname.split('/').pop(), status: 'completed', unsigned_urls: [`https://openrouter.ai/api/v1/videos/${url.pathname.split('/').pop()}/content`] });
  }) as typeof fetch;
  const blockout = join(project, 'blockout.mp4');
  writeFileSync(blockout, MP4);

  for (const prompt of ['a café', 'an office']) {
    await generatePaidMedia(project, { kind: 'video', model: 'bytedance/seedance-2.5', name: 'shot', prompt, params: { duration: 5 }, references: [{ path: blockout }] });
  }

  const bucketObject = /^https:\/\/acct\.r2\.cloudflarestorage\.com\/studio\/references\/[0-9a-f]{64}\.mp4$/;
  assert.deepEqual(calls.filter((c) => c.url.includes('r2.')).map((c) => c.url.split(' ')[0]), ['HEAD', 'PUT', 'HEAD']);
  for (const submit of calls.filter((c) => c.url.endsWith('/videos'))) {
    const link = new URL(submit.body.input_references[0].video_url.url);
    assert.match(`${link.origin}${link.pathname}`, bucketObject);
    assert.equal(link.searchParams.get('X-Amz-Expires'), '3600');
  }
});

test('each take of a sound effect is paid for once, with the plan its licence follows', async () => {
  Object.assign(process.env, { ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_PLAN: 'starter' });
  const MP3 = Buffer.from('ID3\x04\x00', 'latin1');
  stubOpenRouter(() => MP3);
  const request = { kind: 'sound-effect', model: 'eleven_text_to_sound_v2', name: 'sfx-munch', prompt: 'a crisp apple munch', params: { duration_seconds: 1 } } as const;

  const one = await generatePaidMedia(project, { ...request, take: 1 });
  const two = await generatePaidMedia(project, { ...request, take: 2 });
  assert.deepEqual((await generatePaidMedia(project, { ...request, take: 1 })).files, one.files);
  assert.notDeepEqual(two.files, one.files);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/api\.elevenlabs\.io\/v1\/sound-generation\?/);
  assert.deepEqual(calls[0].body, { text: 'a crisp apple munch', model_id: 'eleven_text_to_sound_v2', duration_seconds: 1 });
  assert.match(basename(one.files[0]), /\.mp3$/);
  assert.equal(one.provenance.plan, 'starter');
});

test("ElevenLabs' refusals read plainly, and no plan means no call", async () => {
  Object.assign(process.env, { ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_PLAN: 'starter' });
  globalThis.fetch = (async () => Response.json({ detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of 10000.' } }, { status: 401 }));
  const request = { kind: 'sound-effect', model: 'eleven_text_to_sound_v2', name: 'sfx-yawn', prompt: 'a small dinosaur yawns' } as const;
  await assert.rejects(generatePaidMedia(project, request), { message: 'ElevenLabs refused the request (quota_exceeded): This request exceeds your quota of 10000.' });

  globalThis.fetch = (async () => Response.json({ detail: [{ loc: ['body', 'duration_seconds'], msg: 'Input should be greater than or equal to 0.5', type: 'greater_than_equal' }] }, { status: 422 }));
  await assert.rejects(generatePaidMedia(project, request), { message: 'ElevenLabs refused the request: duration_seconds Input should be greater than or equal to 0.5' });

  delete process.env.ELEVENLABS_PLAN;
  stubOpenRouter(() => Buffer.alloc(0));
  await assert.rejects(generatePaidMedia(project, request), /ELEVENLABS_PLAN must name the key's plan/);
  assert.equal(calls.length, 0);
});
