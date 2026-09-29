// procreate-app-driver.ts: Procreate 5 on an iPad, driven through WebDriverAgent (vid-96): import a template as a
// canvas, add and name layers, pick a brush and a colour, paint a finger's strokes at canvas coordinates, and export
// the layers as PNGs to Procreate's shared folder, where ios-device-usb.ts collects them.
//
// Most of Procreate is labelled for accessibility, and the driver finds it by label. Three parts aren't, and are
// tapped where they sit in landscape on a 12.9-inch iPad: the system file pickers (another process draws them), the
// layer menu, and the colour panel's hex keypad. `assertScreen` refuses any other screen size.
//
// Walked through by hand first, on Procreate 5.4.14 and iPadOS 17.7: see docs/procreate-probes.md.

import type { WdaPoint, WebDriverAgentSession } from '#lib/platform/ios-device/engine/webdriveragent-client.ts';
import { centreOf } from '#lib/platform/ios-device/engine/webdriveragent-client.ts';
import { PROCREATE_CAPTURE_CANVAS, type ProcreateCanvasPoint } from '../models/procreate-capture-plan.ts';

export const PROCREATE_BUNDLE_ID = 'au.com.savageinteractive.procreate';
const FILES_BUNDLE_ID = 'com.apple.DocumentsApp';
/** The folder in Procreate's shared Documents that templates and brush sets are staged in, one file at a time. */
export const PROCREATE_STAGING_FOLDER = 'studio-capture';

/** The screen, in points, that the fixed positions below were measured on. */
const SCREEN = { width: 1366, height: 1024 };
/**
 * Where a freshly imported 4096 square canvas sits: 4 canvas pixels to the point, its left edge 169.875 points in.
 * Fitted to a 3×3 grid of taps on the exported layer, to within a hundredth of a pixel; each capture's calibration
 * taps check it again.
 */
export const PROCREATE_CANVAS_ON_SCREEN = { pixelsPerPoint: PROCREATE_CAPTURE_CANVAS / 1024, left: 169.875, top: 0 };
/** The first item in a file picker's grid, and its Save button. */
const PICKER_FIRST_ITEM = { x: 603, y: 315 }, PICKER_SAVE = { x: 1053, y: 220 };
/** The layer list's top row, and Rename in the menu that tapping a selected layer opens beside it. */
const TOP_LAYER_ROW = { x: 1123, y: 154 }, LAYER_MENU_RENAME = { x: 833, y: 83 };
const LAYERS_ADD = { x: 1315, y: 89 };
/** The colour panel's hex keypad, opened by its Hexadecimal field. */
const HEX_KEYS: Record<string, WdaPoint> = {
  D: { x: 763, y: 352 }, E: { x: 844, y: 352 }, F: { x: 925, y: 352 }, A: { x: 763, y: 406 }, B: { x: 844, y: 406 }, C: { x: 925, y: 406 },
  7: { x: 763, y: 460 }, 8: { x: 844, y: 460 }, 9: { x: 925, y: 460 }, 4: { x: 763, y: 514 }, 5: { x: 844, y: 514 }, 6: { x: 925, y: 514 },
  1: { x: 763, y: 568 }, 2: { x: 844, y: 568 }, 3: { x: 925, y: 568 }, 0: { x: 803, y: 622 }, delete: { x: 925, y: 622 },
};
/** The brush list, where it scrolls and the band a brush must sit in to be tapped. */
const BRUSH_LIST = { x: 1146, top: 110, bottom: 960 };
/** Each toolbar panel: the button that toggles it and an element only the open panel shows. */
const PANELS = {
  brushes: { button: 'document-paint-button', marker: 'Brush Navigation Title' },
  colour: { button: 'document-color-button', marker: 'Value' },
  layers: { button: 'document-layers-button', marker: 'Layers Navigation Title' },
};
/**
 * A finger's pace: a move every 8 ms between points 2 points apart, 250 points (1000 canvas pixels) a second. Steady,
 * so no probe's speed dynamics would read it (they're all off anyway).
 */
const MS_PER_MOVE = 8;
const TAP_HOLD_MS = 60;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The whole screen point nearest a canvas point. WebDriverAgent drops a touch's fraction of a point (the pilot's taps
 * at 233.875 landed at 233), so the driver snaps to whole points itself and records where they land.
 */
export const procreateScreenPoint = ({ x, y }: ProcreateCanvasPoint): WdaPoint => ({
  x: Math.round(x / PROCREATE_CANVAS_ON_SCREEN.pixelsPerPoint + PROCREATE_CANVAS_ON_SCREEN.left),
  y: Math.round(y / PROCREATE_CANVAS_ON_SCREEN.pixelsPerPoint + PROCREATE_CANVAS_ON_SCREEN.top),
});

