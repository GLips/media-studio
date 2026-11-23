import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recorderBundlePropertyList } from './recorder-app-bundle.ts';

// The recorder runs each list with one folder appended; a wrong word here loses every recording's add, or its menu's
// recent takes.
test("the recorder runs this checkout's library verbs under this node and PATH", () => {
  const plist = recorderBundlePropertyList({ studioRoot: '/Users/me/media-studio', nodePath: '/opt/node/bin/node', shellPath: '/opt/homebrew/bin:/usr/bin' });
  const command = (key: string) => {
    const list = new RegExp(`<key>${key}</key><array>(.*)</array>`).exec(plist)?.[1];
    return [...(list ?? '').matchAll(/<string>(.*?)<\/string>/g)].map(([, arg]) => arg);
  };
  const studio = ['/usr/bin/env', 'PATH=/opt/homebrew/bin:/usr/bin', '/opt/node/bin/node', '/Users/me/media-studio/cli/studio.ts'];
  assert.deepEqual(command('StudioLibraryAdd'), [...studio, 'library', 'add', '--move', '--no-proxies']);
  assert.deepEqual(command('StudioLibraryRecordings'), [...studio, 'library', 'recordings', '--json', '--limit', '5', '--inbox']);
  assert.deepEqual(command('StudioLibraryRemoveTake'), [...studio, 'library', 'remove', '--take']);
  assert.deepEqual(command('StudioLibraryOpen'), [...studio, 'library', 'open']);
});
