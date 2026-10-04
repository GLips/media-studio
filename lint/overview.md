# lint/

One lint system with two tiers. They're split by what a rule can see, and both read the tree's layout from one place.

```
policy/studio-tree.ts   where a path sits: lib areas, features and roles, projects, cli, harness, web places
policy/*.ts             tables the checks read: SDK owners, timing constructors
structural/             whole-tree checks (npm run check:arch, check-arch.ts)
oxlint/                 per-file rules, run by oxlint.config.ts (npm run lint, lint.ts)
candidate-snapshot.ts   the files both tiers read: the working tree by hand, the index under a hook
baseline.ts             how both tiers count findings against a baseline
arch-baseline.json      the studio's baselined findings, both tiers; work/arch-baseline.json is the workspace's
```

**Layout comes from `studio-tree.ts` alone.** No rule lists directories. A rule about features, barrels, layers or
roles asks `classifyStudioPath` for a file's position, so a folder is covered the moment it's declared there. A file
no position covers is itself a finding (`declared-tree`). Rules about code quality apply to every TypeScript file,
by file type, lint/ and work/ included. Web-only rules are about the web app's subjects (server functions, its
design system, its routes), and they decide from a file's position whether it's one of them. Where oxlint needs
globs, they're declared in studio-tree.ts beside the positions: `TERMINAL_PROGRAM_GLOBS` (no-console is off, as
the console is their output) and `DEFAULT_EXPORT_MODULE_GLOBS` (loaded by path for their default export).

## The tiers

**What both tiers read.** Run by hand, check:arch and lint read the working tree, untracked files included,
so a project is checked before it's added. The pre-commit hooks pass `--snapshot index`: only what the commit holds,
so another session's half-written file can't block it, and each lists the sources it left unchecked. check:arch reads
the index's text; oxlint reads the index's files from disk. `check:arch -- --rev <commit>` reads a committed tree.
`--update-baseline` counts only the index, as the hook judges it: a baseline excuses what a commit holds, so stage a
fix before rewriting it, and an untracked project's violations are never excused. A scope's repository, mount and
baseline file are `lint/gate-scope.ts`'s.

**`structural/`** reads the snapshot, parsed once (`source-tree.ts`), with every import resolved to
a canonical path, so an alias and a relative spelling reach one verdict. The `types` checks ask the TypeScript 7
compiler what a declaration means. `type-checker.ts` serves the compiler the same snapshot through the API's virtual
filesystem, and `tsconfigFor` picks each file's program by its position. Findings are counted per check, file and
key against the baseline: one past it blocks, and a stale entry blocks until `--update-baseline` rewrites it.
Advisory checks print and never block. Each scope has one baseline for both tiers: an oxlint finding is filed under
the id oxlint prints (`arch(no-long-comments)`), keyed by its line's text, and each tier rewrites only its own. Each check's spec runs it on a throwaway git repo in the studio's layout
(`spec-tree.ts`).

**`oxlint/`** holds per-file syntax rules, registered as `arch/*` by `oxlint/plugin.ts` and enabled in
`oxlint.config.ts` beside oxlint's built-ins (type-aware `typescript/*`, sonarjs duplication, `import/no-cycle`).
`npm run lint` runs oxlint over the studio, and `-- --scope workspace` over work/; a warning never blocks.
Rule specs use RuleTester; `lint/oxlintrc.test.ts` runs the real CLI once, because RuleTester builds no global
scope. `oxlint/lib/rule-file.ts` turns oxlint's filename into a studio position.

A rule belongs to the tier that can answer its question. Where an import lands, what a barrel drags in and what a type
resolves to are structural questions. What one file writes is a per-file question.

## Rules

Studio: the checks written for this repo's own shape. All structural, all over the whole tree.

