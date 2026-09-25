// project-brand.ts: the kit a project's brand.ts names, read from brands/<name>/ (see lib/models/brand/brand.ts), and
// generated/brand.ts, which the bundle aliases as `@brand`. That module is rewritten on every bundle. It imports the
// kit's brand.ts and the project's and merges them in the bundle, so an open Studio picks up an edit to either. A kit
// whose font or logo files are missing, or an override that doesn't fit, stops the bundle.
//
// Imported by lib/engine/bundle/project-bundle.ts, so it stays free of import.meta (the Remotion CLI bundles that file to CommonJS):
// the kit's folder is found from the project's, and both brand.ts files are read with require, which Node strips of
// types. Require caches, so in a long-lived process these checks can see an earlier edit; the bundle checks again.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { brandFiles, mergeProjectBrand, type Brand, type ProjectBrand } from '#models/brand/brand.ts';

const brandsDirFor = (projectDir: string) => join(resolve(projectDir), '..', '..', 'brands');
const projectBrandFileFor = (projectDir: string) => join(resolve(projectDir), 'brand.ts');
const projectBrandModuleFor = (projectDir: string) => join(resolve(projectDir), 'generated', 'brand.ts');
const requireDefault = <T>(file: string) => (createRequire(file)(file) as { default: T }).default;

function listBrands(projectDir: string) {
  const dir = brandsDirFor(projectDir);
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'brand.ts'))) : [];
}

/** A project's kit, found and checked: its folder, and the kit with the project's overrides. */
export type ResolvedProjectBrand = { name: string; dir: string; brand: Brand };

/** The project's kit with its overrides, its files checked, or null when it has no brand.ts. Throws listing every missing file. */
export function readProjectBrand(projectDir: string): ResolvedProjectBrand | null {
  const projectFile = projectBrandFileFor(projectDir);
  if (!existsSync(projectFile)) return null;
  const project = requireDefault<ProjectBrand>(projectFile);
  const name = project.name;
  const dir = join(brandsDirFor(projectDir), name);
  const file = join(dir, 'brand.ts');
  if (typeof name !== 'string' || !existsSync(file)) {
    throw new Error(`brands: ${basename(resolve(projectDir))}'s brand.ts names ${JSON.stringify(name)}, which isn't a kit (brands/ has ${listBrands(projectDir).join(', ') || 'none'})`);
  }
  const brand = mergeProjectBrand(requireDefault<Brand>(file), project, name);
  const { fonts, logos } = brandFiles(brand);
  const missing = [
    ...fonts.filter((f) => !existsSync(join(dir, f))).map((f) => `  ${f}: ${[brand.fonts.display, brand.fonts.text].find((face) => face.files.some((x) => x.file === f))!.source}`),
    ...logos.filter((f) => !existsSync(join(dir, f))).map((f) => `  ${f}`),
  ];
  if (missing.length) throw new Error(`brands: ${name} is missing files in brands/${name}/ (fonts/ isn't in git, so each machine adds its own):\n${missing.join('\n')}`);
  return { name, dir, brand };
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
 * Rewrites generated/brand.ts: the project's kit with its overrides, its fonts loaded and logos sized
 * (lib/studio/brand.tsx), or a module that throws, naming the fix, when a design imports `@brand` in a project with no
 * brand.ts. The kit's files are imported by name, so a project that names another kit, or a kit that names other
 * files, needs a new bundle. Returns its path.
 */
export function writeProjectBrandModule(projectDir: string): string {
  const path = projectBrandModuleFor(projectDir);
  const kit = readProjectBrand(projectDir);
  const from = (p: string) => JSON.stringify(relative(dirname(path), p).split('\\').join('/'));
  let module: string;
  if (!kit) {
    const message = `${basename(resolve(projectDir))} imports @brand but has no brand.ts; add \`export default { name: '<brand>' } satisfies ProjectBrand\`, naming one of brands/: ${listBrands(projectDir).join(', ') || 'none yet'}`;
    module = `// Written on every bundle (lib/engine/bundle/project-brand.ts): the project has no brand.ts.\nthrow new Error(${JSON.stringify(message)});\n`;
  } else {
    const { fonts, logos } = brandFiles(kit.brand);
    const lines = [
      `// Written on every bundle from the project's brand.ts (lib/engine/bundle/project-brand.ts): brands/${kit.name} with its overrides, loaded. Edits here are lost.`,
      `import kit from ${from(join(kit.dir, 'brand.ts'))};`,
      `import project from ${from(projectBrandFileFor(projectDir))};`,
      `import { mergeProjectBrand } from ${from(join(resolve(projectDir), '..', '..', 'lib', 'brand.ts'))};`,
      `import { loadStudioBrand } from ${from(join(resolve(projectDir), '..', '..', 'lib', 'studio', 'brand.tsx'))};`,
      ...fonts.map((f, i) => `import font${i} from ${from(join(kit.dir, f))};`),
      ...logos.map((f, i) => `import logo${i} from ${from(join(kit.dir, f))};`),
      '',
      `export default loadStudioBrand(mergeProjectBrand(kit, project, ${JSON.stringify(kit.name)}), {`,
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
