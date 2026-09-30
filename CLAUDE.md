`tk` tracks tickets and todos in this repo. Run `tk` for the full guide.

## Rules

- Commands: `npm run check:arch`, `npm run lint`, `npm run typecheck`, `npm test`. Run each on its own; a chained `&&`
  hides every failure after the first. The pre-commit gate (`.githooks/pre-commit`, on after `npm install`) runs
  check:arch, then `typecheck:gate` and `test:gate` (what a clean clone holds, no `work/`), `typecheck:web` and
  `lint`, and refuses the commit on any failure.
- `work/` holds your projects (`work/projects/<p>/`), brand kits (`work/brands/<name>/`, see `docs/brand-kits.md`),
  private painting styles (`work/styles/<name>/`, see `docs/private-styles.md`) and `hosts.json`. The studio's git
  ignores it; it's a git repository of its own, made by `studio workspace init` (run it first). Its commits run `.githooks-workspace/pre-commit`: `check:arch --scope workspace`, the full typecheck,
  `lint --scope workspace`, `npm run test:workspace`.
- `lib/` is areas (`timing`, `picture`, `footage`, `output`, `platform`) of feature folders, each holding only the
  role folders it needs: `models/` (pure, loads in plain Node), `studio/` (renders in the browser), `engine/`
  (Node-side machinery). So `lib/<area>/<feature>/<role>/`, plus `lib/api.ts`, which projects import as `#studio`.
  The brush engine's features are laid out in `docs/brush-engine.md`.
  `models` imports only `models`; `studio` imports `models` and `studio`; `engine` imports `models` and `engine`; browser
  code never imports `engine`. A new area is declared in `lint/policy/studio-tree.ts`. An import into a feature from
  outside it uses `#lib/*`, never a relative path; `node lint/rewrite-lib-imports.ts` rewrites any that slip in.
- Start a project with `studio new <slug> --capability <music-led|voice-led|mixed|silent|still-only>`. It passes every check
  from its first commit; a new project isn't baselined, so a violation in it blocks.
- A project, `work/projects/<p>/`: `project.ts` (its capability, held to what it binds, and the `shared` modules its
  scenes may import), `timeline.ts`, `timeline.test.ts` (the retime runner), a file per scene in `scenes/` or `bars/`
  with its helpers in a folder of its name, `video.tsx`, `stills.tsx`.
- Timing lives in `timeline.ts`. A scene reaches another's moment by its cue, never by importing it. `timeline.ts`
  imports `models` code (`#lib/<area>/<feature>/models/…`), never `#studio`.
- Lint and the hooks enforce this; `lint/overview.md` lists the rules. Every rule reads the layout from
  `lint/policy/studio-tree.ts`, so a new folder is declared there, and the quality rules cover all TypeScript. Older
  violations sit in baselines that only shrink, both tiers' in one file per repo: `lint/arch-baseline.json` for the
  studio, `work/arch-baseline.json` for the workspace. Fixing one leaves a stale entry: rewrite the baseline with
  `-- --update-baseline` on the command that reported it.
