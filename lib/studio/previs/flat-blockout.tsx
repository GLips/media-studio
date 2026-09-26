// flat-blockout.tsx: a 2D blockout, the blocking rung of a flat scene (#models/timeline/scene-rung.ts) and, like a 3D
// blockout (blockout.tsx), a reference video `studio gen video` can send. Flat boxes, placeholder type and crossed
// image slots stand in for a scene's pieces, each labelled with its name, on a gridded ground; they move on the frames
// of the scene's clock (flat-blockout-pose.ts), and the view can push or pan across them. What's settled here is where things
// sit and when they move, at the real timing; nothing is styled.

import { AbsoluteFill } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { flatPoseAt, type FlatKey, type FlatPose, type FlatView } from './flat-blockout-pose.ts';
import { motionAttrs } from '../probe/motion-tag.ts';
import { useVideoFormat } from '../composition/video-format.ts';

/** `box` is any shape or panel, `type` a line of words set at its box's height, `image` a slot for a picture or footage. */
export type FlatPieceKind = 'box' | 'type' | 'image';
export type FlatPiece = {
  kind: FlatPieceKind;
  /** Its label, its motion track's name, and how a previs prompt names it. Unique in the scene. */
  name: string;
  /** Where it rests before its first key; opacity and scale default to 1, the turn to 0. */
  pose: Pick<FlatPose, 'x' | 'y' | 'w' | 'h'> & Partial<FlatPose>;
  keys?: readonly FlatKey<FlatPose>[];
  /** A muted tint, as a 3D blockout's: a previs prompt names a piece by it, and a saturated one comes back saturated. */
  color?: string;
  /** A `type` piece's words. Default its name. */
  text?: string;
};
export type FlatViewMoves = { rest?: FlatView; keys?: readonly FlatKey<FlatView>[] };

const GROUND = '#eceef1';
const GRID = '#d9dce1';
const GREY = '#b9bcc2';
const INK = '#3b3f46';

/**
 * The scene's pieces on `frame` of the clock their keys are on, drawn in order (the last on top), through `view`. A
 * timed scene's is its own clock's (`blockingScene`); a scene timed in seconds passes `s.t * fps`. With no view, it holds
 * the frame's centre at zoom 1.
 */
export function FlatBlockout({ pieces, view, frame }: { pieces: readonly FlatPiece[]; view?: FlatViewMoves; frame: number }) {
  const { width, height } = useVideoFormat();
  const { cx, cy, zoom } = flatPoseAt(view?.rest ?? { cx: width / 2, cy: height / 2, zoom: 1 }, view?.keys ?? [], frame);
  return (
    <AbsoluteFill style={{ background: GROUND, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${width / 2}px, ${height / 2}px) scale(${zoom}) translate(${-cx}px, ${-cy}px)` }}>
        {/* The grid moves with the view, as a 3D blockout's ground does, so a push or pan reads as one. */}
        <div style={{
          position: 'absolute', left: -width, top: -height, width: 3 * width, height: 3 * height,
          backgroundImage: `linear-gradient(${GRID} 2px, transparent 2px), linear-gradient(90deg, ${GRID} 2px, transparent 2px)`,
          backgroundSize: '120px 120px',
        }} />
        {pieces.map((piece) => <FlatPieceAt key={piece.name} piece={piece} frame={frame} />)}
      </div>
    </AbsoluteFill>
  );
}

function FlatPieceAt({ piece, frame }: { piece: FlatPiece; frame: number }) {
  const { x, y, w, h, opacity, scale, rotateDeg } = flatPoseAt({ opacity: 1, scale: 1, rotateDeg: 0, ...piece.pose }, piece.keys ?? [], frame);
  const color = piece.color ?? (piece.kind === 'type' ? INK : GREY);
  const box = { position: 'absolute', left: x, top: y, width: w, height: h, opacity, transform: `rotate(${rotateDeg}deg) scale(${scale})` } as const;
  if (piece.kind === 'type') {
    return (
      <div {...motionAttrs({ name: piece.name })} style={{ ...box, color, font: `700 ${h * 0.8}px/${h}px ${DISPLAY_FONT}`, whiteSpace: 'nowrap' }}>
        {piece.text ?? piece.name}
      </div>
    );
  }
  return (
    <div {...motionAttrs({ name: piece.name })} style={{ ...box, background: piece.kind === 'image' ? `${color}66` : color, border: `3px solid ${color}`, boxSizing: 'border-box' }}>
      {piece.kind === 'image' && (
        <svg width={w} height={h} style={{ position: 'absolute', left: -3, top: -3 }}>
          <line x1={0} y1={0} x2={w} y2={h} stroke={color} strokeWidth={3} />
          <line x1={w} y1={0} x2={0} y2={h} stroke={color} strokeWidth={3} />
        </svg>
      )}
      <span style={{ position: 'absolute', left: 10, top: 6, font: `600 18px ${MONO_FONT}`, color: INK, opacity: 0.7, whiteSpace: 'nowrap' }}>{piece.name}</span>
    </div>
  );
}
