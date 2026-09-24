// generated-image.ts: `studio gen image`. Generates a still (cached like every paid generation, lib/paid-generation.ts)
// and lists it by name in generated/images.ts, which the video imports:
//   import { images } from './generated/images.ts';
//   <Img src={images['title-bg'].src} style={{ objectFit: 'cover' }} />
// Generating a name again with a new prompt or model replaces its entry; the old file stays in generated/, cached.
//
// Each model takes its own subset of the image API's params, and OpenRouter silently drops the rest, so the request is
// checked against the model's own description (fetchOpenRouterImageModel) before anything is paid for.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fetchOpenRouterImageModel, type OpenRouterImageModel } from './openrouter.ts';
import { generatePaidMedia } from './paid-generation.ts';

/** Cheap ($0.01), takes reference images, and good enough for a final still; it ignores aspect ratio and makes 3:2. */
export const DEFAULT_IMAGE_MODEL = 'meta/muse-image';

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

type ImageEntry = { file: string; w: number; h: number; model: string; prompt: string };

/** Generates the image and lists it as images[name]. Returns the image's path and the generated/images.ts it rewrote. */
export async function generateProjectImage(project: string, request: GeneratedImageRequest): Promise<{ file: string; index: string }> {
  if (!/^[a-z][a-z0-9-]*$/.test(request.name)) throw new Error(`--name must be lowercase words joined by dashes, not ${request.name}`);
  for (const ref of request.references) if (!existsSync(ref)) throw new Error(`no reference image at ${ref}`);
  const params = openRouterImageParams(await fetchOpenRouterImageModel(request.model), request);

  const [file] = await generatePaidMedia(project, {
    kind: 'image', model: request.model, name: request.name, prompt: request.prompt, params,
    references: request.references.map((path) => ({ path })),
  });
  const { w, h } = imageSize(file);
  const index = writeImageEntry(project, request.name, { file: relative(join(project, 'generated'), file), w, h, model: request.model, prompt: request.prompt });
  console.error(`images['${request.name}']: ${w}×${h}, ${request.model}`);
  return { file, index };
}

/** The request params for `model`, refusing anything the model would silently ignore. */
export function openRouterImageParams(model: OpenRouterImageModel, { aspect, transparent, references }: Pick<GeneratedImageRequest, 'aspect' | 'transparent' | 'references'>) {
  const supported = model.supported_parameters;
  const enumValues = (param: string) => {
    const spec = supported[param];
    return spec?.type === 'enum' ? spec.values : [];
  };
  const params: Record<string, unknown> = {};
  if (aspect !== undefined) {
    const aspects = enumValues('aspect_ratio');
    if (!aspects.includes(aspect)) {
      throw new Error(aspects.length
        ? `${model.id} takes --aspect ${aspects.join(', ')}, not ${aspect}`
        : `${model.id} ignores --aspect: leave it off and frame the still with objectFit: 'cover', or pick a model that takes it`);
    }
    params.aspect_ratio = aspect;
  }
  if (transparent) {
    if (!enumValues('background').includes('transparent')) throw new Error(`${model.id} can't make a transparent background; openai/gpt-image-1-mini can`);
    params.background = 'transparent';
  }
  if (references.length) {
    if (!model.architecture.input_modalities.includes('image')) throw new Error(`${model.id} takes no reference images`);
    const range = supported.input_references;
    if (range?.type === 'range' && references.length > range.max) throw new Error(`${model.id} takes at most ${range.max} reference image(s), not ${references.length}`);
  }
  return params;
}

// An SVG's size is its viewBox: it scales to whatever box the scene gives it, so this only sets its aspect.
function imageSize(file: string): { w: number; h: number } {
  if (file.endsWith('.svg')) {
    const viewBox = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(readFileSync(file, 'utf8'));
    if (!viewBox) throw new Error(`${file} has no viewBox to size it by`);
    return { w: Number(viewBox[1]), h: Number(viewBox[2]) };
  }
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
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
