import type { ComponentType, ReactNode } from 'react';
import type { DrawPathKitProps } from '#studio/lab/kit/draw-path-kit-stage.tsx';
import type { EndCardKitProps } from '#studio/lab/kit/end-card-kit-stage.tsx';
import type { GlassCardKitProps } from '#studio/lab/kit/glass-card-kit-stage.tsx';
import type { GradeKitProps } from '#studio/lab/kit/grade-kit-stage.tsx';
import type { OdometerKitProps } from '#studio/lab/kit/odometer-kit-stage.tsx';
import type { SectionCardKitProps } from '#studio/lab/kit/section-card-kit-stage.tsx';
import type { ShutterBlurKitProps } from '#studio/lab/kit/shutter-blur-kit-stage.tsx';
import type { WordRevealKitProps } from '#studio/lab/kit/word-reveal-kit-stage.tsx';

/** Each piece's id and the props its stage plays. A new piece is a row here and an entry in LAB_KIT_PIECES. */
export type LabKitPropsById = {
  'word-reveal': WordRevealKitProps;
  odometer: OdometerKitProps;
  'draw-path': DrawPathKitProps;
  'glass-card': GlassCardKitProps;
  'section-card': SectionCardKitProps;
  'end-card': EndCardKitProps;
  grade: GradeKitProps;
  'shutter-blur': ShutterBlurKitProps;
};

export type LabKitPieceId = keyof LabKitPropsById;

export type LabKitControlsProps<P> = { readonly props: P; readonly set: (patch: Partial<P>) => void };

/** One piece in the Kit pieces tab: its plain-words name and blurb, the stage that plays it, and its controls. */
export type LabKitPiece<K extends LabKitPieceId> = {
  id: K;
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
  defaults: LabKitPropsById[K];
  /** Loop length for these props, so a slow setting still gets to finish and hold before the loop restarts. */
  seconds: (props: LabKitPropsById[K]) => number;
  Stage: ComponentType<LabKitPropsById[K]>;
  Controls: ComponentType<LabKitControlsProps<LabKitPropsById[K]>>;
};
