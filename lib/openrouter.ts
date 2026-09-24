// openrouter.ts: the one place that talks to OpenRouter, so every command shares auth and error reporting.
// The key comes from the environment only; the owner's secret launcher puts it there for one process.

const API = 'https://openrouter.ai/api/v1';

/**
 * POSTs JSON to an OpenRouter endpoint and returns the raw Response, so audio callers can read bytes and
 * chat callers can read JSON.
 */
export async function postOpenRouter(path: string, body: object): Promise<Response> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY is not set. Run this under your secret launcher so the key exists only in this process, '
      + 'e.g. `op run --env-file="$(studio home)/.env.op" -- studio voice <project>`');
  }

  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenRouter ${path} ${response.status}: ${await response.text()}`);
  return response;
}
