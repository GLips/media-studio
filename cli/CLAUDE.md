`cli/` is the `studio` command: `studio.ts` registers a file per command in `commands/`.

- It's what an author runs to make, check, preview and render projects, styles and brand kits. Tooling for building
  the studio itself (capture rigs, fitting, fidelity sheets) belongs in `harness/`, not here.
- A command stays thin: argument parsing and wiring over `lib/`'s `engine` and `models`. The machinery lives in `lib/`.
