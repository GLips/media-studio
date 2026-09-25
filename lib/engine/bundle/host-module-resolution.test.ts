import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { matchTsconfigPathAlias, readTsconfigPathAliases, resolveHostImport } from './host-module-resolution.ts';

test('a host tsconfig alias resolves through JSONC and extends, longest prefix first', () => {
  const root = mkdtempSync(join(tmpdir(), 'host-tsconfig-'));
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  writeFileSync(join(root, 'tsconfig.base.json'), `{
    // shared by every package
    "compilerOptions": { "paths": { "@/*": ["./src/*"], "@/ui/*": ["./design/*",], }, },
  }`);
  writeFileSync(join(root, 'apps/web/tsconfig.json'), '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "baseUrl": "." } }');
  const aliases = readTsconfigPathAliases(join(root, 'apps/web/tsconfig.json'));
  assert.ok(aliases);
  assert.deepEqual(matchTsconfigPathAlias(aliases, '@/lib/date'), [join(root, 'apps/web/src/lib/date')]);
  assert.deepEqual(matchTsconfigPathAlias(aliases, '@/ui/button'), [join(root, 'apps/web/design/button')]);
  assert.deepEqual(matchTsconfigPathAlias(aliases, 'react'), []);
});

test('@host/ names a host file, or a package as that host directory sees it', () => {
  assert.deepEqual(resolveHostImport('/h', '@host/apps/web/src/card.tsx'), { fromDir: '/h', request: '/h/apps/web/src/card.tsx' });
  assert.deepEqual(resolveHostImport('/h', '@host/apps/web/node_modules/@mantine/core/styles.css'), { fromDir: '/h/apps/web', request: '@mantine/core/styles.css' });
  assert.deepEqual(resolveHostImport('/h', '@host/node_modules/react-query'), { fromDir: '/h', request: 'react-query' });
  assert.equal(resolveHostImport('/h', 'react'), null);
});
