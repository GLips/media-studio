// render-session.ts: one project bundled for rendering, and what every render script does with it. Node only.
//
// Each session bundles just its own project (see project-bundle.ts), so another project's missing captures can't
// break it.
import { bundle } from '@remotion/bundler';
import { renderFrames, selectComposition, type OnArtifact } from '@remotion/renderer';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectSlug, projectWebpackOverride } from './project-bundle.ts';
import { W } from './studio/frame.ts';
import type { TimelineReport, VideoProps } from './studio/Video.tsx';

export type RenderSession = Awaited<ReturnType<typeof openRenderSession>>;

/**
 * Every render's browser runs on the GPU. Painted layers (lib/paint) draw with WebGL, which Remotion's default
 * software renderer makes crawl.
 */
export const RENDER_CHROMIUM = { gl: 'angle' } as const;

export async function openRenderSession(project: string) {
  console.log(`bundling ${project}…`);
  const serveUrl = await bundle({ entryPoint: resolve('lib/studio/index.ts'), webpackOverride: projectWebpackOverride(project) });
  const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, ...p });
  const compositionFor = (inputProps: VideoProps) => selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, id: projectSlug(project), inputProps });

  /** Renders chosen frames as JPEGs `w` wide; returns each frame's file. Repeats are rendered once. */
  async function renderStills(wanted: number[], { w, captions = false }: { w: number; captions?: boolean }) {
    const frames = [...new Set(wanted)];
    const inputProps = props({ captions });
    const composition = await compositionFor(inputProps);
    const dir = mkdtempSync(join(tmpdir(), 'stills-'));
    await renderFrames({
      composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, inputProps, outputDir: dir, imageFormat: 'jpeg', jpegQuality: 90, scale: w / W, frames,
      imageSequencePattern: 'f-[frame].[ext]', onStart: () => {}, onFrameUpdate: () => {},
    });
    const files = readdirSync(dir).filter((f) => /\.jpe?g$/.test(f));
    if (files.length !== frames.length) throw new Error(`rendered ${files.length} of ${frames.length} stills`);
    // renderFrames pads the frame number to the composition's length, so match by value.
    const byFrame = new Map(files.map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
    return { dir, fileFor: (frame: number) => byFrame.get(frame)! };
  }

  /** The timeline as the composition lays it out, from the report frame 0 emits. */
  async function readTimeline(): Promise<TimelineReport> {
    const sink = artifactSink();
    const inputProps = props();
    await renderFrames({
      composition: await compositionFor(inputProps), serveUrl, chromiumOptions: RENDER_CHROMIUM, inputProps, outputDir: mkdtempSync(join(tmpdir(), 'timeline-')),
      imageFormat: 'none', frames: [0], onArtifact: sink.onArtifact, onStart: () => {}, onFrameUpdate: () => {},
    });
    return sink.json<TimelineReport>('timeline.json');
  }

  return { project, serveUrl, props, compositionFor, renderStills, readTimeline };
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
  return { onArtifact, json };
}
