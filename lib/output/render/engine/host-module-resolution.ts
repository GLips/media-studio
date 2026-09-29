// host-module-resolution.ts: lets a scene's bundle follow a host's own imports (see lib/platform/host/engine/hosts.ts).
//
// Host files import through their package's tsconfig `paths` (tk's apps/web has `@/*` → ./src/*). Those aliases
// belong to one package, not to the host, so each import is resolved against the tsconfig nearest the importing
// file, and only for files inside the host. Bare imports need nothing: webpack follows the host link to its real
// path, so it walks up through the host package's node_modules and the host root's by itself.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import type { webpack } from '@remotion/bundler';

export type TsconfigPathAliases = { basePath: string; paths: Record<string, string[]> };

// tsconfig is JSONC: comments and trailing commas, which JSON.parse rejects.
function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const end = text.indexOf('"', i + 1);
      let close = end;
      while (close !== -1 && isEscaped(text, close)) close = text.indexOf('"', close + 1);
      out += text.slice(i, close + 1);
      i = close;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function isEscaped(text: string, quote: number) {
  let backslashes = 0;
  for (let j = quote - 1; text[j] === '\\'; j--) backslashes++;
  return backslashes % 2 === 1;
}

type TsconfigJson = { extends?: string | string[]; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };

function resolveExtendedTsconfig(fromConfig: string, spec: string) {
  if (spec.startsWith('.') || isAbsolute(spec)) {
    const path = resolve(dirname(fromConfig), spec);
    return existsSync(path) || path.endsWith('.json') ? path : `${path}.json`;
  }
  const require = createRequire(fromConfig);
  for (const candidate of [spec, `${spec}.json`, `${spec}/tsconfig.json`]) {
    try {
      return require.resolve(candidate);
    } catch {}
  }
  throw new Error(`host bundle: ${fromConfig} extends "${spec}", which doesn't resolve`);
}

/**
 * The `paths` a tsconfig ends up with after `extends`, and the directory they're relative to (the nearest
 * `baseUrl`, else the directory of the tsconfig that declared them). Null when it has none.
 */
export function readTsconfigPathAliases(configPath: string): TsconfigPathAliases | null {
  const json = parseJsonc(readFileSync(configPath, 'utf8')) as TsconfigJson;
  const own = json.compilerOptions ?? {};
  // Later entries of an `extends` array win, as tsc applies them in order.
  const parents = [json.extends ?? []].flat().map((spec) => readTsconfigPathAliases(resolveExtendedTsconfig(configPath, spec)));
  const inherited = parents.reduce<TsconfigPathAliases | null>((acc, parent) => parent ?? acc, null);
  const baseUrl = own.baseUrl === undefined ? undefined : resolve(dirname(configPath), own.baseUrl);
  if (own.paths) return { basePath: baseUrl ?? dirname(configPath), paths: own.paths };
  if (inherited && baseUrl) return { ...inherited, basePath: baseUrl };
  return inherited;
}

/** Absolute candidates for a specifier, in tsc's order: the matching pattern with the longest prefix, then its targets. */
export function matchTsconfigPathAlias({ basePath, paths }: TsconfigPathAliases, specifier: string): string[] {
  let best: { prefix: string; star: string | null; targets: string[] } | null = null;
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === specifier) return targets.map((t) => resolve(basePath, t));
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (best && best.prefix.length >= prefix.length) continue;
    best = { prefix, star: specifier.slice(prefix.length, specifier.length - suffix.length), targets };
  }
  if (!best) return [];
  const { star, targets } = best;
  return targets.map((t) => resolve(basePath, t.replace('*', star ?? '')));
}

/** Where `@host/<path>` points: a host file, or a package as the host directory before `node_modules/` sees it. */
export function resolveHostImport(hostRoot: string, specifier: string): { fromDir: string; request: string } | null {
  if (!specifier.startsWith('@host/')) return null;
  const path = `/${specifier.slice('@host/'.length)}`;
  const at = path.indexOf('/node_modules/');
  if (at === -1) return { fromDir: hostRoot, request: join(hostRoot, path) };
  return { fromDir: join(hostRoot, path.slice(0, at)), request: path.slice(at + '/node_modules/'.length) };
}

