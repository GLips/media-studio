// node harness/stamp-paint-gate.ts run (npm run stamp:gate -- run): the GPU gate (lib/paint/gate). It
// runs the renderer's formulas, paints synthetic paintings and traces a resolve on the GPU, and holds each to its
// accepted baseline (harness/fixtures/stamp-paint/), its CPU twin or its frame. `update <ids> --reason` writes
// candidates with their differences; `accept <ids>` replaces the baselines with them. `staged` is what pre-commit runs; it runs `staged-tree` inside the written-out index.
// `private run|update|accept` does the same for pack brushes, into the workspace's work/validation/stamp-paint/.
import { defineCommand } from 'citty';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptStampGateCandidates, STAMP_GATE_PUBLIC_STORE } from '#lib/paint/gate/engine/stamp-gate-store.ts';
import { runStampGatePrivate, updateStampGatePrivate } from '#lib/paint/gate/engine/stamp-gate-private.ts';
import { runStagedStampGate } from '#lib/paint/gate/engine/stamp-gate-staged.ts';
import { stampGateImportedFiles, stampGateReachedBy } from '#lib/paint/gate/engine/stamp-gate-reach.ts';
import { runStampGate, STAMP_GATE_PAGE, stampGateBaselineIds, updateStampGate, type StampGateCheck } from '#lib/paint/gate/engine/stamp-gate.ts';
import { STUDIO_STYLES_DIR, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const PRIVATE_STORE = join(STUDIO_WORKSPACE_DIR, 'validation', 'stamp-paint');
const PRIVATE_BRUSHES = [
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Medium Wash Slow" },
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Opaque Thicker" },
  { style: 'watercolor', pack: 'vvds', name: 'Main Watercolor Brush' },
  { style: 'watercolor', pack: 'vvds', name: 'Super Wet Watercolor Brush' },
];

function report(checks: readonly StampGateCheck[]) {
  for (const { id, passed, detail } of checks) console.log(`${passed ? 'ok  ' : 'FAIL'} ${id}: ${detail}`);
  const failed = checks.filter((check) => !check.passed);
  console.log(`stamp gate: ${checks.length - failed.length} of ${checks.length} held${failed.length ? `; failed ${failed.map((c) => c.id).join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 1;
}

/** IDs from positional arguments; `all` is every baseline subject's, which only a first seeding should want. */
const idsArg = (raw: readonly string[]) => (raw.includes('all') ? stampGateBaselineIds() : [...raw]);

const reasonArg = { type: 'string', required: true, description: 'Why the baselines change, recorded with them when accepted' } as const;

const runCommand = defineCommand({
  meta: { name: 'run', description: 'Run the gate: formulas against their baselines or CPU twins, paintings against their baselines, a trace against its frame. Fails on any difference, a missing adapter or a changed input.' },
  async run() {
    report(await runStampGate(STAMP_GATE_PUBLIC_STORE));
  },
});

const updateCommand = defineCommand({
  meta: { name: 'update', description: 'Write candidates for the named baselines (e.g. painting/regions formula/pooled, or all), with how each differs, into harness/fixtures/stamp-paint/candidates/. Replaces no baseline.' },
  args: { reason: reasonArg },
  async run({ args }) {
    const ids = idsArg(args._);
    if (!ids.length) throw new Error(`stamp gate: name the baselines to update: ${stampGateBaselineIds().join(', ')}`);
    for (const { id, files, comparison } of await updateStampGate(STAMP_GATE_PUBLIC_STORE, ids, args.reason)) console.log(`${id}: ${comparison}\n  ${files.join('\n  ')}`);
  },
});

const acceptCommand = defineCommand({
  meta: { name: 'accept', description: 'Replace the named baselines with their candidates, recording each reason, day and commit in the manifest.' },
  run({ args }) {
    const ids = idsArg(args._);
    if (!ids.length) throw new Error('stamp gate: name the candidates to accept');
    console.log(acceptStampGateCandidates(STAMP_GATE_PUBLIC_STORE, ids).join('\n'));
  },
});

const stagedCommand = defineCommand({
  meta: { name: 'staged', description: "Pre-commit's gate: write out the index and run its own staged-tree verb on it, all within its deadline." },
  run() {
    const { passed, seconds } = runStagedStampGate(process.cwd());
    if (!passed) console.log(`stamp gate: FAILED on the staged tree after ${seconds.toFixed(1)} s`);
    if (!passed) process.exitCode = 1;
  },
});

const stagedTreeCommand = defineCommand({
  meta: { name: 'staged-tree', description: 'Run inside a written-out index by staged: the staged paths, NUL-separated, on stdin; runs the gate when one of them is a file it imports or reads.' },
  async run() {
    const staged = readFileSync(0, 'utf8').split('\0').filter(Boolean);
    const reached = stampGateReachedBy(staged, await stampGateImportedFiles(process.cwd(), STAMP_GATE_PAGE));
    if (!reached.length) return;
    const started = performance.now();
    report(await runStampGate(STAMP_GATE_PUBLIC_STORE));
    console.log(`stamp gate: ran in ${((performance.now() - started) / 1000).toFixed(1)} s on the staged tree for ${reached.slice(0, 3).join(', ')}${reached.length > 3 ? ', …' : ''}`);
  },
});

const privateCommand = defineCommand({
  meta: { name: 'private', description: 'Pack brushes painted in each private case, held to baselines in work/validation/stamp-paint/: run, update --reason, or accept <ids|all>.' },
  subCommands: {
    run: defineCommand({ meta: { name: 'run', description: 'Hold every private painting to its baseline' }, async run() {
      report(await runStampGatePrivate(PRIVATE_STORE, STUDIO_STYLES_DIR, PRIVATE_BRUSHES));
    } }),
    update: defineCommand({ meta: { name: 'update', description: 'Write candidates for every private painting' }, args: { reason: reasonArg }, async run({ args }) {
      for (const { id, comparison } of await updateStampGatePrivate(PRIVATE_STORE, STUDIO_STYLES_DIR, PRIVATE_BRUSHES, args.reason)) console.log(`${id}: ${comparison}`);
    } }),
    accept: defineCommand({ meta: { name: 'accept', description: 'Replace the named private baselines (or all candidates) with their candidates' }, run({ args }) {
      const candidates = join(PRIVATE_STORE, 'candidates');
      const all = readdirSync(candidates, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
      console.log(acceptStampGateCandidates(PRIVATE_STORE, args._.includes('all') ? all : args._).join('\n'));
    } }),
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'stamp-paint-gate', description: "The GPU gate: stamp paint's formulas, paintings and traces held to accepted baselines" },
  subCommands: { run: runCommand, update: updateCommand, accept: acceptCommand, staged: stagedCommand, 'staged-tree': stagedTreeCommand, private: privateCommand },
}));
