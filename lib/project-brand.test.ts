import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeProjectBrandModule } from './project-brand.ts';

test("a project's kit stops the bundle naming each missing file, and once they're in, @brand imports them with the logos sized", () => {
  const root = mkdtempSync(join(tmpdir(), 'brand-'));
  const project = join(root, 'projects', 'p'), kit = join(root, 'brands', 'acme');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(kit, 'fonts'), { recursive: true });
  writeFileSync(join(project, 'brand.json'), '{ "name": "acme" }');
  const face = { family: 'Acme Sans', fallback: 'sans-serif', files: [{ file: 'fonts/AcmeSans-Bold.otf', weight: '700' }], source: 'the Acme brand portal' };
  const brand = { name: 'Acme', fonts: { display: face, text: face }, logos: { light: { file: 'logo-light.svg', color: '#fff' }, dark: { file: 'logo-dark.svg', color: '#000' } } };
  writeFileSync(join(kit, 'brand.ts'), `export default ${JSON.stringify(brand)};\n`);
  writeFileSync(join(kit, 'logo-light.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"></svg>');

  assert.throws(() => writeProjectBrandModule(project), {
    message: 'brands: acme is missing files in brands/acme/ (fonts/ isn\'t in git, so each machine adds its own):\n  fonts/AcmeSans-Bold.otf: the Acme brand portal\n  logo-dark.svg',
  });

  writeFileSync(join(kit, 'fonts', 'AcmeSans-Bold.otf'), '');
  writeFileSync(join(kit, 'logo-dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"></svg>');
  const module = readFileSync(writeProjectBrandModule(project), 'utf8');
  assert.match(module, /import font0 from "..\/..\/..\/brands\/acme\/fonts\/AcmeSans-Bold.otf";/);
  assert.match(module, /"logo-light.svg": \{ src: logo0, w: 200, h: 40 \}/);
  assert.match(module, /"logo-dark.svg": \{ src: logo1, w: 100, h: 20 \}/);
});
