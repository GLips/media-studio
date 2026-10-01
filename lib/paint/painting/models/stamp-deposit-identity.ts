// stamp-deposit-identity.ts: who a deposit is, apart from how it came to be written.
//
// A deposit's identity is `group/passage/name`, unique in the painting, and it seeds the deposit's randomness. Its
// name is the ID its author wrote and, for a deposit a technique generates, the semantic keys that pick it out among
// that invocation's children (a charge's touch k), held apart rather than spliced into the ID. Its provenance, the
// applications it was written under, rides beside and never enters a seed, so organising paint moves none of it.

/** A deposit's name in its passage: the ID written, then a generated child's keys, the invocation's first. */
export type StampDepositName = { id: string; keys: readonly string[] };

/** The passage a deposit is written in: the first two segments of its identity. */
export type StampPassageIdentity = { group: string; passage: string };

/**
 * A name as it seeds: a child's keys follow its invocation's ID after `-` (`warm-3`). An authored ID may hold a `-`
 * too, so `warm-3` written beside a charge `warm` collides; the compiler refuses that as an ID used twice.
 */
export const stampDepositNameText = ({ id, keys }: StampDepositName) => [id, ...keys].join('-');

/** A deposit's full ID, `group/passage/name`: unique in the painting, the seed of every stamp in it. */
export const stampDepositId = ({ group, passage }: StampPassageIdentity, name: StampDepositName) => `${group}/${passage}/${stampDepositNameText(name)}`;

/** `segment` refused unless it's non-empty and holds no `/` or `|`, the separators of a full ID and of a seed. */
export function checkedStampIdSegment(segment: string): string {
  if (!segment || /[/|]/.test(segment)) throw new Error(`stamp paint: "${segment}" isn't an ID: IDs are non-empty and hold no "/" or "|"`);
  return segment;
}
