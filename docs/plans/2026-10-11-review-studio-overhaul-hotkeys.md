# Review studio overhaul: hotkeys (design input to the plan)

TanStack Hotkeys report (@tanstack/react-hotkeys 0.10.0 on core @tanstack/hotkeys 0.8.0, read from the installed .d.ts files and dist source)

**Where we stand.** We barely use it. `use-review-hotkeys.ts` makes one `useHotkeys([...])` call with no `meta`, no `HotkeysProvider`, no sequences, no held-key state and no registrations read-back. `HotkeysProvider` appears nowhere else in `web/src`.

**What the library offers**

- **Registering**
  - `useHotkey(hotkey, cb, opts)` and `useHotkeys(defs[], commonOptions)`. Options merge in this order: Provider defaults, then `commonOptions`, then each definition's own.
  - Callbacks and options are re-synced on every render, so there are no stale closures.
  - `enabled: false` is a soft disable: the registration stays in the store and just doesn't fire.
  - A hotkey is a string (`'Mod+S'`) or a `RawHotkey` object (`{ key, mod, ctrl, shift, alt, meta }`).
- **`HotkeyOptions`**: `enabled`, `eventType: 'keydown'|'keyup'`, `ignoreInputs`, `preventDefault` (default true), `stopPropagation` (default true), `requireReset` (fires once until the keys are released), `target`, `platform`, `conflictBehavior: 'warn'|'error'|'replace'|'allow'`, and `meta: HotkeyMeta` (`{ name, description }`, which we can extend with declaration merging).
- **`ignoreInputs` default** (`getDefaultIgnoreInputs`):
  - It is `false` for Ctrl/Meta combos and for `Escape`, so Esc fires inside textareas by default. That is the draft-drop bug. The fix is `ignoreInputs: true` on Esc, with the composer handling its own Esc.
  - It is `true` for single keys and Shift/Alt combos.
  - `isInputElement` treats every `<input>` except button/submit/reset as an input, radios included. That explains "proof-ground radios swallow hotkeys after click": a focused radio makes every unmodified key get ignored. Fix: use `SegmentedControl` or buttons, or blur after a change.
- **Scopes**
  - There is no scope stack. A scope is just a `target` (element or ref): listeners attach to that element, and the event has to come from inside it.
  - Every matching registration on the same target fires. Conflicts are detected only for the same hotkey on the same target.
  - Because `stopPropagation` defaults to true, an element-scoped registration hides a document-level one with the same key from events inside that element. That is the only precedence there is.
  - So "contexts" are something we build ourselves, using `enabled` flags plus `target`.
- **Sequences**: `useHotkeySequence(['G','N'], cb, { timeout })` and `useHotkeySequences(defs[])`. Steps can carry modifiers; a bare modifier press doesn't advance or reset a sequence. `SequenceRegistrationView` includes `matchedStepCount`, which we can use to show a pending "g…" indicator.
- **Key state**
  - `useKeyHold(key)` returns a boolean. `useHeldKeys()` and `useHeldKeyCodes()` return arrays. `getKeyStateTracker()` exposes `isKeyHeld`, `areAllKeysHeld` and `isAnyKeyHeld`, and clears held keys on window blur.
  - There is no hold-duration API. Hold-to-flip compare is `useKeyHold('Backslash')` (or a keyup registration). K+J / K+L is `useKeyHold('K')` read inside the J/L callbacks.
  - Auto-repeat isn't filtered: holding a key re-fires keydown. That's fine for frame stepping. J/K/L shuttle needs `requireReset: true`.
- **Cheatsheet**
  - `useHotkeyRegistrations()` returns `{ hotkeys: HotkeyRegistrationView[], sequences: SequenceRegistrationView[] }`, without callbacks, with `options.meta`, `options.enabled` and `triggerCount`. It needs no Provider.
  - `formatForDisplay(hotkey, { platform, useSymbols, separatorToken })` renders ⌘⇧ on Mac. `formatHotkeySequence(seq)` covers sequences.
- **Recorder**: `useHotkeyRecorder` and `useHotkeySequenceRecorder` exist. We don't need them now.

**Proposed structure**

