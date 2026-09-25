// render-stills.ts: renders a project's stills (its stills.tsx, registered by lib/studio/Root.tsx) to
// out/stills/<design>-<preset>-<variant>.png, with what each still's fitted text settled on. Node only.
import { getCompositions, openBrowser, renderStill } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifactSink, bundleStudioProject, RENDER_CHROMIUM } from './render-session.ts';
import { isStillFitArtifact, stillName, type StillFitReport, type StillProps } from './studio/still-presets.ts';

/** Which stills to render: each list keeps the stills whose design, preset or variant is in it; absent keeps all. */
export type StillSelection = { designs?: readonly string[]; presets?: readonly string[]; variants?: readonly string[] };

export type RenderedStill = { file: string; still: StillProps; fits: StillFitReport[] };

export async function renderProjectStills(project: string, selection: StillSelection, { format }: { format: 'png' | 'jpeg' }): Promise<RenderedStill[]> {
  const serveUrl = await bundleStudioProject(project);
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM });
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
    const rendered: RenderedStill[] = [];
    for (const composition of chosen) {
      const still = composition.defaultProps as StillProps;
      const file = join(dir, `${stillName(still)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
      const sink = artifactSink();
      await renderStill({
        composition, serveUrl, output: file, imageFormat: format, jpegQuality: format === 'jpeg' ? 92 : undefined,
        puppeteerInstance: browser, chromiumOptions: RENDER_CHROMIUM, onArtifact: sink.onArtifact,
      });
      rendered.push({ file, still, fits: sink.names().filter(isStillFitArtifact).map((n) => sink.json<StillFitReport>(n)) });
    }
    return rendered;
  } finally {
    await browser.close({ silent: true });
  }
}

/** One line per fitted text: its size and width, and a warning when it's at its floor or doesn't fit even there. */
export function describeStillFits({ still, fits }: RenderedStill): string[] {
  return fits.map((f) => {
    const px = (n: number) => `${Math.round(n * 10) / 10}px`;
    const set = `${stillName(still)}: ${f.name} ${px(f.size)} at ${f.stretch}% width (max ${px(f.max)}, floor ${px(f.min)})`;
    if (f.overflows) return `${set}: OVERFLOWS its box even at the floor, so shorten the copy or give it a bigger box`;
    if (f.atFloor) return `${set}: AT ITS FLOOR, so the copy is too long for this preset's box`;
    return set;
  });
}
