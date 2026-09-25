// bakeoff.tsx: the image bake-off as a grid, one row per brief and one column per model, so the same ask can be
// compared across models at a glance. The reviewer's verdicts can be hidden, to judge the pictures first.
import { useMemo, useState } from 'react';
import type { LabBakeoffBrief, LabBakeoffModel, LabGalleryItem, LabImageBakeoff } from '../../../server.ts';
import { formatGenerationCost, GeneratedMediaLightbox, MediaModal } from './lightbox.tsx';

const VERDICT_WORDS = { good: 'Good', mixed: 'Mixed', bad: 'Miss' } as const;

type BakeoffOpen = { kind: 'cell'; brief: string; index: number } | { kind: 'brief'; brief: LabBakeoffBrief } | { kind: 'model'; model: LabBakeoffModel };

export function ImageBakeoffGrid({ bakeoff, items }: { bakeoff: LabImageBakeoff; items: LabGalleryItem[] }) {
  const [verdicts, setVerdicts] = useState(true);
  const [open, setOpen] = useState<BakeoffOpen | null>(null);
  const byName = new Map(items.map((i) => [i.name, i]));
  const models = bakeoff.models.filter((m) => !m.missing);
  const missing = bakeoff.models.filter((m) => m.missing);
  const row = (brief: string) => models.flatMap((m) => byName.get(`${brief}-${m.short}`) ?? []);
  const modelOf = (item: LabGalleryItem) => models.find((m) => item.name.endsWith(`-${m.short}`));
  const briefOf = (item: LabGalleryItem) => bakeoff.briefs.find((b) => item.name.startsWith(`${b.id}-`));
  const modelTotal = (m: LabBakeoffModel) => bakeoff.briefs.reduce((sum, b) => sum + (byName.get(`${b.id}-${m.short}`)?.cost ?? 0), 0);

  return (
    <div className="bakeoff">
      <div className="bakeoff-bar">
        <label className="bakeoff-toggle">
          <input type="checkbox" checked={verdicts} onChange={(e) => setVerdicts(e.target.checked)} />
          Show the reviewer's verdicts <small>(untick to judge for yourself first)</small>
        </label>
        {verdicts && (
          <span className="bakeoff-legend">
            {(['good', 'mixed', 'bad'] as const).map((t) => <span key={t} className={`bakeoff-tag ${t}`}>{VERDICT_WORDS[t]}</span>)}
          </span>
        )}
      </div>

      <div className="bakeoff-grid" style={{ gridTemplateColumns: `180px repeat(${models.length}, minmax(0, 1fr))` }}>
        <span className="hud bakeoff-corner">Brief ↓ · Model →</span>
        {models.map((m) => (
          <button key={m.short} type="button" className="bakeoff-model" onClick={() => setOpen({ kind: 'model', model: m })}>
            <b>{m.name.replace(/\s*\(.*\)$/, '')}</b>
            <span className="hud">{formatGenerationCost(modelTotal(m))} for all four</span>
          </button>
        ))}
        {bakeoff.briefs.map((b) => (
          <BakeoffRow key={b.id} brief={b} cells={models.map((m) => byName.get(`${b.id}-${m.short}`))}
            verdict={(item) => (verdicts ? bakeoff.cells[item.name] : undefined)}
            onBrief={() => setOpen({ kind: 'brief', brief: b })}
            onCell={(item) => setOpen({ kind: 'cell', brief: b.id, index: row(b.id).indexOf(item) })} />
        ))}
      </div>

      {missing.length > 0 && <p className="note">A seventh model wasn't available to try.</p>}

      <BakeoffRecommendation html={bakeoff.recommendation} />

      {open?.kind === 'cell' && (
        <GeneratedMediaLightbox items={row(open.brief)} index={open.index} onIndex={(index) => setOpen({ ...open, index })} onClose={() => setOpen(null)}
          title={(item) => modelOf(item)?.name ?? item.model}
          extra={(item) => {
            const cell = bakeoff.cells[item.name];
            return (
              <div className="bakeoff-note">
                <span className="hud">Brief: {briefOf(item)?.label}</span>
                {cell && <p><span className={`bakeoff-tag ${cell.tag}`}>{VERDICT_WORDS[cell.tag]}</span> {cell.text}</p>}
                {cell?.seconds && <small>Took {cell.seconds}s · came back {cell.size}</small>}
              </div>
            );
          }} />
      )}
      {open?.kind === 'brief' && (
        <MediaModal onClose={() => setOpen(null)}>
          <span className="hud">The brief · {open.brief.aspect}</span>
          <h3>{open.brief.label}</h3>
          <p><b>What it's for.</b> {open.brief.purpose}</p>
          <p><b>What good looks like.</b> {open.brief.good}</p>
          <span className="hud">The prompt every model got</span>
          <p className="media-prompt">{open.brief.prompt}</p>
          {open.brief.ref && <><span className="hud">Plus this photo of the real product</span><img className="bakeoff-ref" src={open.brief.ref} alt="" /></>}
        </MediaModal>
      )}
      {open?.kind === 'model' && (
        <MediaModal onClose={() => setOpen(null)}>
          <span className="hud"><code>{open.model.id}</code></span>
          <h3>{open.model.name}</h3>
          <p><b>Why it was in the running.</b> {open.model.why}</p>
          <p><b>Price.</b> {open.model.price}</p>
          <p><b>Ranking.</b> {open.model.rank}</p>
          <p><b>Accepts.</b> {open.model.takes}</p>
        </MediaModal>
      )}
    </div>
  );
}

/**
 * The reviewer's pick up front (its opening paragraph's first two sentences: the model, then why) and the rest of the
 * write-up behind a disclosure. notes.json is the bake-off's own write-up in this repo, so its HTML is trusted.
 */
function BakeoffRecommendation({ html }: { html: string }) {
  const { lead, rest } = useMemo(() => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelector('h2')?.remove();
    const first = doc.querySelector('p')!;
    const [, head = first.innerHTML, tail = ''] = /^(.*?<\/b>.*?\.)\s+(.*)$/s.exec(first.innerHTML) ?? [];
    first.innerHTML = tail;
    if (!tail) first.remove();
    return { lead: head, rest: doc.body.innerHTML };
  }, [html]);
  return (
    <div className="bakeoff-verdict">
      <span className="hud">The reviewer's pick · the model the studio now uses by default</span>
      <p className="bakeoff-verdict-lead" dangerouslySetInnerHTML={{ __html: lead }} />
      <details>
        <summary>The rest of the write-up: the catches, and when to reach for the other models</summary>
        <div dangerouslySetInnerHTML={{ __html: rest }} />
      </details>
    </div>
  );
}

