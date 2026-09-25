// lightbox.tsx: the Generated media tab's detail views. A plain modal for briefs and models, and a lightbox for one
// generated piece at a time (the file large, then its model, cost, prompt and references), stepping through a set
// with the arrow keys so the same brief can be compared model by model.
import { useEffect, type ReactNode } from 'react';
import type { LabGalleryItem } from '../../../server.ts';

/** A dollar amount at the precision that matters: $1.39, $0.04, $0.004. */
export function formatGenerationCost(usd: number) {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3).replace(/0$/, '')}`;
}

/** A generated file as its kind plays: a still, a muted looping clip, or an audio player. */
export function GeneratedMediaView({ url, kind, autoPlay = false, className }: {
  url: string; kind: LabGalleryItem['kind']; autoPlay?: boolean; className?: string;
}) {
  if (kind === 'video') return <video className={className} src={url} muted loop playsInline autoPlay={autoPlay} controls={autoPlay} preload="metadata" />;
  if (kind === 'audio') return <audio className={className} src={url} controls preload="metadata" />;
  return <img className={className} src={url} alt="" />;
}

const isVideoUrl = (url: string) => /\.(mp4|webm)$/i.test(url);

/** A dimmed overlay holding a panel; Escape or a click outside closes it. */
export function MediaModal({ onClose, wide = false, children }: { onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="media-modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`media-modal-panel${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="media-modal-close" onClick={onClose} aria-label="Close">×</button>
        {children}
      </div>
    </div>
  );
}

/** One generated piece in full, with ← → stepping through `items`. */
export function GeneratedMediaLightbox({ items, index, onIndex, onClose, title = (i) => i.name, extra }: {
  items: LabGalleryItem[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  title?: (item: LabGalleryItem) => ReactNode; extra?: (item: LabGalleryItem) => ReactNode;
}) {
  const item = items[index];
  const step = (by: number) => onIndex((index + by + items.length) % items.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const params = Object.entries(item.params);
  return (
    <MediaModal onClose={onClose} wide>
      <div className="media-lightbox">
        <div className="media-lightbox-view">
          <GeneratedMediaView key={item.id} url={item.files[0]} kind={item.kind} autoPlay className={item.kind === 'image' ? 'checker' : undefined} />
          {items.length > 1 && (
            <div className="media-lightbox-nav">
              <button type="button" onClick={() => step(-1)} aria-label="Previous">←</button>
              <span className="hud">{index + 1} / {items.length}</span>
              <button type="button" onClick={() => step(1)} aria-label="Next">→</button>
            </div>
          )}
        </div>
        <aside className="media-lightbox-facts">
          <span className="hud">{item.where}</span>
          <h3>{title(item)}</h3>
          <dl>
            <dt className="hud">Model</dt><dd><code>{item.model}</code></dd>
            <dt className="hud">Cost</dt><dd>{item.cost === null ? 'not recorded' : formatGenerationCost(item.cost)}</dd>
            {item.generatedAt && <><dt className="hud">Made</dt><dd>{new Date(item.generatedAt).toLocaleString()}</dd></>}
            {params.length > 0 && <><dt className="hud">Settings</dt><dd className="media-chips">{params.map(([k, v]) => <span key={k}>{k.replaceAll('_', ' ')}: {String(v)}</span>)}</dd></>}
          </dl>
          {extra?.(item)}
          <span className="hud">The prompt, word for word</span>
          <p className="media-prompt">{item.prompt}</p>
          {item.references.length > 0 && (
            <>
              <span className="hud">Given to the model alongside the prompt</span>
              <div className="media-refs">
                {item.references.map((r) => (isVideoUrl(r) ? <video key={r} src={r} muted loop autoPlay playsInline /> : <img key={r} src={r} alt="" className="checker" />))}
              </div>
            </>
          )}
        </aside>
      </div>
    </MediaModal>
  );
}
