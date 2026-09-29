`harness/` is tooling for building the studio itself, not for authoring: the rigs that measure the stamp renderer
against its references. One file per rig, run as `node harness/<rig>.ts <verb>` or through npm:

- `photoshop.ts` (`npm run photoshop -- check|probes|references|restore`): Photoshop 2026's own renders, by script.
- `procreate.ts` (`npm run procreate -- probes|capture`): the parked Procreate rig on a USB iPad.
- `brush-fidelity.ts` (`npm run brushes:sheet`, `npm run brushes:fit`): the fidelity sheet and the reading fit.

- An entry point stays thin: argument parsing and wiring over `lib/`'s `engine` and `models`, run through
  `run-harness-command.ts`. The machinery lives in `lib/`. It has `cli/`'s import rights (`lint/policy/studio-tree.ts`).
- A verb an author runs to make, check, preview or render belongs in `cli/` (`studio`), not here.
