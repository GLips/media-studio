import { Stack } from '@mantine/core';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { splitLabGallery } from '#models/lab/lab-generated-media.ts';
import { labCatalogQueryOptions } from '#web/features/lab/controllers/lab-catalog-query.ts';
import { LabTabIntro } from '../lab-tab-intro.tsx';
import { LabMediaForAgents } from './lab-media-for-agents.tsx';
import { LabMediaLightbox } from './lab-media-lightbox.tsx';
import { LabMediaSection } from './lab-media-section.tsx';
import { LabMediaSpend } from './lab-media-spend.tsx';
import { LabMediaStills } from './lab-media-stills.tsx';
import { LabMusicShelf } from './lab-music-shelf.tsx';
import { LabPrevisComparison } from './lab-previs-comparison.tsx';

type LabMediaDetail = { items: readonly LabGalleryItem[]; index: number };

/**
 * The Generated media tab: a gallery of everything `studio gen` has made in the projects, the previs renders beside
 * their blockouts, the music, and the other stills, each with its prompt and price. It only shows files already on
 * disk; nothing here generates or calls a paid API.
 */
export function LabMediaTab() {
  const { data: catalog } = useSuspenseQuery(labCatalogQueryOptions);
  const [detail, setDetail] = useState<LabMediaDetail | null>(null);
  const { gallery } = catalog;
  const { previs, music, others } = splitLabGallery(gallery);
  const show = (items: readonly LabGalleryItem[]) => (item: LabGalleryItem) => setDetail({ items, index: items.indexOf(item) });

  return (
    <Stack gap="xl">
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

      <LabMediaSpend shown={gallery} />

      {previs.length > 0 && (
        <LabMediaSection tag="Video · previs" title="Sketch the shot in grey, pay once for the real thing" intro={<>
          A generated clip costs about $1.40 for five seconds, and you can't tell a video model "move the camera a little
          slower". So the studio first <b>blocks out</b> the shot: a rough 3D sketch in grey boxes that fixes the camera
          move, the framing and the timing, made in code for free and easy to change. Once that's approved, it pays once,
          and <b>Seedance</b> (ByteDance's video model) paints a photoreal version that follows the sketch. Film crews call
          this previs, short for previsualisation. Both clips below play off one clock.
        </>}>
          <LabPrevisComparison items={previs} onDetail={show(previs)} />
        </LabMediaSection>
      )}

      {music.length > 0 && (
        <LabMediaSection tag="Music · Lyria" title="Tracks written from a paragraph" intro={<>
          <b>Lyria</b> is Google's music model. The prompt reads like a brief to a composer: the mood, the tempo in beats
          per minute, the instruments, where it builds. The studio then finds the beats in the track so the video's cuts
          can land on them. Press play; only one plays at a time.
        </>}>
          <LabMusicShelf tracks={music} onDetail={show(music)} />
        </LabMediaSection>
      )}

      {others.length > 0 && (
        <LabMediaSection tag="Images · pipeline test" title="The other kinds of still" intro={<>
          A dry run of every kind of still a video asks for: a title background, a product photo remade from a flat
          drawing, an icon as an SVG (a drawing made of shapes rather than pixels, so it stays sharp at any size), and a
          cut-out with a see-through background, shown here on a checkerboard.
        </>}>
          <LabMediaStills items={others} onDetail={show(others)} />
        </LabMediaSection>
      )}

      <LabMediaForAgents gallery={gallery} />

      {detail && (
        <LabMediaLightbox items={detail.items} index={detail.index}
          onIndex={(index) => setDetail({ ...detail, index })} onClose={() => setDetail(null)} />
      )}
    </Stack>
  );
}
