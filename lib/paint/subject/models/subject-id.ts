// subject-id.ts: the names a subject's pieces go by. Every id is a branded string in one kebab-case grammar, so a
// part's id can't be handed where a feature's is wanted, and every key and seed built from ids is a valid document
// key. Ids are semantic: a part keeps its id while it is hidden, and nothing is ever addressed by index.

declare const subjectIdKind: unique symbol;
export type SubjectIdKind = 'subject' | 'part' | 'feature' | 'material' | 'frame' | 'feature-group' | 'tag';
/** A string that has passed the id grammar for one kind of id. */
export type SubjectIdOf<K extends SubjectIdKind> = string & { readonly [subjectIdKind]: K };

/** A subject's id, kebab-case: the first segment of every key its painting makes. */
export type SubjectId = SubjectIdOf<'subject'>;
/** A part's id, kebab-case, stable while the part is hidden: `glove-left`, `head`. */
export type PartId = SubjectIdOf<'part'>;
/** A feature's id, kebab-case: a line, region or landmark on its owner part, as `mouth` or `brow-left`. */
export type FeatureId = SubjectIdOf<'feature'>;
/** A material's id, kebab-case: what parts wear, holding a local colour, as `skin` or `brand-blue`. */
export type MaterialId = SubjectIdOf<'material'>;
/** A local frame's id, kebab-case, as `face`: where a replacement paints in the subject's own coordinates. */
export type FrameId = SubjectIdOf<'frame'>;
/** A set of features painted or replaced together, such as `face`. */
export type FeatureGroupId = SubjectIdOf<'feature-group'>;
/** What a part or feature is in the subject's anatomy (`eye`, `belly`, `glove`): an open vocabulary painters interpret. */
export type SubjectTag = SubjectIdOf<'tag'>;

/**
 * The literal ids a subject was declared with, carried on its type so a selector naming an id the subject lacks is a
 * compile error. A subject built from data (a mesh's materials) carries plain `string`s and is checked at run time.
 */
export type SubjectIds = {
  readonly part: string;
  readonly feature: string;
  readonly material: string;
  readonly frame: string;
  readonly group: string;
  readonly tag: string;
};

/** Lowercase words joined by single hyphens: valid in a document key, and readable in a diagnostic. */
const SUBJECT_ID_GRAMMAR = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const isSubjectIdText = (text: string): boolean => SUBJECT_ID_GRAMMAR.test(text);

/** Why `text` isn't an id, for a diagnostic's message. */
export const subjectIdGrammarMessage = (text: string) =>
  `'${text}' isn't an id: one is lowercase words of letters and digits joined by single hyphens, starting with a letter`;

/** `text` as an id of `kind`, once isSubjectIdText has passed it: constructors check, then brand. */
export const subjectIdFromChecked = <K extends SubjectIdKind>(kind: K, text: string): SubjectIdOf<K> =>
  // SAFETY: every caller has checked `text` with isSubjectIdText, or looks it up in a subject, whose ids all passed.
  text as SubjectIdOf<K>;
