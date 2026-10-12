# Review studio overhaul: ui-spec (design input to the plan)

# Review studio: synthesized UI spec

## Scores

Each proposal was scored from 1 to 5 against eight criteria.

| | nle | devtool | minimal |
|---|---|---|---|
| Fixes every verbatim complaint | 5 | 5 | 5 |
| Density | 4 (7 lanes, 160px dock) | 5 | 4 (40px bar) |
| Affordances work without labels | 4 (glyph gutter) | 5 (hollow marks that fill on hover, ghost line) | 4 (hover key hints) |
| Fits 1440×720 | 4 (viewer 496) | 5 (stage 516) | 5 |
| Colour discipline | 2 (accent means both playhead and open note; adds a new blue) | 5 (colour = note state only) | 3 (cobalt does 3 jobs) |
| Coherent across screens | 4 | 5 | 3 (thin decisions and script) |
| Buildable in Mantine 9 + StyleX | 4 | 4 | 4 |
| Agent loop is prominent | 3 (thread shares a tabbed panel) | 5 (full-height thread) | 4 |

**Devtool is the base.** Its full-height thread puts the agent conversation first, which is the highest-leverage feature. Its rule that colour means state settles the "yellow dots" complaint for good.

**Grafted from the other two:**
- From nle: beats as ruler ticks, ⌘K quick-open, the lane-glyph gutter, the I/O band across every lane, and the richer URL model.
- From minimal: a hover frame preview in place of a pictures lane, the playhead halo, an Unplaced group with Re-pin, save state shown only on failure, key hints in tooltips, and fade edges on scrolling panels.

## 1. Shell (every screen)

```
┌ ◂ motion-showcase / video.mp4 ▾   r14 ▾ 3a9f2c*   [r15 ↻]          ◆   ⌘K  ? ┐ 28
```
- `◂` goes up one level (also `Mod+ArrowUp`). The file name opens a menu of files. `r14 ▾` opens render history: a thumbnail, commit and age per row. `*` marks a dirty tree.
- `[r15 ↻]` appears only when a newer render exists while a draft is open. With no draft open, the new render loads silently and `f` is re-placed by moment.
- `◆` shows agent presence: cream while a `studio review watch` heartbeat is fresh, `dim` otherwise. The tooltip reads `watching since 12:04`.
- Save state has no indicator while saving works. On failure, `danger` text `not saved · retry` appears and stays until a save succeeds.
- If-Match conflicts reload and merge with no UI.
- No page scrolls. The app is a `100dvh` grid with no width cap. Only the thread, the grids and the script scroll, and each one shows fade edges.

## 2. Video review (1440×720)

```
┌ shell ──────────────────────────────────────────────────────┬ thread 360 ─────────────┐ 28
│                                                              │ ●4 ◐2 ?1   ✓9  ⌕       │ 24
│                    STAGE (fit, letterboxed `screen`)         ├─────────────────────────┤
│              pins ①②, strokes; crosshair = click pins        │▌● a3 0:04.12 intro      │
│                                     h = 720-28-28-120 = 544  │  Logo lands a beat late.│
│                                                              │  ◆ cue +3f · 9c1e       │
│                                                              │ ◐ b7 0:07.00–08.10      │
│                                                              │  ◆ eased out            │
│                                                              │ ? c2 0:11.20 r11        │
├──────────────────────────────────────────────────────────────┤  ◆ hold or cut? [reply] │
│ ▶ 0:04.12 f136  1× ⟲ ♪ │ ⇆ r13 ▾ ◫ │ ⌗ ⊡ ▦                  │ ▸ unplaced 2            │ 28
├──┬───────────────────────────────────────────────────────────┤                         │
│  │0:00 ╵ ╵ ╹ ╵ 0:02 ╵ ╵ ╹ ╵ ▼136 ╵ ╹ 0:06 ╵ ╵ ╹     [I▒▒▒O]  │                         │ 16
│▤ │▓intro▓▓▓▓▓▓▓▓│╱╱reveal╱╱╱╱╱╱╱│outro ┃                    │                         │ 20
│◆ │ ▽logo-in ▽kick ◇tag      ┃◆drop ▽cta                     │                         │ 16
│● │    ●a3      ━━◐b7━━      ┃       ?c2                     │                         │ 16
│” │ "Meet the…" │"It plans…" ┃                               │┌ ○ fix ─────────────────┐│
│∿ │▁▂▅▇│whoosh▅▃▂▁▂▃▆█▆│hit ▃┃▁▂▃▄▅▆▅│sting                   ││ ▏                      ││ 32
└──┴───────────────────────────────────────────────────────────┴└────────────────────────┘┘
```

