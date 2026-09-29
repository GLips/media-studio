import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBinaryPlist, PlistReal, PlistUid, writeBinaryPlist } from './binary-plist.ts';
import { openZipBytes, writeZipArchive } from './zip-archive.ts';

test("a keyed archive written back reads as it was, reals kept real, and a written zip opens with the pack reader", () => {
  const archive = {
    $version: 100000, $archiver: 'NSKeyedArchiver', $top: { root: new PlistUid(1) },
    $objects: ['$null', { name: new PlistUid(2), grainDepth: new PlistReal(1), shapeCount: new PlistReal(0.0625), stamp: true, blendMode: 28, jitter: -3 }, 'Probe — dual', new Uint8Array([1, 2, 3])],
  };
  assert.deepEqual(parseBinaryPlist(writeBinaryPlist(archive), { keepReals: true }), archive);
  const zip = openZipBytes('probes', writeZipArchive([{ name: 'a/Brush.archive', data: writeBinaryPlist(archive) }, { name: 'brushset.plist', data: new Uint8Array([7]) }]));
  assert.deepEqual(zip.names, ['a/Brush.archive', 'brushset.plist']);
  assert.deepEqual(parseBinaryPlist(new Uint8Array(zip.read('a/Brush.archive')), { keepReals: true }), archive);
});
