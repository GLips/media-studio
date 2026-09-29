// project-styles.ts: the private styles a project's project.ts names in `styles`, found in work/styles/<name>/ and
// checked before a bundle: each pack a style's style.ts lists must be imported on this machine, at the asset version
// the studio reads, with every file its manifest lists. A style that fails stops the bundle, listing each file with
// the pack's `source`, as a brand kit's missing fonts do. A style that passes is written into generated/stamp-paint-styles.ts,
// which the bundle aliases as `@stamp-paint-styles`: each style.ts, its packs' manifests and the images it paints with,
// imported so the bundle serves them (lib/picture/stamp-paint/studio/stamp-paint-styles.ts reads it).
//
// Imported by lib/output/render/engine/project-bundle.ts, so it stays free of import.meta (the Remotion CLI bundles that
// file to CommonJS): work/styles is found from the project's folder, and project.ts and style.ts are read with require,
// which Node strips of types.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { ProjectDeclaration } from '#lib/platform/project/models/capability.ts';
import { resolveStampPaintStyle, STAMP_PAINT_ASSETS_VERSION, STAMP_PAINT_PACK_MANIFEST, stampPaintStyleImages, type StampPaintPackManifest, type StampPaintStyle } from '../models/style.ts';

const stylesDirFor = (projectDir: string) => join(resolve(projectDir), '..', '..', 'styles');
const requireDefault = <T>(file: string) => (createRequire(file)(file) as { default: T }).default;
const readManifest = (styleDir: string, pack: string) => JSON.parse(readFileSync(join(styleDir, 'brushes', pack, STAMP_PAINT_PACK_MANIFEST), 'utf8')) as StampPaintPackManifest;
const projectStylesModuleFor = (projectDir: string) => join(resolve(projectDir), 'generated', 'stamp-paint-styles.ts');

function listStyles(projectDir: string) {
  const dir = stylesDirFor(projectDir);
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'style.ts'))) : [];
}

/** What's wrong with one style's imported packs on this machine, a line each; none when it can paint. */
function styleAssetProblems(dir: string, style: StampPaintStyle): string[] {
  const manifests = new Map<string, StampPaintPackManifest>();
  const packProblems = Object.entries(style.packs).flatMap(([pack, { source }]) => {
    const manifestFile = join(dir, 'brushes', pack, STAMP_PAINT_PACK_MANIFEST);
    if (!existsSync(manifestFile)) return [`  brushes/${pack}/${STAMP_PAINT_PACK_MANIFEST}: ${source}`];
    const manifest = readManifest(dir, pack);
    if (manifest.version !== STAMP_PAINT_ASSETS_VERSION) {
      return [`  brushes/${pack}/: imported as version ${manifest.version}, and the studio reads version ${STAMP_PAINT_ASSETS_VERSION}; import it again from ${source}`];
    }
    manifests.set(pack, manifest);
    return manifest.files.filter((file) => !existsSync(join(dir, 'brushes', pack, file))).map((file) => `  brushes/${pack}/${file}: ${source}`);
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


/**
 * Checks each style the project names, throwing with every problem at once, then rewrites generated/stamp-paint-styles.ts
 * and returns its path. A style's images are imported by name, so naming another brush or paper needs a new bundle.
 */
export function writeProjectStylesModule(projectDir: string): string {
  const declarationFile = join(resolve(projectDir), 'project.ts');
  const names = existsSync(declarationFile) ? requireDefault<ProjectDeclaration>(declarationFile).styles ?? [] : [];
  const problems = names.flatMap((name) => {
    const file = join(stylesDirFor(projectDir), name, 'style.ts');
    if (!existsSync(file)) {
      return [`styles: ${basename(resolve(projectDir))}'s project.ts names ${JSON.stringify(name)}, which isn't a style (work/styles/ has ${listStyles(projectDir).join(', ') || 'none'})`];
    }
    const lines = styleAssetProblems(join(stylesDirFor(projectDir), name), requireDefault<StampPaintStyle>(file));
    return lines.length ? [`styles: ${name} can't paint until its packs are imported in work/styles/${name}/ (brushes/ isn't in git, so each machine imports its own; docs/private-styles.md):\n${lines.join('\n')}`] : [];
  });
  if (problems.length) throw new Error(problems.join('\n'));

  const path = projectStylesModuleFor(projectDir);
  const from = (p: string) => JSON.stringify(relative(dirname(path), p).split('\\').join('/'));
  const imports: string[] = [], entries: string[] = [];
  names.forEach((name, s) => {
    const dir = join(stylesDirFor(projectDir), name);
    const style = requireDefault<StampPaintStyle>(join(dir, 'style.ts'));
    const packs = Object.keys(style.packs);
    const manifests = Object.fromEntries(packs.map((pack) => [pack, readManifest(dir, pack)]));
    const images = stampPaintStyleImages(resolveStampPaintStyle(name, style, manifests));
    imports.push(`import style${s} from ${from(join(dir, 'style.ts'))};`);
    packs.forEach((pack, p) => imports.push(`import manifest${s}_${p} from ${from(join(dir, 'brushes', pack, STAMP_PAINT_PACK_MANIFEST))};`));
    images.forEach(({ pack, file }, i) => imports.push(`import image${s}_${i} from ${from(join(dir, 'brushes', pack, file))};`));
    entries.push(
      `  ${JSON.stringify(name)}: {`,
      `    style: style${s},`,
      `    manifests: { ${packs.map((pack, p) => `${JSON.stringify(pack)}: manifest${s}_${p}`).join(', ')} },`,
      `    images: {`,
      ...images.map(({ pack, file }, i) => `      ${JSON.stringify(`${pack}/${file}`)}: image${s}_${i},`),
      '    },',
      '  },',
    );
  });
  const module = [
    "// Written on every bundle from the project's project.ts (lib/picture/stamp-paint/engine/project-styles.ts): the styles it names. Edits here are lost.",
    ...imports,
    '',
    `export default {`,
    ...entries,
    `};`,
    '',
  ].join('\n');
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
  return path;
}
