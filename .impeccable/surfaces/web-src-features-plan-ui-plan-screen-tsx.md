---
version: 1
slug: "web-src-features-plan-ui-plan-screen-tsx"
primary_target: "web/src/features/plan/ui/plan-screen.tsx"
related_targets: ["web/src/routes/projects.$project.plan.tsx"]
---

# Plan page

Scope: `/projects/<p>/plan`, Operate mode. Graham reviews an agent's plan for a video before anything expensive runs: watches it, edits text in place (saved to storyboard.ts), comments on exact words, approves scene by scene.

## Direction contract

THESIS: The animation is the page. It plays large; the scene under the playhead sits beside it, ready to edit. Refuses the data-table dump of every field at once.
OWN-WORLD: The studio's incumbent dark world (near-black ground, cream type, Archivo, mono only for times), cobalt for the word being read and drafts, caution amber for what waits, pass green for approved, accent for the one primary action.
STORY: He presses play, reads along as words light, sees what moves on which word, fixes a line by clicking it, selects words to comment, approves, moves to the next scene.
FIRST VIEWPORT: Top bar (length vs target in words, scenes approved, agent questions, notes with the agent: saved as written, so there's no send step). Left: the player, letterboxed portrait or landscape. Right 560px: current scene's title, times, lines lit word by word with cue tags, on screen and motion, its comments. Bottom: scene strip proportional to time, playhead, dashed target line.
FORM: Playback view with chapter strip, first of three dealt; seed:93e3feb4195acb51
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
