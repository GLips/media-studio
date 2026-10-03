`harness/` is tooling for building the studio itself, not for authoring: the rigs that measure the stamp renderer
against its references. One file per rig, run as `node harness/<rig>.ts <verb>` or through npm:

- `photoshop.ts` (`npm run photoshop -- check|probes|references|restore`): Photoshop 2026's own renders, by script.
- `brush-fidelity.ts` (`npm run brushes:sheet`, `npm run brushes:fit`, `npm run brushes:diagnose`,
  `npm run brushes:hand`, `npm run brushes:fills`, `npm run brushes:probes -- <run>`): the fidelity sheet, the
  Procreate reading fit, the Photoshop reading's per-brush diagnostic, the stroke hand and fill sheets, and a
  Photoshop probe run scored cell by cell on the GPU renderer's stage trace, each cell's error split among the stages
  that own it.
- `stamp-paint-guard.ts` (`npm run brushes:guard -- fingerprint|brushes|reports`): holds a restructuring of the brush
  engine to painting nothing visibly differently, brush by brush: stamp fingerprints, brush snapshots and sheet-report
  diffs, each to a tolerance.
- `stamp-paint-gate.ts` (`npm run stamp:gate [-- run|update <ids> --reason …|accept <ids>|staged|private …]`): the
  GPU renderer held to accepted formula grids and paintings (fixtures in `fixtures/stamp-paint/`); bare, it runs the
  gate; pre-commit runs `staged`.

- An entry point stays thin: argument parsing and wiring over `lib/`'s `engine` and `models`, run through
  `run-harness-command.ts`. The machinery lives in `lib/`. It has `cli/`'s import rights (`lint/policy/studio-tree.ts`).
- A verb an author runs to make, check, preview or render belongs in `cli/` (`studio`), not here.
