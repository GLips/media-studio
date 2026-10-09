// render-page-settle.ts: how drawing code keeps its page open past its frames for work it doesn't wait on (a solve's
// films on their way to the solved-paint cache): the render's Node side closes the page only once it has settled
// (models/render-page-settle.ts).

import type { RenderPageSettleGlobal } from '../models/render-page-settle.ts';

const held = new Set<Promise<void>>();

/** Keeps this page open until `work` settles; a rejection is the caller's to handle, and is ignored here. */
export function holdRenderPageOpen(work: Promise<void>): void {
  if (!held.size) Object.assign(globalThis, { studioRenderPageSettled: renderPageSettled } satisfies RenderPageSettleGlobal);
  const settled = work.catch(() => {}).finally(() => held.delete(settled));
  held.add(settled);
}

/** Resolves once everything held open, and anything it holds open in turn, has settled. */
async function renderPageSettled(): Promise<void> {
  if (!held.size) return;
  await Promise.all(held);
  return renderPageSettled();
}
