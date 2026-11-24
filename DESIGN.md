---
name: Media Studio
description: The local web app where Graham watches, edits, comments on and approves what his video agents made.
colors:
  ground: "#0c0c0e"
  panel: "#16161a"
  raised: "#202026"
  line: "#2a2a31"
  cream: "#f3f0e7"
  dim: "#8d8a83"
  mark: "#6b6962"
  accent: "#ee4c23"
  cobalt: "#4144f4"
  caution: "#f2b134"
  pass: "#3ccf7a"
  danger: "#ff4d6d"
  lane-a: "#1a1a1f"
  lane-b: "#222228"
  screen: "#000000"
typography:
  heading:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: "34px"
  line:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: "34px"
  reading:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "19px"
    lineHeight: "34px"
  page-title:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
  prose:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    lineHeight: "22px"
  body:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    lineHeight: "16px"
  chrome:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    lineHeight: "16px"
  readout:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    lineHeight: "16px"
    fontFeature: "\"tnum\""
rounded:
  control: "3px"
  pill: "999px"
spacing:
  hairline: "2px"
  tight: "4px"
  gap: "8px"
  inset: "12px"
  row-dense: "20px"
  row: "24px"
  bar: "28px"
  side-width: "360px"
  queue-width: "240px"
  sidebar-width: "240px"
  title-row: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.cream}"
    typography: "{typography.chrome}"
    rounded: "{rounded.control}"
  button-approve-changes:
    backgroundColor: "{colors.caution}"
    textColor: "{colors.ground}"
    typography: "{typography.chrome}"
    rounded: "{rounded.control}"
  button-comment:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.cream}"
    typography: "{typography.chrome}"
    rounded: "{rounded.control}"
  button-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.cream}"
    typography: "{typography.chrome}"
    rounded: "{rounded.control}"
  button-default-hover:
    backgroundColor: "{colors.raised}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.dim}"
    rounded: "{rounded.control}"
  icon-button-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.cream}"
  bar-pill:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.dim}"
    typography: "{typography.chrome}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  bar-pill-asks:
    backgroundColor: "{colors.caution}"
    textColor: "{colors.ground}"
    rounded: "{rounded.pill}"
  cue-tag:
    backgroundColor: "transparent"
    textColor: "{colors.cobalt}"
    typography: "{typography.readout}"
    rounded: "{rounded.control}"
    padding: "0 4px"
  scene-block:
    backgroundColor: "{colors.lane-a}"
    textColor: "{colors.cream}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  scene-block-focused:
    backgroundColor: "{colors.raised}"
  list-row:
    backgroundColor: "transparent"
    textColor: "{colors.cream}"
    rounded: "{rounded.control}"
    padding: "0 8px"
  list-row-hover:
    backgroundColor: "{colors.raised}"
  tooltip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.cream}"
    typography: "{typography.chrome}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
---

# Design System: Media Studio

## Overview

**Creative North Star: "The Screening Room"**

A dark room built for watching: a near-black ground, the picture large, cream type read beside it, and colour held back until it means something. Every screen is a working screen for one expert who opens it between agent turns, so it is dense and quiet. Rows line up across panels on one shared line height; surfaces lift off the ground by tone, not by shadow; and the only bright things on the page are the word being spoken, the one action to take, and whatever waits on a decision.

The values live in one file, `web/src/shared/ui/theme.stylex.ts`, and every shadow in `web/src/shared/ui/shadows.ts`. Mantine's components take the same tokens through `web/src/shared/ui/mantine-theme.ts`, and the type scale reaches components as Mantine `Text size` keys (xs, sm, md, prose, line, lg, heading, xl). Copy is plain: no all-caps headings, no zero counts, and states in visible words ("1 open note", "2 questions", "0 of 6 signed"), with an icon beside one only where it helps and never the meaning in a tooltip alone.

