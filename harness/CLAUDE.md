`harness/` is tooling for building the studio itself, not for authoring: the rigs that measure the stamp renderer
against its references. One file per rig, run as `node harness/<rig>.ts <verb>` or through npm:

- `photoshop.ts` (`npm run photoshop -- check|probes|references|restore`): Photoshop 2026's own renders, by script.
- `brush-fidelity.ts` (`npm run brushes:sheet`, `npm run brushes:fit`, `npm run brushes:diagnose`,
  `npm run brushes:hand`): the fidelity sheet, the Procreate reading fit, the Photoshop reading's per-brush diagnostic
  and the stroke hand sheet.
- `stamp-paint-guard.ts` (`npm run brushes:guard -- fingerprint|brushes|reports`): holds a restructuring of the brush
  engine to painting nothing visibly differently, brush by brush: stamp fingerprints, brush snapshots and sheet-report
  diffs, each to a tolerance.
- `stamp-reference.ts` (`npm run stamp:reference -- probes <run>`): the slow CPU reference renderer against a
  Photoshop probe run, each cell's error split among the stages that own it.

- An entry point stays thin: argument parsing and wiring over `lib/`'s `engine` and `models`, run through
  `run-harness-command.ts`. The machinery lives in `lib/`. It has `cli/`'s import rights (`lint/policy/studio-tree.ts`).
- A verb an author runs to make, check, preview or render belongs in `cli/` (`studio`), not here.
