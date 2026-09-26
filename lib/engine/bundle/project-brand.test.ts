import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { studioTempRoot } from '../temp/studio-temp.ts';
import { readProjectBrand, writeProjectBrandModule } from './project-brand.ts';

let projects = 0;

function acmeProject() {
  const root = join(studioTempRoot(), `brand-${++projects}`);
  const project = join(root, 'projects', 'p'), kit = join(root, 'brands', 'acme');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(kit, 'fonts'), { recursive: true });
  const face = { family: 'Acme Sans', fallback: 'sans-serif', files: [{ file: 'fonts/AcmeSans-Bold.otf', weight: '700' }], source: 'the Acme brand portal' };
  const brand = {
    name: 'Acme', colors: { primary: '#123456', secondary: '#345678', accent: '#ff0000', dark: '#000000', light: '#ffffff' }, palette: { 'accent-40': '#ff9999' },
    fonts: { display: face, text: face }, logos: { light: { file: 'logo-light.svg', color: '#fff' }, dark: { file: 'logo-dark.svg', color: '#000' } }, voice: 'Plain.',
  };
  writeFileSync(join(kit, 'brand.ts'), `export default ${JSON.stringify(brand)};\n`);
  writeFileSync(join(kit, 'logo-light.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"></svg>');
  const setProject = (spec: object) => writeFileSync(join(project, 'brand.ts'), `export default ${JSON.stringify(spec)};\n`);
  return { project, kit, setProject };
}

test("a project's kit stops the bundle naming each missing file, and once they're in, @brand imports them with the logos sized", () => {
  const { project, kit, setProject } = acmeProject();
  setProject({ name: 'acme' });
  assert.throws(() => writeProjectBrandModule(project), {
    message: 'brands: acme is missing files in brands/acme/ (fonts/ isn\'t in git, so each machine adds its own):\n  fonts/AcmeSans-Bold.otf: the Acme brand portal\n  logo-dark.svg',
  });

  writeFileSync(join(kit, 'fonts', 'AcmeSans-Bold.otf'), '');
  writeFileSync(join(kit, 'logo-dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"></svg>');
  const module = readFileSync(writeProjectBrandModule(project), 'utf8');
  assert.match(module, /import font0 from "..\/..\/..\/brands\/acme\/fonts\/AcmeSans-Bold.otf";/);
  assert.match(module, /"logo-light.svg": \{ src: logo0, w: 200, h: 40 \}/);
  assert.match(module, /"logo-dark.svg": \{ src: logo1, w: 100, h: 20 \}/);
  assert.match(module, /loadStudioBrand\(mergeProjectBrand\(kit, project, "acme"\)/);
});

test("a project's brand.ts overrides the kit's colours, palette and voice, and a field or role that doesn't exist is refused", () => {
  const a = acmeProject();
  writeFileSync(join(a.kit, 'fonts', 'AcmeSans-Bold.otf'), '');
  writeFileSync(join(a.kit, 'logo-dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"></svg>');
  a.setProject({ name: 'acme', colors: { accent: '#00ff00' }, palette: { sale: '#00ff00' } });
  const { brand } = readProjectBrand(a.project)!;
  assert.equal(brand.name, 'Acme');
  assert.deepEqual([brand.colors.accent, brand.colors.primary, brand.palette.sale, brand.palette['accent-40'], brand.voice], ['#00ff00', '#123456', '#00ff00', '#ff9999', 'Plain.']);

  const b = acmeProject();
  b.setProject({ name: 'acme', colors: { acent: '#00ff00' }, fonts: {} });
  assert.throws(() => readProjectBrand(b.project), { message: "brands: the project's brand.ts has fonts; it sets name, colors, palette, voice (fonts and logos come from the kit)" });
  const c = acmeProject();
  c.setProject({ name: 'acme', colors: { acent: '#00ff00' } });
  assert.throws(() => readProjectBrand(c.project), { message: "brands: the project's brand.ts's colors has \"acent\"; its roles are primary, secondary, accent, dark, light" });
});