The plan page shows the system at full size: the player letterboxed on the left, the scene under the playhead in a 440 to 560px column beside it, its spoken lines large and lit in cobalt word by word, and the whole video as a strip of scenes along the foot.

**Key Characteristics:**
- Near-black ground, cream type, tonal lift from ground to panel to raised.
- Colour is a signal, never decoration: each hue has one job.
- One sans face (Archivo) for everything read; mono (JetBrains Mono) only for machine figures.
- One 16px line height for the chrome; larger sizes open up for reading.
- Small, square-ish controls (3px corners); pills only in the top bar.
- Hover is always the raised tone; focus is always a 1px cream ring.

## Colors

A neutral dark ground with five signal hues, each owning exactly one meaning.

### Primary
- **Ember** (accent): the one primary action on a screen (Approve scene), and an open or reopened note. Filled behind cream type on the action.

### Secondary
- **Reading Cobalt** (cobalt): the word being spoken, lit solid behind it at 80% as the playhead crosses it; the draft note's pin, range, strokes and the composer's edge; the voice lane's spoken underline; the Comment button that rises over a selection.

### Tertiary
- **Caution Amber** (caution): what waits on someone. An agent's question, a scene changed since it was approved (and its Approve the changes button), an unsigned scene, the length past the target and the target line on the strip.
- **Pass Green** (pass): approved, addressed, on target. A signed scene's check, an addressed note, a length within target.
- **Failure Red** (danger): a failure only. A save or render that failed, a plan that doesn't time, a length past its maximum.

### Neutral
- **Screening Black** (ground): the page under every screen.
- **Panel Charcoal** (panel): a surface lifted off the ground, as the thread, the dock, tooltips, menus and the bar's pills.
- **Raised Slate** (raised): one step above panel, only on hover, focus or the selected item. The "you can click this" signal.
- **Seam** (line): the 1px rule between two surfaces.
- **Cream** (cream): type, the playhead, the focus ring, the current row's edge and the focused scene's outline.
- **Dim Stone** (dim): neutral facts and secondary type. Field labels, line times, scene facts, the timing flags under the strip, a resolved note, an absent agent.
- **Mark Grey** (mark): structure drawn in the dock: cue and landmark glyphs, the waveform, sfx ticks.
- **Lane Bands** (lane-a, lane-b): alternating scene bands in the dock; lane-a is also a scene block's rest fill on the plan strip.
- **Letterbox** (screen): the black around a frame, and the drop under floating things.

### Named Rules
**The One Job Rule.** Solid cobalt marks the spoken word and drafts. Accent is the one primary action. Amber marks what waits on someone. Dim marks neutral facts. Green is approved; red is failure. No hue is borrowed for emphasis or decoration.

**The Outline Not Fill Rule.** A cue's tag under its word is outlined in cobalt with cobalt type, never filled: a solid cobalt fill is the word being said.

**The Dim Fact Rule.** Something worth knowing that asks nothing of anyone (a silent stretch, a stretch with nothing happening, a line's start time) is dim, not amber.

**The One Primary Rule.** A screen fills one button with accent. Other actions sit on panel and lift to raised on hover.

## Typography

**Display Font:** Archivo (with -apple-system, Helvetica Neue, Arial), the studio's own face, loaded from `lib/picture/type/studio/Archivo.ttf` so the app reads in the type its renders set.
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo), from the same folder.

**Character:** A grotesque that goes from a 900-weight heading to small chrome without changing voice, with a plain mono beside it for figures that tick.

