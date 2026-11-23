// stamp-gate-paper-card-page.ts: the gate page's paper cards (stamp-gate-paper-card.ts): each view's pop-up built by
// paintedThreePopUp as a shot's three source is, its flat prints written straight into painted textures, loaded
// through the three-source loader under the paper key, rendered at its moment and read back over the frame. The
// diorama is a paperPopUpPlane in a shot, its prints painted, drawn through the shot's renderer and its lens.

import { DataUtils } from 'three/webgpu';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { PAPER_KEY_LIGHT } from '#lib/paint/painting/models/stamp-form.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { copyStampLayerForReadback, readStampLayerCopy } from '#lib/paint/painting/studio/stamp-layer-readback.ts';
import { paperPopUpPlane } from '#lib/paint/shot/studio/shot-paper-pop-up.ts';
import { paintedThreePopUp } from '#lib/paint/three-layers/studio/painted-three-pop-up.ts';
import { loadPaintedThreeSources, type PaintedThreeTextureHandle } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  checkStampGatePaperCard, STAMP_GATE_PAPER_CARD_DIORAMA, STAMP_GATE_PAPER_CARD_DIORAMA_POP_UP, STAMP_GATE_PAPER_CARD_DIORAMA_PRINTS, STAMP_GATE_PAPER_CARD_PRINTS,
  STAMP_GATE_PAPER_CARD_VIEW_IDS, STAMP_GATE_PAPER_CARD_VIEWS, stampGatePaperCardBytes, stampGatePaperCardCamera, stampGatePaperCardFrame, stampGatePaperCardPrintAt,
  type StampGatePaperCardPictureOf,
} from '../models/stamp-gate-paper-card.ts';
import type { StampGateShot } from '../models/stamp-gate-shot-span.ts';
import { stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateFramesBeside, stampGateShotFrames } from './stamp-gate-shot-frames.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

/** Each view rendered, read back over its frame. */
async function drawStampGatePaperCardViews(): Promise<StampGatePaperCardPictureOf> {
  const { camera } = stampGatePaperCardCamera(), { width, height } = camera.stage.frame;
  return withGateSurface(stampGatePaperCardFrame(), stampGateSheetImageUrl, async ({ owner }) => {
    const { device } = owner, prints: GPUTexture[] = [];
    try {
      // Painted textures are gamma-encoded and opaque (painted-three-sources.ts): each print's colours as they are.
      const handles = STAMP_GATE_PAPER_CARD_PRINTS.map((print): PaintedThreeTextureHandle => {
        const texture = device.createTexture({ size: [print.width, print.height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        prints.push(texture);
        const halves = new Uint16Array(print.width * print.height * 4);
        for (let y = 0; y < print.height; y++) {
          for (let x = 0; x < print.width; x++) halves.set([...stampGatePaperCardPrintAt(print, x + 0.5, y + 0.5), 1].map((v) => DataUtils.toHalfFloat(v)), (y * print.width + x) * 4);
        }
        device.queue.writeTexture({ texture }, halves, { bytesPerRow: print.width * 8 }, [print.width, print.height]);
        return { id: print.id, texture, wrap: null };
      });
      const sources = STAMP_GATE_PAPER_CARD_VIEW_IDS.map((id) => {
        const { popUp, keyOnly } = STAMP_GATE_PAPER_CARD_VIEWS[id];
        return { id, build: paintedThreePopUp(popUp, keyOnly ? { lights: { fill: 0, sky: 0 }, leak: [0, 0, 0] } : {}) };
      });
      const loaded = await loadPaintedThreeSources(owner, camera, PAPER_KEY_LIGHT, sources, { handles, update: () => Promise.resolve() });
      try {
        const pictures = await gpuEachInTurn(STAMP_GATE_PAPER_CARD_VIEW_IDS, async (id) => {
          const source = loaded.sources.get(id);
          if (source?.kind !== 'three') throw new Error(`stamp gate: paper card view ${id} loaded as no three source`);
          await source.render(STAMP_GATE_PAPER_CARD_VIEWS[id].at, null);
          const { texture, at } = source.picture;
          const copy = await owner.checked(`reading back paper card view ${id}`, () => {
            const encoder = device.createCommandEncoder(), copied = copyStampLayerForReadback(device, encoder, texture, { x: -at.x, y: -at.y, w: width, h: height });
            device.queue.submit([encoder.finish()]);
            return copied;
          });
          const { values } = await readStampLayerCopy(copy);
          return { width, height, values };
        });
        return (view) => pictures[STAMP_GATE_PAPER_CARD_VIEW_IDS.indexOf(view)];
      } finally {
        loaded.dispose();
      }
    } finally {
      for (const texture of prints) texture.destroy();
    }
  });
}

/** The diorama's shot: its dusk back, and its pop-up with every print painted, under a lens that blooms. */
function stampGatePaperCardDioramaShot(): StampGateShot {
  const { camera } = stampGatePaperCardCamera(), { backDepth, bloom } = STAMP_GATE_PAPER_CARD_DIORAMA, { dusk, ...prints } = STAMP_GATE_PAPER_CARD_DIORAMA_PRINTS;
  const { plane, paintedTextures } = paperPopUpPlane({
    id: 'diorama', depth: 1,
    popUp: {
      ...STAMP_GATE_PAPER_CARD_DIORAMA_POP_UP,
      prints: Object.fromEntries(Object.entries(prints).map(([key, { module, layers, widthPx, heightPx }]) => [key, { source: layersOf(painting(module), layers), widthPx, heightPx }])),
    },
  });
  return {
    camera: { stage: stampStage(camera.stage.frame, 2), fov: camera.fov, lens: { bloom, shutter: 'shut' } },
    planes: [{ id: 'dusk', depth: backDepth, source: layersOf(painting(dusk.module), dusk.layers) }, plane],
    paintedTextures,
  };
}

/** The paper cards' baseline, the views side by side, then the diorama: RGB bytes row by row, in base64. */
export async function paintStampGatePaperCard(): Promise<string> {
  const pictureOf = await drawStampGatePaperCardViews();
  const { frames: [diorama] } = await stampGateShotFrames(stampGatePaperCardDioramaShot(), [STAMP_GATE_PAPER_CARD_DIORAMA.at]);
  return stampGateRgbBase64(stampGateFramesBeside([...STAMP_GATE_PAPER_CARD_VIEW_IDS.map((id) => stampGatePaperCardBytes(pictureOf(id))), diorama], stampGatePaperCardFrame()));
}

/** The paper cards' checks (checkStampGatePaperCard) on their views as rendered. */
export async function checkStampGatePaperCardCase(): Promise<StampGateWashCheck[]> {
  return checkStampGatePaperCard(await drawStampGatePaperCardViews());
}
