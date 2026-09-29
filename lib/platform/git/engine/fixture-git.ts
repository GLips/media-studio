// fixture-git.ts: git run in a throwaway repository (a spec's fixture, a scaffold workspace), cut off from whichever
// repository started this process. Node only.
//
// Git hands a hook GIT_DIR, GIT_INDEX_FILE and its -c settings (GIT_CONFIG_PARAMETERS), and a git child inherits
// them over its cwd. Under the pre-commit gate, a fixture's `git init`, `config` and `commit` would land in the real
// repository: its config, its index, its branch. Without any GIT_* variable, git finds its repository from cwd alone.
import { execFileSync } from 'node:child_process';

/** This process's environment with every GIT_* variable removed. */
export function isolatedGitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

/** Runs git in the repository at `cwd` and returns its stdout. */
export function runFixtureGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8' });
}