/**
 * A webpack resolve plugin for a scene's `@host/…` imports. A package is re-resolved as a bare import from the host
 * directory, not opened as a folder: a folder import reads package.json's `main`, the host's own imports read its
 * `exports`, and when those differ the scene gets a second copy of the package (and of its React contexts).
 */
export class HostImportPlugin {
  readonly hostRoot: string;

  constructor(hostRoot: string) {
    this.hostRoot = hostRoot;
  }

  apply(resolver: webpack.Resolver) {
    const target = resolver.ensureHook('resolve');
    resolver.getHook('described-resolve').tapAsync('HostImportPlugin', (request, context, callback) => {
      const hostImport = request.request ? resolveHostImport(this.hostRoot, request.request) : null;
      if (!hostImport) return callback();
      const next = { ...request, path: hostImport.fromDir, request: hostImport.request };
      resolver.doResolve(target, next, `host import ${request.request}`, context, (err, result) => {
        if (err) return callback(err);
        if (!result) return callback(new Error(`host bundle: ${request.request} doesn't resolve (${hostImport.request} from ${hostImport.fromDir})`));
        callback(null, result);
      });
    });
  }
}

/** A webpack resolve plugin that applies host tsconfig `paths` to imports made by files under `hostRoot` (a real path). */
export class HostTsconfigPathsPlugin {
  readonly hostRoot: string;
  // Keyed by directory: the aliases of the tsconfig nearest it, or null for none.
  private readonly aliasesByDir = new Map<string, TsconfigPathAliases | null>();

  constructor(hostRoot: string) {
    this.hostRoot = hostRoot;
  }

  apply(resolver: webpack.Resolver) {
    const target = resolver.ensureHook('resolve');
    resolver.getHook('described-resolve').tapAsync('HostTsconfigPathsPlugin', (request, context, callback) => {
      const { path: fromDir, request: specifier } = request;
      if (!fromDir || !specifier || specifier.startsWith('.') || isAbsolute(specifier) || !this.isHostSource(fromDir)) return callback();
      const aliases = this.aliasesFor(fromDir);
      const candidates = aliases ? matchTsconfigPathAlias(aliases, specifier) : [];
      const tryCandidate = (i: number): void => {
        if (i === candidates.length) return callback();
        resolver.doResolve(target, { ...request, request: candidates[i] }, `host tsconfig path ${specifier} → ${candidates[i]}`, context, (err, result) => {
          if (err) return callback(err);
          if (result) return callback(null, result);
          tryCandidate(i + 1);
        });
      };
      tryCandidate(0);
    });
  }

  // A host's dependencies are compiled against their own settings, never the host app's aliases.
  private isHostSource(dir: string) {
    return (dir === this.hostRoot || dir.startsWith(this.hostRoot + sep)) && !dir.includes(`${sep}node_modules${sep}`);
  }

  private aliasesFor(dir: string): TsconfigPathAliases | null {
    const cached = this.aliasesByDir.get(dir);
    if (cached !== undefined) return cached;
    const config = join(dir, 'tsconfig.json');
    let aliases: TsconfigPathAliases | null;
    if (existsSync(config)) aliases = readTsconfigPathAliases(config);
    else aliases = dir === this.hostRoot ? null : this.aliasesFor(dirname(dir));
    this.aliasesByDir.set(dir, aliases);
    return aliases;
  }
}

/**
 * A webpack resolve plugin that bundles an empty module in place of any host file matching `globs` (relative to
 * `hostRoot`, a real path), as webpack's `alias: { x: false }` does. For server-only code a component's module graph
 * reaches but never runs while it renders: a framework's build strips it from the browser bundle, and this bundle
 * doesn't run that build. Imports of a stubbed module read undefined.
 */
export class HostModuleStubPlugin {
  readonly hostRoot: string;
  readonly globs: readonly string[];

  constructor(hostRoot: string, globs: readonly string[]) {
    this.hostRoot = hostRoot;
    this.globs = globs;
  }

  apply(resolver: webpack.Resolver) {
    resolver.getHook('resolved').tapAsync('HostModuleStubPlugin', (request, _context, callback) => {
      const file = request.path;
      if (!file) return callback();
      const fromHost = relative(this.hostRoot, file);
      if (fromHost.startsWith('..') || !this.globs.some((glob) => matchesGlob(fromHost, glob))) return callback();
      callback(null, { ...request, path: false });
    });
  }
}
