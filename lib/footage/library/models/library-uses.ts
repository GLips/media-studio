// library-uses.ts: which library items a project's source refers to. A project reaches an item only by importing its
// committed metadata as `#library/<id>/item.json` (or transcript.json), so those specifiers are the whole record of
// who uses what: nothing else is kept to fall out of date.

// A quoted specifier under #library/, as a static import, an export-from or a dynamic import writes it.
const LIBRARY_SPECIFIER = /["'`]#library\/([^/"'`]+)\//g;

/** The ids of the library items `source`, a module's text, imports from; none for a module that imports none. */
export function libraryItemsImportedBy(source: string): Set<string> {
  return new Set(Array.from(source.matchAll(LIBRARY_SPECIFIER), (match) => match[1]));
}
