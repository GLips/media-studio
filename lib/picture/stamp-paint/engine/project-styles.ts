// project-styles.ts: the private styles a project's project.ts names in `styles`, found in work/styles/<name>/ and
// checked before a bundle: each pack a style's style.ts lists must be imported on this machine, at the asset version
// the studio reads, with every file its manifest lists. A style that fails stops the bundle, listing each file with
// the pack's `source`, as a brand kit's missing fonts do.
//
// Imported by lib/output/render/engine/project-bundle.ts, so it stays free of import.meta (the Remotion CLI bundles that
// file to CommonJS): work/styles is found from the project's folder, and project.ts and style.ts are read with require,
// which Node strips of types.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import type { ProjectDeclaration } from '#lib/platform/project/models/capability.ts';
import { STAMP_PAINT_ASSETS_VERSION, STAMP_PAINT_PACK_MANIFEST, type StampPaintPackManifest, type StampPaintStyle } from '../models/style.ts';

const stylesDirFor = (projectDir: string) => join(resolve(projectDir), '..', '..', 'styles');
const requireDefault = <T>(file: string) => (createRequire(file)(file) as { default: T }).default;

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
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as StampPaintPackManifest;
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
  return [...packProblems, ...brushProblems];
}

/** Throws, naming every style problem at once, unless each style the project names can paint on this machine. */
export function assertProjectStylesReady(projectDir: string): void {
  const declarationFile = join(resolve(projectDir), 'project.ts');
  if (!existsSync(declarationFile)) return;
  const names = requireDefault<ProjectDeclaration>(declarationFile).styles ?? [];
  const problems = names.flatMap((name) => {
    const file = join(stylesDirFor(projectDir), name, 'style.ts');
    if (!existsSync(file)) {
      return [`styles: ${basename(resolve(projectDir))}'s project.ts names ${JSON.stringify(name)}, which isn't a style (work/styles/ has ${listStyles(projectDir).join(', ') || 'none'})`];
    }
    const lines = styleAssetProblems(join(stylesDirFor(projectDir), name), requireDefault<StampPaintStyle>(file));
    return lines.length ? [`styles: ${name} can't paint until its packs are imported in work/styles/${name}/ (brushes/ isn't in git, so each machine imports its own; docs/private-styles.md):\n${lines.join('\n')}`] : [];
  });
  if (problems.length) throw new Error(problems.join('\n'));
}
