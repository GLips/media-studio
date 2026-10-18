// project-styles.ts: the private styles a project.ts names, checked from work/styles/<name>/ before a bundle: each
// pack a style.ts lists must be imported here, at the studio's asset version, with every file its manifest lists. A
// failing style stops the bundle, listing each file with the pack's `source`. A passing one goes into
// generated/stamp-paint-styles.ts (aliased `@stamp-paint-styles`), importing its style.ts, manifests, its brushes'
// profiles at their keys now (style-packs.ts) and images. A brush with none stored doesn't stop the bundle: only a
// fill with it is refused.
//
// Stays free of import.meta: lib/output/render/engine/project-bundle.ts imports it, and the Remotion CLI bundles that to
// CommonJS. So work/styles is found from the project's folder, and project.ts and style.ts are read with require,
// which Node strips of types.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { ProjectDeclaration } from '#lib/platform/project/models/capability.ts';
import { STAMP_PAINT_PACK_MANIFEST, type StampPaintPack } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { resolveStampPaintStyle, stampPaintStyleImages, type StampPaintStyle } from '../models/style.ts';
import { readImportedStampPaintPack, readStampPaintPackGeneration } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { readStampPaintStylePacks, stampPaintStyleProfiledPacks } from './style-packs.ts';

const stylesDirFor = (projectDir: string) => join(resolve(projectDir), '..', '..', 'styles');
const requireDefault = <T>(file: string) => (createRequire(file)(file) as { default: T }).default;
const projectStylesModuleFor = (projectDir: string) => join(resolve(projectDir), 'generated', 'stamp-paint-styles.ts');

const listStyleNames = (stylesDir: string) => (existsSync(stylesDir) ? readdirSync(stylesDir).filter((d) => existsSync(join(stylesDir, d, 'style.ts'))) : []);

/** What's wrong with one style's imported packs on this machine, a line each; none when it can paint. */
function styleAssetProblems(dir: string, style: StampPaintStyle): string[] {
  const manifests = new Map<string, StampPaintPack>();
  const packProblems = Object.entries(style.packs).flatMap(([pack, { source }]) => {
    let imported: ReturnType<typeof readImportedStampPaintPack>;
    try {
      imported = readImportedStampPaintPack(join(dir, 'brushes', pack));
    } catch (error) {
      return [`  brushes/${pack}/: ${error instanceof Error ? error.message : String(error)} (${source})`];
    }
    if (!imported) return [`  brushes/${pack}/: not imported: ${source}`];
    const { dir: generation, manifest } = imported;
    manifests.set(pack, manifest);
    return manifest.files.filter((file) => !existsSync(join(generation, file))).map((file) => `  brushes/${pack}/${file}: ${source}`);
  });
  // A pack that isn't imported is reported above; its brushes can't be looked for until it is.
  const brushProblems = Object.entries(style.brushes).flatMap(([name, { pack, brush }]) => {
    if (!style.packs[pack]) return [`  brushes.${name}: names the pack ${pack}, which isn't in packs`];
    const manifest = manifests.get(pack);
    return manifest && !manifest.brushes[brush] ? [`  brushes.${name}: ${pack} has no brush ${JSON.stringify(brush)}; import it again from ${style.packs[pack].source}`] : [];
  });
  const paperImages = { 'paper.image': style.paper.image, 'paper.grain': style.paper.grain?.image };
  const paperProblems = Object.entries(paperImages).flatMap(([name, image]) => {
    if (!image) return [];
    if (!style.packs[image.pack]) return [`  ${name}: names the pack ${image.pack}, which isn't in packs`];
    const manifest = manifests.get(image.pack);
    return manifest && !manifest.files.includes(image.file) ? [`  ${name}: ${image.pack} has no file ${image.file}; import it again from ${style.packs[image.pack].source}`] : [];
  });
  return [...packProblems, ...brushProblems, ...paperProblems];
}

/** The styles `projectDir`'s project.ts names, which its bundle serves alone: none for a project with no project.ts. */
export function projectStyleNames(projectDir: string): readonly string[] {
  const declarationFile = join(resolve(projectDir), 'project.ts');
  return existsSync(declarationFile) ? requireDefault<ProjectDeclaration>(declarationFile).styles ?? [] : [];
}

/** What's wrong with the style `name` in `stylesDir`, a line each under one problem; none when it paints. */
function stampPaintStyleProblems(stylesDir: string, name: string, project: string): string[] {
  const file = join(stylesDir, name, 'style.ts');
  if (!existsSync(file)) {
    return [`styles: ${project}'s project.ts names ${JSON.stringify(name)}, which isn't a style (work/styles/ has ${listStyleNames(stylesDir).join(', ') || 'none'})`];
  }
  const lines = styleAssetProblems(join(stylesDir, name), requireDefault<StampPaintStyle>(file));
  return lines.length ? [`styles: ${name} can't paint until its packs are imported in work/styles/${name}/ (brushes/ isn't in git, so each machine imports its own; studio brushes import --help):\n${lines.join('\n')}`] : [];
}

