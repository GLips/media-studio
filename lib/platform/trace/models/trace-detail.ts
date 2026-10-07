// trace-detail.ts: which frames a render traces in detail (`studio render --trace detail[:a:b]`): their solves span by
// span down to each sheet entry and GPU step, where an ordinary render traces each solve whole. Detail costs a
// span per step, a few thousand a solve, so it's asked for, over a few frames where it can be.

/** Frames `from` to `end` (exclusive; null for to the end) traced in detail. */
export type TraceDetail = { readonly from: number; readonly end: number | null };

/** `--trace`'s value read: `detail` for every frame, `detail:a:b` for frames a to b, inclusive. */
export function traceDetailOf(text: string): TraceDetail {
  if (text === 'detail') return { from: 0, end: null };
  const range = /^detail:(\d+):(\d+)$/.exec(text);
  if (!range || Number(range[2]) < Number(range[1])) throw new Error(`--trace is detail, or detail:120:239 for frames 120 to 239; not ${text}`);
  return { from: Number(range[1]), end: Number(range[2]) + 1 };
}

/** Whether `detail` covers `frame`; never with no detail. */
export const traceDetailCovers = (detail: TraceDetail | undefined, frame: number) => !!detail && frame >= detail.from && (detail.end === null || frame < detail.end);
