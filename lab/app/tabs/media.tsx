// media.tsx: the Generated media tab, a gallery of everything `studio gen` has made so far: the previs video tests
// beside their 3D blockouts, the image bake-off as a brief × model grid, the music tracks, and the other stills,
// each with its prompt and price. It only reads files already on disk; nothing here generates or calls a paid API.
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { LabGalleryItem, LabImageBakeoff } from '../../server.ts';
import { LabNote, LabTabIntro } from '../ui.tsx';
import { ImageBakeoffGrid } from './media/bakeoff.tsx';
import { formatGenerationCost, GeneratedMediaLightbox, GeneratedMediaView } from './media/lightbox.tsx';
import { PrevisComparison, previsBlockoutUrl } from './media/previs.tsx';
import './media.css';

const BAKEOFF_FOLDER = 'scratch/image-bakeoff';
/** Smoke tests of the gen command itself: a lo-fi loop, a paper boat and a default-model check add nothing to see. */
const SMOKE_TEST_FOLDERS = new Set(['scratch/gen-smoke', 'scratch/vid-22-default']);

const MUSIC_MODEL_WORDS: Record<string, string> = {
  'google/lyria-3-clip-preview': 'Lyria 3 Clip · ~30 s',
  'google/lyria-3-pro-preview': 'Lyria 3 Pro · full length',
};

