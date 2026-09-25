# Generated stills

A still nothing drawn or captured gives (title-card art, a background, a physical product's shot, a concept icon) is
generated with `studio gen image <p> "<prompt>" --name <name>`. A product's UI is never generated (the `video-kickoff`
skill, Real UI only). It's paid and cached by request, so settle the prompt before re-running.

- Hand it what's real: the product's own photo or capture crop as `--ref`, and brand colours as hex in the prompt.
- Keep the default model unless the job needs another; `studio gen image --help` says which model does what.
- Pass `--aspect 16:9` for a full-frame still; it still won't be exactly 1920×1080, so fill the frame with
  `objectFit: 'cover'`.
- Look at it before using it: colours drift from the hex asked for, and a product shot can invent parts.
