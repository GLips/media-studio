import type { DrawingSchedule } from '#lib/timing/drawings/models/drawing-schedule.ts';
import type { LayerNode, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { ShotEffectImage } from '#lib/paint/shot/models/shot-effect.ts';
import { requireSubjectEvidence, type SubjectWithEvidence } from '#lib/paint/subject/models/subject-check.ts';
import { SubjectDiagnosticError } from '#lib/paint/subject/models/subject-diagnostic.ts';
import type { SubjectEvidenceKind } from '#lib/paint/subject/models/subject-evidence.ts';
import type { Subject } from '#lib/paint/subject/models/subject.ts';

/** The schedule supplying mark tokens to the layers this step draws. */
export type LookRedraw = DrawingSchedule;

type DrawSettings = { readonly redraw?: LookRedraw };
type LookDraw<N extends string, P extends object> = {
  readonly kind: 'draw';
  readonly name: N;
  readonly description: string;
  readonly params: Readonly<P> & DrawSettings;
  readonly changed: readonly string[];
  readonly draw: (subject: Subject) => readonly LayerNode[];
  with(fields: Partial<P> & DrawSettings): LookDraw<N, P>;
};

/** A named subject-local pass. Its settings are the fields a derivation may change independently. */
export function lookDraw<const N extends string, P extends object, E extends SubjectEvidenceKind = never>(
  name: N, description: string, params: P & DrawSettings, draw: (subject: SubjectWithEvidence<E>, params: P) => readonly LayerNode[],
  evidence: readonly E[] = [],
): LookDraw<N, P> {
  function resolve(settings: P & DrawSettings): LookDraw<N, P> {
    // SAFETY: each key belongs to these settings, copied from the declared parameters plus redraw.
    const keys = Object.keys(settings) as (keyof typeof settings & string)[];
    return { kind: 'draw', name, description, params: settings, changed: keys.filter(key => settings[key] !== params[key]),
      draw(subject) {
        const checked = requireSubjectEvidence(subject, evidence, name);
        if (!checked.ok) throw new SubjectDiagnosticError(`look draw '${name}'`, checked.diagnostics);
        return draw(checked.value, settings);
      },
      with(fields) {
        for (const key of Object.keys(fields)) {
          if (key !== 'redraw' && !Object.hasOwn(params, key)) throw new Error(`unknown look field '${name}.${key}'`);
        }
        return resolve({ ...settings, ...fields });
      },
    };
  }
  return resolve(params);
}

/** A placed sheet reads draws in deposit order. An image placement reads one sharp image. */
export type LookPlace<N extends string = string> = { readonly kind: 'place'; readonly name: N } & (
  { readonly sheet: readonly string[]; readonly paper: PaintingDocument['paper']; readonly medium: PaintingDocument['medium'] } | { readonly image: string }
);

/** A sharp image operation names each upstream image, including placed images in stage space. */
export type LookProcess = Pick<ShotEffectImage, 'definition' | 'params'> & {
  readonly kind: 'process'; readonly name: string; readonly inputs: Readonly<Record<string, string>>; readonly space: 'stage' | 'local';
};

export type LookStep = LookDraw<string, object> | LookPlace | LookProcess;

/** Checks all connections, including unused steps, before any drawing runs. */
export function checkLookGraph(steps: readonly LookStep[], show: readonly string[]): void {
  const named = new Map<string, LookStep>();
  for (const step of steps) {
    if (named.has(step.name)) throw new Error(`duplicate look step '${step.name}'`);
    named.set(step.name, step);
  }
  const done = new Set<string>(), visiting = new Set<string>();
  function read(owner: string, name: string, expected: readonly LookStep['kind'][]) {
    const step = named.get(name);
    if (!step) throw new Error(`${owner} reads unknown step '${name}'`);
    if (visiting.has(name)) throw new Error(`look cycle: ${[...visiting, name].join(' -> ')}`);
    if (!expected.includes(step.kind)) throw new Error(`${owner} reads '${name}' (${step.kind}), expected ${expected.join(' or ')}`);
    visit(step);
  }
  function visit(step: LookStep) {
    if (done.has(step.name)) return;
    visiting.add(step.name);
    if (step.kind === 'place' && 'sheet' in step) {
      if (new Set(step.sheet).size !== step.sheet.length) throw new Error(`duplicate draw in ${step.name}.sheet`);
      for (const name of step.sheet) read(`${step.name}.sheet`, name, ['draw']);
    } else if (step.kind === 'place') read(`${step.name}.image`, step.image, ['process', 'place']);
    else if (step.kind === 'process') for (const [input, name] of Object.entries(step.inputs)) read(`${step.name}.${input}`, name, ['process', 'place']);
    visiting.delete(step.name);
    done.add(step.name);
  }
  steps.forEach(visit);
  if (new Set(show).size !== show.length) throw new Error('duplicate placed step in show');
  show.forEach((name) => read('show', name, ['place']));
}
