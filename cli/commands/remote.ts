// studio remote: the remote render app on Modal that `studio render --remote` and `studio look --remote` draw on, its
// deployment and its containers; and the two verbs its containers run (`job`, `keep-browsers`). docs/remote-render.md.
import { defineCommand } from 'citty';
import { openStudioRenderSession } from '../project-arg.ts';

const numberFlag = (text: string | undefined) => (text === undefined ? undefined : Number(text));

const deployCommand = defineCommand({
  meta: {
    name: 'deploy',
    description: 'Deploy the remote render app (lib/output/remote-render/engine/modal_render_app.py) to your Modal account: its image built from package-lock.json and this Node, rebuilt only when either changes. Run it again after either changes, or to change a setting; each deploy sets every setting, a flag left out going back to its default. Stops the containers the deployment before it left warm. Prints what a warm container costs an hour.',
  },
  args: {
    gpu: { type: 'string', valueHint: 'T4', description: 'The GPU each render container has: T4 (the default), L4, A10 or L40S' },
    warm: { type: 'string', valueHint: '10', description: 'Minutes a container stays warm after its last call, billed while it waits (default 10; Modal allows 2 seconds to 20 minutes)' },
    'max-containers': { type: 'string', valueHint: '4', description: 'Most render containers at once: a render splits across up to this many, about one per 600 frames (default 4)' },
    browsers: { type: 'string', valueHint: '3', description: 'Browsers each container keeps open, each drawing a piece of its share at once (default 3)' },
  },
  async run({ args }) {
    const { deployRemoteRender, describeRemoteSettings } = await import('#lib/output/remote-render/engine/remote-admin.ts');
    const warmMinutes = numberFlag(args.warm);
    const { settings, stopped } = await deployRemoteRender({
      gpu: args.gpu, warmSeconds: warmMinutes === undefined ? undefined : Math.round(warmMinutes * 60),
      maxContainers: numberFlag(args['max-containers']), browsers: numberFlag(args.browsers),
    });
    console.log(`deployed: ${describeRemoteSettings(settings)}${stopped ? `; stopped the ${stopped} container${stopped > 1 ? 's' : ''} the last deployment left warm` : ''}`);
  },
});

const statusCommand = defineCommand({
  meta: { name: 'status', description: 'What the deployed remote render app runs on and costs warm, and how many of its containers are up now' },
  async run() {
    const { remoteRenderStatus } = await import('#lib/output/remote-render/engine/remote-admin.ts');
    for (const line of await remoteRenderStatus()) console.log(line);
  },
});

const stopCommand = defineCommand({
  meta: { name: 'stop', description: 'Stop the remote render app\'s containers now rather than when their warm window ends, so nothing bills; a call running in one fails' },
  async run() {
    const { stopRemoteRender } = await import('#lib/output/remote-render/engine/remote-admin.ts');
    const stopped = await stopRemoteRender();
    console.log(stopped ? `stopped ${stopped} container${stopped > 1 ? 's' : ''}` : 'no containers were up');
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
  meta: { name: 'remote', description: 'The remote render app on Modal that render --remote and look --remote draw on: deploy it, see it, stop its containers' },
  subCommands: { deploy: deployCommand, status: statusCommand, stop: stopCommand, job: jobCommand, 'keep-browsers': keepBrowsersCommand },
});
