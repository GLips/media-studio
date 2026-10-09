// frame-profiling.ts: `studio profile`, where a span of frames spends its time. Node only.
//
// The span rendered whole, timed from the frames' arrival, its pages sending each frame as delivery's do (drawn,
// read back and sent to Node, which drops it) and again sending none, the difference being capture; in one tab and in
// the session's. Each tab's first frame loads, and is left out. The drawing is read from the one-tab sending pass's
// trace (the pages' spans under it): each frame span's time, each load's, each readback step's
// (picture-readback-span.ts), and what drawing code counted a frame cost, on its frame span (frame-costs-table.ts).
import { renderFrames } from '@remotion/renderer';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { watchedRenderFrames } from '#lib/platform/browser/engine/render-watch.ts';
import type { RenderSession } from './render-session.ts';
import { traceLabel, traceQuantity, type TraceSpan } from '#lib/platform/trace/models/trace-model.ts';
import { PICTURE_READBACK_SPAN_KIND, PICTURE_READBACK_STEPS, type PictureReadbackStep } from '#lib/picture/readback/models/picture-readback-span.ts';
import { frameCostsOfTraceAttributes, frameCostsTable, type FrameCostsEntry } from '#lib/picture/profiling/models/frame-costs-table.ts';

/** Milliseconds, over the span's frames. */
export type FrameTimeSpread = { median: number; p90: number; max: number };

export type FrameProfileReport = {
  frames: { from: number; end: number };
  size: { width: number; height: number };
  gpu: string;
  /** Per label (a frame span's name and its shot), its time in each frame, summed over spans alike in a frame. */
  drawn: { label: string; frames: number; spread: FrameTimeSpread }[];
  /** Per load (a painted shot's, a stamp painting's), each one's time from begun to ready. */
  loads: { label: string; ms: number[] }[];
  /** Per step of sending a frame, its time over the frames past the first (which loads); none with one frame. */
  readback: { step: PictureReadbackStep; spread: FrameTimeSpread }[];
  /**
   * A frame's whole render, steady state: wall-clock per frame, in `tabs` at once, its frames sent and not.
   * `null` when the span has no frame past each tab's first, so no steady state to time.
   */
  whole: { tabs: number; sent: number | null; uncaptured: number | null }[];
  /** What the frames' drawing counted it cost, as their frame spans carry it. */
  costs: FrameCostsEntry[];
};

/** Span kinds of a frame's drawing, and names of a load, as painted-shot.tsx and stamp-painting.tsx trace them. */
const FRAME_KINDS = new Set(['shot-frame', 'painting-frame']);
/** A painted shot's warm: its costs counted apart from its frames', at the frame it loaded in. */
const isWarm = (span: TraceSpan) => span.kind === 'shot-phase' && span.name === 'warm';
const LOAD_NAMES = new Set(['painted shot load', 'stamp painting load']);

function spreadOf(values: number[]): FrameTimeSpread {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1] };
}

/** `items` grouped by `key`, in first-seen order. */
function groupedBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** The spans under `root`, at any depth, in the order they began. */
function spansUnder(spans: readonly TraceSpan[], root: string): TraceSpan[] {
  const children = groupedBy(spans, (s) => s.parent);
  const under: TraceSpan[] = [], open = [root];
  for (let id = open.pop(); id !== undefined; id = open.pop()) {
    for (const child of children.get(id) ?? []) {
      under.push(child);
      open.push(child.id);
    }
  }
  return under.toSorted((a, b) => a.start - b.start);
}

const labelOf = (span: TraceSpan) => {
  const shot = traceLabel(span, 'shot');
  return shot ? `${span.name} (${shot})` : span.name;
};

/** The drawing the pages traced under the pass span `pass`: frame times, loads and costs. */
function drawingOf(spans: readonly TraceSpan[], pass: string): Pick<FrameProfileReport, 'drawn' | 'loads' | 'readback' | 'costs'> {
  const under = spansUnder(spans, pass).filter((s) => s.status === 'ok');
  const framed = under.filter((s) => s.kind !== undefined && FRAME_KINDS.has(s.kind));
  const perLabel = new Map<string, Map<number, number>>();
  for (const span of framed) {
    const label = labelOf(span), frame = traceQuantity(span, 'frame')!, perFrame = perLabel.get(label) ?? new Map<number, number>();
    perFrame.set(frame, (perFrame.get(frame) ?? 0) + (span.end - span.start) * 1000);
    perLabel.set(label, perFrame);
  }
  const loads = groupedBy(under.filter((s) => LOAD_NAMES.has(s.name)), labelOf);
  const readbacks = under.filter((s) => s.kind === PICTURE_READBACK_SPAN_KIND).slice(1);
  return {
    readback: readbacks.length ? PICTURE_READBACK_STEPS.map((step) => ({ step, spread: spreadOf(readbacks.map((s) => traceQuantity(s, step) ?? 0)) })) : [],
    drawn: [...perLabel].map(([label, perFrame]) => ({ label, frames: perFrame.size, spread: spreadOf([...perFrame.values()]) })),
    loads: [...loads].map(([label, done]) => ({ label, ms: done.map((s) => (s.end - s.start) * 1000) })),
    costs: under.filter((s) => framed.includes(s) || isWarm(s)).flatMap((span) => {
      const costs = frameCostsOfTraceAttributes(span.attributes ?? {});
      if (!costs.counts.length && !costs.levels.length && !costs.notes.length) return [];
      return [{ ...costs, frame: traceQuantity(span, 'frame')!, label: isWarm(span) ? `${traceLabel(span, 'shot')} warm` : traceLabel(span, 'shot') ?? span.name }];
    }),
  };
}

