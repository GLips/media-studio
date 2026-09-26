// ─── A lib/ folder too wide to scan ───────────────────────────────────
//
// Advisory (plan §5.2): past about 15 source files directly in one lib/
// folder, a reader can no longer tell its domains apart by listing it, so
// it's time to group them into subfolders. Specs and declaration files
// sit beside the modules they describe and don't count.

import { SOURCE_EXTENSIONS } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'folder-width';
export const FOLDER_WIDTH_LIMIT = 15;
const COUNTED = new RegExp(`\\.(${SOURCE_EXTENSIONS.join('|')})$`);
const NOT_COUNTED = /\.test\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

export const folderWidthCheck: StructuralCheck = {
  id: ID,
  advisory: true,
  run: (context) => {
    const perFolder = new Map<string, number>();
    for (const path of context.tree.paths) {
      if (!path.startsWith('lib/') || !COUNTED.test(path) || NOT_COUNTED.test(path)) continue;
      const folder = path.slice(0, path.lastIndexOf('/'));
      perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
    }
    return [...perFolder].filter(([, count]) => count > FOLDER_WIDTH_LIMIT).sort().map(([folder, count]): Finding => ({
      check: ID, path: folder, line: 1, key: 'width',
      message: `${count} source files directly in ${folder}/, over ${FOLDER_WIDTH_LIMIT}: group them into subfolders by domain`,
    }));
  },
};
