// studio hosts: the product repos videos are about. See lib/platform/host/engine/hosts.ts.
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

const syncHostsCommand = defineCommand({
  meta: {
    name: 'sync',
    description: "Check out the project's host at the ref in its host.json into ~/.cache/studio/hosts (or use the working copy hosts.local.json names) and link it at <project>/host, which scenes import as @host/…. Prints the host as JSON.",
  },
  args: {
    project: studioProjectArg,
    install: { type: 'boolean', default: false, description: "Also install the host's packages in the checkout, with the package manager its lockfile names" },
  },
  async run({ args }) {
    const { syncProjectHost } = await import('#lib/platform/host/engine/hosts.ts');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const synced = syncProjectHost(resolveStudioProject(args.project), { install: args.install });
    console.log(JSON.stringify(synced, null, 2));
  },
});

const listHostsCommand = defineCommand({
  meta: { name: 'list', description: 'Print every host (work/hosts.json, work/hosts.local.json) and the projects about it, as JSON.' },
  async run() {
    const { listHosts } = await import('#lib/platform/host/engine/hosts.ts');
    console.log(JSON.stringify(listHosts(), null, 2));
  },
});

export default defineCommand({
  meta: {
    name: 'hosts',
    description: 'Product repos a video is about. work/hosts.json maps a name to its git repo; work/hosts.local.json (gitignored) maps it to a working copy on this machine; <project>/host.json { name, ref, browserStubs? } opts a project in, browserStubs being globs of server-only host files the bundle empties.',
  },
  subCommands: { sync: syncHostsCommand, list: listHostsCommand },
});
