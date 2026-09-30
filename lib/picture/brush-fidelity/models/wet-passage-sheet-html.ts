// wet-passage-sheet-html.ts: the passage sheet as a page for the person judging wet paint, in plain words: each
// passage's three media side by side, what it shows and what to look for, and the notes kept beside the sheet on what's
// still rough. Pure: the engine (engine/wet-passage-sheet.ts) paints the passages and hands this their files.

import { WET_PASSAGES } from './wet-passages.ts';

/** A medium's column: its name as the page says it, and each passage's image file (relative to the page) or refusal. */
export type WetPassageSheetColumn = { label: string; passages: Record<string, { file: string } | { refused: string }> };

/**
 * What the person keeps beside the sheet (notes.json in its folder), each optional: an opening note, what's still
 * rough in each passage by ID, and notes on the animation checks and the landscape.
 */
export type WetPassageSheetNotes = { intro?: string; passages?: Readonly<Record<string, string>>; animation?: string; landscape?: string };

/** Images shown beside the passages: a landscape painted with the same ops, and references to compare against. */
export type WetPassageSheetFigures = { landscape: readonly { file: string; caption: string }[]; references: readonly string[] };

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A note as paragraphs, split on blank lines. */
const paragraphs = (text: string | undefined, className = '') => (text ?? '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p${className && ` class="${className}"`}>${escaped(p.trim())}</p>`).join('\n');

const STYLE = `
body { font: 16px/1.55 -apple-system, system-ui, sans-serif; max-width: 1240px; margin: 2rem auto; padding: 0 1.5rem; color: #222; background: #fbfaf7; }
h1 { font-size: 1.7rem; margin-bottom: .2rem; } h2 { margin-top: 2.6rem; border-bottom: 1px solid #ddd; padding-bottom: .2rem; }
.row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; } figure { margin: 0; } figcaption { color: #555; font-size: .92rem; margin-top: .3rem; }
img { width: 100%; display: block; border: 1px solid #ccc; }
.refused { aspect-ratio: 36 / 26; display: flex; align-items: center; justify-content: center; border: 1px dashed #bbb; color: #777; background: #f3f1ec; text-align: center; padding: 1rem; }
.look { background: #f3f0e6; border-left: 3px solid #b99a5b; padding: .5rem .9rem; } .rough { color: #7a3e00; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }`;

/** The sheet's page. */
export function wetPassageSheetHtml(columns: readonly WetPassageSheetColumn[], notes: WetPassageSheetNotes, figures: WetPassageSheetFigures): string {
  const passages = WET_PASSAGES.map((passage) => {
    const cells = columns.map(({ label, passages: painted }) => {
      const cell = painted[passage.id];
      const body = cell && 'file' in cell
        ? `<img src="${escaped(cell.file)}" alt="${escaped(`${passage.title}, ${label}`)}">`
        : `<div class="refused" title="${escaped(cell?.refused ?? '')}">The engine can’t paint this yet.</div>`;
      return `<figure>${body}<figcaption>${escaped(label)}</figcaption></figure>`;
    }).join('\n');
    const rough = notes.passages?.[passage.id];
    return `<h2>${escaped(passage.title)}</h2>
<p>${escaped(passage.shows)}</p>
<div class="row">${cells}</div>
<p class="look"><strong>Look for:</strong> ${escaped(passage.lookFor)}</p>
${rough ? `<p class="rough"><strong>Still rough:</strong> ${escaped(rough)}</p>` : ''}`;
  }).join('\n');
  const landscape = figures.landscape.length
    ? `<div class="two">${figures.landscape.map(({ file, caption }) => `<figure><img src="${escaped(file)}" alt="${escaped(caption)}"><figcaption>${escaped(caption)}</figcaption></figure>`).join('\n')}</div>` : '';
  const references = figures.references.map((file) => `<li><a href="file://${escaped(file)}">${escaped(file.split('/').at(-1) ?? file)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Wet paint: the reference passages</title><style>${STYLE}</style></head>
<body>
<h1>Wet paint: the reference passages</h1>
${paragraphs(notes.intro)}
<p>Each passage is painted three times, in ${columns.map(({ label }) => label.toLowerCase()).join(', ')}, with the same instructions: what a painter would do, not the effect wanted.</p>
${passages}
<h2>Animation</h2>
${paragraphs(notes.animation)}
<h2>The fresh landscape</h2>
${paragraphs(notes.landscape)}
${landscape}
${references ? `<h2>Your watercolours, to compare</h2>\n<p>Opened from where they live; not copied here.</p>\n<ul>${references}</ul>` : ''}
</body></html>
`;
}
