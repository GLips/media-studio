`tk` tracks tickets and todos in this repo. Run `tk` for the full guide.

## Rules

- Commands: `npm run check:arch`, `npm run typecheck`, `npm test`. Run each on its own; a chained `&&` hides every
  failure after the first. The pre-commit gate (`.githooks/pre-commit`, on after `npm install`) runs check:arch, then
  `typecheck:gate` and `test:gate` (what a clean clone holds, no `work/`), and refuses the commit on any failure.
- `work/` holds your projects (`work/projects/<p>/`), brand kits (`work/brands/<name>/`, see `docs/brand-kits.md`) and
  `hosts.json`. The studio's git ignores it; it's a git repository of its own, made by `studio workspace init` (run it
  first). Its commits run `.githooks-workspace/pre-commit`: `check:arch --scope workspace`, the full typecheck,
  `npm run test:workspace`.
- `lib/` has three positions: `lib/models/` (pure, loads in plain Node), `lib/studio/` (renders in the browser) and
  `lib/engine/` (Node-side machinery). Each holds domain subfolders only, plus `lib/studio/api.ts`, which projects
  import as `#studio`. `lib/sfx/` and `lib/paint/` are still to be split into them. An import into a `lib/<folder>` from
  outside it uses its alias (`#models/*`, `#studio/*`, `#engine/*`, `#sfx/*`, `#paint/*`), never a relative path;
  `node lint/rewrite-lib-imports.ts` rewrites any that slip in.
- Start a project with `studio new <slug> --capability <music-led|voice-led|mixed|silent|still-only>`. It passes every check
  from its first commit; a new project isn't baselined, so a violation in it blocks.
- A project, `work/projects/<p>/`: `project.ts` (its capability, held to what it binds, and the `shared` modules its
  scenes may import), `timeline.ts`, `timeline.test.ts` (the retime runner), a file per scene in `scenes/` or `bars/`
  with its helpers in a folder of its name, `video.tsx`, `stills.tsx`.
- Timing lives in `timeline.ts`. A scene reaches another's moment by its cue, never by importing it. `timeline.ts`
  imports `#models/*`, never `#studio`.
- Lint and the hooks enforce this. Older violations sit in baselines that only shrink: `lint/arch-baseline.json` for
  the studio, `work/arch-baseline.json` for the workspace.