function BakeoffRow({ brief, cells, verdict, onBrief, onCell }: {
  brief: LabBakeoffBrief; cells: (LabGalleryItem | undefined)[]; verdict: (item: LabGalleryItem) => LabImageBakeoff['cells'][string] | undefined;
  onBrief: () => void; onCell: (item: LabGalleryItem) => void;
}) {
  return (
    <>
      <button type="button" className="bakeoff-brief" onClick={onBrief}>
        <b>{brief.label}</b>
        <small>{brief.aspect === '1:1' ? 'Square' : 'Widescreen'}{brief.ref ? ' · from a photo' : ''}</small>
        <span className="media-link">The brief →</span>
      </button>
      {cells.map((item, i) => {
        if (!item) return <span key={i} className="bakeoff-cell empty hud">not made</span>;
        const v = verdict(item);
        return (
          <button key={item.id} type="button" className={`bakeoff-cell${v ? ` ${v.tag}` : ''}`} onClick={() => onCell(item)} title={v?.text}>
            <img src={item.files[0]} alt="" loading="lazy" />
            {v && <span className={`bakeoff-tag ${v.tag}`}>{VERDICT_WORDS[v.tag]}</span>}
            {item.cost !== null && <span className="bakeoff-cost hud">{formatGenerationCost(item.cost)}</span>}
          </button>
        );
      })}
    </>
  );
}
