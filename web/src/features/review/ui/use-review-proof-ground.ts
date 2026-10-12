import { useLocalStorage } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
import { useQueries } from '@tanstack/react-query';
import { colors } from '#web/shared/ui/theme.stylex.ts';

/** A still in a format that can hold transparency, so it's proofed over a ground whatever its snapshot says. */
const REVIEW_PROOFED_STILL = /\.(png|webp)$/i;

/** Whether the file is drawn over the proof ground: a transparent render, or a still that may be one. */
export const reviewIsProofed = ({ kind, path, transparent }: { kind: string; path: string; transparent: boolean }) =>
  transparent || (kind === 'still' && REVIEW_PROOFED_STILL.test(path));

/** The grounds a transparent picture can be proofed over: the checkerboard, and the flat colours it may sit on. */
export const REVIEW_PROOF_GROUNDS = ['checker', 'coral', 'navy', 'white', 'black'] as const;
export type ReviewProofGround = (typeof REVIEW_PROOF_GROUNDS)[number];

/** Each ground as a background, for the box a transparent picture is drawn in (its own box, not the letterbox). */
export const reviewProofGroundStyles = stylex.create({
  checker: {
    backgroundColor: colors.checkerLight,
    backgroundImage: `repeating-conic-gradient(${colors.checkerDark} 0 25%, transparent 0 50%)`,
    backgroundSize: '16px 16px',
  },
  coral: { backgroundColor: colors.proofCoral },
  navy: { backgroundColor: colors.proofNavy },
  white: { backgroundColor: colors.proofWhite },
  black: { backgroundColor: colors.proofBlack },
});

/**
 * The ground every transparent picture on the screen is drawn over, chosen once: the stage, the Board's tiles, the
 * grid and the filmstrip all read the same one, and it's remembered across reloads as the reviewer's preference.
 */
export function useReviewProofGround(): readonly [ReviewProofGround, (ground: ReviewProofGround) => void] {
  const [ground, setGround] = useLocalStorage<ReviewProofGround>({ key: 'review-proof-ground', defaultValue: 'checker' });
  return [REVIEW_PROOF_GROUNDS.includes(ground) ? ground : 'checker', setGround];
}

/** A still's own pixels: its size, and whether any of them lets the ground through. */
export type ReviewStillPixels = { readonly w: number; readonly h: number; readonly clear: boolean };

/** The longest side the alpha check reads at: a clear patch still pulls its block below opaque when scaled down. */
const REVIEW_ALPHA_CHECK_EDGE = 512;

/** Decodes the still and, for a format that can hold transparency, reads whether any pixel is less than opaque. */
async function readReviewStillPixels(src: string, mayBeClear: boolean): Promise<ReviewStillPixels> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const { naturalWidth: w, naturalHeight: h } = image;
  if (!mayBeClear) return { w, h, clear: false };
  const scale = Math.min(1, REVIEW_ALPHA_CHECK_EDGE / Math.max(w, h));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { w, h, clear: false };
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return { w, h, clear: true };
  return { w, h, clear: false };
}

/**
 * Each still's pixels, read once per URL and kept: whether the ground can show through it (a PNG may well be opaque),
 * and its size, for the zoom readout. Undefined until the still has decoded.
 */
export function useReviewStillPixels(stills: readonly { readonly path: string; readonly src: string }[]): (ReviewStillPixels | undefined)[] {
  return useQueries({
    queries: stills.map(({ path, src }) => ({
      queryKey: ['review-still-pixels', src],
      queryFn: () => readReviewStillPixels(src, reviewIsProofed({ kind: 'still', path, transparent: false })),
      staleTime: Infinity,
    })),
  }).map((q) => q.data);
}
