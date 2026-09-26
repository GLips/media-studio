`tk` tracks tickets and todos in this repo. Run `tk` for the full guide.

## Rules

- Commands: `npm run check:arch`, `npm run typecheck`, `npm test`. Run each on its own; a chained `&&` hides every
  failure after the first. The pre-commit gate (`.githooks/pre-commit`, on after `npm install`) runs check:arch, then
  `typecheck:gate` and `test:gate` (what a clean clone holds, without projects' gitignored media), and refuses the
  commit on any failure.
- `lib/` has three positions: `lib/models/` (pure, loads in plain Node), `lib/studio/` (renders in the browser) and
  `lib/engine/` (Node-side machinery). Each holds domain subfolders only, plus `lib/studio/api.ts`, which projects
  import as `#studio`. `lib/sfx/` and `lib/paint/` are still to be split into them.
- Start a project with `studio new <slug> --capability <music-led|voice-led|mixed|still-only>`. It passes every check
  from its first commit; a new project isn't baselined, so a violation in it blocks.
- A project: `project.ts` (its capability, held to what it binds), `timeline.ts`, `timeline.test.ts` (the retime
  runner), a file per scene in `scenes/` or `bars/` with its helpers in a folder of its name, `video.tsx`, `stills.tsx`.
- Timing lives in `timeline.ts`. A scene reaches another's moment by its cue, never by importing it. `timeline.ts`
  imports `#models/*`, never `#studio`.
- Lint and the hook enforce this. `lint/arch-baseline.json` lists older violations; it only shrinks.
