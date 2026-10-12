`cli/` is the `studio` command: `studio-command.ts` registers a file per command in `commands/`; `studio.ts` runs it.

- It's what an author runs to make, check, preview and render projects, styles and brand kits. Tooling for building
  the studio itself (capture rigs, fitting, fidelity sheets) belongs in `harness/`, not here.
- A command stays thin: argument parsing and wiring over `lib/`'s `engine` and `models`. The machinery lives in `lib/`.
- `--help` is the reference skills point at: `meta.description` is a one-line summary, `meta.about` the rest.
  Renaming a verb or flag fails `skill-command-drift.test.ts` until the skills that write it are updated.
