// studio remote: the studio's app on Modal, which `studio render --remote` and `studio look --remote` draw on and
// `studio remote run` runs the repo's checks on; its deployment and its containers; and the two verbs its render
// containers run (`job`, `keep-browsers`). docs/remote.md.
import { defineCommand } from 'citty';
import { openStudioRenderSession } from '../project-arg.ts';

const numberFlag = (text: string | undefined) => (text === undefined ? undefined : Number(text));
/** A flag given in minutes, as whole seconds. */
const minutesFlagSeconds = (text: string | undefined) => (text === undefined ? undefined : Math.round(Number(text) * 60));

const deployCommand = defineCommand({
  meta: {
    name: 'deploy',
    description: 'Deploy this checkout\'s version of the remote app (lib/platform/remote/engine/modal_remote_app.py) to your Modal account, named media-studio-remote-<8 hex> by its package-lock.json, this Node and the app\'s code: checkouts that differ in any deploy versions of their own and never touch each other\'s. Its image is built from package-lock.json and this Node, rebuilt only when either changes. Run it when a remote command says this checkout\'s version isn\'t deployed, or to change a setting; each deploy sets every setting, a flag left out going back to its default. Ends the containers this version\'s deployment before left, warm or busy (a busy one\'s call runs again on a new container). Prints what a warm container costs an hour.',
  },
  args: {
    gpu: { type: 'string', valueHint: 'T4', description: 'The GPU each render container has: T4 (the default), L4, A10 or L40S' },
    warm: { type: 'string', valueHint: '10', description: 'Minutes a render container stays warm after its last call, billed while it waits (default 10; Modal allows 2 seconds to 20 minutes)' },
    'check-warm': { type: 'string', valueHint: '2', description: 'Minutes a check container (studio remote run) stays warm after its last call (default 2): a cold check takes 13–19 s longer, laying the checkout out' },
    'max-containers': { type: 'string', valueHint: '4', description: 'Most render containers at once: a render splits across up to this many, about one per 600 frames (default 4)' },
    browsers: { type: 'string', valueHint: '3', description: 'Browsers each container draws its share in, a piece each at once (default 3); it keeps one more open, for the sound' },
  },
  async run({ args }) {
    const { deployRemote, describeRemoteSettings } = await import('#lib/platform/remote/engine/remote-admin.ts');
    const settings = deployRemote({
      gpu: args.gpu, warmSeconds: minutesFlagSeconds(args.warm), checkWarmSeconds: minutesFlagSeconds(args['check-warm']),
      maxContainers: numberFlag(args['max-containers']), browsers: numberFlag(args.browsers),
    });
    console.log([`deployed ${settings.app}:`, ...describeRemoteSettings(settings).map((line) => `  ${line}`)].join('\n'));
  },
});

const statusCommand = defineCommand({
  meta: { name: 'status', description: 'The versions of the remote app deployed, each with how many containers it has up now, and what this checkout\'s version runs renders and checks on and costs warm, or that it isn\'t deployed' },
  async run() {
    const { remoteStatus } = await import('#lib/platform/remote/engine/remote-admin.ts');
    for (const line of await remoteStatus()) console.log(line);
  },
});

const stopCommand = defineCommand({
  meta: { name: 'stop', description: 'Stop the containers of this checkout\'s version of the remote app, renders\' and checks\', now rather than when their warm window ends, so nothing bills; a call running in one fails, another checkout\'s of the same version too. Other versions\' containers run on unless --all' },
  args: {
    all: { type: 'boolean', default: false, description: 'Stop every version\'s containers (each media-studio-remote-<8 hex> app), not only this checkout\'s' },
  },
  async run({ args }) {
    const { stopRemote } = await import('#lib/platform/remote/engine/remote-admin.ts');
    const { mine, stopped } = stopRemote({ all: args.all });
    if (!stopped.length) console.log(args.all ? 'no version of the remote app is deployed' : `this checkout's version, ${mine}, isn't deployed: nothing to stop`);
    for (const { name, containers } of stopped) {
      console.log(`${name}: ${containers.length ? `stopped ${containers.length} container${containers.length > 1 ? 's' : ''}` : 'no containers were up'}`);
    }
  },
});

