// subject-tags.ts: the tags with a meaning every painter shares. A subject's tags are its own words (`belly`,
// `marking`); these few are the vocabulary a painter reads to paint a target as something particular, so a subject
// that wants its eyes painted as eyes tags them with these.

/**
 * Well-known tags. `eye`: a part or feature painted as an eye, with an iris, a pupil and a glint. `pupil`: a region
 * drawn as an eye's pupil; an eye whose part carries one is painted as the design draws it. `cheek`: a landmark
 * painted as a blush.
 */
export const SUBJECT_WELL_KNOWN_TAGS = { eye: 'eye', pupil: 'pupil', cheek: 'cheek' } as const;

export type SubjectWellKnownTag = (typeof SUBJECT_WELL_KNOWN_TAGS)[keyof typeof SUBJECT_WELL_KNOWN_TAGS];

/** Whether `target` carries `tag`. */
export const hasSubjectTag = (target: { readonly tags: readonly string[] }, tag: SubjectWellKnownTag) => target.tags.includes(tag);
