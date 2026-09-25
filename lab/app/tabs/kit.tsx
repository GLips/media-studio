// kit.tsx: the lab's Kit pieces tab: the ready-made components a video's scenes are built from, one at a time on a
// live stage with every prop as a control. Pick a piece from the cards; its settings are kept while you look at
// another. Pieces that need a captured page (MotionTitle, ClickToBlur, Phone, SplitCompare) aren't here.
import { useState } from 'react';
import { LabBench, LabControls, LabNote, LabStage, LabTabIntro } from '../ui.tsx';
import { DRAW_PATH_PIECE, ODOMETER_PIECE, WORD_REVEAL_PIECE } from './kit/builds.tsx';
import { END_CARD_PIECE, GLASS_CARD_PIECE, SECTION_CARD_PIECE } from './kit/cards.tsx';
import { GRADE_PIECE, SHUTTER_BLUR_PIECE } from './kit/finish.tsx';
import type { KitPieceProps } from './kit/piece.tsx';
import './kit.css';

// The registry. A newly committed piece (e.g. from lib/studio/reel) is one defineKitPiece entry added here.
const KIT_PIECES = [
  WORD_REVEAL_PIECE,
  ODOMETER_PIECE,
  DRAW_PATH_PIECE,
  GLASS_CARD_PIECE,
  SECTION_CARD_PIECE,
  END_CARD_PIECE,
  GRADE_PIECE,
  SHUTTER_BLUR_PIECE,
];

export function KitTab() {
  const [chosenId, setChosenId] = useState(KIT_PIECES[0].id);
  const [propsById, setPropsById] = useState<Record<string, KitPieceProps>>({});
  const piece = KIT_PIECES.find((p) => p.id === chosenId)!;
  const props = propsById[piece.id] ?? piece.defaults;
  const set = (patch: Partial<KitPieceProps>) =>
    setPropsById((all) => ({ ...all, [piece.id]: { ...(all[piece.id] ?? piece.defaults), ...patch } }));

  return (
    <>
      <LabTabIntro
        number={3}
        title="Kit pieces"
        what={<>The studio’s ready-made building blocks: words that ripple in, a number that rolls into place, a pen stroke, a closing card, and the finishing touches laid over a whole frame. A video’s scenes are mostly these, given its own words and colours. Pick one below and play with its settings.</>}
        when="Every video uses a handful. Walkthroughs of an app lean on the text and cards; teasers and showreels add the grain, vignette and shutter blur."
        bad="A piece used for everything (every line rippling in, every number rolling), or settings pushed so far that the effect is all you notice: words crawling in, grain like static, a smear on something slow."
        good="Each piece earns its moment: the one number that matters rolls in, the one word that matters gets underlined, and the finishing touches are felt more than seen."
      />
      <nav className="kit-picker" aria-label="Kit pieces">
        {KIT_PIECES.map((p) => (
          <button key={p.id} type="button" className={p === piece ? 'on' : undefined} onClick={() => setChosenId(p.id)}>
            <span className="kit-picker-name">{p.title}</span>
            <span className="kit-picker-blurb">{p.blurb}</span>
          </button>
        ))}
      </nav>
      <section className="kit-piece">
        <div className="kit-piece-head">
          <h3>{piece.title}</h3>
          <p className="kit-when"><span className="hud">When a video uses it</span> {piece.whenUsed}</p>
        </div>
        <LabBench
          // Keyed by piece, so switching pieces starts the new one from its first frame.
          stage={<LabStage key={piece.id} component={piece.Stage} inputProps={props} seconds={piece.seconds(props)} label={piece.title} />}
        >
          <LabControls><piece.Controls props={props} set={set} /></LabControls>
          <button type="button" className="kit-reset" onClick={() => setPropsById((all) => ({ ...all, [piece.id]: piece.defaults }))}>Reset to the starting settings</button>
        </LabBench>
        {piece.note && <LabNote>{piece.note}</LabNote>}
      </section>
      <LabNote>
        More pieces from the motion showcase (bounce, odometer, kinetic type, recap, capture plane) are still being built and will appear here once they’re finished.
      </LabNote>
      <details className="kit-agents">
        <summary className="hud">For agents</summary>
        <ul>
          {KIT_PIECES.map((p) => <li key={p.id}>{p.title}: <code>{p.name}</code> in <code>{p.source}</code></li>)}
        </ul>
        <p>Not shown: <code>MotionTitle</code>, <code>ClickToBlur</code>, <code>Phone</code> and <code>SplitCompare</code> need a captured page (a Shot). <code>ThreeStage</code> is left out while it is being reworked.</p>
      </details>
    </>
  );
}
