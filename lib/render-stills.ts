// render-stills.ts: renders a project's stills (its stills.tsx, registered by lib/studio/Root.tsx) to
// out/stills/<design>-<preset>-<variant>.png, checking each first (lib/still-check.ts): a still with a problem isn't
// written, and an older file of its name is removed, so out/stills never holds a still that fails. Node only.
import { getCompositions, openBrowser, renderStill } from '@remotion/renderer';
import type { VideoConfig } from 'remotion';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactSink, bundleStudioProject, RENDER_CHROMIUM } from './render-session.ts';
import { stillProblems, type StillMeasure, type StillPixels, type StillProblem } from './still-check.ts';
import { isStillFitArtifact, STILL_MEASURE_ARTIFACT, STILL_UI_ZONES, stillName, type StillFitReport, type StillProps, type StillRenderProps } from './studio/still-presets.ts';

/** Which stills to render: each list keeps the stills whose design, preset or variant is in it; absent keeps all. */
export type StillSelection = { designs?: readonly string[]; presets?: readonly string[]; variants?: readonly string[] };

/** One still, checked. `file` is where it was written: absent when it failed, or when only checking. */
export type RenderedStill = { file?: string; still: StillProps; fits: StillFitReport[]; problems: StillProblem[] };

function decodeRgb(file: string, w: number, h: number): StillPixels {
  const rgb = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: w * h * 3 + 1024 });
  if (rgb.length !== w * h * 3) throw new Error(`${file} decoded to ${rgb.length} bytes, not ${w}×${h} RGB`);
  return { w, h, rgb };
}

/**
 * Renders and checks the chosen stills. `check` writes none, only reporting; otherwise each still that passes is
 * written in `format`.
 */
export async function renderProjectStills(project: string, selection: StillSelection, { format, check }: { format: 'png' | 'jpeg'; check: boolean }): Promise<RenderedStill[]> {
  const serveUrl = await bundleStudioProject(project);
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM });
  const tmp = mkdtempSync(join(tmpdir(), 'stills-'));
  try {
    const all = (await getCompositions(serveUrl, { puppeteerInstance: browser, chromiumOptions: RENDER_CHROMIUM })).filter((c) => c.id.startsWith('still-'));
    if (!all.length) throw new Error(`${project} has no stills.tsx, or it defines no stills`);
    const keeps = (list: readonly string[] | undefined, value: string) => !list || list.includes(value);
    const chosen = all.filter((c) => {
      const { design, preset, variant } = c.defaultProps as StillProps;
      return keeps(selection.designs, design) && keeps(selection.presets, preset) && keeps(selection.variants, variant);
    });
    if (!chosen.length) {
      const values = (key: keyof StillProps) => [...new Set(all.map((c) => (c.defaultProps as StillProps)[key]))].join(', ');
      throw new Error(`no still matches that. Designs: ${values('design')}; presets: ${values('preset')}; variants: ${values('variant')}`);
    }

    const dir = join(project, 'out', 'stills');
    mkdirSync(dir, { recursive: true });
    const draw = async (composition: VideoConfig, props: StillRenderProps, output: string, imageFormat: 'png' | 'jpeg') => {
      const sink = artifactSink();
      await renderStill({
        composition: { ...composition, props }, serveUrl, output, imageFormat, jpegQuality: imageFormat === 'jpeg' ? 92 : undefined,
        puppeteerInstance: browser, chromiumOptions: RENDER_CHROMIUM, onArtifact: sink.onArtifact,
      });
      return sink;
    };
    const checked: RenderedStill[] = [];
    for (const composition of chosen) {
      const still = composition.defaultProps as StillProps;
      const name = stillName(still), ext = format === 'jpeg' ? 'jpg' : 'png';
      const drawn = join(tmp, `${name}.${ext}`), groundFile = join(tmp, `${name}-ground.png`);
      const sink = await draw(composition, still, drawn, format);
      await draw(composition, { ...still, ground: true }, groundFile, 'png');
      const fits = sink.names().filter(isStillFitArtifact).map((n) => sink.json<StillFitReport>(n));
      const problems = stillProblems({
        measure: sink.json<StillMeasure>(STILL_MEASURE_ARTIFACT), fits,
        ground: decodeRgb(groundFile, composition.width, composition.height), zones: STILL_UI_ZONES[still.preset],
      });
      const file = join(dir, `${name}.${ext}`);
      if (check) {
        checked.push({ still, fits, problems });
      } else if (problems.length) {
        rmSync(file, { force: true });
        checked.push({ still, fits, problems });
      } else {
        copyFileSync(drawn, file);
        checked.push({ file, still, fits, problems });
      }
    }
    return checked;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    await browser.close({ silent: true });
  }
}

/** One line per fitted text: the size and width it settled on. Its floor and overflow are problems (stillProblems). */
export function describeStillFits({ still, fits }: RenderedStill): string[] {
  const px = (n: number) => `${Math.round(n * 10) / 10}px`;
  return fits.map((f) => `${stillName(still)}: ${f.name} ${px(f.size)} at ${f.stretch}% width (max ${px(f.max)}, floor ${px(f.min)})`);
}