/** Profiles frames `from`–`end` (exclusive): whole, captured and not, in 1 tab and in the session's. */
export async function profileFrames(session: RenderSession, { from, end }: { from: number; end: number }): Promise<FrameProfileReport> {
  const frames = Array.from({ length: end - from }, (_, i) => from + i), inputProps = session.props();
  /** The steady per-frame ms of a pass in `tabs`, null with no frame past each tab's first; and the pass's span. */
  const wholeIn = (tabs: number, capture: boolean) => session.inBrowser(`whole frames, ${capture ? 'sent' : 'uncaptured'}, ${tabs} tab${tabs > 1 ? 's' : ''}`, async (browser, watch) => {
    const route = capture ? session.frameSink.open(async () => {}) : null;
    try {
      const sending = route ? { ...inputProps, frameSink: route.url } : inputProps;
      // Selected in each browser: a composition carries the props it was selected with, and renders with them.
      const composition = await session.compositionFor(sending, browser);
      if (end > composition.durationInFrames) throw new Error(`the video has frames 0–${composition.durationInFrames - 1}`);
      const arrived: number[] = [];
      await renderFrames({
        ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch, () => arrived.push(performance.now())), composition, serveUrl: session.serveUrl, puppeteerInstance: browser,
        inputProps: sending, concurrency: tabs, frames, onStart: () => {}, outputDir: null, imageFormat: 'none',
      });
      // Every tab loads on its first frame; those frames arrive first, and the rest are the steady state.
      const steady = arrived.slice(tabs - 1);
      const ms = frames.length > tabs ? (steady[steady.length - 1] - steady[0]) / (steady.length - 1) : null;
      return { result: { ms, composition, pass: watch.trace!.parent }, workers: tabs };
    } finally {
      route?.close();
    }
  });

  // The one-tab sending pass always runs, even for one frame: its trace is the drawing's, cold for a single frame.
  const one = await wholeIn(1, true), { composition } = one;
  const uncapturedIn = async (tabs: number) => (frames.length > tabs ? (await wholeIn(tabs, false)).ms : null);
  const whole: FrameProfileReport['whole'] = [{ tabs: 1, sent: one.ms, uncaptured: await uncapturedIn(1) }];
  const tabs = session.workersFor(composition);
  if (tabs > 1) whole.push(frames.length > tabs ? { tabs, sent: (await wholeIn(tabs, true)).ms, uncaptured: await uncapturedIn(tabs) } : { tabs, sent: null, uncaptured: null });

  const { spans } = session.trace.trace();
  return {
    frames: { from, end }, size: { width: composition.width, height: composition.height },
    gpu: spans.flatMap((s) => traceLabel(s, 'gpu') ?? []).at(-1)!,
    ...drawingOf(spans, one.pass),
    whole,
  };
}

const ms = (n: number) => `${n.toFixed(1)} ms`;
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A load's times: each, when there are few; else the first (which fills caches) apart from the spread of the rest. */
function formatLoads(times: readonly number[]): string {
  if (times.length <= 3) return times.map(ms).join(', ');
  const { median, p90, max } = spreadOf(times.slice(1));
  return `${times.length} loads: the first ${ms(times[0])}, then median ${ms(median)}, p90 ${ms(p90)}, max ${ms(max)}`;
}

/** `report` as lines to print; with `costs`, what the drawing counted it cost follows, frame by frame. */
export function formatFrameProfile(report: FrameProfileReport, { costs = false }: { costs?: boolean } = {}): string[] {
  const { frames, size, gpu } = report;
  const costLines = report.costs.length ? frameCostsTable(report.costs) : ['  nothing in these frames counts its costs'];
  return [
    `${frames.end - frames.from === 1 ? `frame ${frames.from}` : `frames ${frames.from}–${frames.end - 1}`} at ${size.width}×${size.height}, GPU ${gpu}`,
    'drawing, per frame, as traced in 1 tab (not waited for on the GPU: studio render --trace detail times its steps there):',
    ...(report.drawn.length ? report.drawn.map(({ label, frames: n, spread: s }) => `  ${label}: median ${ms(s.median)}, p90 ${ms(s.p90)}, max ${ms(s.max)} over ${counted(n, 'frame')}`) : ['  nothing in these frames traces its drawing']),
    ...report.loads.map(({ label, ms: times }) => `  ${label}: ${formatLoads(times)}`),
    ...(report.readback.length ? ['sending a frame, per frame, in 1 tab (settle waits out the drawing above):'] : []),
    ...report.readback.map(({ step, spread: s }) => `  ${step}: median ${ms(s.median)}, p90 ${ms(s.p90)}, max ${ms(s.max)}`),
    'whole render, per frame, steady state (frames drawn, read back and sent as delivery does, then none; no encode):',
    ...report.whole.map(({ tabs, sent, uncaptured }) => (sent === null || uncaptured === null
      ? `  ${counted(tabs, 'tab')}: no steady state from ${counted(frames.end - frames.from, 'frame')}: profile ${tabs + 1} or more`
      : `  ${counted(tabs, 'tab')}: ${ms(sent)} sent, ${ms(uncaptured)} uncaptured: capture costs ${ms(sent - uncaptured)}`)),
    ...(costs ? ['costs, as the frames\' spans carry them:', ...costLines] : []),
  ];
}