/** Where on the canvas a touch aimed at `p` lands, once snapped to a whole point. */
export function procreateTouchedPoint(p: ProcreateCanvasPoint): ProcreateCanvasPoint {
  const { x, y } = procreateScreenPoint(p);
  return { x: (x - PROCREATE_CANVAS_ON_SCREEN.left) * PROCREATE_CANVAS_ON_SCREEN.pixelsPerPoint, y: (y - PROCREATE_CANVAS_ON_SCREEN.top) * PROCREATE_CANVAS_ON_SCREEN.pixelsPerPoint };
}

export class ProcreateDriver {
  readonly wda: WebDriverAgentSession;
  private color: string | undefined;
  private brush: { set: string; name: string } | undefined;
  constructor(wda: WebDriverAgentSession) {
    this.wda = wda;
  }

  async assertScreen() {
    const window = await this.wda.windowSize();
    if (window.width !== SCREEN.width || window.height !== SCREEN.height) {
      throw new Error(`procreate: the screen is ${window.width}×${window.height} points; the driver's positions are for a 12.9-inch iPad in landscape (${SCREEN.width}×${SCREEN.height}). Turn it to landscape.`);
    }
  }

  private async inCanvas() {
    return Boolean(await this.wda.find('document-gallery-button'));
  }

  async toGallery() {
    await this.wda.activate(PROCREATE_BUNDLE_ID);
    if (await this.inCanvas()) await this.wda.tapNamed('document-gallery-button');
    await this.wda.waitFor('the gallery', (all) => all.find((e) => e.identifier === 'gallery-procreate-button'));
  }

  /**
   * Imports the staged template (the only file in the staging folder) as a new canvas, which Procreate opens. The
   * picker opens where it last was; the first import is pointed at the staging folder by hand (docs).
   */
  async importStagedTemplate() {
    await this.toGallery();
    await this.wda.tapNamed('Import', 'Button');
    await pause(2500);
    await this.wda.tap(PICKER_FIRST_ITEM);
    await this.wda.waitFor('the imported canvas', (all) => all.find((e) => e.identifier === 'document-layers-button'), 30_000);
    this.color = undefined;
    await pause(1000);
  }

  /** Imports a staged brush set by opening it from the Files app, which hands it to Procreate. */
  async importStagedBrushSet(file: string, setName: string) {
    await this.wda.activate(FILES_BUNDLE_ID);
    await this.wda.tapNamed('DOC.sidebar.item.On My iPad');
    await this.tapFilesItem('Procreate');
    await this.tapFilesItem(PROCREATE_STAGING_FOLDER);
    await this.tapFilesItem(file.replace(/\.[^.]+$/, ''));
    const deadline = Date.now() + 60_000;
    while ((await this.wda.activeBundleId()) !== PROCREATE_BUNDLE_ID) {
      if (Date.now() > deadline) throw new Error(`procreate: opening ${file} in Files didn't hand it to Procreate`);
      await pause(500);
    }
    await pause(3000);
    if (!(await this.hasBrushSet(setName))) throw new Error(`procreate: imported ${file} but its set ${setName} isn't in the Brush Library`);
  }

  /** Taps a Files item by its icon: tapping its name would start renaming it. */
  private async tapFilesItem(name: string) {
    const cell = await this.wda.waitFor(`${name} in Files`, (all) => all.find((e) => e.type === 'Cell' && (e.identifier.startsWith(`${name},`) || e.label.startsWith(`${name},`) || e.label.startsWith(name))));
    await this.wda.tap({ x: cell.rect.x + cell.rect.width / 2, y: cell.rect.y + 40 });
    await pause(1200);
  }