### Hierarchy
- **Heading** (900, 30px, 34px leading; `size="heading"`): what a page is about, named once at its top. The plan's current scene title.
- **Line** (500, 22px, 34px leading; `size="line"`): a plan's spoken line, read along with the picture. The words the plan page is for.
- **Reading** (19px, 34px leading; `size="lg"`): text read for itself, large, as a decision's text candidate.
- **Page title** (700, 22px, 28px leading; `StudioPageTitle`, `typography.pageTitle`): a sidebar page's name (Awaiting you, Library), once, in its 56px title row with a quiet count beside it. The sidebar's `studio` wordmark sits level with it at the same size, 900, tracked tight.
- **Prose** (15px, 22px leading; `size="prose"`): prose read for content. A plan's brief and scene fields.
- **Body** (13px, 16px; `size="md"`): note bodies, scene names on the strip, the bar's title, every list row's name (a project's at 600).
- **Chrome** (12px, 16px; `size="sm"`, the default): bars, menus, chips, tooltips, field labels, buttons.
- **Readout** (mono, 11px, 16px, tabular figures; `size="xs"` with the mono face, or `Readout`): timecode, frame numbers, hashes, key caps.

Weights in use beyond the scale: 700 for the title in the bar, 600 for names (a scene on the strip, a timed cue, Approved).

### Named Rules
**The One Line Height Rule.** Every size up to body sits on a 16px line, so rows line up across panels. Only the reading sizes (prose, line, reading, heading) open up, to 22px or 34px, and the page title, to 28px.

**The Machine Mono Rule.** Mono is for figures a machine produced: times, frame numbers, hashes, key caps, a note's anchor reference. Words people read are Archivo.

## Layout

Full-viewport working screens, no page scroll: a CSS grid of a bar, a body that fills, and a foot, with panels scrolling inside themselves under a fade (`FadeScroll`).

- **Plan page:** header row; then two columns, the player (`minmax(0, 1fr)`) and the scene panel (`minmax(440px, 560px)`) split by a 1px seam; the thread at the side width (360px) on the right; the scene strip and transport along the foot.
- **Review page:** stage, a 28px transport bar (playback at its start, the stage's tools, draw, guides, fit and board, as one edged set at its end), then the dock of lanes; the thread beside the stage at 360px. The dock's ruler is a 16px label line over its ticks, so the playhead's flag never covers a tick. A folder of stills shows as a contact sheet: each still bare on the ground, as wide as its column up to 200px tall, bottom-aligned along its row, with a dim Archivo caption under it naming the part of its name its folder doesn't share. The tile the arrow keys are on has a 2px accent edge; the still whose notes are open, when the cursor is elsewhere, a 1px cream one. The breadcrumb names the folder.
- **Decisions page:** the queue of the project's decisions down the left at 240px, then the line the decision is for over its candidates and their transport, and the thread at 360px.
- **Index and library:** the studio sidebar down the left at full height (240px, panel, a 1px seam): the `studio` wordmark, Awaiting you with its count, Library, then Projects with a filter field (`/` on the index), each project with what waits in it in amber. The sidebar is the one list of projects. The page fills the rest with no bar: its title row (`StudioPageTitle`, level with the wordmark) carries quick-open and the keys at its right, inset 24px like the rows below.
- **Index and project pages:** one uncapped list whose rows share columns (a subgrid): picture, name, what it asks (dim, to a cap), its state in words just after, readouts at the far edge. The index is Awaiting you alone, its rows grouped under each project's name on a seam from the list's edge, cream at 600 with its count.
- **Project names** dim their `YYYY-MM-` date, so the part that tells them apart reads first (`ProjectName`).
- **Viewers** (a recording, a render's review, stills) keep the full width and their `◂` crumb: the work needs the room.
- **Library shelf:** fills the width it's given, uncapped: the sidebar pages' title row with its count, then, at the title's inset, an outlined search, then a table whose column names (Title, Sources, Length, Flags) sit on the same grid as its 64px two-line rows, each led by the item's 96×54 poster. A recording still under the recorder's dated title is titled by when it began, in cream; a named one keeps its name over its date. The second line is what the take opens by saying, hesitations left out, in cream at 70% so it reads above the dates and column names, on one line of at most 72ch; a named item's date leads it, dim. Sources are lucide icons alone, named by their column and, in words, by their tooltip. Lengths read `m:ss`, to the nearest second.
- **Recording page:** one bar: the title, then its facts dim after it (recorded, length, sources, window, projects). The picture fills what the rest leaves, whole at its own shape on the ground, over the transport (play, the time, a speed readout that steps 1×, 1.5×, 2×, 0.5× on a click, and mute, as the render review's) and a strip with a time ruler, its speech in mark grey. The flags are as tall as their rows and an open composer, to a third of the window, then scroll; their filter chips carry no counts. The transcript is a 400px column on the right at body size; the word being said is its one in-text mark, the cobalt wash, and a flag marks its lines with a rule down their edge in its author's colour. A refused save keeps the composer open with the draft and says why in danger red.

Spacing is drawn from three steps, 4px (tight), 8px (gap) and 12px (inset), with 2px for hairline nudges and 24px as a list row's height and a panel's padding. Rows are 24px, dense rows 20px, bars 28px. The plan's scene panel pads 24px and separates its fields by 24px; a field's label sits 4px above its text.

## Elevation & Depth

Depth is tonal. A surface lifts from ground to panel, and anything you can act on lifts once more to raised on hover. Seams are 1px line-coloured rules. Shadows are few, named, and functional; `shadows.ts` is the whole list and lint refuses a `boxShadow` written anywhere else.

### Shadow Vocabulary
- **Pin halo** (`box-shadow: 0 0 0 2px #f3f0e7, 0 2px 8px #000000`): a review pin on the frame, holding on any footage.
- **Spoken underline** (`box-shadow: inset 0 -2px 0 #4144f4`): the word being spoken in the voice lane.
- **Ground ring** (`box-shadow: 0 0 0 1px #0c0c0e`): a note dot ringed in the ground's dark, so it holds on a picture of its own colour.
- **Float** (`box-shadow: 0 4px 14px #000000`): a control floating over the page, as the Comment button over a selection.

### Named Rules
**The Tonal Lift Rule.** Panels never cast shadows. A shadow exists only to keep a mark legible over a picture or to float a control above the text it acts on.

## Shapes

Corners are barely rounded (3px) on buttons, chips, tiles, menus, rows and scene blocks; Mantine's default radius is that same 3px. Full pills (999px) are reserved for the top bar's status pills and the round play button. Borders are 1px; a 2px left edge marks a thread row's state (cream for the current row, amber for an agent's question). Focus is a 1px cream outline offset 1px outward on controls and inset on rows. Underlines carry meaning on words: 2px thick, offset 6px, in the colour of the note on them, dashed cobalt for a draft.

## Components

### Buttons
Small and flat: Mantine `Button` at size xs on the default variant.
- **Shape:** gently squared (3px).
- **Primary:** accent fill, cream type, a leading check icon ("Approve scene", "Approve with 1 open note"). One per screen.
- **Approve the changes:** amber fill, ground type, when the scene changed after it was approved.
- **Comment:** cobalt fill, cream type, floating over a text selection with the float shadow.
- **Default:** panel fill, cream type, raised on hover.
- **Text action:** dim, underlined 3px below ("Undo").

### Icon buttons
A lucide icon (14 to 16px) that does one thing, its name and hotkey in a tooltip. Dim at rest, cream on raised on hover, cream on raised when active. Mouse-reachable always; the hotkey is in the tooltip, never the only way.

### Bar pills
22px tall, fully round, panel fill, dim chrome type, 8px inline padding. They state facts in words ("26.1 s · 2.1 s over the 24 s target", "0 of 4 scenes approved", "Voice timed from word counts"), with a coloured clause for the part that matters. Pills that act lift to raised on hover; the agent's questions pill is filled amber with ground type.

### Spoken line (signature)
A 64px column for the line's start time (mono, dim, a raised hover; click plays from it), then the words at line size, weight 500. The word under the playhead is lit by a cobalt wash at 80% opacity, driven by a frame CSS variable with no re-render; words already said fade to 55% while playing. A cue's name sits outlined in cobalt after the word it lands on. A word with a note is underlined in the note's state colour.

### Scene strip (signature)
The whole video as blocks, each as wide as it runs, on lane-a, 3px corners, raised on hover; the focused scene is raised with a 1px cream outline. Each block names its number and title (body, 600) over its facts (readout size, dim) with state icons top right: a check in green, a question or a changed-since mark in amber. A 2px cream playhead crosses it, the target length is a dashed amber line with its label, and timing flags hang under it as dim 2px rules with dim labels.

### Notes panel
The thread beside the work. Its header names it ("Notes") and counts its states in words, each after the glyph its rows carry, so the header is the rows' legend: "● 1 open note", "◐ 2 to verify", "? 3 questions", "✓ 4 resolved", the same words the index uses. "open" and "resolved" are its filters, edged in a 1px seam at rest so they read as controls beside the bare counts, filled while on. The resolved fold's action says "Clear resolved". Notes left on earlier renders sit behind a closed, dim "Earlier renders" toggle at the panel's foot, with no count. On a still, the panel opens with the still's whole name over its facts ("1200 × 630 · 1 of 20"), then the composer.

### Thread rows
Indented rows with a 2px left edge, raised on hover; a small gap parts the label line from the body and a wider one the body from the replies; a 1px cream focus ring inset. The kind is a lucide icon in cream; the state is the colour. A long body stops after four whole lines with a dim "… more", never mid-line. A reply landing on a row flashes it cobalt at 25% for 1s, easing out.

### Composer
At the thread's foot (on a still, under the still's facts at the panel's head): the field, led by what the note will pin to (a video's timecode chip, dim while it follows the playhead, cobalt once pinned), with a prompt as its placeholder; under it the kind picker and a labelled "Post ↵" button. On a still it rests as a one-line prompt with its `N` key until a click or `N` opens it.

### Inputs / Fields
Scene fields are a dim chrome label with a comment icon button, over prose-size cream text edited in place. The composer's draft is edged in cobalt. A composer always shows its Cancel and Save buttons (Save the screen's accent while it's open), with its keys in dim words beside them. An action that waits on something, as Flag range waits on a marked range, stays on show disabled, with what it waits for in dim words beside it; a row's own actions (edit, remove) show at rest, not only on hover.

### Tooltips and menus
Panel fill, 1px seam border, 3px corners, cream chrome type: they sit on the dark screen as a panel, never as a light box.

### List rows
40px rows on the index and project pages, transparent at rest, raised on hover or keyboard focus, with only one row lit at a time. A decision's or plan's glyph sits on the ground, with no tile; only real pictures fill the 64px box. Each row's state is words coloured by its job: an open note in accent, one to verify in green, a question, an open decision or an unsigned plan in amber, a settled one dim.

### Sidebar items
24px rows, chrome type, a 14px lucide icon column (empty for a project, so names line up under the labels), raised on hover and on the page showing now, a count in amber at the end when something waits there.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, step and radius from `theme.stylex.ts` and every shadow from `shadows.ts`.
- **Do** give each hue its one job: solid cobalt for the spoken word and drafts, accent for the one primary action, amber for what waits on someone, dim for neutral facts.
- **Do** lift what can be clicked to raised (#202026) on hover, and ring focus in 1px cream.
- **Do** say states and counts in plain words, with the detail in the tooltip ("2.1 s over the 24 s target", "Changed since you approved it").
- **Do** set times, frame numbers and hashes in mono at readout size with tabular figures.
- **Do** keep the chrome on the 16px line height so rows line up across panels.

### Don't:
- **Don't** fill a second button with accent on the same screen.
- **Don't** fill anything solid cobalt except the word being spoken, the draft and the Comment action; a cue tag is outlined.
- **Don't** colour a neutral fact amber; amber means someone has to act.
- **Don't** cast a shadow under a panel or card; lift by tone.
- **Don't** set headings in all caps, or show a count of zero.
- **Don't** set words people read in mono.
