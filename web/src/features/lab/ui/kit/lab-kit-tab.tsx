import { Stack } from '@mantine/core';
import { useState } from 'react';
import { LabNote } from '../lab-note.tsx';
import { LabTabIntro } from '../lab-tab-intro.tsx';
import { LabKitForAgents } from './lab-kit-for-agents.tsx';
import type { LabKitPieceId, LabKitPropsById } from './lab-kit-piece.ts';
import { LabKitPieceBench } from './lab-kit-piece-bench.tsx';
import { LabKitPiecePicker } from './lab-kit-piece-picker.tsx';

/**
 * The ready-made components a video's scenes are built from, one at a time on a live stage with every prop as a
 * control. A piece's settings are kept while you look at another. Pieces that need a captured page (MotionTitle,
 * ClickToBlur, Phone, SplitCompare) aren't here.
 */
export function LabKitTab() {
  const [chosenId, setChosenId] = useState<LabKitPieceId>('word-reveal');
  const [propsById, setPropsById] = useState<Partial<LabKitPropsById>>({});
  const setPieceProps = <K extends LabKitPieceId>(id: K, props: LabKitPropsById[K]) => setPropsById((all) => ({ ...all, [id]: props }));
  return (
    <Stack gap="xl">
      <LabTabIntro
        number={3}
        title="Kit pieces"
        what="The studio’s ready-made building blocks: words that ripple in, a number that rolls into place, a pen stroke, a closing card, and the finishing touches laid over a whole frame. A video’s scenes are mostly these, given its own words and colours. Pick one below and play with its settings."
        when="Every video uses a handful. Walkthroughs of an app lean on the text and cards; teasers and showreels add the grain, vignette and shutter blur."
        bad="A piece used for everything (every line rippling in, every number rolling), or settings pushed so far that the effect is all you notice: words crawling in, grain like static, a smear on something slow."
        good="Each piece earns its moment: the one number that matters rolls in, the one word that matters gets underlined, and the finishing touches are felt more than seen."
      />
      <LabKitPiecePicker chosenId={chosenId} onChoose={setChosenId} />
      <LabKitPieceBench pieceId={chosenId} propsById={propsById} onPropsChange={setPieceProps} />
      <LabNote>
        More pieces from the motion showcase (bounce, odometer, kinetic type, recap, capture plane) are still being built and will appear here once they’re finished.
      </LabNote>
      <LabKitForAgents />
    </Stack>
  );
}
