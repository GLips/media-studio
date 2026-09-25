// render-session.ts: one project bundled for rendering, and what every render command does with it. Node only.
//
// Each session bundles just its own project (see project-bundle.ts), so another project's missing captures can't
// break it.
import { bundle } from '@remotion/bundler';
import { renderFrames, selectComposition, type OnArtifact } from '@remotion/renderer';
import { mkdtempSync, readdirSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoConfig } from 'remotion';
import { projectSlug, projectWebpackOverride, replaySlug } from './project-bundle.ts';
import { W } from './studio/frame.ts';
import { STUDIO_ROOT } from './studio-project.ts';
import type { ReplayProps } from './studio/Root.tsx';
import type { TimelineReport, VideoProps } from './studio/Video.tsx';

export type RenderSession = Awaited<ReturnType<typeof openRenderSession>>;

/**
 * Every render's browser runs on the GPU. Painted layers (lib/paint) draw with WebGL, which Remotion's default
 * software renderer makes crawl.
 */
export const RENDER_CHROMIUM = { gl: 'angle' } as const;

/**
 * Tabs per render. Remotion's default is half the cores; frames are screenshot-bound, so all but one core renders
 * about 20% faster, at under 1 GB.
 */
export const RENDER_CONCURRENCY = Math.max(1, availableParallelism() - 1);

/** Bundles the studio's browser entry for one project (its video, its stills or both); returns the serve URL. */
export async function bundleStudioProject(project: string) {
  console.error(`bundling ${project}…`);
  return bundle({ entryPoint: join(STUDIO_ROOT, 'lib/studio/index.ts'), webpackOverride: projectWebpackOverride(project) });
}

export async function openRenderSession(project: string) {
  const serveUrl = await bundleStudioProject(project);
  const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, blockouts: false, ...p });
  const compositionFor = (inputProps: VideoProps) => selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, id: projectSlug(project), inputProps });

  async function renderJpegs(composition: VideoConfig, inputProps: Record<string, unknown>, frames: number[], w: number, concurrency = RENDER_CONCURRENCY) {
    const dir = mkdtempSync(join(tmpdir(), 'stills-'));
    await renderFrames({
      composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, inputProps, outputDir: dir, imageFormat: 'jpeg', jpegQuality: 90, scale: w / W, frames,
      concurrency, imageSequencePattern: 'f-[frame].[ext]', onStart: () => {}, onFrameUpdate: () => {},
    });
    const files = readdirSync(dir).filter((f) => /\.jpe?g$/.test(f));
    if (files.length !== frames.length) throw new Error(`rendered ${files.length} of ${frames.length} stills`);
    // renderFrames pads the frame number to the composition's length, so match by value.
    const byFrame = new Map(files.map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
    return { dir, fileFor: (frame: number) => byFrame.get(frame)! };
  }

  /** Renders chosen frames as JPEGs `w` wide; returns each frame's file. Repeats are rendered once. */
  async function renderStills(wanted: number[], { w, captions = false }: { w: number; captions?: boolean }) {
    const inputProps = props({ captions });
    return renderJpegs(await compositionFor(inputProps), inputProps, [...new Set(wanted)], w);
  }

  /**
   * Renders the video's frames in `order`, one after another in a single tab, so each has the history it's given.
   * `fileFor(i)` is the render of order[i].
   */
  async function renderReplay(order: number[], { w }: { w: number }) {
    const inputProps: ReplayProps = { ...props(), order };
    const composition = await selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, id: replaySlug(project), inputProps });
    return renderJpegs(composition, inputProps, order.map((_, i) => i), w, 1);
  }

  /** The timeline as the composition lays it out, from the report frame 0 emits. */
  async function readTimeline(): Promise<TimelineReport> {
    const sink = artifactSink();
    const inputProps = props();
    await renderFrames({
      composition: await compositionFor(inputProps), serveUrl, chromiumOptions: RENDER_CHROMIUM, inputProps, outputDir: mkdtempSync(join(tmpdir(), 'timeline-')), concurrency: RENDER_CONCURRENCY,
      imageFormat: 'none', frames: [0], onArtifact: sink.onArtifact, onStart: () => {}, onFrameUpdate: () => {},
    });
    return sink.json<TimelineReport>('timeline.json');
  }

  return { project, serveUrl, props, compositionFor, renderStills, renderReplay, readTimeline };
}

/** Collects the artifacts a render emits, by name. */
export function artifactSink() {
  const files = new Map<string, string>();
  const onArtifact: OnArtifact = (a) => { files.set(a.filename, Buffer.from(a.content).toString('utf8')); };
  const json = <T,>(name: string): T => {
    const content = files.get(name);
    if (content === undefined) throw new Error(`no ${name} artifact`);
    return JSON.parse(content);
  };
  return { onArtifact, json, names: () => [...files.keys()] };
}
