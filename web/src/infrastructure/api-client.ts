// api-client.ts: the app's one reader of `fetch`, for what it loads by URL rather than through a server function: the
// lab's catalog, its whole videos and its music, which an export serves as static files from any host.

/** The response at `url`, or a throw naming it and the status when it didn't load. */
export async function fetchStudioUrl(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} didn't load: ${response.status} ${await response.text()}`);
  return response;
}
