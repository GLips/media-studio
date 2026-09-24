// openrouter.mjs: the one place that talks to OpenRouter, so every script shares auth and error reporting.
// Run scripts through `op run` (see .env.op) so OPENROUTER_API_KEY exists only in that process.

const API = 'https://openrouter.ai/api/v1';

/**
 * POSTs JSON to an OpenRouter endpoint and returns the raw Response, so audio callers can read bytes and
 * chat callers can read JSON.
 *
 * @param {string} path - e.g. '/audio/speech'.
 * @param {object} body
 * @returns {Promise<Response>}
 */
export async function postOpenRouter(path, body) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set: run through `op run --env-file=.env.op` (see package.json scripts)');

  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenRouter ${path} ${response.status}: ${await response.text()}`);
  return response;
}