One registry module per screen: `review-hotkeys.ts` for the review screen and `projects-hotkeys.ts` for the index. Each exports a hook that registers everything with `meta.group` and `meta.name`, plus a pure `hotkeyGroups` order for the cheatsheet.

```ts
// web/src/app/hotkey-meta.d.ts
declare module '@tanstack/hotkeys' {
  interface HotkeyMeta { group: 'playback' | 'notes' | 'compare' | 'decision' | 'navigate'; name: string }
}
```

```ts
// review-hotkeys.ts
export function useReviewHotkeys(c: { playback; notes; compare; decision; mode: ReviewMode }) {
  const on = (...modes: ReviewMode[]) => ({ enabled: modes.includes(c.mode) });
  const step = (by: number) => (e: KeyboardEvent) =>
    c.playback.seekBy(e.shiftKey ? by * 10 : by);
  useHotkeys([
    { hotkey: 'Space', callback: c.playback.toggle, options: { meta: { group: 'playback', name: 'Play/pause' } } },
    { hotkey: 'J', callback: () => c.playback.shuttle(useKeyHoldRef.K ? -0.25 : -1), options: { requireReset: true, meta: { group: 'playback', name: 'Reverse' } } },
    { hotkey: 'ArrowLeft', callback: step(-1), options: { meta: { group: 'playback', name: 'Frame back' } } },
    { hotkey: 'N', callback: c.notes.startAtPlayhead, options: { meta: { group: 'notes', name: 'Note at playhead' } } },
    { hotkey: 'R', callback: c.notes.resolveFocused, options: { ...on('notes'), meta: { group: 'notes', name: 'Resolve' } } },
    { hotkey: '1', callback: () => c.decision.pick(0), options: { ...on('decision'), meta: { group: 'decision', name: 'Pick A' } } },
    { hotkey: 'Shift+/', callback: c.toggleCheatsheet, options: { meta: { group: 'navigate', name: 'Shortcuts' } } },
  ], { conflictBehavior: 'error' });
  useHotkeySequences([
    { sequence: ['G', 'N'], callback: c.notes.focusList, options: { meta: { group: 'navigate', name: 'Go to notes' } } },
  ]);
}
```

- **Contexts**: one `mode` (`'playback' | 'notes' | 'compare' | 'decision'`) derived from screen state toggles `enabled`. Each keyboard event then has exactly one owner, and `conflictBehavior: 'error'` catches real double-binds in dev. The note composer registers its own Esc and Mod+Enter with `target: composerRef`, which hides the global Esc. The global Esc gets `ignoreInputs: true` and never drops a draft.
- **Hold**: `const flipped = useKeyHold('Backslash')` drives compare A/B directly. For K+J/K+L, the callbacks call `getKeyStateTracker().isKeyHeld('K')`, so no state has to be read at render time. `useKeyHoldRef.K` in the sketch is a stand-in for this call.
- **Cheatsheet**:

```tsx
const { hotkeys, sequences } = useHotkeyRegistrations();
const rows = [...hotkeys.map(h => ({ meta: h.options.meta, keys: formatForDisplay(h.hotkey), on: h.options.enabled })),
              ...sequences.map(s => ({ meta: s.options.meta, keys: formatHotkeySequence(s.sequence), on: s.options.enabled }))];
// group by meta.group, dim rows with on === false
```

  The same rows feed inline `<Kbd>` hints in tooltips, looked up by `meta.name`, so labels never drift from the bindings.
- **Shift+punctuation**: keep the current raw `{ key: ',', shift: true }` spelling (the typed spellings leave out shifted punctuation). Or, as in the sketch, bind once and read `e.shiftKey`, which halves the registrations.
- **Provider**: wrap the app in `HotkeysProvider defaultOptions={{ hotkey: { conflictBehavior: 'error' } }}`.

Context7 wasn't queried. Everything above comes from the installed `.d.ts` files and the core `dist` source. Files read:
- /Users/graham/Programming/media-studio-review/node_modules/@tanstack/react-hotkeys/dist/*.d.ts
- /Users/graham/Programming/media-studio-review/node_modules/@tanstack/hotkeys/dist/{hotkey-manager,manager.utils,sequence-manager,hotkey,format,key-state-tracker}.*
- /Users/graham/Programming/media-studio-review/web/src/features/review/ui/use-review-hotkeys.ts