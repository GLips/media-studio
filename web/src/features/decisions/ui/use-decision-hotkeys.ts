import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { decisionCandidateBeside } from './decision-two-up-pair.ts';
import type { DecisionScreenValue } from './decision-screen-context.tsx';

/** How many candidates the number keys reach: `1`–`9`. */
export const DECISION_NUMBER_KEYS = 9;

const decisionKey = (hotkey: UseHotkeyDefinition['hotkey'], name: string, callback: (event: KeyboardEvent) => void, ignoreInputs?: boolean): UseHotkeyDefinition =>
  ({ hotkey, callback, options: { ...(ignoreInputs !== undefined && { ignoreInputs }), meta: { group: 'decision', name } } });

/** The cheatsheet's and the tooltips' name for a number key: `Candidate A`. */
export const decisionCandidateKeyName = (key: string) => `Candidate ${key.toUpperCase()}`;

/**
 * Lightroom's culling: `←` `→` `1`–`9` move focus, `P` `X` `U` judge it, `Enter` two-ups it, `Escape` surveys, `F`
 * shows picks only, `Mod+Enter` signs off and opens the next open decision; `↑` `↓` step the queue, as the plan's
 * scenes. Left out: judging once closed, keys past the last candidate or either end of the queue.
 */
export function useDecisionHotkeys(screen: DecisionScreenValue) {
  const { decision, shown, focused, pair, search, setSearch, decide, signOff, playback, focus, openTwoUp, pass, topic, openDecision } = screen;
  const twoUp = search.view === 'two';
  const keys = (twoUp ? decision.candidates : shown).map((c) => c.key);
  const stepTo = (from: string) => (direction: -1 | 1) => () => {
    const stays = twoUp ? pair.find((k) => k !== from) : undefined;
    const to = decisionCandidateBeside(keys, from, direction, stays);
    if (to !== undefined) focus(to);
  };

  const defs: UseHotkeyDefinition[] = [
    ...decision.candidates.slice(0, DECISION_NUMBER_KEYS).map((c, i) =>
      // SAFETY: i is under 9, so `i + 1` is one of the digit keys the Hotkey type spells.
      decisionKey(String(i + 1) as UseHotkeyDefinition['hotkey'], decisionCandidateKeyName(c.key), () => focus(c.key))),
    decisionKey('F', 'Picks only', () => setSearch({ filter: search.filter === 'picks' ? undefined : 'picks' })),
  ];
  const at = pass.decisions.findIndex((d) => d.topic === topic);
  const before = pass.decisions[at - 1], after = pass.decisions.at(at + 1);
  // Only in story order: a step taken while the storyboard loads would follow the posting order.
  if (before && pass.ordered) defs.push(decisionKey('ArrowUp', 'Previous decision', () => openDecision(before.topic)));
  if (after && pass.ordered) defs.push(decisionKey('ArrowDown', 'Next decision', () => openDecision(after.topic)));
  // Escape, not a letter: the cards are lettered A, B, … so a letter key reads as a candidate. Not from a field, which
  // Escape leaves.
  if (twoUp) defs.push(decisionKey('Escape', 'Survey', () => openTwoUp(null), true));
  if (focused !== null) {
    const step = stepTo(focused);
    defs.push(
      decisionKey('Space', 'Play', playback.toggle),
      decisionKey('ArrowLeft', 'Previous candidate', step(-1)),
      decisionKey('ArrowRight', 'Next candidate', step(1)),
      decisionKey('Enter', 'Two-up', () => openTwoUp(focused)),
    );
  }
  if (decision.state === 'open') {
    const verdict = (v: 'pick' | 'reject' | null) => () => {
      if (focused !== null) decide([{ op: 'decision.verdict', id: decision.id, candidate: focused, verdict: v }]);
    };
    defs.push(
      decisionKey('P', 'Pick', verdict('pick')),
      decisionKey('X', 'Reject', verdict('reject')),
      decisionKey('U', 'Unflag', verdict(null)),
      // Not from inside the thread's composer, whose own Mod+Enter saves the note. A held key's repeats are dropped:
      // signing off opens the next decision, which a repeat would sign off unseen.
      decisionKey('Mod+Enter', 'Sign off', (event) => {
        if (!event.repeat) signOff();
      }, true),
    );
  }
  useHotkeys(defs);
}