/** What's wrong with the styles the project names, a problem each (a style's own lines under it); none when all paint. */
export function projectStyleProblems(projectDir: string): string[] {
  const project = basename(resolve(projectDir));
  return projectStyleNames(projectDir).flatMap((name) => stampPaintStyleProblems(stylesDirFor(projectDir), name, project));
}

/**
 * The `@stamp-paint-styles` module serving `names`, each checked already, importing by `from` (a path to its import
 * specifier), with `refusals` (statements on `styles`) before its export. A style's images are imported by name, so
 * naming another brush or paper needs the module again.
 */
function stampPaintStylesModuleSource(stylesDir: string, names: readonly string[], from: (path: string) => string, header: string, refusals: readonly string[] = []): string {
  const imports: string[] = [], entries: string[] = [];
  names.forEach((name, s) => {
    const dir = join(stylesDir, name);
    const style = requireDefault<StampPaintStyle>(join(dir, 'style.ts'));
    const packs = Object.keys(style.packs);
    // Resolved once per pack, so the manifest and images imported are one generation's. One published since the check
    // was made is whole by construction (replaceStampPaintPack), so it's served unchecked rather than mixed.
    const generations = Object.fromEntries(packs.map((pack) => [pack, readStampPaintPackGeneration(join(dir, 'brushes', pack))]));
    const read = readStampPaintStylePacks(stylesDir, name, style, generations);
    const images = stampPaintStyleImages(resolveStampPaintStyle(name, style, stampPaintStyleProfiledPacks(read)));
    imports.push(`import style${s} from ${from(join(dir, 'style.ts'))};`);
    packs.forEach((pack, p) => imports.push(`import manifest${s}_${p} from ${from(join(generations[pack].dir, STAMP_PAINT_PACK_MANIFEST))};`));
    const profiles = packs.map((pack, p) => Object.entries(read[pack].profileFiles).map(([brush, file], b) => {
      imports.push(`import profile${s}_${p}_${b} from ${from(file)};`);
      return `${JSON.stringify(brush)}: profile${s}_${p}_${b}`;
    }));
    images.forEach(({ pack, file }, i) => imports.push(`import image${s}_${i} from ${from(join(generations[pack].dir, file))};`));
    entries.push(
      `  ${JSON.stringify(name)}: {`,
      `    style: style${s},`,
      `    manifests: { ${packs.map((pack, p) => `${JSON.stringify(pack)}: manifest${s}_${p}`).join(', ')} },`,
      `    profiles: { ${packs.map((pack, p) => `${JSON.stringify(pack)}: ${profiles[p].length ? `{ ${profiles[p].join(', ')} }` : '{}'}`).join(', ')} },`,
      `    images: {`,
      ...images.map(({ pack, file }, i) => `      ${JSON.stringify(`${pack}/${file}`)}: image${s}_${i},`),
      '    },',
      '  },',
    );
  });
  return [header, ...imports, '', 'const styles = {', ...entries, '};', ...refusals, 'export default styles;', ''].join('\n');
}

/**
 * Checks each style the project names, throwing with every problem at once, then rewrites generated/stamp-paint-styles.ts
 * and returns its path.
 */
export function writeProjectStylesModule(projectDir: string): string {
  const problems = projectStyleProblems(projectDir);
  if (problems.length) throw new Error(problems.join('\n'));
  const path = projectStylesModuleFor(projectDir);
  const from = (p: string) => JSON.stringify(relative(dirname(path), p).split('\\').join('/'));
  const header = "// Written on every bundle from the project's project.ts (lib/paint/style/engine/project-styles.ts): the styles it names. Edits here are lost.";
  const module = stampPaintStylesModuleSource(stylesDirFor(projectDir), projectStyleNames(projectDir), from, header);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
  return path;
}

/** The workspace's `@stamp-paint-styles` for the studio app: its source, and the style files it was made from. */
export type WorkspaceStampPaintStylesModule = { source: string; styleFiles: readonly string[] };

/**
 * `@stamp-paint-styles` for the studio app's preview player, which plays any project from one page: every style in
 * `stylesDir`, imported by absolute path. A style that can't paint on this machine is there as a getter throwing its
 * problems, so only a scene painting with it fails, and says why.
 */
export function workspaceStampPaintStylesModule(stylesDir: string): WorkspaceStampPaintStylesModule {
  const names = listStyleNames(stylesDir);
  const problems = new Map(names.map((name) => [name, stampPaintStyleProblems(stylesDir, name, 'the workspace')]));
  const painting = names.filter((name) => !problems.get(name)!.length);
  const header = '// The studio app\'s @stamp-paint-styles (lib/paint/style/engine/project-styles.ts): every workspace style.';
  const refusals = names.filter((name) => problems.get(name)!.length).map((name) =>
    `Object.defineProperty(styles, ${JSON.stringify(name)}, { get() { throw new Error(${JSON.stringify(problems.get(name)!.join('\n'))}); } });`);
  const source = stampPaintStylesModuleSource(stylesDir, painting, (p) => JSON.stringify(p), header, refusals);
  return { source, styleFiles: names.map((name) => join(stylesDir, name, 'style.ts')) };
}
