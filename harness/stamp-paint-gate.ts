// node harness/stamp-paint-gate.ts [run] (npm run stamp:gate, run by default): the GPU gate (lib/paint/gate). It
// runs the renderer's formulas, paints synthetic paintings and traces a resolve on the GPU, and holds each to its
// accepted baseline (harness/fixtures/stamp-paint/), its CPU twin or its frame. `update <ids> --reason` writes
// candidates with their differences; `accept <ids>` replaces the baselines with them. `pushed` is what pre-push runs; it runs `tree` inside each pushed commit, written out.
// `private run|update|accept` does the same for pack brushes, into the workspace's work/validation/stamp-paint/.
import { defineCommand } from 'citty';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptStampGateCandidates, STAMP_GATE_PUBLIC_STORE } from '#lib/paint/gate/engine/stamp-gate-store.ts';
import { runStampGatePrivate, updateStampGatePrivate, type StampGatePrivateBrush } from '#lib/paint/gate/engine/stamp-gate-private.ts';
import { STAMP_GATE_PRIVATE_FLAT_CASES } from '#lib/paint/gate/models/stamp-gate-private-cases.ts';
import { runPushedStampGate, runStampGateOnPushedTree, stampGatePushedCommits } from '#lib/paint/gate/engine/stamp-gate-pushed.ts';
import { runStampGate, stampGateBaselineIds, updateStampGate, type StampGateCheck } from '#lib/paint/gate/engine/stamp-gate.ts';
import { STUDIO_STYLES_DIR, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const PRIVATE_STORE = join(STUDIO_WORKSPACE_DIR, 'validation', 'stamp-paint');
// The flat cases hold the four the studio's paintings lean on; the wash case holds each in its style's medium and paper,
// with two bristle brushes whose gaps the water mustn't bridge.
const PRIVATE_ALL_CASES = [...STAMP_GATE_PRIVATE_FLAT_CASES, 'wash'] as const;
const PRIVATE_BRUSHES: readonly StampGatePrivateBrush[] = [
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Medium Wash Slow", cases: PRIVATE_ALL_CASES },
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Opaque Thicker", cases: PRIVATE_ALL_CASES },
  { style: 'watercolor', pack: 'vvds', name: 'Main Watercolor Brush', cases: PRIVATE_ALL_CASES },
  { style: 'watercolor', pack: 'vvds', name: 'Super Wet Watercolor Brush', cases: PRIVATE_ALL_CASES },
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Sparse Bristle", cases: ['wash'] },
  { style: 'gouache', pack: 'kyle-gouache', name: "Kyle's Paintbox - Gouache Bristle Super Dry", cases: ['wash'] },
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

const pushedCommand = defineCommand({
  meta: { name: 'pushed', description: "Pre-push's gate: pre-push's stdin names the pushed refs; each pushed commit is written out and its own tree verb runs on it." },
  run() {
    const root = process.cwd();
    for (const { sha, paths } of stampGatePushedCommits(root, readFileSync(0, 'utf8'))) {
      const { passed, seconds } = runPushedStampGate(root, sha, paths);
      if (!passed) console.log(`stamp gate: FAILED on ${sha.slice(0, 8)} after ${seconds.toFixed(1)} s`);
      if (!passed) process.exitCode = 1;
    }
  },
});

const treeCommand = defineCommand({
  meta: { name: 'tree', description: 'Run inside a written-out commit by pushed: the paths it carries, NUL-separated, on stdin. When one of them is a file the gate imports or reads, it waits for the whole GPU, then runs the gate within its deadline.' },
  async run() {
    const ran = await runStampGateOnPushedTree(process.cwd(), readFileSync(0, 'utf8').split('\0').filter(Boolean));
    if (!ran) return;
    const { checks, reached, seconds } = ran;
    report(checks);
    console.log(`stamp gate: ran in ${seconds.toFixed(1)} s on the pushed tree for ${reached.slice(0, 3).join(', ')}${reached.length > 3 ? ', …' : ''}`);
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
  default: 'run',
  subCommands: { run: runCommand, update: updateCommand, accept: acceptCommand, pushed: pushedCommand, tree: treeCommand, private: privateCommand },
}), 'exclusive');
