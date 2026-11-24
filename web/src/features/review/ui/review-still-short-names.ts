/** Where a file name may be cut between words: after a separator, never inside a word. */
const REVIEW_NAME_SEPARATORS = new Set(['-', '_', '.', ' ']);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};

/**
 * The folder's file names as the grid labels them: the words every name starts with and an extension they all share
 * left out, so `buy-box-og-every-colour-box.png` among `buy-box-…png` reads `og-every-colour-box`. A folder of one,
 * or a name the cut would empty, keeps its whole name.
 */
export function reviewStillShortNames(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  const extension = extensionOf(names[0]);
  const shared = names.every((n) => extensionOf(n) === extension) ? extension : '';
  const stems = names.map((n) => n.slice(0, n.length - shared.length));
  let common = stems[0];
  for (const stem of stems) while (!stem.startsWith(common)) common = common.slice(0, -1);
  // Back to the last separator, so a word the names only start alike (`og-every`, `og-even`) stays whole.
  let cut = common.length;
  while (cut > 0 && !REVIEW_NAME_SEPARATORS.has(common[cut - 1])) cut--;
  return stems.map((stem, i) => (stem.length > cut ? stem.slice(cut) : names[i]));
}