**Size and layout**
- The dock is 120px with the voice lane, 104px without it. At 800px tall the stage gets 624.
- The thread is full height. Its composer docks at the bottom, so the list never jumps.
- `Mod+\` collapses the thread and the stage widens.
- `B` swaps the stage for the Board (§5). The dock stays visible.

**Playhead**
- The playhead is a 2px `cream` line with a 1px `ground` halo. It runs from the stage's bottom edge through every lane, with a `▼136` flag in the ruler.
- It is always drawn. Fix: `styles.span` must not set `width: null`.
- Its position is written straight to a CSS variable from the playback rAF through a ref. `setFrame` no longer runs per presented frame: React state updates only on pause or seek. That fixes the whole-screen re-render.

## 3. Timeline lanes

The whole dock is the scrubber.

**Pointer**
- Press on empty space seeks; drag scrubs. Shift-drag anywhere, or drag in the notes lane, sketches a range.
- Clicking a mark selects it and seeks to it. Double-clicking a scene block loops it. Clicking a sound aims the draft at that sound.
- Hovering shows a `dim` ghost line, a ghost time in the ruler, and a 160px frame preview from the still sheet above the pointer.

**Gutter**
- A 20px gutter holds one glyph per lane (▤ ◆ ● ” ∿). The tooltip names the lane, and clicking the glyph hides or shows it.
- Lanes with no data are not rendered.

| Lane | h | Content (structure is greyscale; only the notes lane has colour) |
|---|---|---|
| Ruler | 16 | Timecode, beat ticks (taller on downbeats), the I/O band as a `rangeWash` across all lanes, loop bracket |
| Scenes | 20 | Bands alternating `laneA`/`laneB`, the id clipped and never ellipsised. Blocking = 45° `hatch`, final = solid. Hover shows `reveal · blocking · 0:02.10–0:05.00`. Cut lines run through all lanes in `line`. |
| Marks | 16 | `mark` grey: ▽ cue, ◇ replay (bracket over its span), ◆ landmark. Names are drawn while there's room, otherwise shown on hover. |
| Notes | 16 | Dot = moment note, bar = range note, filled in the state colour, id inside when it fits. The draft is a dashed `cobalt` outline. |
| Voice | 16 | Line spans with their text. Word hairlines at high zoom. |
| Sound | 32 | Mirrored `mark` waveform from the peaks sidecar, with sfx ticks and names overlaid. Cue-list alternatives are hollow. |

**Zoom:** `-` and `=` zoom, `0` fits, `Mod`+wheel zooms around the pointer. When zoomed, a 4px overview strip appears and playback pages to keep the playhead in view.

**Compare:** the other render's cuts show as faint ticks under the scenes lane wherever they moved.

## 4. Thread

**Filter row**
- Chips of state glyph plus count: `●4 ◐2 ?1`, plus `✓9` at the right edge.
- Default: everything except resolved. Resolved notes collapse to the final `✓ 9 resolved ▸` row.
- Copy (`Mod+Shift+C`) and `studio review notes` default to open + reopened.

**Row**
- Glyph, id, time or range, scene, then `r11` in dim mono only when `writtenOn` ≠ the current render.
- The body is markdown with paragraphs kept.
- Replies are indented under the author glyph (`◆` agent; nothing for you), followed by the commit chip, which links.
- The row under the playhead gets a 2px `cream` left rule and scrolls into view, unless the thread was scrolled in the last 3s.

**Unplaced group** (replaces "moment gone"):
- Collapsed at the bottom.
- Each entry shows the frame image it was written against plus `Re-pin` and `Resolve`.

**Hover and focus actions** (right-aligned, never at rest): `reply · resolve · reopen · ⋯`.

**Selection**
- `X` or shift-click selects. The filter row becomes `3  Resolve  Reopen  Delete`.

**Agent replies**
- A new reply lands with a 1s `flash` and the timeline chip pulses.
- An agent question gives the row a `caution` left rule.

**Delete:** no confirm. The row collapses to an inline `Undo` for 6s, and `Mod+Z` also undoes.

**Composer**
- The kind chip (`○ fix ▾`) cycles with `Tab`.
- `Escape` leaves the composer with the draft kept: its pin dims and stays. `Escape` on an empty draft discards.
- Drafts are kept per file in `sessionStorage`, so they survive a file switch and a render auto-load.
- `D` toggles draw mode while composing.

**Draw mode:** a floating `↗ ○ ✎ ⌫` strip at the stage's top-left. Strokes are `cobalt` while drafting and take the state colour once saved.

## 5. Other screens

**Board** (`B`, from a video)
- One row per scene, with stills at the render's true aspect, the scene id, the rung edge (hatch or solid) and note dots.
- Thumbnails come from a bounded cut queue. Each shows a `skeleton` tile until it is cut, never a black box.
- `Enter` or a click seeks and returns to the stage. `Escape` returns without seeking.
- This replaces the storyboard below the fold.

**Stills** (`/projects/$project/artifacts/$` on a folder)
- `B` toggles grid and single, so the same key means "grid" everywhere.
- Grid: true aspect ratios with note dots in the corner.
- Single: fits the box, so 9:16 can't overflow. `Z` toggles fit and 1:1; `Space`-drag pans; `ArrowLeft`/`ArrowRight` step.
- A 48px filmstrip replaces the dock.
- `H` cycles guides (safe, platform crops, thirds) from the framing check's geometry. That geometry is unverified: confirm it exists in `lib/` before building.
- Proof grounds become a `SegmentedControl`, not radios.

**Compare**
- `⇆ r13 ▾` picks the other render.
- Hold `\` to flip. `W` wipes: a hairline with a 12px grip, `ew-resize`, and a `r13 | r14` tag at its foot. `Shift+W` shows side by side.
- Renders are aligned by moment. There is no diff mode.

**Decisions** (`/projects/$project/decisions/$topic`)

Yes: the agent posts 2–6 candidates and you cull them.
```
┌ ◂ lake / music-bed ▾      Which bed under the VO?           ◆  ⌘↵ Sign off ┐
├──────────────────────────────────────────────────────────┬─────────────────┤
│ ┌A────────┐ ┌B────────┐ ┌C (40% dim)┐ ┌D════ pick ═┐       │ thread (same    │
│ │ media/∿ │ │ media/∿ │ │  ✕         │ │ media/∿    │       │ component, per  │
│ └suno $.40┘ └11L  $1.1┘ └seed 41─────┘ └────────────┘       │ candidate)      │
├──────────────────────────────────────────────────────────┤                 │
│ ▶ 0:12.04  shared transport + waveform; 1–9 swap, time kept │                 │
└──────────────────────────────────────────────────────────┴─────────────────┘
```
- Survey (`B`) is a grid. `Enter` opens two-up: the focused candidate against the pick, with one transport.
- A pick gets a `pass` frame. A reject is dimmed with ✕.
- Meta (model, cost, seed) sits in 11px mono on each frame's bottom edge.
- Sign off is the screen's one `accent` button.

**Script** (`/projects/$project/script`)
- Lines at 15px with the line number and time in mono.
- The current line is `cream` and the rest `dim`. The current word gets a `cobalt` underline sweep.
- Clicking a word seeks. `N` notes the line, or the selected words.
- The thread sits on the right; the dock below holds voice and sound only.
- The header shows `take: draft ▾ ⇆ paid` and `7d2e ✓`. The ✓ dims when the script hash changes.

**Dashboard** (`/`)
- An `Awaiting you` list of anything with ◐, ?, an open decision or an unsigned script.
- Below it, all projects as 40px rows: a 64px thumbnail, the name (Archivo 900, its only use), glyph counts (zero counts hidden), and the latest render with its age.

**Project page** (`/projects/$project`)
- Files, decisions and the script, all in the same row type.

**Errors and pending states**
- Errors keep the shell with `◂`.
- Pending states are skeletons at the real aspect.

## 6. Tokens (`theme.stylex.ts`)

**Removed:** `cue`, `replay`, `blocking`, `typography.title`, `typography.lede`, `spacing.pageMaxWidth`, `spacing.pageMargin`, `radius.surface` (10px).

**Re-roled colours:**

| Token | Role (one job each) |
|---|---|
| `accent` | Open or reopened note, plus the single primary action on a screen |
| `pass` | Addressed note (◐, verify it) and a picked candidate |
| `caution` | Waiting on you: agent question, open decision, unsigned script |
| `dim` | Resolved note, secondary type, `◆` absent |
| `cobalt` | The draft: pin, range, strokes in progress, composer edge, read-along word |
| `cream` | Type, playhead, focus ring (1px, 1px offset, `:focus-visible`), current row rule |

**New colour tokens:**
```ts
danger: '#ff4d6d',      // a failure only: save failed, render failed
raised: '#202026',      // hover fill one step above panel: the "you can click this" signal
laneA: '#1a1a1f', laneB: '#222228',  // alternating scene bands
hatch: '#33333b',       // the blocking rung's 45° stripes
mark: '#6b6962',        // structure: cue/landmark/replay glyphs, waveform, sfx ticks
rangeWash: 'rgba(243,240,231,0.08)', // I/O band, loop span
flash: 'rgba(65,68,244,0.25)',       // a reply landing
skeleton: '#18181c',
```

**New size tokens:**
- `typography`: `readout` 11px mono, `chrome` 12px, `body` 13px. Line height 16px everywhere. `display` is kept for the dashboard only.
- `spacing`: `row: '24px'`, `rowDense: '20px'`, `bar: '28px'`, `laneGutter: '20px'`. `sideWidth` becomes `360px`. Step tokens are 4, 8 and 12px.
- `radius.control: '3px'`.

**Interactivity rules:**
- Clickable things get `cursor: pointer` and a `raised` fill (or hollow → filled for marks) within one frame. Decoration never reacts to hover.
- `crosshair` on the stage means "click pins a note". `ew-resize` is for range handles and the wipe grip.
- Selected items get a 2px inner `cream` edge.
- The scrubber is `role=slider` with `aria-valuetext` set to the timecode. Notes are focusable `listitem`s.

## 7. Copy rules

**Removed text:**
- RENDER UNKNOWN (v1 files are dropped, not migrated), "moved from f…", "moment gone"
- Raw `(0.80, 0.83)`
- "Pause where something feels off…" and the "click the frame…" empty state. The empty thread shows only `<Kbd>N</Kbd>`.
- "storyboard ↓", "storyboard · N SCENES", "1 SCENES", "1 videos", "0 STILLS"
- FINAL / BLOCKING pills
- "saved to review/notes-…"
- The orange newer-file banner
- "of N · fps" (moved to the timecode tooltip), "newest", "estimated"
- The 44px uppercase titles
- Bare spinners

**Rules:**
- No all-caps headings inside a working screen.
- Zero counts are hidden, and single items aren't counted.
- State words live in tooltips; the screen uses glyphs.
- Every icon button's tooltip is `name <Kbd>`, looked up from the hotkey registry by `meta.name`, so the label can't drift from the binding.

**Words that stay:** names, `rN`, hashes, timecode, `Resolve` `Reopen` `Reply` `Undo` `Re-pin` `unplaced` `Sign off` `Copy`, and the decision's question.

## 8. Keyboard (TanStack Hotkeys 0.10)

**Wiring**
- `HotkeysProvider defaultOptions={{ hotkey: { conflictBehavior: 'error' } }}` at the root.
- `hotkey-meta.d.ts` merges `HotkeyMeta { group: 'global'|'playback'|'timeline'|'notes'|'compare'|'draw'|'decision'|'script'; name: string }`.
- One registry hook per screen: `useReviewHotkeys`, `useDecisionHotkeys`, `useScriptHotkeys`, `useDashboardHotkeys`.

**Scopes** (there is no scope stack, so they are built from `enabled` plus `target`):
- `mode: 'stage' | 'board' | 'draw'` toggles `enabled`.
- The thread registers its keys with `target: threadRef`. The composer registers with `target: composerRef`, and its `stopPropagation` hides the global `Escape`.
- The global `Escape` gets `ignoreInputs: true`.

| Group | Bindings |
|---|---|
| global | `Shift+/` cheatsheet · `Mod+K` quick-open · `Mod+ArrowUp` up · `Mod+Shift+C` copy open notes · `Mod+L` copy link · `Mod+Z`/`Mod+Shift+Z` · `Mod+\` thread · sequences `['G','D']` dashboard, `['G','P']` project, `['G','S']` script, `['G','N']` focus thread (the pending `G…` shows from `matchedStepCount`) |
| playback | `Space` play · `J` `L` shuttle with `requireReset: true`, where a repeat press doubles the rate · `K` stop; `J`/`L` while `getKeyStateTracker().isKeyHeld('K')` step a frame · `ArrowLeft`/`ArrowRight` frame, ×10 when `e.shiftKey` (one registration each) · `Home` `End` · `I` `O` · `Alt+X` clear range · `[` `]` prev/next note · `{` `}` prev/next scene (raw `{key:'[',shift:true}`) · `'` next cue, `;` prev cue · `/` loop (range › note › scene) · `Shift+/`… taken, so `Alt+/` cycles loop rate 0.25/0.5/1 · `M` mute · `Alt+ArrowUp`/`Alt+ArrowDown` volume · `N`/`Enter` note at playhead · `D` draw · `B` board · `Z` fit/1:1 · `H` guides |
| timeline | `-` `=` zoom · `0` fit |
| compare | `useKeyHold('Backslash')` flip · `W` wipe · `Shift+W` side by side · `V` choose render |
| notes (`target: threadRef`) | `ArrowUp`/`ArrowDown` · `Enter` seek and expand · `R` reply · `E` resolve · `Shift+E` resolve all addressed · `U` reopen · `X` select · `Backspace` delete (undo) · `F` cycle filter |
| composer (`target: composerRef`) | `Mod+Enter` save · `Tab` kind · `Escape` leave with the draft kept; on an empty draft, discard |
| draw (`enabled: mode==='draw'`) | `A` arrow · `C` circle · `P` pen · `Backspace` last stroke · `Escape` done |
| decision | `ArrowLeft`/`ArrowRight` · `P` pick · `X` reject · `U` unflag · `1`–`9` swap, time kept · `Enter` two-up · `B` survey · `F` picks only · `Mod+Enter` sign off |
| script | `ArrowUp`/`ArrowDown` line · `Space` play from line · `N` note on line or selection |