| Check | Holds |
|---|---|
| declared-tree | every source file sits at a position studio-tree.ts declares |
| import-policy | projects never import each other; lib crossings use `#lib/*`; studio never reaches engine; work/ stays private; the web app's rows: a feature is reached through its barrel, its layers import downward, shared and infrastructure never import upward, only `WEB_ENGINE_DOOR` reaches engine code, and client code reaches `.server` modules only from a feature's controllers |
| timing-ownership, scene-ownership, retime-registration | a project builds timing only in timeline.ts; a scene reaches only its own folder, shared modules and the timeline; every timeline registers with the retime runner |
| model-purity | a model reaches no render, I/O or browser code through any chain |
| frame-determinism | a frame never reads a clock or randomness |
| capability-match | a project binds what its capability declares |
| sdk-containment | each SDK is reached only from its declared owners, each a distinct use (policy/sdk-owners.ts) |
| no-scratch, studio-temp, render-snapshot, brush-assets | no tracked file names scratch/; temp folders come from studio-temp; a render is read through its own snapshot; bought brush packs stay out of git |
| folder-width (advisory) | a lib folder past 15 source files groups them |

All TypeScript: quality rules extended to the whole repo by vid-107.

| Rule | Tier | Holds |
|---|---|---|
| require-safety-comment | oxlint | every `as` states its invariant in a `// SAFETY:` comment |
| no-chained-type-assertions | oxlint | no `as unknown as T` |
| no-type-argument-assertion | oxlint | a data-reading call doesn't name its own result type |
| no-reflect-access | oxlint | no `Reflect.get` or `Reflect.apply` |
| no-long-comments | oxlint | a comment run stays within 60 words and 15 lines (twice that for a file header) |
| no-vacant-symbol-names | oxlint | a reachable name says what it's for |
| no-module-mocking | oxlint | tests run the real module |
| hook-count, prop-count, single-component-export (warn) | oxlint | component size signals |
| no-async-effect | oxlint | an async effect has one place to cancel |
| typed-tree | structural | a program compiles every TypeScript file, or the types checks are blind to it |
| no-opaque-record, no-widen-then-assert, no-known-value-widening, no-broad-parameters, no-unknown-returns, no-unknown-type-aliases, no-runtime-typeof | structural | type declarations say something: no open bags, `unknown` contracts or widen-then-assert round trips |
| file-size | structural | a source file stays under 600 lines |
| trampolines (advisory) | structural | an exported function that only forwards |
| doc-budgets | structural | each doc in docs/doc-budgets.manifest.json stays under its word ceiling |
| barrel-discoverability | structural | a barrel names what it exports |
| test-file-mirror (advisory) | structural | a spec sits beside the module it's named for |
| feature-layers | structural | a lib foundation (`LIB_LAYERS`: platform, vocabulary, timing, framing, measurement, authoring, lowest first) imports only foundations of its own layer or a lower one |
| feature-visibility | structural | a feature imported from another feature grants it, with a reason, in its visibility.json (one finding per ungranted pair); a foundation needs no grant and keeps no grant file |
| feature-cycles | structural | no feature imports one that imports it back (one finding per import inside a cycle) |
| no-test-imports | structural | only a spec imports a spec |
| oxlint's built-ins | oxlint | the correctness, suspicious and perf categories, type-aware `typescript/*`, sonarjs duplication, `import/*` (oxlint.config.ts). Off: `typescript/no-unsafe-type-assertion`, whose sites require-safety-comment governs with an escape it lacks; `react/no-array-index-key` outside web/, as a Remotion frame renders from scratch and never reorders a stateful list |

Web app: rules whose subject only the web app has.

| Rule | Tier | Holds |
|---|---|---|
| route-thinness | oxlint | a route reaches no server module or engine code |
| server-fn-placement, server-fn-validation, no-deprecated-input-validator, no-plain-export-in-server-fn-module | oxlint | server functions live in controllers, validate their input, and share no module with plain exports |
| no-disable-validation | oxlint | an Effect Schema never skips validation |
| no-inline-color, no-inline-font-size, no-inline-style-prop, no-raw-primitives, no-stylex-border-shorthand, vendor-component-containment | oxlint | styling goes through the design system's tokens and primitives |
| barrel-purity | structural | a feature barrel never reaches a server-only package |
| css-tokens, shadow-source, token-equality | structural | stylesheet values, shadows and spacing name their tokens |
