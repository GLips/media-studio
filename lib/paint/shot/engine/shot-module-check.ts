// shot-module-check.ts: a module's painted shots checked in Node, as `studio paint check` reports them: every exported
// value shaped as PaintedShotProps (a camera, planes and the span it's drawn over) compiled as its PaintedShot would
// compile it, its problems and its motion's warnings (shot-motion-warnings.ts) said by export.
//
// Negative space: a shot is checked without its page. Its canvases are the ones its planes name, far to near, and HTML
// is taken to lie behind it, so a clear back passes here; what the page decides is the render's to refuse. A shot
// built by a function, from a scene's clock say, isn't seen: export its value to check it.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { compilePaintedShot } from '../models/shot-compile.ts';
import type { PaintedShotProps } from '../models/shot-props.ts';

/** A module's shot checked: its export's name, and its problems, errors and warnings both. */
export type ShotModuleCheck = { readonly name: string; readonly problems: readonly PaintingProblem[] };

/** Whether `value` is shaped as a painted shot's props: a camera, its planes, and its span. */
function isPaintedShotProps(value: unknown): value is PaintedShotProps {
  if (typeof value !== 'object' || value === null) return false;
  return 'camera' in value && typeof value.camera === 'object' && 'planes' in value && Array.isArray(value.planes) && 'span' in value && typeof value.span === 'object';
}

const planeFarthest = (plane: PaintedShotProps['planes'][number]) => (plane.kind === 'instanced' ? plane.depths.far : plane.depth);

/** The canvases `shot`'s planes name, in the order its page must hold them: the farthest plane's first. */
function shotNamedCanvases(shot: PaintedShotProps): string[] {
  return [...new Set(shot.planes.toSorted((a, b) => planeFarthest(b) - planeFarthest(a)).flatMap(({ canvas }) => (canvas === undefined ? [] : [canvas])))];
}

/** Whether `loaded`, what an import gave, is a module's namespace: an object of its exports. */
const isModuleNamespace = (loaded: unknown): loaded is object => typeof loaded === 'object' && loaded !== null;

/**
 * Every painted shot the module at `file` exports, checked (see the file's head). Throws for a module exporting none.
 * Its painting sources evaluate as it imports them, so the caller registers the render's tsx hooks first.
 */
export async function checkPaintedShotModuleFile(file: string): Promise<ShotModuleCheck[]> {
  const loaded: unknown = await import(pathToFileURL(resolve(file)).href);
  const exported: [string, unknown][] = isModuleNamespace(loaded) ? Object.entries(loaded) : [];
  const shots = exported.filter((entry): entry is [string, PaintedShotProps] => isPaintedShotProps(entry[1]));
  if (!shots.length) throw new Error(`${file} exports no painted shot: \`studio paint check\` checks a *.painting.ts source, or a module exporting a shot's props (camera, planes, span)`);
  return shots.map(([name, shot]) => ({ name, problems: compilePaintedShot(shot, shotNamedCanvases(shot), shot.span.fps, { htmlBehind: true }).problems }));
}
