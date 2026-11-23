# lint/

One lint system with two tiers. They're split by what a rule can see, and both read the tree's layout from one place.

```
policy/studio-tree.ts   where a path sits: lib areas, features and roles, projects, cli, harness, web places
policy/*.ts             tables the checks read: SDK owners, timing constructors
structural/             whole-tree checks (npm run check:arch, check-arch.ts)
oxlint/                 per-file rules, run by oxlint.config.ts (npm run lint, lint.ts)
candidate-snapshot.ts   the files both tiers read: the working tree by hand, the index under a hook
gate-scope.ts           a scope (the studio, or work/): its repository, mount and baseline
gate-every-scope.ts     a run with no --scope: each scope there is, side by side
baseline.ts             how both tiers count findings against a baseline
arch-baseline.json      the studio's baselined findings, both tiers; work/arch-baseline.json is the workspace's
language-service-policy.test.ts   tsconfig.effect.json against the diagnostics @effect/tsgo ships
```

**Layout comes from `studio-tree.ts` alone.** No rule lists directories. A rule about features, barrels, layers or
roles asks `classifyStudioPath` for a file's position, so a folder is covered the moment it's declared there. A file
no position covers is itself a finding (`declared-tree`). Rules about code quality apply to every TypeScript file,
by file type, lint/ and work/ included. Web-only rules are about the web app's subjects (server functions, its
design system, its routes), and they decide from a file's position whether it's one of them. Where oxlint needs
globs, they're declared in studio-tree.ts beside the positions: `TERMINAL_PROGRAM_GLOBS` (no-console is off, as
the console is their output) and `DEFAULT_EXPORT_MODULE_GLOBS` (loaded by path for their default export).

## The tiers

**Which scope.** check:arch and lint judge one scope at a time: `public`, the studio's repository as a clean clone
holds it, or `workspace`, work/'s, read beside the studio's. Each has its own baseline, and each hook names its own
scope. Run by hand with no `--scope`, either judges the studio and, when work/ is a workspace, work/ too, so a project
is judged by hand as its commit will be. Each scope runs in its own process, the same `--scope` run its hook makes,
but over the working tree (unless `--snapshot index`) and outside any hook's git environment. The run opens by naming
the scopes it judges and closes with each one's verdict. `check:arch -- --rev <commit>` judges the studio alone.

**What both tiers read.** Run by hand, check:arch and lint read the working tree, untracked files included,
so a project is checked before it's added. The pre-commit hooks pass `--snapshot index`: only what the commit holds,
so another session's half-written file can't block it, and each lists the sources it left unchecked. check:arch reads
the index's text; oxlint reads the index's files from disk. `check:arch -- --rev <commit>` reads a committed tree.
`--update-baseline` counts only the index, as the hook judges it: a baseline excuses what a commit holds, so stage a
fix before rewriting it. It only shrinks a baseline: each entry falls to the count found, and a finding past it is
left out, still blocking, so a new project's violations are never excused. With no `--scope` it shrinks each scope's
baseline. Adding entries is deliberate and names one scope: `--scope <s> --update-baseline --admit-new` excuses a new
rule's existing violations or a moved file's. A scope's repository, mount and baseline file are `lint/gate-scope.ts`'s.

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
`npm run lint` runs oxlint over the studio and work/, `-- --scope public` or `-- --scope workspace` over one; a
warning never blocks.
Rule specs use RuleTester; `lint/oxlintrc.test.ts` runs the real CLI once, because RuleTester builds no global
scope. `oxlint/lib/rule-file.ts` turns oxlint's filename into a studio position.

A rule belongs to the tier that can answer its question. Where an import lands, what a barrel drags in and what a type
resolves to are structural questions. What one file writes is a per-file question.

**The Effect language service** is a third tier, run by the typecheck rather than by lint. Whether an Effect is left
unrun, a failure goes unhandled or a `try` sits in a generator are questions about types inside Effect code, which only
the checker answers. `tsconfig.effect.json` is its policy: tsconfig.json and web/tsconfig.json extend it, and it names
every diagnostic `@effect/tsgo` ships at `error` or `off`, each `off` with its reason. `npm run typecheck` (and `:gate`,
`:web`) runs `effect-tsgo tsc`, the language service's build of the installed TypeScript, which reports type errors and
the policy in one pass; plain `tsc` ignores `plugins`. Both commit hooks typecheck through it, the workspace's too. `language-service-policy.test.ts` fails when an upgrade adds or
drops a diagnostic, until the policy names it. A source exception is `// @effect-diagnostics-next-line <rule>:off` with
the reason beside it. The oxlint Effect rules below hold what the checker doesn't: bans on named APIs and shapes.

## Rules

Studio: the checks written for this repo's own shape. All structural, all over the whole tree.

| Check | Holds |
|---|---|
| declared-tree | every source file sits at a position studio-tree.ts declares |
| import-policy | projects never import each other; lib crossings use `#lib/*`; studio never reaches engine; work/ stays private; the web app's rows: a feature is reached through its barrel, its layers import downward, shared and infrastructure never import upward, only `WEB_ENGINE_DOOR` reaches engine code, and client code reaches `.server` modules only from a feature's controllers |
| timing-ownership, scene-ownership | a project states timing only in storyboard.ts, with defineStoryboard, and builds no timeline; a scene reaches only its own folder, shared modules and the storyboard |
| model-purity | a model reaches no render, I/O or browser code through any chain |
| frame-determinism | a frame never reads a clock or randomness |
| capability-match | a project binds what its capability declares |
| sdk-containment | each SDK is reached only from its declared owners, each a distinct use (policy/sdk-owners.ts) |
| no-scratch, studio-temp, render-snapshot, brush-assets | no tracked file names scratch/; temp folders come from studio-temp; a render is read through its own snapshot; bought brush packs stay out of git |
| folder-width (advisory) | a lib folder past 15 source files groups them |

