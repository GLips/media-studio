// paid-generation.ts: every paid OpenRouter generation (`studio gen` verbs, `studio music`'s generated beds) goes
// through generatePaidMedia, which writes the results into the project's generated/ and returns their paths.
//
// Outputs aren't reproducible (most models ignore a seed), so the cache, keyed by kind, model, prompt, params and
// reference bytes, is the only way to get a result twice. generated/provenance.json records what made each and its
// cost. A video job's id sits in generated/pending.json until download, so a run dying mid-poll resumes it rather
// than paying again.
//
// References go inline as base64, except a video: the video API takes only HTTPS, so it's uploaded to our bucket
// (s3-upload.ts) and sent as an expiring link.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { uploadS3Reference } from './s3-upload.ts';
import {
  awaitOpenRouterVideoJob, downloadOpenRouterVideo, generateOpenRouterAudio, generateOpenRouterImage, submitOpenRouterVideo,
  type OpenRouterMedia,
} from './openrouter.ts';

/** Which OpenRouter API makes it: `/images`, `/videos` (a job to poll), or chat completions with audio out (Lyria). */
export type PaidGenerationKind = 'image' | 'video' | 'audio';
/** A local file sent with the prompt. `frame` pins an image as a video's first or last frame, rather than a reference. */
export type PaidGenerationReference = { path: string; frame?: 'first_frame' | 'last_frame' };
export type PaidGenerationRequest = {
  kind: PaidGenerationKind;
  model: string;
  /** Names the output files, generated/<name>-<key>.<ext>. Not part of the key, so renaming never pays again. */
  name: string;
  prompt: string;
  /** The rest of the request body as the endpoint takes it, e.g. `{ aspect_ratio: '16:9', duration: 5 }`. */
  params?: Record<string, unknown>;
  references?: readonly PaidGenerationReference[];
  /** Runs only on a cache miss, just before paying: a check that throws to refuse the request. Not part of the key. */
  beforePaying?: () => Promise<void>;
};

type GeneratedProvenance = {
  name: string;
  kind: PaidGenerationKind;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  references: { path: string; sha256: string; frame?: PaidGenerationReference['frame'] }[];
  /** Relative to the project. */
  files: string[];
  cost: number | null;
  requestId: string | null;
  generatedAt: string;
};

/** Makes what the request asks for, or finds it already made, and returns the absolute paths of the files. */
export async function generatePaidMedia(project: string, request: PaidGenerationRequest): Promise<string[]> {
  const dir = join(project, 'generated');
  mkdirSync(dir, { recursive: true });
  const provenancePath = join(dir, 'provenance.json'), pendingPath = join(dir, 'pending.json');

  const params = request.params ?? {};
  const references = (request.references ?? []).map((ref) => ({ ...ref, bytes: readFileSync(ref.path) }))
    .map((ref) => ({ ...ref, sha256: createHash('sha256').update(ref.bytes).digest('hex') }));
  const key = paidGenerationKey(request.kind, request.model, request.prompt, params, references.map((ref) => [ref.sha256, ref.frame ?? null]));

  const made = readJsonRecord<GeneratedProvenance>(provenancePath)[key];
  if (made && made.files.every((file) => existsSync(join(project, file)))) {
    for (const file of made.files) console.error(`cached ${file}`);
    return made.files.map((file) => join(project, file));
  }

  await request.beforePaying?.();
  let media: OpenRouterMedia;
  if (request.kind === 'image') media = await generateOpenRouterImage(await requestBody(request, params, references));
  else if (request.kind === 'audio') media = await generateOpenRouterAudio(await requestBody(request, params, references));
  else {
    let jobId = readJsonRecord<string>(pendingPath)[key];
    if (jobId) console.error(`picking up video job ${jobId}`);
    else {
      jobId = (await submitOpenRouterVideo(await requestBody(request, params, references))).id;
      writeJsonRecordEntry(pendingPath, key, jobId);
      console.error(`submitted video job ${jobId}`);
    }
    const job = await awaitOpenRouterVideoJob(jobId, (status) => console.error(`video job ${jobId} ${status}`));
    if (job.status !== 'completed') {
      // A job that ended without a video isn't billed, so the next run submits afresh.
      writeJsonRecordEntry(pendingPath, key, undefined);
      throw new Error(`OpenRouter video job ${job.id} ${job.status}: ${job.error ?? 'no reason given'}`);
    }
    media = await downloadOpenRouterVideo(job);
  }
  if (!media.outputs.length) throw new Error(`OpenRouter ${request.model} returned nothing`);

  const files = media.outputs.map((bytes, i) => {
    const file = join('generated', `${request.name}-${key}${media.outputs.length > 1 ? `-${i + 1}` : ''}.${generatedMediaExtension(bytes)}`);
    writeFileSync(join(project, file), bytes);
    return file;
  });
  writeJsonRecordEntry(provenancePath, key, {
    name: request.name, kind: request.kind, model: request.model, prompt: request.prompt, params,
    references: references.map(({ path, sha256, frame }) => ({ path: relative(project, path), sha256, ...(frame && { frame }) })),
    files, cost: media.cost, requestId: media.requestId, generatedAt: new Date().toISOString(),
  });
  // Only once the files and their provenance are written: until then a lost download can still be picked up.
  if (request.kind === 'video') writeJsonRecordEntry(pendingPath, key, undefined);
  const cost = media.cost === null ? 'cost unknown' : `$${media.cost.toFixed(3)}`;
  for (const file of files) console.error(`generated ${file}  ${cost}${media.requestId ? `  (${media.requestId})` : ''}`);
  return files.map((file) => join(project, file));
}

