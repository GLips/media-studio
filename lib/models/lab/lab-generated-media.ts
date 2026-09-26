// lab-generated-media.ts: how the lab's Generated media tab reads the catalog's gallery: which pieces are previs
// renders, music or other stills, what they cost, and the words it shows for each.
import type { LabGalleryItem } from './lab-catalog.ts';

/** A dollar amount at the precision that matters: $1.39, $0.04, $0.004. */
export function formatGenerationCost(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3).replace(/0$/, '')}`;
}

export const sumGenerationCost = (items: readonly LabGalleryItem[]) => items.reduce((s, i) => s + (i.cost ?? 0), 0);

export const GENERATED_MEDIA_KIND_WORDS = { image: 'Image', video: 'Video clip', audio: 'Music track' } as const;

const LAB_MUSIC_MODEL_WORDS: Readonly<Record<string, string>> = {
  'google/lyria-3-clip-preview': 'Lyria 3 Clip · ~30 s',
  'google/lyria-3-pro-preview': 'Lyria 3 Pro · full length',
};

/** A music model as a reader knows it, or its id when the lab has no words for it. */
export const labMusicModelWords = (model: string) => LAB_MUSIC_MODEL_WORDS[model] ?? model;

/** A project's slug without its date: `2026-09-motion-showcase` reads `motion-showcase`. */
export const labProjectShortName = (project: string) => project.replace(/^\d{4}-\d{2}-/, '');

/**
 * Whether a catalog URL is a video. Served, the file's path is the `path` query (`/media/<project>?path=…`);
 * exported, it's the URL's own path, so both are read.
 */
export function isLabVideoUrl(url: string): boolean {
  const parsed = new URL(url, 'http://lab.invalid');
  return /\.(mp4|webm)$/i.test(parsed.searchParams.get('path') ?? parsed.pathname);
}

/** The blockout is the previs reference that's a video; any other reference is a photo of a real subject. */
export const previsBlockoutUrl = (item: LabGalleryItem) => item.references.find(isLabVideoUrl);

/**
 * The part of a previs prompt that names the scene. Every one opens with the same paragraph telling the model to
 * follow @Video1; what differs, and what a reader wants, is what each grey shape becomes.
 */
export const previsSceneText = (prompt: string) => prompt.split('\n\n').slice(1).join('\n\n') || prompt;

export type LabGallerySections = {
  /** Video renders that followed a blockout. */
  previs: LabGalleryItem[];
  music: LabGalleryItem[];
  /** Everything else: stills, and any clip made without a blockout. */
  others: LabGalleryItem[];
};

/** The gallery split into the tab's sections, each piece in exactly one. */
export function splitLabGallery(gallery: readonly LabGalleryItem[]): LabGallerySections {
  const previs = gallery.filter((i) => i.kind === 'video' && previsBlockoutUrl(i));
  const music = gallery.filter((i) => i.kind === 'audio');
  const others = gallery.filter((i) => !previs.includes(i) && !music.includes(i));
  return { previs, music, others };
}
