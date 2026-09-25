// project-brand.ts: the brand a project names in brand.json, read from brands/<name>/ (see lib/brand.ts), and
// generated/brand.ts, which the bundle aliases as `@brand`. That module is rewritten on every bundle, so a project
// builds from brand.json alone, and a kit whose font or logo files are missing stops the bundle with a list of them.
//
// Imported by lib/project-bundle.ts, so it stays free of import.meta (the Remotion CLI bundles that file to CommonJS):
// the kit's folder is found from the project's, and its brand.ts is read with require, which Node strips of types.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { brandFiles, type Brand } from './brand.ts';

const brandsDirFor = (projectDir: string) => join(resolve(projectDir), '..', '..', 'brands');
const projectBrandModuleFor = (projectDir: string) => join(resolve(projectDir), 'generated', 'brand.ts');

/** The brand the project names in brand.json, or null when it names none. */
export function readProjectBrandName(projectDir: string): string | null {
  const path = join(resolve(projectDir), 'brand.json');
  if (!existsSync(path)) return null;
  const spec = JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown };
  if (typeof spec.name !== 'string') throw new Error(`brands: ${path} needs { "name": "<brand>" }, one of brands/: ${listBrands(projectDir).join(', ')}`);
  return spec.name;
}

function listBrands(projectDir: string) {
  const dir = brandsDirFor(projectDir);
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'brand.ts'))) : [];
}

export type ProjectBrand = { name: string; dir: string; brand: Brand };

/** The project's brand kit as brand.ts has it, or null when it names none. Its files may be missing: readProjectBrand checks. */
export function readProjectBrandData(projectDir: string): ProjectBrand | null {
  const name = readProjectBrandName(projectDir);
  if (name === null) return null;
  const dir = join(brandsDirFor(projectDir), name);
  const file = join(dir, 'brand.ts');
  if (!existsSync(file)) throw new Error(`brands: ${basename(resolve(projectDir))}'s brand.json names "${name}", but there's no brands/${name}/brand.ts (brands/ has ${listBrands(projectDir).join(', ') || 'none'})`);
  return { name, dir, brand: (createRequire(file)(file) as { default: Brand }).default };
}

/** The project's brand kit, its files checked, or null when it names none. Throws listing every missing file. */
export function readProjectBrand(projectDir: string): ProjectBrand | null {
  const kit = readProjectBrandData(projectDir);
  if (!kit) return null;
  const { name, dir, brand } = kit;
  const { fonts, logos } = brandFiles(brand);
  const missing = [
    ...fonts.filter((f) => !existsSync(join(dir, f))).map((f) => `  ${f}: ${[brand.fonts.display, brand.fonts.text].find((face) => face.files.some((x) => x.file === f))!.source}`),
    ...logos.filter((f) => !existsSync(join(dir, f))).map((f) => `  ${f}`),
  ];
  if (missing.length) throw new Error(`brands: ${name} is missing files in brands/${name}/ (fonts/ isn't in git, so each machine adds its own):\n${missing.join('\n')}`);
  return kit;
}

/** An SVG's own size, from its width and height, or its viewBox. */
function svgSize(path: string): { w: number; h: number } {
  const head = readFileSync(path, 'utf8').match(/<svg\b[^>]*>/)?.[0] ?? '';
  const attr = (a: string) => Number(head.match(new RegExp(`\\s${a}="([\\d.]+)(px)?"`))?.[1]);
  const [, , vw, vh] = (head.match(/viewBox="([^"]+)"/)?.[1] ?? '').split(/[\s,]+/).map(Number);
  const w = attr('width') || vw, h = attr('height') || vh;
  if (!w || !h) throw new Error(`brands: ${path} has no width and height or viewBox`);
  return { w, h };
}

/**
 * Rewrites generated/brand.ts: the project's kit, its fonts loaded and logos sized (lib/studio/brand.tsx), or a module
 * that throws, naming the fix, when a design imports `@brand` in a project with no brand.json. Returns its path.
 */
export function writeProjectBrandModule(projectDir: string): string {
  const path = projectBrandModuleFor(projectDir);
  const kit = readProjectBrand(projectDir);
  const from = (p: string) => JSON.stringify(relative(dirname(path), p).split('\\').join('/'));
  let module: string;
  if (!kit) {
    const message = `${basename(resolve(projectDir))} imports @brand but has no brand.json; add { "name": "<brand>" }, one of brands/: ${listBrands(projectDir).join(', ') || 'none yet'}`;
    module = `// Written on every bundle (lib/project-brand.ts): the project names no brand.\nthrow new Error(${JSON.stringify(message)});\n`;
  } else {
    const { fonts, logos } = brandFiles(kit.brand);
    const lines = [
      `// Written on every bundle from brand.json (lib/project-brand.ts): brands/${kit.name}, loaded. Edits here are lost.`,
      `import brand from ${from(join(kit.dir, 'brand.ts'))};`,
      `import { loadStudioBrand } from ${from(join(resolve(projectDir), '..', '..', 'lib', 'studio', 'brand.tsx'))};`,
      ...fonts.map((f, i) => `import font${i} from ${from(join(kit.dir, f))};`),
      ...logos.map((f, i) => `import logo${i} from ${from(join(kit.dir, f))};`),
      '',
      `export default loadStudioBrand(brand, {`,
      ...fonts.map((f, i) => `  ${JSON.stringify(f)}: font${i},`),
      `}, {`,
      ...logos.map((f, i) => {
        const { w, h } = svgSize(join(kit.dir, f));
        return `  ${JSON.stringify(f)}: { src: logo${i}, w: ${w}, h: ${h} },`;
      }),
      `});`,
    ];
    module = `${lines.join('\n')}\n`;
  }
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
  return path;
}
