// plan-notes.ts: the plan's notes as the page draws them. A plan note is placed on the storyboard as it reads now
// (review-plan.ts), shown beside what it quotes and listed in the thread; a new one is anchored on what the reviewer
// selected or clicked, by the words it quotes, never by their positions.
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { findReviewPlanQuote, placeReviewPlanThread, reviewPlanFieldText, reviewPlanNotePlacementOf, type ReviewPlanPlacement } from '#lib/output/review/models/review-plan.ts';
import { REVIEW_THREAD_TONES, reviewThreadTone, type ReviewFile, type ReviewPlanAnchor, type ReviewThread, type ReviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import type { ProjectStoryboard } from '#web/features/storyboard/index.ts';

/** A plan thread placed on the storyboard: the review panel's placement, and where on the page it shows. */
export type PlanPlacedThread = PlacedReviewThread & {
  anchor: ReviewPlanAnchor;
  plan: ReviewPlanPlacement;
};

/** Every plan thread in `file`, placed on `plan`; a note whose scene, line or quote is gone carries why as `unplaced`. */
export function placePlanThreads(file: ReviewFile, { storyboard, resolved }: ProjectStoryboard): PlanPlacedThread[] {
  return file.threads.flatMap((thread): PlanPlacedThread[] => {
    const { anchor } = thread;
    if (anchor.on !== 'plan') return [];
    const placed = placeReviewPlanThread(anchor, storyboard, resolved);
    const why = reviewPlanNotePlacementOf(anchor, storyboard, resolved);
    const pinned = placed.frame === null ? { shifted: false } : { frame: placed.frame, shifted: false };
    const placement = 'unplaced' in why ? why : pinned;
    return [{ ...thread, anchor, placement, plan: placed }];
  });
}

/** Open notes that stop a sign-off at the first `S`: on the scene, neither resolved nor a standing `keep`. */
export const planSceneOpenNoteCount = (threads: readonly PlanPlacedThread[] | undefined, scene: string) =>
  (threads ?? []).filter((t) => t.plan.scene === scene && t.state !== 'resolved' && t.kind !== 'keep').length;

/** What a new note is about, before its quote: a cell, a line, a brief section or a left-out item. */
export type PlanTarget =
  | { field: 'scene' | 'onScreen' | 'motion' | 'reads'; scene: string }
  | { field: 'line'; scene: string; line: string }
  | { field: 'brief'; section: string }
  | { field: 'leftOut'; item: number };

/** The attributes a target's element carries, so a selection inside it finds what it's in. */
export const planTargetAttributes = (target: PlanTarget) => ({ 'data-plan-target': JSON.stringify(target) });

/** The target an element is inside, by its nearest `data-plan-target`. */
export function planTargetOfElement(element: Element | null): PlanTarget | null {
  const raw = element?.closest<HTMLElement>('[data-plan-target]')?.dataset.planTarget;
  // SAFETY: only planTargetAttributes writes the attribute, always a JSON PlanTarget.
  return raw ? (JSON.parse(raw) as PlanTarget) : null;
}

const elementOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement ?? null);

/** Marks text that is the page's, not the plan's (a note's mark, a cue's tag): a quote never takes it. */
export const planUnquotedAttributes = { 'data-plan-unquoted': '' } as const;

/** The elements whose edges part a cell's words, so two selected paragraphs quote as `end. Start`, not `end.Start`. */
const PLAN_TEXT_BLOCKS = 'p, li, div, h1, h2, h3, h4, h5, h6, blockquote, pre';

/**
 * What `range` quotes inside `target`. In a line, the words it touches, whole and in order: a cue chip sits beside its
 * word, not in it, so it never joins. Elsewhere the selected text, less what the page adds, its blocks parted by spaces.
 */
function planQuoteIn(target: Element, range: Range): string {
  const words = [...target.querySelectorAll('[data-word]')];
  if (words.length) return words.filter((word) => range.intersectsNode(word)).map((word) => word.textContent ?? '').join(' ');
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let quote = '', block: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || node.parentElement?.closest('[data-plan-unquoted]')) continue;
    const text = node.textContent ?? '';
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : text.length;
    const nodeBlock = node.parentElement?.closest(PLAN_TEXT_BLOCKS) ?? null;
    quote += (block !== null && nodeBlock !== block ? ' ' : '') + text.slice(from, to);
    block = nodeBlock;
  }
  return quote.replace(/\s+/g, ' ').trim();
}

/** The selection's quote and the target it lies in, when it lies within one target of `root`; null otherwise. */
export function planSelectionIn(root: HTMLElement): { target: PlanTarget; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode)) return null;
  const a = elementOf(selection.anchorNode)?.closest('[data-plan-target]'), b = elementOf(selection.focusNode)?.closest('[data-plan-target]');
  if (!a || a !== b) return null;
  const target = planTargetOfElement(a);
  const text = planQuoteIn(a, selection.getRangeAt(0));
  return target && text ? { target, text } : null;
}

/** What a new note on `target` quotes, `text` (a left-out note always quotes its item). */
function planQuotedAnchorOf(target: PlanTarget, text: string | null, plan: ProjectStoryboard): ReviewPlanAnchor {
  const quote = text ? { text } : {};
  switch (target.field) {
    case 'brief': return { on: 'plan', field: 'brief', section: target.section, ...quote };
    case 'leftOut': return { on: 'plan', field: 'leftOut', text: plan.storyboard.leftOut?.[target.item] ?? text ?? '' };
    case 'line': return { on: 'plan', field: 'line', scene: target.scene, line: target.line, ...quote };
    default: return { on: 'plan', field: target.field, scene: target.scene, ...quote };
  }
}

/** A new plan note's anchor, with its field's whole text as it is now (`was`), so the note shows what changes after. */
export function planNoteAnchorOf(target: PlanTarget, text: string | null, plan: ProjectStoryboard): ReviewPlanAnchor {
  const anchor = planQuotedAnchorOf(target, text, plan);
  const was = reviewPlanFieldText(plan.storyboard, anchor);
  return { ...anchor, ...(was !== undefined && { was }) };
}

/** True when `anchor` is about `target`: the cell, line, section or item it was written on. */
export function planAnchorOn(anchor: Partial<ReviewPlanAnchor>, target: PlanTarget, leftOut: readonly string[] | undefined): boolean {
  if (anchor.field !== target.field) return false;
  switch (target.field) {
    case 'brief': return anchor.section === target.section;
    case 'leftOut': {
      // As placeReviewPlanThread marks it: on the item its quote is in, and one that quotes nothing on none.
      const item = leftOut?.[target.item];
      return item !== undefined && anchor.text !== undefined && findReviewPlanQuote(item, anchor.text) !== null;
    }
    case 'line': return anchor.line === target.line && anchor.scene === target.scene;
    default: return anchor.scene === target.scene;
  }
}

/** How a thread's state reads beside its anchor: the colour role it takes, and its word. */
export type PlanThreadMark = { tone: 'accent' | 'pass' | 'caution' | 'dim'; word: string };

const PLAN_THREAD_COLOURS: Readonly<Record<ReviewThreadTone, PlanThreadMark['tone']>> = {
  open: 'accent', addressed: 'pass', asks: 'caution', keep: 'dim', resolved: 'dim',
};

export function planThreadMarkOf(thread: Pick<ReviewThread, 'kind' | 'state' | 'entries'>): PlanThreadMark {
  const tone = reviewThreadTone(thread);
  return { word: REVIEW_THREAD_TONES[tone].word, tone: PLAN_THREAD_COLOURS[tone] };
}
