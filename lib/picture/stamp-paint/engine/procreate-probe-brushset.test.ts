import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { PROCREATE_PROBE_BASE, procreateProbes } from '../models/procreate-probes.ts';
import { parseBinaryPlist, PlistReal, PlistUid, writeBinaryPlist, type PlistValue } from './binary-plist.ts';
import { openZipBytes, writeZipArchive } from './zip-archive.ts';
import { writeProcreateProbeBrushset } from './procreate-probe-brushset.ts';

test("a keyed archive written back reads as it was, reals kept real and their width kept, and a written zip opens with the pack reader", () => {
  const archive = {
    $version: 100000, $archiver: 'NSKeyedArchiver', $top: { root: new PlistUid(1) },
    $objects: ['$null', { name: new PlistUid(2), grainDepth: new PlistReal(1, 4), shapeCount: new PlistReal(0.1), stamp: true, blendMode: 28, jitter: -3 }, 'Probe — dual', new Uint8Array([1, 2, 3])],
  };
  assert.deepEqual(parseBinaryPlist(writeBinaryPlist(archive), { keepReals: true }), archive);
  const zip = openZipBytes('probes', writeZipArchive([{ name: 'a/Brush.archive', data: writeBinaryPlist(archive) }, { name: 'brushset.plist', data: new Uint8Array([7]) }]));
  assert.deepEqual(zip.names, ['a/Brush.archive', 'brushset.plist']);
  assert.deepEqual(parseBinaryPlist(new Uint8Array(zip.read('a/Brush.archive')), { keepReals: true }), archive);
});

test("every probe keeps each setting the type its template stores it as, since Procreate drops a brush with a mistyped key", () => {
  const keys = new Set([...Object.keys(PROCREATE_PROBE_BASE), ...procreateProbes().flatMap((p) => [...Object.keys(p.settings), ...Object.keys(p.dual?.settings ?? {})])]);
  const root: Record<string, PlistValue> = { name: new PlistUid(2) };
  for (const key of keys) root[key] = key === 'textureDepthTilt' ? true : key === 'blendMode' ? 0 : new PlistReal(0, 4);
  const template = writeBinaryPlist({ $version: 100000, $archiver: 'NSKeyedArchiver', $top: { root: new PlistUid(1) }, $objects: ['$null', root, 'Template'] });
  withStudioTemp('probes', (dir) => {
    writeFileSync(join(dir, 'pack.brushset'), writeZipArchive([{ name: 'T/Brush.archive', data: template }, { name: 'brushset.plist', data: new Uint8Array() }]));
    writeProcreateProbeBrushset({ archive: join(dir, 'pack.brushset'), brush: 'Template', out: join(dir, 'probes.brushset') });
    const set = openZipBytes('probes', readFileSync(join(dir, 'probes.brushset')));
    const typeOf = (v: PlistValue) => (v instanceof PlistReal ? `real${v.bytes}` : typeof v);
    for (const name of set.names.filter((n) => n.endsWith('Brush.archive'))) {
      const archive = parseBinaryPlist(new Uint8Array(set.read(name)), { keepReals: true }) as { $objects: Record<string, PlistValue>[] };
      const brush = archive.$objects[1], label = String(archive.$objects[(brush.name as PlistUid).uid]);
      if (label.startsWith('Diag 2') || label.startsWith('Diag 3')) continue;
      for (const key of keys) assert.equal(typeOf(brush[key]), typeOf(root[key]), `${label}: ${key}`);
    }
  });
});
