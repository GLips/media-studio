// ─── A spec sits beside the module it's named for ─────────────────────
//
// Advisory. `x.test.ts` pairs with an `x.ts`/`x.tsx` in its folder, so a search
// for the module turns up the spec that constrains it; one qualifier is part of
// the convention (`x.integration.test.ts` covers `x.ts`). A project's
// `timeline.test.ts` is its retime runner and pairs with `timeline.ts` like any
// other. `.spec.` and `test_` names are reported too: they sit beside their
// module but don't come up in a search for `.test.`.
//
// Never asks whether a module has a spec: many rightly have none. The tree
// declares no test folder (`__tests__/`, `test/`), so no location excuses an
// unpaired spec; a cross-cutting suite is named after the module it enters by.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SOURCE_EXTENSIONS, sourcePathStem } from '../../candidate-snapshot.ts';

const ID = 'test-file-mirror';
const TEST_SUFFIX = '.test';
const OFF_CONVENTION = [/\.spec$/, /(^|\/)test_[^/]+$/];

export const testFileMirrorCheck: StructuralCheck = {
  id: ID,
  advisory: true,
  run(context) {
    const hasModule = (base: string) => SOURCE_EXTENSIONS.some((extension) => context.tree.paths.has(`${base}.${extension}`));
    return context.tree.sources.flatMap((file): Finding[] => {
      const bare = sourcePathStem(file.path);
      const finding = (key: string, message: string): Finding[] => [{ check: ID, path: file.path, line: 1, key, message }];
      if (!bare.endsWith(TEST_SUFFIX)) {
        return OFF_CONVENTION.some((pattern) => pattern.test(bare))
          ? finding('spelling', `off-convention spec name: call it <module>${TEST_SUFFIX}.ts, so a search for the module finds it`)
          : [];
      }
      const base = bare.slice(0, -TEST_SUFFIX.length);
      if (hasModule(base)) return [];
      // The qualifier's dot must be in the file name: a dotted folder name isn't a qualifier.
      const dot = base.lastIndexOf('.');
      if (dot > base.lastIndexOf('/') && hasModule(base.slice(0, dot))) return [];
      return finding('orphan', `no ${base.slice(base.lastIndexOf('/') + 1)} module beside this spec: name it after the module it exercises`);
    });
  },
};
