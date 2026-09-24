// openrouter.ts: the one place that talks to OpenRouter, so every command shares auth and error reporting.
// The key comes from the environment only; the owner's secret launcher puts it there for one process.
//
// Paid generation reaches three different endpoints, one per kind of media: images answer in one JSON response, video
// is a job to submit and poll, and audio (Lyria) streams out of chat completions. Each returns the same OpenRouterMedia,
// so lib/paid-generation.ts caches and records them all alike.

const API = 'https://openrouter.ai/api/v1';
// OpenRouter's own advice for video jobs, which take from half a minute to several.
const VIDEO_POLL_MS = 30_000;

/** What one paid generation returned: the media's bytes, what it cost in USD, and OpenRouter's id for the request. */
export type OpenRouterMedia = { outputs: Buffer[]; cost: number | null; requestId: string | null };
/** A video job as OpenRouter reports it; `id` is what a later run polls to pick the job back up. */
export type OpenRouterVideoJob = {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
  generation_id?: string | null;
  unsigned_urls?: string[];
  usage?: { cost?: number | null };
  error?: string | null;
};

function openRouterHeaders(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY is not set. Run this under your secret launcher so the key exists only in this process, '
      + 'e.g. `op run --env-file="$(studio home)/.env.op" -- studio <verb> <project>`');
  }
  return { Authorization: `Bearer ${key}` };
}

async function fetchOpenRouter(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  // An absolute URL (a video's content URL) takes the key too, so it must be OpenRouter's own.
  if (pathOrUrl.includes('://') && !pathOrUrl.startsWith(`${API}/`)) throw new Error(`refusing to send the OpenRouter key to ${pathOrUrl}`);
  const url = pathOrUrl.includes('://') ? pathOrUrl : `${API}${pathOrUrl}`;
  const response = await fetch(url, { ...init, headers: { ...openRouterHeaders(), ...init.headers } });
  if (!response.ok) throw new Error(`OpenRouter ${new URL(url).pathname} ${response.status}: ${await response.text()}`);
  return response;
}

/**
 * POSTs JSON to an OpenRouter endpoint and returns the raw Response, so audio callers can read bytes and
 * chat callers can read JSON.
 */
export function postOpenRouter(path: string, body: object): Promise<Response> {
  return fetchOpenRouter(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// The image API's body carries no request id; its X-Generation-Id header does.
export async function generateOpenRouterImage(body: object): Promise<OpenRouterMedia> {
  const response = await postOpenRouter('/images', body);
  const result: { data: { b64_json: string }[]; usage?: { cost?: number | null } } = await response.json();
  return { outputs: result.data.map((image) => Buffer.from(image.b64_json, 'base64')), cost: result.usage?.cost ?? null, requestId: response.headers.get('x-generation-id') };
}

/**
 * What an image model takes, as OpenRouter describes it: each request param it honours (an enum's values or a
 * range), and whether it reads images at all. OpenRouter doesn't refuse a param the model doesn't list (muse-image
 * took aspect_ratio 16:9 and made 3:2), so callers check against this before paying.
 */
export type OpenRouterImageModel = {
  id: string;
  architecture: { input_modalities: string[] };
  supported_parameters: Record<string, { type: 'enum'; values: string[] } | { type: 'range'; min: number; max: number } | { type: 'boolean' }>;
};

export async function fetchOpenRouterImageModel(model: string): Promise<OpenRouterImageModel> {
  const { data }: { data: OpenRouterImageModel[] } = await (await fetchOpenRouter('/images/models')).json();
  const found = data.find((m) => m.id === model);
  if (!found) throw new Error(`OpenRouter has no image model ${model}; list them at ${API}/images/models`);
  // A listed model can have no provider serving it, and a request then fails upstream as a misleading 401.
  const { endpoints }: { endpoints: unknown[] } = await (await fetchOpenRouter(`/images/models/${model}/endpoints`)).json();
  if (!endpoints.length) throw new Error(`no provider is serving ${model} on OpenRouter right now; try again later or pick another --model`);
  return found;
}

export async function submitOpenRouterVideo(body: object): Promise<OpenRouterVideoJob> {
  return (await postOpenRouter('/videos', body)).json();
}

/** Polls a video job until it ends, whether completed, failed, cancelled or expired, and returns it as it ended. */
export async function awaitOpenRouterVideoJob(jobId: string, onStatus: (status: string) => void): Promise<OpenRouterVideoJob> {
  let job: OpenRouterVideoJob = await (await fetchOpenRouter(`/videos/${jobId}`)).json();
  while (job.status === 'pending' || job.status === 'in_progress') {
    onStatus(job.status);
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_MS));
    job = await (await fetchOpenRouter(`/videos/${jobId}`)).json();
  }
  return job;
}

/** Downloads what a completed video job made. */
export async function downloadOpenRouterVideo(job: OpenRouterVideoJob): Promise<OpenRouterMedia> {
  // The content URLs aren't presigned; they take the key like any other call.
  const outputs = await Promise.all((job.unsigned_urls ?? []).map(async (url) => Buffer.from(await (await fetchOpenRouter(url)).arrayBuffer())));
  return { outputs, cost: job.usage?.cost ?? null, requestId: job.generation_id ?? job.id };
}

/** Chat completions with audio out, which only streams: the audio arrives as base64 pieces, and the cost in the last chunk. */
export async function generateOpenRouterAudio(body: object): Promise<OpenRouterMedia> {
  const response = await postOpenRouter('/chat/completions', { ...body, stream: true });
  let base64 = '', buffered = '', cost: number | null = null, requestId: string | null = null;
  const decoder = new TextDecoder();
  const read = (line: string) => {
    const data = line.startsWith('data: ') ? line.slice(6).trim() : '';
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(`OpenRouter /chat/completions: ${chunk.error.message}`);
    requestId ??= chunk.id ?? null;
    base64 += chunk.choices?.[0]?.delta?.audio?.data ?? '';
    cost = chunk.usage?.cost ?? cost;
  };
  for await (const bytes of response.body!) {
    buffered += decoder.decode(bytes, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop()!;
    lines.forEach(read);
  }
  // The last event, which carries the cost, may end without a newline.
  read(buffered + decoder.decode());
  if (!base64) throw new Error(`OpenRouter ${requestId ?? 'chat completion'} returned no audio`);
  return { outputs: [Buffer.from(base64, 'base64')], cost, requestId };
}
