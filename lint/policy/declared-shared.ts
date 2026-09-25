// ─── Each project's declared shared modules ───────────────────────────
//
// A shared module is one scenes may import (a project's palette, inks, HUD
// layout). Listing it here is the declaration: scene ownership then holds it to
// never importing back into a scene. A project file that is neither a role nor
// listed is unclassified, and a scene reaching it fails.
//
// Empty on purpose: the showcase's root helpers (bar.ts, ink-field.ts, parts.tsx,
// reel.tsx) are baselined as unclassified, and its migration decides which are
// shared and which belong to one scene's folder.

/** Project directory name → paths inside the project, e.g. `{ '2026-09-x': ['look.ts'] }`. */
export const DECLARED_SHARED_MODULES: Readonly<Record<string, readonly string[]>> = {};