**Cheatsheet and fixes**
- The cheatsheet (a Mantine `Modal`) is built from `useHotkeyRegistrations()` and grouped by `meta.group`. Keys go through `formatForDisplay` and sequences through `formatHotkeySequence`. Rows with `enabled === false` are dimmed.
- Proof grounds move to `SegmentedControl`, which fixes radios swallowing keys.

## 9. URLs (TanStack Router, `validateSearch` on each route)

- `/` dashboard
- `/projects/$project` project page
- `/projects/$project/artifacts/$`, with search params:

  | Param | Values |
  |---|---|
  | `f` | frame |
  | `note` | note id |
  | `in`, `out` | range |
  | `r` | render shown, absent = latest |
  | `vs` | render compared against |
  | `cmp` | `flip\|wipe\|side` |
  | `w` | wipe position, 0–1 |
  | `view` | `stage\|board\|grid` |
  | `still` | file name, for folders |
  | `filter` | `active\|open\|all` |
  | `z` | `fit\|1` |
- `/projects/$project/decisions/$topic?c=&two=a,d&view=survey|two&filter=picks`
- `/projects/$project/script?line=&take=`

**Rules**
- `f` and `w` are written with `replace`, debounced 150ms, and only on pause or seek, never per played frame.
- `note`, the file, `r` and `view` push history.
- `f` and `note` survive reload and render switches, re-placed by moment.
- Defaults are left out of the URL.

