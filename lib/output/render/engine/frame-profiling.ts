// frame-profiling.ts: `studio profile`, where a span of frames spends its time. Node only.
//
// Two measures, since a render's frame is its drawing and then its capture:
//   - the drawing: the span rendered once in one tab with no screenshot, the page timing the work drawing code offers
//     (lib/picture/profiling/studio/frame-profile.ts), each piece waited for on the GPU, and logging it to the console.
//   - the whole render: the span rendered unprofiled to JPEGs in one tab and in the session's, timed from the frames'
//     arrival. Each tab's first frame loads everything and is left out: a span no longer than the tabs isn't timed.
// The profiled render also logs what drawing code counts it cost (solves, cache hits); `--costs` tables them.
import { renderFrames } from '@remotion/renderer';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { watchedRenderFrames } from '#lib/platform/browser/engine/render-watch.ts';
import { renderHostLineText } from '#lib/platform/browser/models/render-page-log.ts';
import type { RenderSession } from './render-session.ts';
import { frameCostsTable } from '#lib/picture/profiling/models/frame-costs-table.ts';
import {
  FRAME_PROFILE_LOG_PREFIX, isFrameCostsEntry, type FrameCostsEntry, type FrameProfileEntry, type FrameProfileLine,
} from '#lib/picture/profiling/models/frame-profile-entry.ts';

/** Milliseconds, over the span's frames. */
export type FrameTimeSpread = { median: number; p90: number; max: number };

export type FrameProfileReport = {
  frames: { from: number; end: number };
  size: { width: number; height: number };
  gpu: string;
  /** Per label, its time in each frame (summed over what offered it, e.g. two paintings in a crossfade). */
  drawn: { label: string; frames: number; spread: FrameTimeSpread }[];
  /** A label ending "load": each one's time, from mount to ready, not per frame. */
  loads: { label: string; ms: number[] }[];
  /**
   * A frame's whole render, steady state: wall-clock per frame, in `tabs` at once. `null` when the span has no frame
   * past each tab's first, so no steady state to time.
   */
  whole: { tabs: number; msPerFrame: number | null }[];
  /** What the profiled frames' drawing counted it cost, as logged. */
  costs: FrameCostsEntry[];
};

function spreadOf(values: number[]): FrameTimeSpread {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1] };
}

/** Profiles frames `from`–`end` (exclusive), rendering them three times: profiled, then whole in 1 tab and in the session's. */
export async function profileFrames(session: RenderSession, { from, end }: { from: number; end: number }): Promise<FrameProfileReport> {
  const frames = Array.from({ length: end - from }, (_, i) => from + i);
  const lines: FrameProfileLine[] = [];
  const profiled = session.props({ profile: true });

  const composition = await session.inBrowser('profiled frames', async (browser, watch) => {
    const composition = await session.compositionFor(profiled, browser);
    if (end > composition.durationInFrames) throw new Error(`the video has frames 0–${composition.durationInFrames - 1}`);
    await renderFrames({
      ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch), composition, serveUrl: session.serveUrl, puppeteerInstance: browser, inputProps: profiled, outputDir: null,
      // Quiet, so the entries are read, not echoed (frame-profiler.tsx says how they're logged to allow it).
      concurrency: 1, imageFormat: 'none', frames, logLevel: 'error', onStart: () => {},
      onBrowserLog: (log) => {
        watch.onBrowserLog(log);
        const entry = renderHostLineText(FRAME_PROFILE_LOG_PREFIX, log.text);
        // SAFETY: frame-profiler.tsx alone logs behind this prefix, and only a FrameProfileLine's JSON.
        if (entry !== null) lines.push(JSON.parse(entry) as FrameProfileLine);
      },
    });
    return { result: composition, workers: 1 };
  });

  const wholeIn = (tabs: number) => session.inBrowser(`whole frames, ${tabs} tab${tabs > 1 ? 's' : ''}`, async (browser, watch) => {
    const inputProps = session.props();
    // Selected again: a composition carries the props it was selected with, and renders with them.
    const composition = await session.compositionFor(inputProps, browser);
    const arrived: number[] = [];
    await withStudioTemp('profile', (outputDir) => renderFrames({
      ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch, () => arrived.push(performance.now())), composition, serveUrl: session.serveUrl, puppeteerInstance: browser,
      inputProps, outputDir, concurrency: tabs, imageFormat: 'jpeg', frames, onStart: () => {},
    }));
    // Every tab loads on its first frame; those frames arrive first, and the rest are the steady state.
    const steady = arrived.slice(tabs - 1);
    return { result: { tabs, msPerFrame: (steady[steady.length - 1] - steady[0]) / (steady.length - 1) }, workers: tabs };
  });
  const tabs = session.workersFor(composition);
  const steadyIn = async (count: number): Promise<FrameProfileReport['whole'][number]> => (frames.length > count ? wholeIn(count) : { tabs: count, msPerFrame: null });
  const whole = [await steadyIn(1), ...(tabs > 1 ? [await steadyIn(tabs)] : [])];

  const entries = lines.filter((line): line is FrameProfileEntry => !isFrameCostsEntry(line));
  const labels = [...new Set(entries.map((e) => e.label))];
  const isLoad = (label: string) => label.endsWith(' load');
  return {
    frames: { from, end }, size: { width: composition.width, height: composition.height },
    gpu: session.passes.findLast((p) => p.gpu)!.gpu!,
    drawn: labels.filter((l) => !isLoad(l)).map((label) => {
      const perFrame = new Map<number, number>();
      for (const e of entries) if (e.label === label) perFrame.set(e.frame, (perFrame.get(e.frame) ?? 0) + e.ms);
      return { label, frames: perFrame.size, spread: spreadOf([...perFrame.values()]) };
    }),
    loads: labels.filter(isLoad).map((label) => ({ label, ms: entries.filter((e) => e.label === label).map((e) => e.ms) })),
    whole,
    costs: lines.filter(isFrameCostsEntry),
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
    'drawing, per frame, waited for on the GPU (1 tab, no screenshot):',
    ...(report.drawn.length ? report.drawn.map(({ label, frames: n, spread: s }) => `  ${label}: median ${ms(s.median)}, p90 ${ms(s.p90)}, max ${ms(s.max)} over ${counted(n, 'frame')}`) : ['  nothing in these frames offers its work to be timed']),
    ...report.loads.map(({ label, ms: times }) => `  ${label}: ${formatLoads(times)}`),
    'whole render, per frame, steady state (JPEG frames, no encode):',
    ...report.whole.map(({ tabs, msPerFrame }) => (msPerFrame === null
      ? `  ${counted(tabs, 'tab')}: no steady state from ${counted(frames.end - frames.from, 'frame')}: profile ${tabs + 1} or more`
      : `  ${counted(tabs, 'tab')}: ${ms(msPerFrame)}`)),
    ...(costs ? ['costs, as the profiled drawing counted them:', ...costLines] : []),
  ];
}
