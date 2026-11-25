/** Where a name breaks into words: a dash, an underscore, a space or a slash. Not a dot, which starts an extension. */
export const STUDIO_NAME_BREAK = /[-_ /]/;

/** The start every name shares, cut back to its last word break so no word is split; none for fewer than two names. */
export function studioSharedNameStartOf(names: readonly string[]): string {
  if (names.length < 2) return '';
  let shared = names[0];
  for (const name of names) {
    let i = 0;
    while (i < shared.length && i < name.length && shared[i] === name[i]) i += 1;
    shared = shared.slice(0, i);
  }
  let cut = shared.length;
  while (cut > 0 && !STUDIO_NAME_BREAK.test(shared[cut - 1])) cut -= 1;
  return shared.slice(0, cut);
}

/** How one of a run of sibling names shows: `shown` without the run's shared start, split so its end stays visible. */
export type StudioSiblingName = {
  /** What tells it apart: the name less the start every sibling shares. */
  readonly shown: string;
  /** All of `shown` but its last word: what truncates, with an ellipsis, when the name doesn't fit. */
  readonly head: string;
  /** Its last word and extension (`-detail.jpg`), always shown whole. */
  readonly tail: string;
};

/**
 * A name as a grid of its siblings shows it: `03-menu-appstore-iphone-detail.jpg` among `03-menu-appstore-iphone-*`
 * reads `detail.jpg`, and a long one keeps its end in view while its middle gives way. `siblings` includes the name.
 */
export function studioSiblingNameOf(name: string, siblings: readonly string[]): StudioSiblingName {
  const prefix = studioSharedNameStartOf(siblings);
  // A name that is the shared start itself, or wholly inside it, shows whole.
  const shown = prefix.length < name.length && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const extension = /\.[^./]+$/.exec(shown)?.[0] ?? '';
  const stem = shown.slice(0, shown.length - extension.length);
  let lastBreak = stem.length - 1;
  while (lastBreak > 0 && !STUDIO_NAME_BREAK.test(stem[lastBreak])) lastBreak -= 1;
  const split = lastBreak > 0 ? lastBreak : 0;
  return { shown, head: shown.slice(0, split), tail: shown.slice(split) };
}
