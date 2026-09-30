// ─── TEMPORARY: the paths vid-108 is restructuring, held out of vid-107's rules ──
//
// vid-107 switched the quality rules on for all TypeScript. These paths were
// mid-restructure under vid-108 at the time, and a baselined finding in a file
// it moves turns stale or new under its next commit. So the rules vid-107
// switched on skip them entirely: neither baselined nor fixed. The studio's own
// checks still govern them. Delete this module when vid-108 lands.

export const HELD_OUT_UNTIL_VID_108_PATHS: readonly string[] = [
  'lib/picture/stamp-paint/',
  'lib/picture/stamp-styles/',
  'lib/picture/photoshop-brushes/',
  'lib/picture/procreate-brushes/',
  'lib/picture/brush-fidelity/',
  'lib/picture/stamp-reference/',
  'lib/platform/photoshop/',
  // Their harness entry points, which vid-108 edits with them.
  'harness/brush-fidelity.ts',
  'harness/stamp-paint-guard.ts',
  'harness/stamp-reference.ts',
];

/** The structural checks vid-107 switched on for all TypeScript: the only ones the paths above are held out of. */
export const HELD_OUT_UNTIL_VID_108_CHECKS: ReadonlySet<string> = new Set([
  'file-size', 'trampolines', 'doc-budgets', 'barrel-discoverability', 'test-file-mirror', 'feature-visibility', 'feature-cycles',
  'typed-tree', 'no-opaque-record', 'no-widen-then-assert', 'no-known-value-widening', 'no-broad-parameters',
  'no-unknown-returns', 'no-unknown-type-aliases', 'no-runtime-typeof', 'no-test-imports',
]);

export function isHeldOutUntilVid108(check: string, path: string): boolean {
  return HELD_OUT_UNTIL_VID_108_CHECKS.has(check) && HELD_OUT_UNTIL_VID_108_PATHS.some((held) => path.startsWith(held));
}
