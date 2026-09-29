// studio-workspace.ts: work/, where your own projects, brand kits, painting styles and hosts.json live, in a git repository of its own
// that the studio's repository ignores. The studio is shared; what you make with it isn't.
//
//   work/projects/<p>/        a project (studio new)
//   work/brands/<name>/       a brand kit (docs/brand-kits.md)
//   work/styles/<name>/       a private stamp-paint style (docs/private-styles.md)
//   work/hosts.json           host name → { repo } (lib/platform/host/engine/hosts.ts); hosts.local.json beside it, ignored
//   work/arch-baseline.json   check:arch's baseline for the workspace's files, as lint/arch-baseline.json is the studio's
//
// Its commits run .githooks-workspace/pre-commit: check:arch over its index against the studio's, the full typecheck
// and its projects' tests.
//
// Negative space: no package.json in work/. A project's `#studio` and `#lib/*` resolve through the studio's
// package.json because none sits between them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { STUDIO_BRANDS_DIR, STUDIO_PROJECTS_DIR, STUDIO_STYLES_DIR, STUDIO_WORKSPACE_DIR } from './studio-project.ts';

/** Relative to work/, so the checkout can move. */
const WORKSPACE_HOOKS_PATH = '../.githooks-workspace';

/**
 * What a project writes that's made, not authored: recorded, generated or rendered; a brand's licensed fonts; and a
 * style's brushes, imported from a bought pack.
 */
const WORKSPACE_IGNORES = [
  'projects/*/captures/', 'projects/*/out/', 'projects/*/audio/', 'projects/*/music/', 'projects/*/generated/',
  'projects/*/host', 'brands/*/fonts/', 'styles/*/brushes/', 'hosts.local.json', '.DS_Store',
];

export function isStudioWorkspaceRepo(): boolean {
  return existsSync(join(STUDIO_WORKSPACE_DIR, '.git'));
}

export function assertStudioWorkspace(): void {
  if (!isStudioWorkspaceRepo()) throw new Error('there\'s no workspace yet: run `studio workspace init` to make work/, where your projects live');
}

/**
 * Makes work/ a workspace, or completes one: its folders, its own repository with the workspace hook, and each file it
 * needs that's missing. What's there is kept: an existing .gitignore only gains the lines it lacks.
 */
export function initStudioWorkspace(): string[] {
  const done: string[] = [];
  for (const dir of [STUDIO_PROJECTS_DIR, STUDIO_BRANDS_DIR, STUDIO_STYLES_DIR]) mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: STUDIO_WORKSPACE_DIR, env: isolatedGitEnv(), encoding: 'utf8' }).trim();
  if (!isStudioWorkspaceRepo()) {
    git('init', '-q');
    done.push('made work/ a git repository');
  }
  const hooksPath = (() => { try { return git('config', 'core.hooksPath'); } catch { return ''; } })();
  if (hooksPath !== WORKSPACE_HOOKS_PATH) {
    git('config', 'core.hooksPath', WORKSPACE_HOOKS_PATH);
    done.push(`set its hooks to ${WORKSPACE_HOOKS_PATH}`);
  }
  const ignoreFile = join(STUDIO_WORKSPACE_DIR, '.gitignore');
  const ignored = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : '';
  const missing = WORKSPACE_IGNORES.filter((line) => !ignored.split('\n').includes(line));
  if (missing.length) {
    writeFileSync(ignoreFile, `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    done.push(`ignored ${missing.join(', ')}`);
  }
  for (const [file, content] of [['arch-baseline.json', '{}\n'], ['hosts.json', '{}\n']] as const) {
    if (existsSync(join(STUDIO_WORKSPACE_DIR, file))) continue;
    writeFileSync(join(STUDIO_WORKSPACE_DIR, file), content);
    done.push(`wrote ${file}`);
  }
  return done;
}
