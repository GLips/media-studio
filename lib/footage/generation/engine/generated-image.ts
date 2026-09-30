// generated-image.ts: `studio gen image`. Generates a still (cached like every paid generation, lib/footage/generation/engine/paid-generation.ts)
// and lists it by name in generated/images.ts, which the video imports:
//   import { images } from './generated/images.ts';
//   <Img src={images['title-bg'].src} style={{ objectFit: 'cover' }} />
// Generating a name again with a new prompt or model replaces its entry; the old file stays in generated/, cached.
//
// Each model takes its own subset of the image API's params, and OpenRouter silently drops the rest, so a request
// that isn't cached is checked against the model's own description (fetchOpenRouterImageModel) before it's paid for.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fetchOpenRouterImageModel, type OpenRouterImageModel } from './openrouter.ts';
import { generatePaidMedia } from './paid-generation.ts';
import { runFfprobe } from '#lib/output/ffmpeg/engine/ffmpeg.ts';

/**
 * Chosen in vid-20's bake-off: good at title backgrounds, product shots from a reference, icons and legible small
 * text, for $0.004–0.033 an image. The name is a dated variant; if OpenRouter drops it, openai/gpt-image-2 is the
 * fallback (same price, but no transparent background).
 */
export const DEFAULT_IMAGE_MODEL = 'openai/gpt-image-2.5-sunburst';

export type GeneratedImageRequest = {
  name: string;
  prompt: string;
  model: string;
  /** Absolute paths of images sent with the prompt: a product still to reshoot, brand art to match. */
  references: readonly string[];
  /** e.g. '16:9'; left to the model when absent. */
  aspect?: string;
  /** A transparent background, for an icon or cutout laid over a scene. */
  transparent: boolean;
};

// What a video can import (types.d.ts declares these) and the image API reads as a reference.
const IMPORTABLE_IMAGE = new Set(['png', 'jpg', 'webp', 'svg']);
const REFERENCE_IMAGE = ['.png', '.jpg', '.jpeg', '.webp'];

type ImageEntry = { file: string; w: number; h: number; model: string; prompt: string };

/** Generates the image and lists it as images[name]. Returns the image's path and the generated/images.ts it rewrote. */
export async function generateProjectImage(project: string, request: GeneratedImageRequest): Promise<{ file: string; index: string }> {
  if (!/^[a-z][a-z0-9-]*$/.test(request.name)) throw new Error(`--name must be lowercase words joined by dashes, not ${request.name}`);
  for (const ref of request.references) {
    if (!existsSync(ref)) throw new Error(`no reference image at ${ref}`);
    if (!REFERENCE_IMAGE.includes(extname(ref).toLowerCase())) throw new Error(`${ref}: a reference image must be one of ${REFERENCE_IMAGE.join(' ')}`);
  }
  const params = {
    ...(request.aspect !== undefined && { aspect_ratio: request.aspect }),
    ...(request.transparent && { background: 'transparent' }),
  };
  const [file] = await generatePaidMedia(project, {
    kind: 'image', model: request.model, name: request.name, prompt: request.prompt, params,
    references: request.references.map((path) => ({ path })),
    beforePaying: async () => checkOpenRouterImageRequest(await fetchOpenRouterImageModel(request.model), request),
  });
  // Already paid for and cached, so a rerun lands here again rather than paying: the model needs changing.
  const ext = extname(file).slice(1);
  if (!IMPORTABLE_IMAGE.has(ext)) throw new Error(`${request.model} made a .${ext} (${file}), which a video can't import; pick another --model`);
  const { w, h } = imageSize(file);
  const index = writeImageEntry(project, request.name, { file: relative(join(project, 'generated'), file), w, h, model: request.model, prompt: request.prompt });
  console.error(`images['${request.name}']: ${w}×${h}, ${request.model}`);
  return { file, index };
}

/** Refuses a request `model` would silently ignore part of, or fail upstream. */
function checkOpenRouterImageRequest(model: OpenRouterImageModel, { aspect, transparent, references }: GeneratedImageRequest) {
  const supported = model.supported_parameters;
  const enumValues = (param: string) => {
    const spec = supported[param];
    return spec?.type === 'enum' ? spec.values : [];
  };
  if (aspect !== undefined) {
    const aspects = enumValues('aspect_ratio');
    if (!aspects.includes(aspect)) {
      throw new Error(aspects.length
        ? `${model.id} takes --aspect ${aspects.join(', ')}, not ${aspect}`
        : `${model.id} ignores --aspect: leave it off and frame the still with objectFit: 'cover', or pick a model that takes it`);
    }
  }
  if (transparent && !enumValues('background').includes('transparent')) {
    throw new Error(`${model.id} can't make a transparent background; ${DEFAULT_IMAGE_MODEL} can`);
  }
  if (references.length && !model.architecture.input_modalities.includes('image')) throw new Error(`${model.id} takes no reference images`);
  const range = supported.input_references;
  if (range?.type === 'range' && (references.length < range.min || references.length > range.max)) {
    throw new Error(`${model.id} takes ${range.min}–${range.max} reference images, not ${references.length}`);
  }
}

// An SVG's size is its root's viewBox, else its width and height: it scales to whatever box the scene gives it, so
// this only sets its aspect.
function imageSize(file: string): { w: number; h: number } {
  if (file.endsWith('.svg')) {
    const root = /<svg\b[^>]*>/.exec(readFileSync(file, 'utf8'))?.[0] ?? '';
    const attr = (name: string) => new RegExp(`\\s${name}=["']([^"']*)["']`).exec(root)?.[1];
    const [w, h] = attr('viewBox')?.trim().split(/[\s,]+/).slice(2).map(Number) ?? [parseFloat(attr('width') ?? ''), parseFloat(attr('height') ?? '')];
    if (!(w > 0 && h > 0)) throw new Error(`${file}: its <svg> has no viewBox or width and height to size it by`);
    return { w, h };
  }
  const [w, h] = runFfprobe(['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  return { w, h };
}

// images.json is the list, with what made each image; images.ts, rewritten from it each time, imports each file so the
// bundle serves it.
function writeImageEntry(project: string, name: string, entry: ImageEntry): string {
  const listPath = join(project, 'generated', 'images.json');
  const list: Record<string, ImageEntry> = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : {};
  list[name] = entry;
  writeFileSync(listPath, JSON.stringify(list, null, 2));
  const images = Object.entries(list);
  const index = join(project, 'generated', 'images.ts');
  writeFileSync(index, [
    '// Written by `studio gen image` from images.json. Edits here are lost on the next generation.',
    ...images.map(([, { file }], i) => `import g${i} from './${file}';`),
    '',
    'export const images = {',
    ...images.map(([id, { w, h }], i) => `  ${JSON.stringify(id)}: { src: g${i}, w: ${w}, h: ${h} },`),
    '} as const;',
    '',
  ].join('\n'));
  return index;
}
