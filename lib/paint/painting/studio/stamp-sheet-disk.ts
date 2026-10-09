// stamp-sheet-disk.ts: where a render's page keeps its sheet solves between renders: the render serves its solved-paint
// cache (lib/output/render/engine/render-paint-cache.ts) and sets it here as the bundle loads. A solve asks it for the
// decisions it lacks and the films it would make, and gives it what it solved. Unset (the studio's preview, a still),
// solves keep only to the page. A cache that fails is warned of and solved past: it never fails a render.

import { logRenderPageWarning } from '#lib/platform/browser/studio/render-page-log.ts';

/** How long a request to the cache waits before the solve goes on without it. */
const STAMP_SHEET_DISK_TIMEOUT_MS = 15_000;

let source: string | null = null;

/** Where this page's render serves its solved-paint cache, set as the bundle loads. */
export function setStampSheetDiskCache(url: string): void {
  source = url;
}

/** Whether this page keeps its solves on disk. */
export const stampSheetDiskCached = () => source !== null;

/** `ask`'s answer, or null (warned of: the render prints it once) when the cache can't give one. */
async function asked<T>(what: string, ask: (from: string) => Promise<T>): Promise<T | null> {
  if (source === null) return null;
  try {
    return await ask(source);
  } catch (error) {
    logRenderPageWarning(`the solved-paint cache failed ${what}, so this page solved without it: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** `response`, refused unless it's ok. */
function okOf(response: Response): Response {
  if (!response.ok) throw new Error(`it answered ${response.status}`);
  return response;
}

const signal = () => AbortSignal.timeout(STAMP_SHEET_DISK_TIMEOUT_MS);

/** A field of a memo as JSON meets it. */
type StampSheetMemoField = string | number | boolean | null | readonly StampSheetMemoField[] | { readonly [field: string]: StampSheetMemoField };

// JSON writes a non-finite number as null; a memo's times can be infinite (a sheet that never dries).
const NON_FINITE = '$number';
type StampSheetNonFinite = { readonly [NON_FINITE]: string };
const isNonFinite = (field: StampSheetMemoField): field is number => typeof field === 'number' && !Number.isFinite(field);
const isNonFiniteTag = (field: StampSheetMemoField | StampSheetNonFinite): field is StampSheetNonFinite => field !== null && typeof field === 'object' && NON_FINITE in field;
const replaced = (_name: string, field: StampSheetMemoField) => (isNonFinite(field) ? { [NON_FINITE]: String(field) } : field);
const revived = (_name: string, field: StampSheetMemoField | StampSheetNonFinite) => (isNonFiniteTag(field) ? Number(field[NON_FINITE]) : field);

/** The memos the cache knows of `keys`, by key; none when it's unset or fails. */
export async function stampSheetDiskMemos<M>(keys: readonly string[]): Promise<ReadonlyMap<string, M>> {
  if (!keys.length) return new Map();
  const found = await asked('reading decisions', async (from) => {
    const response = okOf(await fetch(`${from}/memos`, { method: 'POST', body: JSON.stringify(keys), headers: { 'content-type': 'application/json' }, signal: signal() }));
    // SAFETY: render-paint-cache.ts answers /memos with [key, memo] pairs.
    return (await response.json()) as [string, string][];
  });
  // SAFETY: each memo was written by stampSheetDiskKeepMemos from an M.
  return new Map((found ?? []).map(([key, memo]) => [key, JSON.parse(memo, revived) as M]));
}

/** Gives the cache `memos`, each `[key, rank, memo]` (render-paint-cache.ts' PaintMemoPut). */
export async function stampSheetDiskKeepMemos(memos: readonly (readonly [string, number, unknown])[]): Promise<void> {
  if (!memos.length) return;
  await asked('keeping decisions', async (from) => {
    const body = JSON.stringify(memos.map(([key, rank, memo]) => [key, rank, JSON.stringify(memo, replaced)]));
    okOf(await fetch(`${from}/memos/put`, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: signal() }));
  });
}

/** The film record kept under `key`; null for none, or when the cache is unset or fails. */
export async function stampSheetDiskFilm(key: string): Promise<ArrayBuffer | null> {
  return (await asked('reading a film', async (from) => {
    const response = await fetch(`${from}/film/${encodeURIComponent(key)}`, { signal: signal() });
    return response.status === 404 ? null : okOf(response).arrayBuffer();
  })) ?? null;
}

/** Gives the cache `record` once read back, the film under `key`; one that fails to read back is warned of too. */
export async function stampSheetDiskKeepFilm(key: string, record: Promise<Uint8Array<ArrayBuffer>>): Promise<void> {
  await asked('keeping a film', async (from) => {
    // A Blob body: an ArrayBuffer one crosses to Node many times slower.
    okOf(await fetch(`${from}/film/${encodeURIComponent(key)}`, { method: 'PUT', body: new Blob([await record]), headers: { 'content-type': 'application/octet-stream' }, signal: signal() }));
  });
}
