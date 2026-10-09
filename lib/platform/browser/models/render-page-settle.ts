// render-page-settle.ts: work a render page finishes after its frames, which the page's close waits for. A page holds
// it open (studio/render-page-settle.ts) and answers this global with a promise of it all settled; Node asks that
// before closing the page (render-browser.ts). Remotion closes a tab with no unload, cutting off anything in flight.

/** A render page's global as Node asks it: unset on a page that never held anything open. */
export type RenderPageSettleGlobal = { studioRenderPageSettled?: () => Promise<void> };
