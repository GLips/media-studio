// ─── node lint/rewrite-lib-imports.ts: relative imports into lib/ → aliases ──
//
// Rewrites every relative import that climbs into another lib feature
// (`lib/<area>/<feature>`) to its `#lib/*` alias, the fix for import-policy's crossing finding. It edits the
// working tree's tracked sources in place and reruns clean: a second run
// changes nothing. Every rewrite is checked by expanding the alias back to the
// file the relative path named.
//
//   node lint/rewrite-lib-imports.ts           rewrite, and list each file changed
//   node lint/rewrite-lib-imports.ts --check   list what would change; exit 1 if anything would

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { aliasForRepoPath, expandStudioAlias, libFeatureCrossedTo, normalizeRepoPath, STUDIO_WORKSPACE_MOUNT } from './policy/studio-tree.ts';
import { parseSourceFile, SOURCE_EXTENSIONS } from './structural/source-tree.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const imports = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { imports: Record<string, string> }).imports;
const SOURCE_RE = new RegExp(`\\.(${SOURCE_EXTENSIONS.join('|')})$`);
// The studio's tracked files and the workspace's, which is a repository of its own at work/ when there is one.
const trackedIn = (mount: string) => execFileSync('git', ['ls-files', '-z'], { cwd: join(root, mount), env: isolatedGitEnv(), encoding: 'utf8' })
  .split('\0').filter(Boolean).map((path) => (mount ? `${mount}/${path}` : path));
// Fixtures under a check's tests spell violations on purpose, but inside strings, which the parser never reads as imports.
const tracked = [...trackedIn(''), ...(existsSync(join(root, STUDIO_WORKSPACE_MOUNT, '.git')) ? trackedIn(STUDIO_WORKSPACE_MOUNT) : [])]
  .filter((path) => SOURCE_RE.test(path) && !/^(node_modules|scratch|skills)\//.test(path));

let changed = 0;
for (const path of tracked) {
  const text = readFileSync(join(root, path), 'utf8');
  const rewrites: { offset: number; from: string; to: string }[] = [];
  for (const { specifier, offset } of parseSourceFile(path, text).imports) {
    if (!specifier.startsWith('.')) continue;
    const target = normalizeRepoPath(`${path.slice(0, path.lastIndexOf('/') + 1)}${specifier}`);
    if (libFeatureCrossedTo(path, target) === undefined) continue;
    const alias = aliasForRepoPath(target, imports);
    if (alias === undefined || expandStudioAlias(alias, imports) !== target) {
      throw new Error(`${path}: no alias in package.json's imports names ${target} (imported as ${specifier})`);
    }
    const quote = text[offset];
    if (!`'"\``.includes(quote) || text.slice(offset + 1, offset + 1 + specifier.length + 1) !== specifier + quote) {
      throw new Error(`${path}: ${specifier} isn't spelled as a plain string at offset ${offset}`);
    }
    rewrites.push({ offset: offset + 1, from: specifier, to: alias });
  }
  if (!rewrites.length) continue;
  changed++;
  console.log(`${path}: ${rewrites.length}`);
  if (check) continue;
  let next = text;
  for (const { offset, from, to } of rewrites.sort((a, b) => b.offset - a.offset)) {
    next = next.slice(0, offset) + to + next.slice(offset + from.length);
  }
  writeFileSync(join(root, path), next);
}
console.log(`${changed} files ${check ? 'would change' : 'rewritten'}.`);
if (check && changed) process.exit(1);
