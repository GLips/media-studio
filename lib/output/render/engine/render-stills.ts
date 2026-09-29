// render-stills.ts: renders a project's stills (its stills.tsx, registered by lib/picture/composition/studio/Root.tsx) to
// out/stills/<design>-<preset>-<variant>.png, checking each first (lib/output/stills/models/still-check.ts): a still with a problem isn't
// written, and an older file of its name is removed, so out/stills never holds a still that fails; a full run also
// removes stills no design makes any more. Node only.
import { getCompositions, renderStill } from '@remotion/renderer';
import type { VideoConfig } from 'remotion';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bundleStudioProject } from './studio-bundle.ts';
import { inRenderBrowser, RENDER_CHROMIUM } from './render-browser.ts';
import { artifactSink } from './render-session.ts';
import { stillProblems, type StillMeasure, type StillPixels, type StillProblem } from '#lib/output/stills/models/still-check.ts';
import { isStillFitArtifact, STILL_MEASURE_ARTIFACT, STILL_UI_ZONES, stillName, type StillFitReport, type StillProps, type StillRenderProps } from '#lib/output/stills/models/still-presets.ts';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

/** Which stills to render: each list keeps the stills whose design, preset or variant is in it; absent keeps all. */
export type StillSelection = { designs?: readonly string[]; presets?: readonly string[]; variants?: readonly string[] };

/**
 * One still, checked. `file` is where it was written: absent when it failed, or when only checking. `drawn` is the
 * still as drawn, pass or fail, when the caller asked to keep it (`drawnDir`). `look` is the still as drawn at
 * STILL_LOOK_SIZE, grey, which says whether two variants look alike (lib/output/stills/engine/still-sheet.ts).
 */
export type RenderedStill = { file?: string; drawn?: string; still: StillProps; fits: StillFitReport[]; problems: StillProblem[]; look: Uint8Array };

/** The side of a still's `look`, in px: about the size a feed shows it, where a difference has to show. */
export const STILL_LOOK_SIZE = 64;

function decodeLook(file: string): Uint8Array {
  return runFfmpeg(['-loglevel', 'error', '-i', file, '-vf', `scale=${STILL_LOOK_SIZE}:${STILL_LOOK_SIZE}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
}

function decodeRgb(file: string, w: number, h: number): StillPixels {
  const rgb = runFfmpeg(['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: w * h * 3 + 1024 });
  if (rgb.length !== w * h * 3) throw new Error(`${file} decoded to ${rgb.length} bytes, not ${w}×${h} RGB`);
  return { w, h, rgb };
}

/**
 * Renders and checks the chosen stills. `check` writes none, only reporting; otherwise each still that passes is
 * written in `format`. `drawnDir` keeps every still as drawn there, failures too, for a sheet (lib/output/stills/engine/still-sheet.ts).
 */
export async function renderProjectStills(project: string, selection: StillSelection, { format, check, drawnDir }: { format: 'png' | 'jpeg'; check: boolean; drawnDir?: string }): Promise<RenderedStill[]> {
  const serveUrl = await bundleStudioProject(project);
  return withStudioTemp('stills', async (tmp) => {
    const { result } = await inRenderBrowser(async (browser) => {
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
      // A full run also clears stills no design makes any more (a variant renamed or an axis dropped), so out/stills
      // holds only current stills. A narrowed run can't tell, and leaves the rest alone.
      if (!check && !selection.designs && !selection.presets && !selection.variants) {
        const current = new Set(all.map((c) => stillName(c.defaultProps as StillProps)));
        for (const f of readdirSync(dir)) if (/\.(png|jpg)$/.test(f) && !current.has(f.replace(/\.\w+$/, ''))) rmSync(join(dir, f));
      }
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
        const drawn = join(drawnDir ?? tmp, `${name}.${ext}`), groundFile = join(tmp, `${name}-ground.png`);
        const sink = await draw(composition, still, drawn, format);
        await draw(composition, { ...still, ground: true }, groundFile, 'png');
        const fits = sink.names().filter(isStillFitArtifact).map((n) => sink.json<StillFitReport>(n));
        const problems = stillProblems({
          measure: sink.json<StillMeasure>(STILL_MEASURE_ARTIFACT), fits,
          ground: decodeRgb(groundFile, composition.width, composition.height), zones: STILL_UI_ZONES[still.preset],
        });
        const file = join(dir, `${name}.${ext}`);
        const kept = { ...(drawnDir && { drawn }), still, fits, problems, look: decodeLook(drawn) };
        if (check) {
          checked.push(kept);
        } else if (problems.length) {
          rmSync(file, { force: true });
          checked.push(kept);
        } else {
          copyFileSync(drawn, file);
          checked.push({ file, ...kept });
        }
      }
      return checked;
    });
    return result;
  });
}

/** One line per fitted text: the size and width it settled on. Its floor and overflow are problems (stillProblems). */
export function describeStillFits({ still, fits }: RenderedStill): string[] {
  const px = (n: number) => `${Math.round(n * 10) / 10}px`;
  return fits.map((f) => `${stillName(still)}: ${f.name} ${px(f.size)} at ${f.stretch}% width (max ${px(f.max)}, floor ${px(f.min)})`);
}
