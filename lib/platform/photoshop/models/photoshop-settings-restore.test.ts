import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planPhotoshopSettingsRestore } from './photoshop-settings-restore.ts';

const snapshot = { 'Settings/Brushes.psp': 'before', 'Settings/Prefs.psp': 'before' };

test("a restore puts back what the run's Photoshop changed, and keeps what a later session changed", () => {
  // The run defined a probe tip (Brushes.psp) and wrote a new file; then Graham's own session installed brushes.
  const exit = { exitedAt: '2026-09-29T22:27:00Z', files: { 'Settings/Brushes.psp': 'run', 'Settings/Prefs.psp': 'run', 'Settings/Probe.psp': 'run' } };
  const now = { 'Settings/Brushes.psp': 'graham', 'Settings/Prefs.psp': 'run', 'Settings/Probe.psp': 'run' };
  assert.deepEqual(planPhotoshopSettingsRestore(snapshot, now, { exit }), { rewrite: ['Settings/Prefs.psp'], remove: ['Settings/Probe.psp'], keep: ['Settings/Brushes.psp'] });
});

test("a snapshot whose run never saw its Photoshop exit isn't put back unless forced", () => {
  const now = { 'Settings/Brushes.psp': 'someone', 'Settings/Prefs.psp': 'before' };
  const refused = planPhotoshopSettingsRestore(snapshot, now);
  assert.match(refused.refused ?? '', /can't be told from a later Photoshop session's/);
  assert.equal(planPhotoshopSettingsRestore(snapshot, now, { force: true }).refused, undefined);
  // Nothing to undo is never refused.
  assert.equal(planPhotoshopSettingsRestore(snapshot, { ...snapshot }).refused, undefined);
});