All TypeScript: quality rules over every TypeScript file in the repo.

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
| doc-budgets | structural | every standing doc (each CLAUDE.md, skill SKILL.md, skill references/ folder as one sum, docs/*.md) has a word ceiling in docs/doc-budgets.manifest.json and stays under it; a ceiling more than 40 words or 5% above its doc fails, and `--update-baseline` ratchets it down |
| skill-links | structural | a skill's `${CLAUDE_PLUGIN_ROOT}/…` and relative links resolve, and it names no bare `docs/` or `lib/` path, `npm run` or `node cli/` |
| barrel-discoverability | structural | a barrel names what it exports |
| test-file-mirror (advisory) | structural | a spec sits beside the module it's named for |
| feature-layers | structural | a lib foundation (`LIB_LAYERS`, lowest first) imports only foundations of its own layer or a lower one |
| feature-visibility | structural | a feature imported from another feature grants it, with a reason, in its visibility.json (one finding per ungranted pair); a foundation needs no grant and keeps no grant file |
| feature-cycles | structural | no feature imports one that imports it back (one finding per import inside a cycle) |
| no-test-imports | structural | only a spec imports a spec |
| oxlint's built-ins | oxlint | the correctness, suspicious and perf categories, type-aware `typescript/*`, sonarjs duplication, `import/*` (oxlint.config.ts). Off: `typescript/no-unsafe-type-assertion`, whose sites require-safety-comment governs with an escape it lacks; `react/no-array-index-key` outside web/, as a Remotion frame renders from scratch and never reorders a stateful list |

Web app: rules whose subject only the web app has.

| Rule | Tier | Holds |
|---|---|---|
| route-thinness | oxlint | a route reaches no server module or engine code |
| server-fn-placement, server-fn-validation, no-deprecated-input-validator, no-plain-export-in-server-fn-module | oxlint | server functions live in controllers, validate their input, and share no module with plain exports |
| no-inline-color, no-inline-font-size, no-inline-style-prop, no-raw-primitives, no-stylex-border-shorthand, vendor-component-containment | oxlint | styling goes through the design system's tokens and primitives |
| barrel-purity | structural | a feature barrel never reaches a server-only package |
| css-tokens, shadow-source, token-equality | structural | stylesheet values, shadows and spacing name their tokens |

Effect: rules over Effect code wherever it sits, then rules for the Effect-native features (`EFFECT_NATIVE_FEATURES` in
studio-tree.ts), which a feature joins by being listed. Their CLI verbs (`EFFECT_NATIVE_CLI_VERBS`, beside it) are
thin doors that run the features' Effects, held by the io, failures and json rules as an engine is.

| Rule | Tier | Holds |
|---|---|---|
| Effect language service | tsc | Effect code does what it reads as: no unrun Effect, unhandled failure or requirement, `try` in a generator, `Error`-typed failure, or clock, console, env or JSON read around its services (tsconfig.effect.json) |
| no-disable-validation | oxlint | a schema's constructor never skips its checks (`disableChecks`) |
| no-nested-layer-provide | oxlint | each `Layer.provide` edge is one line between named layers |
| no-effect-catchcause | oxlint | a handler sees only declared errors; a defect reaches runStudioEffect with its stack |
| no-silent-error-swallow | oxlint | no catch handler answers a failure with `Effect.void` |
| no-manual-tag-comparison | oxlint | code branches on `_tag` through Match, `Predicate.isTagged` or `catchTag`, so a new variant is a compile error |
| no-service-option | oxlint | a service stays in its program's requirements, so a missing layer is a compile error |
| require-error-message | oxlint | a tagged error says what went wrong in its own `message`, the line the CLI prints |
| no-discarding-catch | oxlint | in the web app and Effect-native features, a catch handler reads the failure it was handed |
| effect-native-io | oxlint | an Effect-native engine or verb reaches files, processes and the network only through Effect services: no Node disk, process, network, stream or thread module, no process launcher, no promise-world `ffmpeg.ts` (StudioFfmpeg instead) |
| effect-native-failures | oxlint | an Effect-native engine or verb fails only with tagged errors: no `throw`, `try` or native `Error` |
| effect-native-json | oxlint | an Effect-native feature or verb decodes JSON with its Schema, never `JSON.parse`, destructured or not |
| effect-native-promises | oxlint | an Effect-native engine builds and chains no promise: no `Effect.promise` (`tryPromise` with a tagged `catch`), `new Promise`, `Promise.*`, or `.then`/`.catch`/`.finally` off anything but Effect's own modules |
| effect-native-exports | structural | an Effect-native engine exports no function returning a promise; a promise-world caller runs its Effects through runStudioEffect |

Not ported from tk2's Effect rules: `no-sql-type-parameter` (the studio has no SQL) and `require-failure-disclosure`,
whose subject is tk2's public answer at a door. Its half that fits here is require-error-message: the studio's one
door is the CLI, which prints an error's message.