const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Run package.json scripts (typecheck, typecheck:gate, typecheck:web, lint, check:arch, test:gate, test:workspace, test or any other) in containers on the remote app, not on this machine: each in its own, all at once, against this checkout as it is on disk, both repositories with their uncommitted and untracked files, every project\'s media and every style\'s brushes. Each script\'s output streams here as it comes, marked with its name when there are several; a summary says how each ran and where its time went, then what each container billed. Exits 1 when any failed. A test runner (node --test) gets 16 cores and a T4, since tests render in the render browser; any other script 4 cores and no GPU. Refuses stamp:gate and other harness/ scripts, which need this Mac\'s GPU or Photoshop. Deploy first (studio remote deploy).',
  },
  args: {
    scripts: { type: 'positional', required: true, description: 'The scripts, as npm run names them, e.g. typecheck lint test:gate' },
  },
  async run({ args }) {
    const { formatRemoteRunOutcomes, runRemoteScripts } = await import('#lib/platform/remote/engine/remote-run.ts');
    const outcomes = await runRemoteScripts(args._.map(String));
    console.log(['', ...formatRemoteRunOutcomes(outcomes)].join('\n'));
    const failed = outcomes.filter((outcome) => outcome.exitCode !== 0).map((outcome) => outcome.script);
    if (failed.length) throw new Error(`remote run: ${failed.join(', ')} failed (${failed.length > 1 ? 'their' : 'its'} output is above)`);
  },
});

const jobCommand = defineCommand({
  meta: { name: 'job', description: 'In a remote render container: run a remote call\'s job (a JSON file) into a folder. The app runs this; you don\'t' },
  args: {
    file: { type: 'positional', required: true, description: 'The job, as JSON' },
    out: { type: 'string', required: true, description: 'The folder its files go into' },
  },
  async run({ args }) {
    const { readFileSync } = await import('node:fs');
    const { isRemoteRenderJob } = await import('#lib/output/remote-render/models/remote-render-job.ts');
    const { runRemoteRenderJob } = await import('#lib/output/remote-render/engine/remote-render-job-run.ts');
    const job: unknown = JSON.parse(readFileSync(args.file, 'utf8'));
    if (!isRemoteRenderJob(job)) throw new Error(`${args.file} isn't a remote render job: deploy the app and this checkout's code together`);
    await runRemoteRenderJob(job, { out: args.out, openSession: openStudioRenderSession });
  },
});

const keepBrowsersCommand = defineCommand({
  meta: { name: 'keep-browsers', description: 'In a remote render container: keep render browsers open in a folder for its renders to borrow, until stopped. The app runs this; you don\'t' },
  args: {
    dir: { type: 'string', required: true, description: 'The folder the browsers are kept in' },
    count: { type: 'string', required: true, description: 'How many browsers' },
  },
  async run({ args }) {
    const { keepRenderBrowsers } = await import('#lib/platform/browser/engine/kept-render-browsers.ts');
    const count = Number(args.count);
    if (!(Number.isInteger(count) && count > 0)) throw new Error(`--count is a whole number above 0, not ${args.count}`);
    await keepRenderBrowsers(args.dir, count);
  },
});

export default defineCommand({
  meta: { name: 'remote', description: 'The studio\'s app on Modal: render --remote and look --remote draw on its GPUs, and remote run runs the repo\'s checks on its CPUs. Deploy this checkout\'s version of it, see the versions deployed, stop their containers' },
  subCommands: { deploy: deployCommand, status: statusCommand, stop: stopCommand, run: runCommand, job: jobCommand, 'keep-browsers': keepBrowsersCommand },
});
