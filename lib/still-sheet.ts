// still-sheet.ts: `studio still --sheet`, one image per design × preset laying out every variant for picking between
// them. The design's first axis runs across and the rest down, each row and column labelled by its value. Under each
// variant, a row shows it at the sizes a feed shows it (STILL_FEED_SIZES), 1:1, since a still has to work there; that
// row is the reads-small check, judged by eye. A variant the still check refused is shown, framed red, with its
// problems, and the preset's UI zones are outlined on every variant, so the pick can see why one was refused. Beside
// each sheet, a .cells.json maps its cells for `studio review`.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { RenderedStill } from './render-stills.ts';
import { formatStillAxes, type ReviewStillCellsFile } from './review-notes.ts';
import { STILL_FEED_SIZES, STILL_PRESETS, STILL_UI_ZONES, type StillPreset } from './studio/still-presets.ts';

/** Each still is shown within this box, above its feed row. */
const SHEET_STILL_BOX = { w: 480, h: 600 };

/** One sheet: a design at one preset, its variants on a grid of the first axis (columns) by the rest (rows). */
export type StillSheet = {
  design: string;
  preset: StillPreset;
  columnAxis: string;
  columns: string[];
  rowAxes: string[];
  /** Each row's values on `rowAxes`, and its cells, one per column: null where that variant wasn't rendered. */
  rows: { values: Record<string, string>; cells: (RenderedStill | null)[] }[];
};

