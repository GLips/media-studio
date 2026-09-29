// project-host-spec.ts: a project's host.json and host link (see lib/platform/host/engine/hosts.ts). Its own module, free of
// import.meta, because lib/output/render/engine/project-bundle.ts reads it and the Remotion CLI bundles that to CommonJS.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectHostSpec = {
  name: string;
  ref: string;
  /** Host files (globs from the host root) the bundle replaces with an empty module. See HostModuleStubPlugin. */
  browserStubs?: string[];
};

export const projectHostLink = (projectDir: string) => join(projectDir, 'host');

/** The project's host.json, or null when the video isn't about a host. */
export function readProjectHostSpec(projectDir: string): ProjectHostSpec | null {
  const path = join(projectDir, 'host.json');
  if (!existsSync(path)) return null;
  const spec = JSON.parse(readFileSync(path, 'utf8')) as ProjectHostSpec;
  if (typeof spec.name !== 'string' || typeof spec.ref !== 'string') throw new Error(`hosts: ${path} needs { "name": "<host>", "ref": "<branch, tag or commit>" }`);
  if (spec.browserStubs !== undefined && !(Array.isArray(spec.browserStubs) && spec.browserStubs.every((g) => typeof g === 'string'))) {
    throw new Error(`hosts: ${path} has a browserStubs that isn't a list of globs from the host root`);
  }
  return spec;
}
