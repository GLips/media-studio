// look-frames.ts: which frames `studio look` reads, from how its command line asks for them: frame numbers, a bar of
// the clock, moments in seconds or a stretch stepped through. Pure, so a remote render resolves a look's frames where
// the composition is (remote-render) as the Mac would.
import { frameAtSecond } from '#lib/picture/frame/models/frame.ts';

/** The composition a look reads: its rate, size and length. */
export type LookComposition = { readonly fps: number; readonly width: number; readonly height: number; readonly durationInFrames: number };

/** A region of the frame, in the source's pixels. */
export type LookCrop = { x: number; y: number; w: number; h: number };

/**
 * How a look asks for frames, each its flag's text: `--frames`, `--bar`, `--sheet` or `--strip` (stepped by `step`
 * seconds); `every`, with none of them, for every frame the source holds (--motion and --against).
 */
export type LookFrameAsk = {
  readonly frames?: string; readonly bar?: string; readonly sheet?: string; readonly strip?: string; readonly step: number; readonly every: boolean;
};

/** What frames a source holds: its rate, and its first and end (exclusive) project frames. */
export type LookFrameSpan = { readonly fps: number; readonly first: number; readonly end: number };

/** A clock's bars, as much of a TimelineClockTable as a look reads. */
export type LookBars = { readonly bars: readonly { readonly n: number; readonly from: number; readonly to: number }[] };

/** A number from a comma or colon list; an empty item is NaN, where Number('') would quietly make it 0. */
export const parseLookNumber = (item: string) => (item.trim() ? Number(item) : NaN);

function stepFrames([from, to, step = 1, ...rest]: number[]): number[] {
  if (rest.length || !(step >= 1 && from <= to)) return [NaN];
  return Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
}

/** Frames: `200:210` (inclusive), `200:260:5` (every 5th) or `161,176,191`. */
export function parseLookFrames(spec: string): number[] {
  const range = spec.split(':');
  const frames = range.length > 1 ? stepFrames(range.map(parseLookNumber)) : spec.split(',').map(parseLookNumber);
  if (!frames.length || !frames.every((f) => Number.isInteger(f) && f >= 0)) {
    throw new Error(`frames are whole numbers, like 200:210, 200:260:5 or 161,176,191, not ${spec}`);
  }
  return [...new Set(frames)].toSorted((a, b) => a - b);
}

export function parseLookCrop(spec: string): LookCrop {
  const [x, y, w, h, ...rest] = spec.split(',').map(Number);
  if (rest.length || ![x, y, w, h].every((n) => Number.isInteger(n) && n >= 0) || !(w > 0 && h > 0)) {
    throw new Error(`--crop is x,y,w,h in the video's pixels, like 0,120,1920,840, not ${spec}`);
  }
  return { x, y, w, h };
}

/** Every frame of bar `n` of `clock`. */
export function lookBarFrames(clock: LookBars | undefined, n: string, project: string): number[] {
  if (!clock) throw new Error(`${project} has no bar clock (a timeline.ts): give --frames`);
  const bar = clock.bars.find((b) => b.n === Number(n));
  if (!bar) throw new Error(`there's no bar ${n}: bars are ${clock.bars.map((b) => b.n).join(', ')}`);
  return Array.from({ length: bar.to - bar.from }, (_, i) => bar.from + i);
}

/** The frames `ask` names in `span`, in order, a bar's from `clock` (`project` names it in an error). */
export function lookFramesOf(ask: LookFrameAsk, span: LookFrameSpan, { clock, project }: { clock: LookBars | undefined; project: string }): number[] {
  const frames = (() => {
    if (ask.frames) return parseLookFrames(ask.frames);
    if (ask.bar) return lookBarFrames(clock, ask.bar, project);
    const frameAt = (t: number) => frameAtSecond(t, span.fps, span.end);
    if (ask.sheet) return [...new Set(ask.sheet.split(',').map((t) => frameAt(parseLookNumber(t))))].toSorted((a, b) => a - b);
    if (ask.strip) {
      const [from, to] = ask.strip.split(':').map(parseLookNumber);
      if (!(Number.isFinite(from) && from < to)) throw new Error(`--strip is a stretch of seconds like 4:5, not ${ask.strip}`);
      return [...new Set(Array.from({ length: Math.floor((to - from) / ask.step + 1e-6) + 1 }, (_, i) => frameAt(from + i * ask.step)))];
    }
    if (ask.every) return Array.from({ length: span.end - span.first }, (_, i) => span.first + i);
    throw new Error('give frames: --frames=200:210, --bar=3, --sheet=0.5,4,9 or --strip=4:5');
  })();
  if (frames.some((f) => !Number.isFinite(f))) throw new Error('frames and times are numbers');
  return frames;
}