  /**
   * Opens or closes a toolbar panel and waits until it is. A tap during a panel's animation is dropped, and the first
   * tap on an unselected paint tool only selects it, so the button is tapped until the panel shows as asked.
   */
  private async setPanel(panel: keyof typeof PANELS, open: boolean) {
    const { button, marker } = PANELS[panel];
    const isOpen = async () => (await this.wda.elements()).some((e) => e.label === marker || e.identifier === marker);
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((await isOpen()) === open) return;
      await this.wda.tapNamed(button);
      for (const deadline = Date.now() + 1500; Date.now() < deadline;) {
        await pause(250);
        if ((await isOpen()) === open) {
          await pause(300);
          return;
        }
      }
    }
    throw new Error(`procreate: the ${panel} panel wouldn't ${open ? 'open' : 'close'}`);
  }

  async hasBrushSet(setName: string): Promise<boolean> {
    if (!(await this.inCanvas())) return false;
    await this.setPanel('brushes', true);
    const found = Boolean(await this.wda.find(setName));
    await this.setPanel('brushes', false);
    return found;
  }

  /** Picks `name` in the brush set `set`, scrolling the list to it (the probes' names sort as they're listed). */
  async selectBrush(set: string, name: string) {
    if (this.brush?.set === set && this.brush.name === name) return;
    await this.setPanel('brushes', true);
    await this.wda.tapNamed(set);
    await pause(500);
    for (let attempt = 0; ; attempt++) {
      const brushes = (await this.wda.elements()).filter((e) => e.rect.x > 1000 && e.rect.x < 1100 && e.rect.width > 200 && e.label);
      const target = brushes.find((e) => e.label === name);
      if (target && target.rect.y >= BRUSH_LIST.top && target.rect.y + target.rect.height <= BRUSH_LIST.bottom + 80) {
        await this.wda.tap(centreOf(target.rect));
        break;
      }
      if (attempt > 30) throw new Error(`procreate: no brush ${name} in ${set}`);
      // Scroll toward it: past the visible ones if it sorts after them.
      const later = !target && brushes.length > 0 && name.localeCompare(brushes.at(-1)!.label, undefined, { numeric: true }) > 0;
      const up = target ? target.rect.y > BRUSH_LIST.bottom : later;
      await this.wda.drag({ x: BRUSH_LIST.x, y: up ? 800 : 250 }, { x: BRUSH_LIST.x, y: up ? 350 : 700 });
      await pause(500);
    }
    await pause(300);
    await this.setPanel('brushes', false);
    this.brush = { set, name };
  }

  /** Sets the paint colour by its hex, through the colour panel's Value tab. */
  async setColor(hex: string) {
    const want = hex.replace('#', '').toUpperCase();
    if (this.color === want) return;
    await this.setPanel('colour', true);
    await this.wda.tapNamed('Value', 'Button');
    await this.wda.tapNamed('Hexadecimal');
    await pause(500);
    for (let i = 0; i < 7; i++) await this.wda.tap(HEX_KEYS.delete, 30);
    for (const digit of want) await this.wda.tap(HEX_KEYS[digit], 30);
    await pause(300);
    await this.setPanel('colour', false);
    await this.setPanel('colour', true);
    const field = await this.wda.waitFor('the hex field', (all) => all.find((e) => e.label === 'Hexadecimal'));
    const shown = field.value.replace(/[#,]/g, '').toUpperCase();
    await this.setPanel('colour', false);
    if (shown !== want) throw new Error(`procreate: asked for colour #${want} and the panel shows #${shown}`);
    this.color = want;
  }

  /** Renames the top layer, which must be the selected one. */
  private async renameTopLayer(name: string) {
    await this.wda.tap(TOP_LAYER_ROW);
    await pause(700);
    await this.wda.tap(LAYER_MENU_RENAME);
    await pause(900);
    await this.wda.type(`${name}\n`);
    await this.wda.waitFor(`the layer named ${name}`, (all) => all.find((e) => e.type === 'StaticText' && e.label === name));
  }

  /**
   * Readies an imported template's canvas: its one layer renamed `groundLayer`, the background colour hidden so every
   * exported layer keeps its transparency (Procreate flattens each layer onto the background otherwise).
   */
  async prepareCanvas(groundLayer: string) {
    await this.setPanel('layers', true);
    await this.renameTopLayer(groundLayer);
    const background = await this.wda.waitFor('the background layer', (all) => all.find((e) => e.label === 'Background color'));
    await this.wda.tap({ x: 1312, y: background.rect.y + background.rect.height / 2 });
    await pause(400);
    await this.setPanel('layers', false);
  }

  /** Adds a layer on top, selected, named `name`. */
  async addLayer(name: string) {
    await this.setPanel('layers', true);
    await this.wda.tap(LAYERS_ADD);
    await pause(700);
    await this.renameTopLayer(name);
    await this.setPanel('layers', false);
  }

  /** Paints `strokes` (canvas pixels) with the current brush, colour and layer, the finger lifted between them. */
  async paint(strokes: readonly (readonly ProcreateCanvasPoint[])[]) {
    await this.wda.touch(strokes.map((stroke) => ({ points: stroke.map(procreateScreenPoint), msPerMove: MS_PER_MOVE, holdMs: stroke.length === 1 ? TAP_HOLD_MS : 0 })));
    await pause(250);
  }

  /** Share › PNG Files › Save to Files › Save, into Procreate's shared folder (where the picker was left). */
  async exportLayers() {
    await this.wda.tapNamed('document-actions-button');
    await this.wda.tapNamed('document-actions-share');
    await this.wda.tapNamed('document-actions-share-layerPNG');
    await this.wda.tapNamed('Save to Files', undefined, 120_000);
    await pause(3000);
    await this.wda.tap(PICKER_SAVE);
    await pause(1500);
  }
}
