// studio-user-cache.ts: where the studio keeps what outlives a process and every checkout on the machine shares
// (whisper's build and model, host checkouts, the GPU lease's queue): $XDG_CACHE_HOME, else ~/.cache, then
// media-studio/. ~/.cache on macOS too, as uv and Hugging Face keep theirs, so one path holds on every platform and
// docs can name it. Outside every checkout, so a host's tooling walking up for node_modules never finds the studio's.

import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** The folder `parts` names in the studio's user cache, e.g. `studioUserCacheDir('hosts')`. Not made here. */
export function studioUserCacheDir(...parts: string[]): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache'), 'media-studio', ...parts);
}