## 10. Build notes

- `@mantine/spotlight` isn't installed. Either add it at 9.5.2 for `Mod+K`, or build quick-open on `Modal` + `ScrollArea` + `useHotkeys`.
- Use Mantine `Kbd`, `Tooltip`, `Menu` (render history, file switcher), `SegmentedControl`, `Skeleton` and `Modal`, all restyled through StyleX tokens.
- Lanes are absolutely positioned DOM with StyleX dynamic `left`/`width` from a pure `timelineGeometry(frame→x)` model. The waveform is one `<canvas>`.

## Answers to your questions

- **TanStack Hotkeys:** yes, it's installed, but `use-review-hotkeys.ts` only uses a flat `useHotkeys`. This spec moves to its registry, meta, sequences, held-key state and target scoping.
- **Decisions:** yes. The agent posts a few candidates; you survey them, two-up any pair on a shared transport, then pick/reject and sign off. The agent reads your answer through watch.
- **Agent watching and replying:** this is the full-height thread with `◆` presence, live replies and agent questions marked in `caution`. On the CLI side it is `studio review watch` and `reply`.

**Assumptions not checked:** the `rN` render numbering (it relies on render-history ordering), the framing-check guide geometry in `lib/`, and the schema library for `validateSearch`. The brief is at /Users/graham/Programming/media-studio-review/docs/plans/2026-10-11-review-studio-overhaul-brief.md; tokens are in /Users/graham/Programming/media-studio-review/web/src/shared/ui/theme.stylex.ts.