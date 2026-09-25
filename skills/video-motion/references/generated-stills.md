# Generated stills

A still nothing drawn or captured gives (title-card art, a background, a physical product's shot, a concept icon) is
generated with `studio gen image <p> "<prompt>" --name <name>`. A product's UI is never generated (the `video-kickoff`
skill, Real UI only). It's paid and cached by request, so settle the prompt before re-running.

- Hand it what's real: the product's own photo or capture crop as `--ref`, and brand colours as hex in the prompt.
- The default, `openai/gpt-image-2.5-sunburst`, does titles, product shots, icons and legible small text, and takes
  `--aspect` and `--transparent` (for a cutout laid over a scene). Reach past it only for the job:
  `recraft/recraft-v4.1-vector` when an icon must be an SVG (its colours drift, so check the hex);
  `x-ai/grok-imagine-image-2.0` for the closest likeness to a product `--ref`, but it's slow (up to ~90 s). Not
  `google/gemini-3.1-flash-image`: fastest, but it redraws products and garbles text. If the default is gone from
  OpenRouter, `openai/gpt-image-2` is its fallback (no transparent background).
- It lands in `generated/images.ts`: `import { images } from './generated/images.ts'`, then `images[name].src`.
  Pass `--aspect 16:9` for a full-frame still; it still won't be exactly 1920×1080, so fill the frame with
  `objectFit: 'cover'`.
- Look at it before using it: colours drift from the hex asked for, and a product shot can invent parts.
