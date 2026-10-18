# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One expert: Graham, who directs coding agents that make short videos (App Store previews, product walkthroughs,
painted and motion pieces) for his projects and clients. He opens the studio app often, between agent turns, to judge
what an agent made and steer it before the next expensive step (a voice read, a render, a paint pass). Collaborators
don't use the app; their feedback reaches it through him.

## Product Purpose

The studio is a TypeScript codebase, a `studio` CLI and a local web app. Agents plan, build and render videos with
the CLI; the web app (`studio review open`) is where Graham reviews their work: each project's plan, its renders and
stills, with notes pinned to exact moments, words or regions that the agent reads back and acts on. Success is fast,
unambiguous steering: he sees what was made, says precisely what to change, approves what's right, and the agent's
next turn does what he meant.

## Positioning

The review surface is wired to the project's source, not to exported files: a plan is the project's `storyboard.ts`,
re-timed live as it changes; a note is anchored to the words or frames it's about and survives the agent's edits; an
approval goes stale on its own when what it approved changes.

## Operating Context

- A project is `work/projects/<p>/`: `storyboard.ts` (the plan: brief, a row per scene with its lines and the cues the
  picture moves on, timing), scenes in code, renders in `out/`, review state in `review/review.json`.
- Plans are written by agents at kickoff and revised from his notes; voice lines are timed from word counts until a
  voice is recorded.
- Many agents work on this Mac at once; the app runs locally on Vite, one per checkout.
- Pages: projects overview, a project's plan, video and still review.

## Capabilities and Constraints

- The plan page leads with watching: the animation (or a stand-in before one exists) plays beside the script, which
  follows playback. He edits text in place and the edit saves straight into `storyboard.ts` (git keeps history; the
  agent sees the change). He comments on exact words and signs scenes off.
- Scenes render in the browser (Remotion), so a plan's animatic can play live without a render.
- Keyboard shortcuts exist for experts, but every action must be reachable by mouse with no hidden step.
- Browser code never imports Node-side engine code; the app server never imports project TypeScript (Vite does).

## Product Principles

- Show the work itself, not a description of it: video before notation.
- Plain words over shorthand; nothing on screen needs a legend.
- Every comment and edit lands exactly where he pointed, and the agent can find it again.
- One source of truth: the project's files. The app edits them; it never keeps a second copy.