export function MediaTab() {
  const [gallery, setGallery] = useState<LabGalleryItem[] | null>(null);
  const [bakeoff, setBakeoff] = useState<LabImageBakeoff | null>(null);
  useEffect(() => {
    void fetch('/api/gallery').then((r) => r.json()).then(setGallery);
    void fetch('/api/image-bakeoff').then((r) => r.json()).then(setBakeoff);
  }, []);

  return (
    <>
      <LabTabIntro
        number={6}
        title="Generated media"
        what={<>
          Some shots can't be screen-recorded from a website or built from shapes in code: a photo of a real product on a
          slate table, a café at sunrise, a music track. For those the studio asks an AI model. You describe the picture,
          clip or music in words (the <b>prompt</b>), the model makes it, and you pay per piece, from under a cent for a
          still to about $1.40 for five seconds of video. This tab is a gallery of everything made that way so far.{' '}
          <b>The lab never generates anything and never makes a paid call:</b> it only shows files already on disk.
        </>}
        when="A title card needs a calm photo behind the headline; a product needs a hero shot richer than a screenshot; a scene needs real-looking footage of a place, a person or an object in use; a video needs music to cut to."
        bad="Paying for video blind and re-rolling until one comes out right. Pictures with garbled lettering, a product quietly redrawn as a different one, a background too busy to set a headline on."
        good="Cheap stills tried side by side before settling on a model. Video blocked out in grey 3D first, approved, then rendered once. Every piece keeps its prompt and price, so it can be remade or explained."
      />
      {gallery ? <MediaGallery gallery={gallery} bakeoff={bakeoff} /> : <LabNote>Reading what's been generated…</LabNote>}
    </>
  );
}

function MediaGallery({ gallery, bakeoff }: { gallery: LabGalleryItem[]; bakeoff: LabImageBakeoff | null }) {
  const [detail, setDetail] = useState<{ items: LabGalleryItem[]; index: number } | null>(null);
  const show = (items: LabGalleryItem[], item: LabGalleryItem) => setDetail({ items, index: items.indexOf(item) });
  const shown = gallery.filter((i) => !SMOKE_TEST_FOLDERS.has(i.where));
  const previs = shown.filter((i) => i.kind === 'video' && previsBlockoutUrl(i));
  const bakeoffItems = shown.filter((i) => i.where === BAKEOFF_FOLDER);
  const music = shown.filter((i) => i.kind === 'audio');
  const others = shown.filter((i) => !previs.includes(i) && !bakeoffItems.includes(i) && !music.includes(i));

  return (
    <>
      <MediaSpend gallery={gallery} />

      {previs.length > 0 && (
        <section className="media-section">
          <MediaSectionHead tag="Video · previs" title="Sketch the shot in grey, pay once for the real thing">
            A generated clip costs about $1.40 for five seconds, and you can't tell a video model "move the camera a
            little slower". So the studio first <b>blocks out</b> the shot: a rough 3D sketch in grey boxes that fixes the
            camera move, the framing and the timing, made in code for free and easy to change. Once that's approved, it
            pays once, and <b>Seedance</b> (ByteDance's video model) paints a photoreal version that follows the sketch.
            Film crews call this previs, short for previsualisation. Both clips below play off one clock.
          </MediaSectionHead>
          <PrevisComparison items={previs} onDetail={(item) => show(previs, item)} />
        </section>
      )}

      {bakeoff && bakeoffItems.length > 0 && (
        <section className="media-section">
          <MediaSectionHead tag="Images · bake-off" title="Same four briefs, six models">
            Image models differ a lot in what they're good at, and prices run from a fraction of a cent to seven cents.
            To pick a default, the studio gave six of them the same four jobs: a title-card background, a product shot
            from a real photo, a flat brand-coloured icon, and a scene with exact words on a screen. Each column is one
            model; each row is one job. Click any picture to see it large, then use ← → to step across the models.
          </MediaSectionHead>
          <ImageBakeoffGrid bakeoff={bakeoff} items={bakeoffItems} />
        </section>
      )}

      {music.length > 0 && (
        <section className="media-section">
          <MediaSectionHead tag="Music · Lyria" title="Tracks written from a paragraph">
            <b>Lyria</b> is Google's music model. The prompt reads like a brief to a composer: the mood, the tempo in beats
            per minute, the instruments, where it builds. The studio then finds the beats in the track so the video's cuts
            can land on them. Press play; only one plays at a time.
          </MediaSectionHead>
          <MusicShelf tracks={music} onDetail={(item) => show(music, item)} />
        </section>
      )}

      {others.length > 0 && (
        <section className="media-section">
          <MediaSectionHead tag="Images · pipeline test" title="The other kinds of still">
            A dry run of every kind of still a video asks for: a title background, a product photo remade from a flat
            drawing, an icon as an SVG (a drawing made of shapes rather than pixels, so it stays sharp at any size), and a
            cut-out with a see-through background, shown here on a checkerboard.
          </MediaSectionHead>
          <div className="media-stills">
            {others.map((item) => (
              <button key={item.id} type="button" className="media-card" onClick={() => show(others, item)}>
                <GeneratedMediaView url={item.files[0]} kind={item.kind} className="checker" />
                <span className="media-card-row"><b>{item.name}</b><span className="hud">{item.cost === null ? '' : formatGenerationCost(item.cost)}</span></span>
                <small>{item.prompt}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {detail && <GeneratedMediaLightbox items={detail.items} index={detail.index} onIndex={(index) => setDetail({ ...detail, index })} onClose={() => setDetail(null)} />}
    </>
  );
}

function MediaSectionHead({ tag, title, children }: { tag: string; title: string; children: ReactNode }) {
  return (
    <header className="media-section-head">
      <span className="hud">{tag}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </header>
  );
}

/** The running total across every provenance file, smoke tests included, since that money was spent too. */
function MediaSpend({ gallery }: { gallery: LabGalleryItem[] }) {
  const kinds = [
    { kind: 'video', label: 'video clips' }, { kind: 'image', label: 'images' }, { kind: 'audio', label: 'music tracks' },
  ] as const;
  const sum = (items: LabGalleryItem[]) => items.reduce((s, i) => s + (i.cost ?? 0), 0);
  const hidden = gallery.filter((i) => SMOKE_TEST_FOLDERS.has(i.where)).length;
  return (
    <div className="media-spend">
      <div className="media-spend-total">
        <span className="hud">Spent so far</span>
        <strong>{formatGenerationCost(sum(gallery))}</strong>
        <small>{gallery.length} pieces{hidden ? `, including ${hidden} smoke tests not shown here` : ''}</small>
      </div>
      {kinds.map(({ kind, label }) => {
        const items = gallery.filter((i) => i.kind === kind);
        return (
          <div key={kind} className="media-spend-part">
            <span className="hud">{items.length} {label}</span>
            <strong>{formatGenerationCost(sum(items))}</strong>
          </div>
        );
      })}
      <p className="media-spend-free"><b>This tab costs nothing.</b> Making new media is a separate, deliberate step (<code>studio gen</code>) that the lab can't take.</p>
    </div>
  );
}

function MusicShelf({ tracks, onDetail }: { tracks: LabGalleryItem[]; onDetail: (item: LabGalleryItem) => void }) {
  // One track at a time: a play anywhere on the shelf pauses the rest. 'play' doesn't bubble, so listen in capture.
  const pauseOthers = (e: SyntheticEvent<HTMLDivElement>) => {
    for (const a of e.currentTarget.querySelectorAll('audio')) if (a !== e.target) a.pause();
  };
  return (
    <div className="media-music" onPlayCapture={pauseOthers}>
      {tracks.map((t) => (
        <article key={t.id} className="media-track">
          <div className="media-card-row">
            <b>{t.name.replace(/^music-/, '')}</b>
            <span className="hud">{t.cost === null ? '' : formatGenerationCost(t.cost)}</span>
          </div>
          <span className="hud">{t.where.replace(/^projects\/\d{4}-\d{2}-/, '')} · {MUSIC_MODEL_WORDS[t.model] ?? t.model}</span>
          <GeneratedMediaView url={t.files[0]} kind="audio" />
          <p className="media-track-prompt">{t.prompt.replace(/^Instrumental only, no vocals\.\s*/, '')}</p>
          <button type="button" className="media-link" onClick={() => onDetail(t)}>Full prompt →</button>
        </article>
      ))}
    </div>
  );
}
