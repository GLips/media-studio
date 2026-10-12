import { useLocalStorage } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
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