const readJsonRecord = <T>(path: string): Record<string, T> => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});

// Re-reads the file and sets one entry, with no await between, so another run writing to the same project (a video
// polls for minutes) never has its entries overwritten by a copy read before it wrote them.
function writeJsonRecordEntry(path: string, key: string, value: unknown) {
  const record = readJsonRecord<unknown>(path);
  if (value === undefined) delete record[key];
  else record[key] = value;
  writeFileSync(path, JSON.stringify(record, null, 2));
}

/**
 * The cache key. Params are hashed with their keys sorted, so the order a verb builds them in never makes a paid
 * call; references by their bytes, so an edited file does.
 */
export function paidGenerationKey(...request: unknown[]): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sorted(v)]))
    : value;
  return createHash('sha256').update(JSON.stringify(sorted(request))).digest('hex').slice(0, 16);
}

// Each API takes references in its own field: the image API as input_references, the video API as frame_images for
// pinned frames and input_references (image, video or audio) otherwise, and chat as parts of the user's message.
async function requestBody(request: PaidGenerationRequest, params: Record<string, unknown>, references: (PaidGenerationReference & { bytes: Buffer; sha256: string })[]) {
  const part = async (ref: { path: string; bytes: Buffer; sha256: string }) => {
    const { type, mime } = referenceMedia(ref.path);
    const url = type === 'video_url'
      ? await uploadS3Reference(ref.bytes, { sha256: ref.sha256, ext: extname(ref.path).slice(1).toLowerCase(), mime })
      : `data:${mime};base64,${ref.bytes.toString('base64')}`;
    return { type, [type]: { url } };
  };
  const framed = references.filter((ref) => ref.frame);
  if (framed.length && request.kind !== 'video') throw new Error(`only a video pins frames; ${framed[0].path} has frame: ${framed[0].frame}`);
  const guides = await Promise.all(references.filter((ref) => !ref.frame).map(part));

  if (request.kind === 'audio') {
    return { model: request.model, modalities: ['text', 'audio'], ...params, messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }, ...guides] }] };
  }
  return {
    model: request.model, prompt: request.prompt, ...params,
    ...(guides.length && { input_references: guides }),
    ...(framed.length && { frame_images: await Promise.all(framed.map(async (ref) => ({ ...(await part(ref)), frame_type: ref.frame }))) }),
  };
}

const REFERENCE_MEDIA: Record<string, { type: 'image_url' | 'video_url' | 'audio_url'; mime: string }> = {
  '.png': { type: 'image_url', mime: 'image/png' },
  '.jpg': { type: 'image_url', mime: 'image/jpeg' },
  '.jpeg': { type: 'image_url', mime: 'image/jpeg' },
  '.webp': { type: 'image_url', mime: 'image/webp' },
  '.mp4': { type: 'video_url', mime: 'video/mp4' },
  '.mov': { type: 'video_url', mime: 'video/quicktime' },
  '.wav': { type: 'audio_url', mime: 'audio/wav' },
  '.mp3': { type: 'audio_url', mime: 'audio/mpeg' },
};

function referenceMedia(path: string) {
  const media = REFERENCE_MEDIA[extname(path).toLowerCase()];
  if (!media) throw new Error(`${path}: a reference must be one of ${Object.keys(REFERENCE_MEDIA).join(' ')}`);
  return media;
}

/**
 * The extension for generated bytes, read from their content: the APIs don't reliably say what format they returned.
 * An unknown format is saved as .bin rather than thrown away, since it's already paid for.
 */
export function generatedMediaExtension(bytes: Buffer): string {
  const ascii = (from: number, to: number) => bytes.subarray(from, to).toString('latin1');
  if (ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    return brand === 'avif' ? 'avif' : ['heic', 'heix', 'mif1'].includes(brand) ? 'heic' : brand.startsWith('qt') ? 'mov' : 'mp4';
  }
  if (ascii(0, 4) === '\x1aE\xdf\xa3') return 'webm';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'aac';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
  if (/^\s*<(\?xml|svg)/.test(ascii(0, 100))) return 'svg';
  console.error(`generated media of an unknown format (starts ${bytes.subarray(0, 12).toString('hex')}), saved as .bin`);
  return 'bin';
}
