// elevenlabs.ts: the one place that talks to ElevenLabs, for `studio sfx gen`'s sound effects. The key comes from the
// environment only, as OpenRouter's does; it's granted `sound_generation` alone, so nothing here reads the account.
import type { PaidMedia } from './paid-media.ts';

const API = 'https://api.elevenlabs.io/v1';
/** The plans ELEVENLABS_PLAN may name. Only `free` limits use: non-commercial, with attribution. */
export const ELEVENLABS_PLANS = ['free', 'starter', 'creator', 'pro', 'scale', 'business', 'enterprise'] as const;
type ElevenLabsPlan = (typeof ELEVENLABS_PLANS)[number];

// Every plan can have it, where WAV and PCM at 44.1 kHz need Pro; the studio decodes and levels it anyway.
const OUTPUT_FORMAT = 'mp3_44100_128';

/** What `/sound-generation` takes, as its API names it. */
export type ElevenLabsSoundEffectBody = { text: string; model_id: string; duration_seconds?: number; prompt_influence?: number };

/** An ElevenLabs error body: a refusal's { status, message }, or a 422's complaint per field. */
type ElevenLabsErrorBody = { detail?: { status?: string; message?: string } | { loc?: (string | number)[]; msg?: string }[] };

/**
 * The account's plan, which decides the licence of what it makes. The key can't read the subscription, so the owner
 * sets ELEVENLABS_PLAN beside it in work/.env.op.
 */
export function elevenLabsPlan(): ElevenLabsPlan {
  const plan = process.env.ELEVENLABS_PLAN;
  const named = ELEVENLABS_PLANS.find((p) => p === plan);
  if (!named) {
    throw new Error(`ELEVENLABS_PLAN must name the key's plan, one of ${ELEVENLABS_PLANS.join(', ')}${plan ? `, not ${plan}` : ''}: `
      + "a take's licence depends on it. Set it in work/.env.op beside ELEVENLABS_API_KEY");
  }
  return named;
}

/**
 * ElevenLabs' refusal as one line: `quota_exceeded: …` for a { detail: { status, message } } body, each field's
 * complaint for a 422's { detail: [{ loc, msg }] }, else the body as it came.
 */
export function elevenLabsRefusal(status: number, body: string): string {
  let detail: ElevenLabsErrorBody['detail'];
  try {
    // SAFETY: the error shapes ElevenLabs documents; every field is optional, and a body that's neither reads as it came.
    ({ detail } = JSON.parse(body) as ElevenLabsErrorBody);
  } catch {
    return `ElevenLabs ${status}: ${body}`;
  }
  if (Array.isArray(detail)) {
    const fields = detail.map(({ loc = [], msg = '' }) => `${loc.filter((l) => l !== 'body').join('.')} ${msg}`.trim());
    return `ElevenLabs refused the request: ${fields.join('; ')}`;
  }
  if (detail?.message) return `ElevenLabs refused the request${detail.status ? ` (${detail.status})` : ''}: ${detail.message}`;
  return `ElevenLabs ${status}: ${body}`;
}

/** One sound effect from `body`, as an MP3. */
export async function generateElevenLabsSoundEffect(body: ElevenLabsSoundEffectBody): Promise<PaidMedia> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error('ELEVENLABS_API_KEY is not set. Run this under your secret launcher so the key exists only in this process, '
      + 'e.g. `"$(studio home)/bin/studio-secrets" studio sfx gen …`');
  }
  const plan = elevenLabsPlan();
  const response = await fetch(`${API}/sound-generation?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(elevenLabsRefusal(response.status, await response.text()));
  // ElevenLabs bills in credits, not dollars, and the response doesn't say how many.
  return { outputs: [Buffer.from(await response.arrayBuffer())], cost: null, requestId: response.headers.get('request-id'), plan };
}
