// piece.tsx: the shape of one entry in the Kit pieces tab's registry: a piece's plain-words name and blurb, the
// stage that plays it, its default props and the controls that change them. Adding a newly committed piece to the
// tab is one `defineKitPiece` entry in kit.tsx's KIT_PIECES.
import type { ComponentType, ReactNode } from 'react';

export type KitPieceProps = Record<string, unknown>;

export type KitPieceControlsProps<P extends KitPieceProps> = { props: P; set: (patch: Partial<P>) => void };

export type KitPiece<P extends KitPieceProps> = {
  id: string;
  /** Plain words, for the picker and heading. */
  title: string;
  /** The component's real name in lib/studio, shown only under "For agents" so it can be grepped for. */
  name: string;
  /** One line, no jargon: what the viewer sees. */
  blurb: string;
  /** Where lib/studio keeps it. */
  source: string;
  whenUsed: ReactNode;
  /** Anything worth knowing to read the stage, shown under it. */
  note?: ReactNode;
  defaults: P;
  /** Loop length for these props, so a slow setting still gets to finish and hold before the loop restarts. */
  seconds: (props: P) => number;
  Stage: ComponentType<P>;
  Controls: ComponentType<KitPieceControlsProps<P>>;
};

/**
 * Checks one entry against its own props type, then erases it so pieces with different props share one array. The
 * tab only ever hands a piece's own props back to its own Stage and Controls, which is what makes the erasure safe.
 */
export const defineKitPiece = <P extends KitPieceProps>(piece: KitPiece<P>) => piece as unknown as KitPiece<KitPieceProps>;

/** A one-line text box styled like the lab's sliders, for words a piece shows. */
export function KitTextField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode }) {
  return (
    <label className="slider kit-text">
      <span className="row"><span>{label}</span></span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Showcase colours a piece can take, by name, for colour pickers. */
export const KIT_COLOR_OPTIONS = [
  { value: '#ee4c23', label: 'Red-orange' },
  { value: '#4144f4', label: 'Cobalt' },
  { value: '#f3f0e7', label: 'Cream' },
  { value: '#3ccf7a', label: 'Green' },
] as const;
