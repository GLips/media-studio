// ─── Each project's declared shared modules ───────────────────────────
//
// A shared module is one scenes may import (a project's palette, inks, HUD
// layout). Listing it here is the declaration: scene ownership then holds it to
// never importing back into a scene. A project file that is neither a role nor
// listed is unclassified, and a scene reaching it fails.

/** Project directory name → paths inside the project, e.g. `{ '2026-09-x': ['look.ts'] }`. */
export const DECLARED_SHARED_MODULES: Readonly<Record<string, readonly string[]>> = {
  // The bar contract, the palette and inks, the HUD's layout, the stand-in parts, the ink field and count bars 4, 5
  // and 9 hand over, and the frame every bar is drawn in (its HUD, which the finale reads over its tiles).
  '2026-09-motion-showcase': ['bar.ts', 'look.ts', 'hud.ts', 'parts.tsx', 'ink-field.ts', 'ink-count.ts', 'reel.tsx'],
};
