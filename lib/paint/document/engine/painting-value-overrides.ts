// painting-value-overrides.ts: `studio look --set`'s `painting.property=value` pairs read against a project's painting
// sources, for a render to paint them at over every scene's values (lib/picture/composition's install). A
// painting is named by its factory, as its problems name it; each value is read and checked by its schema, as
// `studio paint check --set` reads one.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paintingValueProblems, paintingValuesFromText, paintingValueTextPairs, type PropertySchema } from '../models/painting-properties.ts';
import { paintingSourceName, type PaintingSourceModule, type PaintingValueOverrides } from '../models/painting-source.ts';
import { loadPaintingSource } from './painting-source-load.ts';

/** Every `*.painting.ts` in `project`, but under its renders (`out/`). */
function projectPaintingSourceFiles(project: string): string[] {
  return readdirSync(project, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.painting.ts') && !file.startsWith('out/'))
    .map((file) => join(project, file));
}

/** `text`'s `painting.property=value` pairs, each name split at its first dot: each painting's values as text, by its name. */
function paintingValueTexts(text: string): Map<string, Record<string, string>> {
  const texts = new Map<string, Record<string, string>>();
  for (const [name, value] of paintingValueTextPairs('set', text)) {
    const dot = name.indexOf('.'), painting = name.slice(0, dot), property = name.slice(dot + 1);
    if (!painting || !property) throw new Error(`--set takes painting.property=value pairs, not "${name}=${value}"`);
    texts.set(painting, { ...texts.get(painting), [property]: value });
  }
  return texts;
}

/**
 * `text`'s `painting.property=value` pairs read against `project`'s painting sources: the values to paint each named
 * painting at, by its name. Throws for a name no source has or several share, or a value its schema refuses.
 */
export async function readPaintingValueOverrides(project: string, text: string): Promise<PaintingValueOverrides> {
  const texts = paintingValueTexts(text);
  const named = new Map<string, { file: string; source: PaintingSourceModule<PropertySchema> }[]>();
  const loaded = await Promise.all(projectPaintingSourceFiles(project).map(async (file) => ({ file, source: await loadPaintingSource(file) })));
  for (const found of loaded) named.set(paintingSourceName(found.source), [...named.get(paintingSourceName(found.source)) ?? [], found]);
  return Object.fromEntries([...texts].map(([name, given]) => {
    const found = named.get(name) ?? [];
    if (found.length === 0) throw new Error(`--set: no painting in ${project} is named ${name}; one is named by its factory: ${[...named.keys()].join(', ') || 'none'}`);
    if (found.length > 1) throw new Error(`--set: ${name} names ${found.length} painting sources (${found.map(({ file }) => file).join(', ')}): give their factories names of their own`);
    const schema = found[0].source.properties ?? {}, values = paintingValuesFromText(schema, given);
    const problems = paintingValueProblems(schema, values, name);
    if (problems.length) throw new Error(`--set: ${problems.map(({ message }) => message).join('; ')}`);
    return [name, values];
  }));
}
