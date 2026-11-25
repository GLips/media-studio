// subject-painter.ts: the contract a style's painter meets. A painter paints the whole subject in its own strategy
// (it may wash several parts as one) and returns ordinary LayerNode[] as keyed contributions, each in one of the slots
// it declares, back to front, with the targets it paints for provenance. It declares the evidence it reads, the
// options a tune may set per target and the intent fields it interprets; paintSubject refuses the rest.
//
// The context hands it ownership already resolved: what a replacement took over and what is hidden is left out of
// paintedParts and paintedFeatures, so a shared wash is planned without them rather than dropped.

import type { LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { SubjectWithEvidence } from '#lib/paint/subject/models/subject-check.ts';
import type { SubjectEvidenceKind } from '#lib/paint/subject/models/subject-evidence.ts';
import type { SubjectArea, Visible } from '#lib/paint/subject/models/subject-geometry.ts';
import { isSubjectIdText, type SubjectId } from '#lib/paint/subject/models/subject-id.ts';
import { subjectRefKey, type PaintableRef, type Subject, type SubjectFeature, type SubjectHex, type SubjectPart, type SubjectRef } from '#lib/paint/subject/models/subject.ts';

// ---- intent ----------------------------------------------------------------------------------------------------------

/** How much a target stands out against the painter's normal treatment. */
export type SubjectEmphasis = 'subdued' | 'normal' | 'accent';

/** How a target's edge meets what's beside it, softest first. */
export type SubjectEdgeIntent = 'lost' | 'soft' | 'firm' | 'hard';

/**
 * What an author wants of a target, in any painter's terms. `localColor` and `preserveLocalColor` override the
 * material's. A painter declares the fields it interprets; one it doesn't is reported, never silently dropped.
 */
export type SubjectIntent = {
  readonly localColor?: SubjectHex;
  readonly preserveLocalColor?: boolean;
  readonly emphasis?: SubjectEmphasis;
  readonly edge?: SubjectEdgeIntent;
};

export type SubjectIntentField = keyof SubjectIntent;

/** A target's intent with every override applied: the material's colour unless one changed it; `edge` the painter's own when unset. */
export type ResolvedSubjectIntent = {
  readonly localColor: SubjectHex;
  readonly preserveLocalColor: boolean;
  readonly emphasis: SubjectEmphasis;
  readonly edge?: SubjectEdgeIntent;
};

// ---- keys ------------------------------------------------------------------------------------------------------------

declare const subjectPaintKeyBrand: unique symbol;
/** A document key (and seed) built from semantic ids, so it survives hidden parts and reordering. */
export type SubjectPaintKey = string & { readonly [subjectPaintKeyBrand]: true };

/** One step of a key: an operation name (kebab-case, as `local-wash`) or a ref, which prints as `part:belly`. */
export type SubjectKeySegment = string | SubjectRef;

/**
 * The one key builder: `<subject>.<segment>.<segment>…`, as `frog.local-wash.material:skin`. Keys are document keys and
 * seeds both, so equal segments repaint equal marks. Never number contours or pieces; name the operation instead.
 */
export function subjectPaintKey(subject: SubjectId, segments: readonly SubjectKeySegment[]): SubjectPaintKey {
  const text = segments.map((segment) => {
    if (typeof segment !== 'string') return subjectRefKey(segment);
    if (!isSubjectIdText(segment)) throw new Error(`subject painting: key segment '${segment}' isn't kebab-case; name the operation, as 'local-wash'`);
    return segment;
  });
  // SAFETY: every segment is kebab-case or a ref of checked ids, so the key holds no '/', '|', whitespace or leading '#'.
  return [subject, ...text].join('.') as SubjectPaintKey;
}

// ---- painter ---------------------------------------------------------------------------------------------------------

/** A part as the painter paints it: shown, so its geometry is at hand. */
export type VisibleSubjectPart = SubjectPart & { readonly visibility: Visible<SubjectArea> };
/** A feature as the painter paints it: shown, its geometry typed by its kind. */
export type VisibleSubjectFeature = { [K in SubjectFeature['kind']]: Extract<SubjectFeature, { kind: K }> & {
  readonly visibility: Extract<Extract<SubjectFeature, { kind: K }>['visibility'], { kind: 'visible' }>;
} }[SubjectFeature['kind']];

/** Paint for some targets, in one slot. `targets` name what it paints, for ownership checks and provenance. */
export type SubjectContribution<Slot extends string = string> = {
  readonly key: SubjectPaintKey;
  readonly slot: Slot;
  readonly targets: readonly PaintableRef[];
  readonly layers: readonly LayerNode[];
};

/** Something the painter noticed while painting, as a structured report: a warning, or an error that fails the painting. */
export type SubjectPainterReport = { readonly severity: 'error' | 'warning'; readonly address: string; readonly message: string; readonly fix: string };

/**
 * What a painter's `paint` reads: the subject, narrowed to its evidence; options; the key builder; which targets it
 * still paints in each slot (`paintedParts`, `paintedFeatures`: visible and not replaced); each target's resolved
 * intent and options; and `report` for anything it noticed.
 */
export type SubjectPainterContext<S extends Subject, O, Slot extends string> = {
  readonly subject: S;
  /** The painter's defaults with the call's options over them. */
  readonly options: O;
  /** subjectPaintKey for this subject. */
  readonly paintKey: (...segments: readonly SubjectKeySegment[]) => SubjectPaintKey;
  /** Whether the painter paints `target` in `slot`: it shows, and no replacement took it over there. */
  readonly paints: (target: PaintableRef, slot: Slot) => boolean;
  /** The parts the painter paints in `slot`, in declaration order. */
  readonly paintedParts: (slot: Slot) => readonly VisibleSubjectPart[];
  /** The features the painter paints in `slot`, in declaration order. */
  readonly paintedFeatures: (slot: Slot) => readonly VisibleSubjectFeature[];
  readonly intent: (target: PaintableRef) => ResolvedSubjectIntent;
  /** `options` with every tune that reaches `target` over them, its owner part's first. */
  readonly optionsFor: (target: PaintableRef) => O;
  readonly report: (report: SubjectPainterReport) => void;
};

export type SubjectPainterDefinition<O extends object, Slot extends string, Control extends keyof O & string, E extends SubjectEvidenceKind> = {
  /** Kebab-case, as `watercolor`. */
  readonly id: string;
  /** The evidence it reads; a subject without it is refused with `missing-evidence`. */
  readonly evidence: readonly E[];
  readonly defaults: O;
  /** Its slots, back to front: the places a replacement can sit and the order contributions are assembled in. */
  readonly slots: readonly [Slot, ...Slot[]];
  /** Where a replacement of slot `all` sits. */
  readonly replaceAllAt: NoInfer<Slot>;
  /** The options a tune may set per target. */
  readonly controls: readonly Control[];
  /** The intent fields it interprets. */
  readonly intents: readonly SubjectIntentField[];
  /** Problems with options, the call's or a tune's merged over them; each comes back as `invalid-options`. */
  readonly checkOptions?: (options: O) => readonly SubjectPainterReport[];
  readonly paint: (context: SubjectPainterContext<SubjectWithEvidence<E>, O, NoInfer<Slot>>) => readonly SubjectContribution<NoInfer<Slot>>[];
};

/** A painter, as defineSubjectPainter checked it. */
export type SubjectPainter<O extends object = object, Slot extends string = string, Control extends keyof O & string = keyof O & string, E extends SubjectEvidenceKind = SubjectEvidenceKind> =
  SubjectPainterDefinition<O, Slot, Control, E>;

/** Its options type, for a caller typing what it passes. */
export type SubjectPainterOptions<P> = P extends { readonly defaults: infer O } ? O : never;

type PainterDeclaration = {
  readonly id: string; readonly slots: readonly string[]; readonly replaceAllAt: string; readonly controls: readonly string[]; readonly defaults: object;
};

function painterDefinitionProblems(definition: PainterDeclaration): string[] {
  const problems: string[] = [];
  if (!isSubjectIdText(definition.id)) problems.push(`id '${definition.id}' isn't kebab-case`);
  const slots = new Set<string>();
  for (const slot of definition.slots) {
    if (!isSubjectIdText(slot) || slot === 'all') problems.push(`slot '${slot}' isn't a kebab-case name other than 'all'`);
    if (slots.has(slot)) problems.push(`slot '${slot}' is declared twice`);
    slots.add(slot);
  }
  if (!slots.has(definition.replaceAllAt)) problems.push(`replaceAllAt '${definition.replaceAllAt}' isn't one of its slots`);
  for (const control of definition.controls) if (!(control in definition.defaults)) problems.push(`control '${control}' has no default`);
  return problems;
}

/**
 * A painter for any subject carrying its evidence. Curried so `O` is named and the rest inferred:
 * `defineSubjectPainter<WatercolorOptions>()({ id: 'watercolor', … })`. Throws on a malformed declaration.
 */
export const defineSubjectPainter = <O extends object>() =>
  <const Slot extends string, const Control extends keyof O & string = never, const E extends SubjectEvidenceKind = never>(
    definition: SubjectPainterDefinition<O, Slot, Control, E>,
  ): SubjectPainter<O, Slot, Control, E> => {
    const problems = painterDefinitionProblems(definition);
    if (problems.length) throw new Error(`subject painter '${definition.id}': ${problems.join('; ')}`);
    return definition;
  };
