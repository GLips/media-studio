`tk` tracks tickets and todos in this repo. Run `tk` for the full guide.

## Rules

- Commands: `npm run check:arch`, `npm run lint`, `npm run typecheck`, `npm test`. Run each on its own; a chained `&&`
  hides every failure after the first. The pre-commit gate (`.githooks/pre-commit`, on after `npm install`) runs
  check:arch and `lint` over the studio, then `typecheck:gate` and `test:gate` (what a clean clone holds, no `work/`)
  and `typecheck:web`, and refuses the commit on any failure. A commit that passed has been gated: don't rerun those
  checks after it. Run by hand with no `--scope`, check:arch and lint judge the studio and `work/` both, each against
  its own baseline, reading the working tree, untracked files included; each hook passes its own scope and reads what
  its commit holds. The GPU gate (`npm run stamp:gate`) takes minutes on the one shared adapter, so pre-push runs it, not
  pre-commit; run it yourself only before handing over work that changes rendering.
- The painting engine is in flux: renders may shift a little between runs and between commits. Judge a moved GPU-gate
  baseline by eye at delivery size and accept it when it looks right; save repeatability work for differences a viewer
  would notice.
- This Mac is shared by many agents. Run heavy checks in the cloud: `studio remote run typecheck lint test:gate` (any
  npm script but the GPU gate) runs each in its own Modal container against this checkout as it is on disk. It needs
  this checkout's version deployed; a remote command says when it isn't, and deploying (`studio remote deploy`) is
  Graham's call.
- Docs have one home each. A verb's flags, defaults, prices and model names live in its `studio <verb> --help`; a
  `#studio` export's parameters in its JSDoc (`studio api`); workflows and judgment for making videos in the skills
  (`skills/<name>/`), which run from other projects' directories and so name `studio` verbs and `#studio` exports,
  never repo paths or `docs/`. `docs/` is for working on the studio itself: `brush-engine.md` (paint's features and
  how a painting is drawn), `render-bench.md` (timing renders, traces, the solved-paint cache), `remote.md` (Modal),
  `photoshop-capture.md` (the Photoshop capture rig), `private-styles.md` (importing and fitting brush packs).
- `work/` holds your projects (`work/projects/<p>/`), brand kits (`work/brands/<name>/`), private painting styles
  (`work/styles/<name>/`) and `hosts.json`. The studio's git ignores it; it's a git repository of its own, made by
  `studio workspace init` (run it first). Its commits run `.githooks-workspace/pre-commit`: `check:arch --scope
  workspace`, `lint --scope workspace`, the full typecheck, `npm run test:workspace`.
- `lib/` is areas (`timing`, `picture`, `paint`, `footage`, `output`, `platform`) of feature folders, each holding
  only the role folders it needs: `models/` (pure, loads in plain Node), `studio/` (renders in the browser),
  `engine/` (Node-side machinery). So `lib/<area>/<feature>/<role>/`, plus `lib/api.ts`, which projects import as
  `#studio`. `models` imports only `models`; `studio` imports `models` and `studio`; `engine` imports `models` and
  `engine`; browser code never imports `engine`. Foundation features stand in layers (`LIB_LAYERS` in
  `lint/policy/studio-tree.ts`, lowest first): a foundation imports only its own layer or lower, and anyone imports it
  freely; every other feature is a peer, imported only with a reasoned grant in its `visibility.json`. A new area is
  declared in `studio-tree.ts`. An import into a feature from outside it uses `#lib/*`, never a relative path;
  `node lint/rewrite-lib-imports.ts` rewrites any that slip in.
- A project, `work/projects/<p>/`, starts with `studio new` and passes every check from its first commit; a new project
  isn't baselined, so a violation in it blocks. It holds `project.ts` (its capability, held to what it binds, and the
  `shared` modules its scenes may import), `storyboard.ts` (its plan: the brief, a row per scene with its lines and
  cues, the left-out list), a file per scene in `scenes/` or `bars/` with its helpers in a folder of its name,
  `video.tsx`, `stills.tsx`. Timing lives in `storyboard.ts` alone, declared with `defineStoryboard` and never built
  by hand; the workspace's retime check times every project's. A scene reaches another's moment by its cue, never by
  importing it.
- Lint and the hooks enforce this; `lint/overview.md` lists the rules. Every rule reads the layout from
  `lint/policy/studio-tree.ts`, so a new folder is declared there, and the quality rules cover all TypeScript. Older
  violations sit in baselines that only shrink, both tiers' in one file per repo: `lint/arch-baseline.json` for the
  studio, `work/arch-baseline.json` for the workspace. Fixing one leaves a stale entry: rewrite the baseline with
  `-- --update-baseline` on the command that reported it.
- Fix papercuts where you find them: a small bug in your path (a crash in a tool, an undersized buffer, a stale
  message) gets fixed in your branch, not filed. File a ticket only for work that needs its own design or would
  derail yours.
