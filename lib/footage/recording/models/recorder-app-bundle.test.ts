import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recorderBundlePropertyList } from './recorder-app-bundle.ts';

// LibraryHandoff.swift runs this list with the take's folder appended; a wrong word here loses every recording's add.
test("the recorder hands a take to this checkout's library add, moving it and leaving proxies, under this node and PATH", () => {
  const plist = recorderBundlePropertyList({ studioRoot: '/Users/me/media-studio', nodePath: '/opt/node/bin/node', shellPath: '/opt/homebrew/bin:/usr/bin' });
  const handoff = /<key>StudioLibraryAdd<\/key><array>(.*)<\/array>/.exec(plist)?.[1];
  const command = [...(handoff ?? '').matchAll(/<string>(.*?)<\/string>/g)].map(([, arg]) => arg);
  assert.deepEqual(command, [
    '/usr/bin/env', 'PATH=/opt/homebrew/bin:/usr/bin', '/opt/node/bin/node', '/Users/me/media-studio/cli/studio.ts', 'library', 'add', '--move', '--no-proxies',
  ]);
});
