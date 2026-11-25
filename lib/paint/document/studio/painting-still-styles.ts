// painting-still-styles.ts: `@stamp-paint-styles` for a still's page (engine/painting-still.ts), so a painting source
// that imports `#studio` bundles. It serves no style: Node resolves the source's brushes and hands them in with the
// request, so the page never reads a style by name, and a source that calls stampPaintStyle there throws naming it.
import type { BundledStampPaintStyles } from '#lib/paint/style/models/style.ts';

const paintingStillStyles: BundledStampPaintStyles = {};
export default paintingStillStyles;