/** Groups rendered stills into sheets, by design and preset, keeping the order the stills came in (their axes' order). */
export function layoutStillSheets(stills: readonly RenderedStill[]): StillSheet[] {
  const groups = new Map<string, RenderedStill[]>();
  for (const s of stills) {
    const key = `${s.still.design}\n${s.still.preset}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()].map((group) => {
    const { design, preset, axes } = group[0].still;
    const [columnAxis, ...rowAxes] = Object.keys(axes);
    const columns = [...new Set(group.map((s) => s.still.axes[columnAxis]))];
    const rowKey = (a: Readonly<Record<string, string>>) => rowAxes.map((r) => a[r]).join('\n');
    const rows = new Map<string, StillSheet['rows'][number]>();
    for (const s of group) {
      const key = rowKey(s.still.axes);
      if (!rows.has(key)) rows.set(key, { values: Object.fromEntries(rowAxes.map((r) => [r, s.still.axes[r]])), cells: columns.map(() => null) });
      rows.get(key)!.cells[columns.indexOf(s.still.axes[columnAxis])] = s;
    }
    return { design, preset, columnAxis, columns, rowAxes, rows: [...rows.values()] };
  });
}

/**
 * Two looks whose grey levels differ by less than this on average look alike at feed size. A crop that moves the image
 * a few px differs by about 2.5; a changed headline, by 15 or more.
 */
const LOOK_ALIKE_MEAN = 4;

const lookDistance = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

/** An axis whose values all look alike at a preset: choosing along it there changes nothing anyone would see. */
export type LookAlikeStillAxis = { design: string; preset: StillPreset; axis: string; values: string[] };

/**
 * The axes that change nothing a feed would show, per design and preset: those where, holding every other axis still,
 * each value's still looks like each other's (their `look`s). An axis with one value, or rendered at one value only,
 * isn't a choice and isn't reported.
 */
export function stillAxesThatLookAlike(stills: readonly RenderedStill[]): LookAlikeStillAxis[] {
  const found: LookAlikeStillAxis[] = [];
  for (const sheet of layoutStillSheets(stills)) {
    const group = sheet.rows.flatMap((r) => r.cells).filter((c) => c !== null);
    for (const axis of [sheet.columnAxis, ...sheet.rowAxes]) {
      const others = (s: RenderedStill) => Object.entries(s.still.axes).filter(([a]) => a !== axis).map(([, v]) => v).join('\n');
      const byOthers = new Map<string, RenderedStill[]>();
      for (const s of group) byOthers.set(others(s), [...(byOthers.get(others(s)) ?? []), s]);
      const choices = [...byOthers.values()].filter((g) => g.length > 1);
      if (!choices.length) continue;
      const alike = choices.every((g) => g.every((a, i) => g.slice(i + 1).every((b) => lookDistance(a.look, b.look) < LOOK_ALIKE_MEAN)));
      if (alike) found.push({ design: sheet.design, preset: sheet.preset, axis, values: [...new Set(group.map((s) => s.still.axes[axis]))] });
    }
  }
  return found;
}

/** A look-alike axis, said as `studio still` and the sheet say it. */
export const describeLookAlikeAxis = ({ design, preset, axis, values }: LookAlikeStillAxis) =>
  `${design} at ${preset}: ${axis} changes nothing at feed size (${values.join(', ')} look alike): make them differ at this frame's size, or drop the axis`;

const run = promisify(execFile);
const even = (n: number) => 2 * Math.round(n / 2);
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Renders each sheet to `<outDir>/<design>-<preset>.png` with its `.cells.json`, working in `workDir` (where the stills
 * were drawn). Every still needs its `drawn` file. Returns the sheets written.
 */
export async function renderStillSheets(stills: readonly RenderedStill[], { outDir, workDir, project }: { outDir: string; workDir: string; project: string }): Promise<string[]> {
  const sheets = layoutStillSheets(stills);
  const lookAlike = stillAxesThatLookAlike(stills);
  // The feed sizes scaled as a platform serves them, lanczos, not by the browser drawing the sheet.
  await Promise.all(stills.flatMap((s) => STILL_FEED_SIZES[s.still.preset].map((f) =>
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', s.drawn!, '-vf', `scale=${f.w}:${f.h}:flags=lanczos`, feedFile(workDir, s, f)]))));

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const written: string[] = [];
  try {
    mkdirSync(outDir, { recursive: true });
    for (const sheet of sheets) {
      const html = join(workDir, `sheet-${sheet.design}-${sheet.preset}.html`);
      writeFileSync(html, stillSheetHtml(sheet, workDir, project, lookAlike.filter((l) => l.design === sheet.design && l.preset === sheet.preset)));
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      await page.goto(`file://${html}`);
      await page.evaluate(() => document.fonts.ready);
      const out = join(outDir, `${sheet.design}-${sheet.preset}.png`);
      await page.screenshot({ path: out, fullPage: true });
      const cells = await page.$$eval('[data-variant]', (els) => {
        const { scrollWidth: w, scrollHeight: h } = document.documentElement;
        return els.map((el) => {
          const r = el.getBoundingClientRect();
          return { variant: (el as HTMLElement).dataset.variant!, rect: { x: r.x / w, y: r.y / h, w: r.width / w, h: r.height / h } };
        });
      });
      const byVariant = new Map(sheet.rows.flatMap((r) => r.cells).filter((c) => c !== null).map((c) => [c.still.variant, c]));
      const file: ReviewStillCellsFile = {
        version: 1,
        cells: cells.map(({ variant, rect }) => {
          const { still, problems } = byVariant.get(variant)!;
          return { variant, axes: still.axes, refused: problems.length > 0, rect };
        }),
      };
      writeFileSync(out.replace(/\.png$/, '.cells.json'), JSON.stringify(file, null, 2) + '\n');
      await page.close();
      written.push(out);
    }
  } finally {
    await browser.close();
  }
  return written;
}

const feedFile = (workDir: string, s: RenderedStill, f: { w: number; h: number }) => join(workDir, `${basename(s.drawn!).replace(/\.\w+$/, '')}-feed-${f.w}x${f.h}.png`);

/** The sheet as a page: files are named relative to `workDir`, where the page is written. */
function stillSheetHtml(sheet: StillSheet, workDir: string, project: string, lookAlike: readonly LookAlikeStillAxis[]): string {
  const { width, height } = STILL_PRESETS[sheet.preset];
  const scale = Math.min(SHEET_STILL_BOX.w / width, SHEET_STILL_BOX.h / height);
  const shown = { w: even(width * scale), h: even(height * scale) };
  const feeds = STILL_FEED_SIZES[sheet.preset];
  const cellWidth = Math.max(shown.w, feeds.reduce((sum, f) => sum + f.w, 0) + 12 * (feeds.length - 1));
  const refusedCount = sheet.rows.flatMap((r) => r.cells).filter((c) => c?.problems.length).length;
  const hasRowHeads = sheet.rowAxes.length > 0;
  // Outlined over every variant, so a refusal for sitting under the platform's UI shows where that is.
  const zones = STILL_UI_ZONES[sheet.preset].map(({ name, rect: r }) =>
    `<div class="zone" title="${escapeHtml(name)}" style="left:${r.x * scale}px;top:${r.y * scale}px;width:${r.w * scale}px;height:${r.h * scale}px"></div>`).join('');

  const cell = (s: RenderedStill | null) => {
    if (!s) return '<div class="cell empty">not rendered</div>';
    const refused = s.problems.length > 0;
    return `<div class="cell${refused ? ' refused' : ''}" data-variant="${escapeHtml(s.still.variant)}">
      <div class="name">${escapeHtml(s.still.variant)}</div>
      <div class="framed"><img class="still" src="${basename(s.drawn!)}" width="${shown.w}" height="${shown.h}">${zones}</div>
      <div class="feeds">${feeds.map((f) => `<figure><img src="${basename(feedFile(workDir, s, f))}" width="${f.w}" height="${f.h}"><figcaption>${f.name} ${f.w}×${f.h}</figcaption></figure>`).join('')}</div>
      ${refused
        ? `<div class="verdict bad">✗ refused by the still check, not written</div><ul>${s.problems.map((p) => `<li>${escapeHtml(p.problem)}</li>`).join('')}</ul>`
        : `<div class="verdict good">✓ passes${s.file ? ` · ${escapeHtml(s.file.slice(project.length + 1))}` : ''}</div>`}
    </div>`;
  };

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #161618; color: #e8e8ea; font: 14px/1.35 -apple-system, system-ui, sans-serif; width: max-content; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9a9aa2; margin-bottom: 20px; }
    .alike { color: #ffc400; font-weight: 600; margin: -8px 0 20px; }
    .grid { display: grid; grid-template-columns: ${hasRowHeads ? 'max-content ' : ''}repeat(${sheet.columns.length}, ${cellWidth + 26}px); gap: 16px; align-items: start; }
    .head { font-weight: 600; color: #c9c9d0; } .head span { color: #8a8a92; font-weight: 400; }
    .rowhead { writing-mode: vertical-rl; transform: rotate(180deg); align-self: center; }
    .cell { padding: 12px; border: 1px solid #2c2c31; border-radius: 6px; background: #1d1d20; }
    .cell.refused { border: 1px solid #ff4d4f; box-shadow: inset 0 0 0 1px #ff4d4f; }
    .cell.empty { color: #666; }
    .name { font: 600 13px ui-monospace, Menlo, monospace; margin-bottom: 8px; }
    .framed { position: relative; } .still { display: block; }
    .zone { position: absolute; box-sizing: border-box; border: 1px dashed rgba(255, 196, 0, 0.9); background: rgba(255, 196, 0, 0.14); }
    .feeds { display: flex; gap: 12px; align-items: flex-end; margin-top: 12px; }
    figure { margin: 0; } figure img { display: block; } figcaption { color: #8a8a92; font-size: 12px; margin-top: 4px; }
    .verdict { margin-top: 10px; font-weight: 600; } .good { color: #6fd08c; } .bad { color: #ff6b6d; }
    ul { margin: 6px 0 0; padding-left: 18px; color: #ffb3b4; max-width: ${cellWidth}px; } li { margin-bottom: 3px; }
  </style></head><body>
    <h1>${escapeHtml(sheet.design)} · ${sheet.preset} ${width}×${height}</h1>
    <div class="sub">${[sheet.columnAxis, ...sheet.rowAxes].join(' × ')} · ${refusedCount ? `${refusedCount} refused by the still check` : 'every variant passes the still check'} · feed row at 1:1${STILL_UI_ZONES[sheet.preset].length ? ` · dashed: ${STILL_UI_ZONES[sheet.preset].map((z) => escapeHtml(z.name)).join(', ')}` : ''}</div>
    ${lookAlike.map((l) => `<div class="alike">⚠ ${escapeHtml(l.axis)} changes nothing here: ${l.values.map(escapeHtml).join(', ')} look alike at feed size</div>`).join('')}
    <div class="grid">
      ${hasRowHeads ? '<div></div>' : ''}${sheet.columns.map((c) => `<div class="head"><span>${escapeHtml(sheet.columnAxis)}</span> ${escapeHtml(c)}</div>`).join('')}
      ${sheet.rows.map((row) => `${hasRowHeads ? `<div class="head rowhead">${escapeHtml(formatStillAxes(row.values))}</div>` : ''}${row.cells.map(cell).join('')}`).join('')}
    </div>
  </body></html>`;
}
