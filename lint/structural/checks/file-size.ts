// ─── No source file past 600 lines ────────────────────────────────────
//
// Every governed source file, wherever it sits, so you can read a whole file
// before changing one function in it. Every line counts, comments and blanks
// included: 300 lines of code under 300 of comment is still 600 to read.
//
// One threshold, and no per-file or per-folder exemption: a folder that keeps
// growing large files is what this should show. A studio whose files are
// rightly longer raises FILE_SIZE_LIMIT, once, for all of them.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'file-size';
export const FILE_SIZE_LIMIT = 600;

export const fileSizeCheck: StructuralCheck = {
  id: ID,
  run: (context) => context.tree.sources.flatMap((file): Finding[] => {
    const lines = lineCount(file.text);
    if (lines <= FILE_SIZE_LIMIT) return [];
    return [{
      check: ID, path: file.path, line: 1, key: 'size',
      message: `${lines} lines, over ${FILE_SIZE_LIMIT}: move a cohesive group of functions or components to a sibling module`,
    }];
  }),
};

/** A trailing newline ends the last line rather than starting an empty one. */
const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
