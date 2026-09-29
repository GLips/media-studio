// procreate-capture.ts: `npm run procreate -- capture`, which has Procreate on the iPad paint every probe and brings its
// layers back full size (vid-96). It writes the probe set and, if Procreate lacks it, imports it; then per canvas of
// the plan (models/procreate-capture-plan.ts) it imports the template, paints each probe on its own named layer
// through procreate-app-driver.ts, exports every layer once, and pulls the PNGs over USB into the run's folder with a
// manifest. `measureProcreateCaptureRepeats` reads a run's repeated probes back and says how much Procreate varies.
//
// The captures are the pack's kind of asset, private: work/styles/<style>/brushes/procreate-captures/<run>/.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { connectedIpad, ensureWebDriverAgent, iosAppDocuments, iosAppVersion, WEBDRIVERAGENT_URL } from '#lib/platform/ios-device/engine/ios-device-usb.ts';
import { WebDriverAgentSession } from '#lib/platform/ios-device/engine/webdriveragent-client.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import {
  drawProcreateCaptureTemplate, planProcreateCapture, PROCREATE_CAPTURE_CALIBRATION_TAPS, PROCREATE_CAPTURE_CANVAS, PROCREATE_CAPTURE_GROUND_LAYER,
  type ProcreateCaptureCanvas, type ProcreateCaptureManifest,
} from '../models/procreate-capture-plan.ts';
import { measureProcreateRepeatVariation, type ProcreateRepeatVariation } from '../models/procreate-capture-repeats.ts';
import { procreateProbes } from '../models/procreate-probes.ts';
import { PROCREATE_BUNDLE_ID, PROCREATE_CANVAS_ON_SCREEN, PROCREATE_STAGING_FOLDER, ProcreateDriver, procreateTouchedPoint } from './procreate-app-driver.ts';
import { procreateProbeSetName, writeProcreateProbeBrushset } from './procreate-probe-brushset.ts';

export type ProcreateCaptureOptions = {
  /** Where runs go: a folder per run. */
  capturesDir: string;
  /** The pack the probes are written over, its template brush, and its brushes painted as bridges. */
  archive: string;
  brush: string;
  bridges: readonly string[];
  only?: readonly string[];
  repeats?: { probes: readonly string[]; times: number };
  log: (line: string) => void;
};

const S = PROCREATE_CAPTURE_CANVAS;

/** A PNG's pixels as RGBA, and the title Procreate writes into an exported layer (its layer's name). */
function readPngRgba(file: string): Uint8Array {
  return new Uint8Array(runFfmpeg(['-nostdin', '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 }));
}
function pngLayerTitle(file: string): string {
  const bytes = readFileSync(file).toString('latin1');
  const title = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(bytes)?.[1];
  if (title === undefined) throw new Error(`capture: ${file} carries no layer title`);
  return Buffer.from(title, 'latin1').toString('utf8').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
/** A PNG's colour chunks and bit depth, as the manifest records them. */
function pngColour(file: string): { profile: string; bitDepth: number } {
  const b = readFileSync(file);
  const chunks: string[] = [];
  for (let at = 8; at < b.length;) {
    const length = b.readUInt32BE(at), type = b.toString('ascii', at + 4, at + 8);
    chunks.push(type);
    at += 12 + length;
  }
  const profile = chunks.includes('iCCP') ? 'embedded ICC profile' : chunks.includes('sRGB') ? 'sRGB (PNG sRGB chunk)' : 'untagged';
  return { profile, bitDepth: b[24] };
}

/** Where the black calibration stamp landed near `at`: the alpha centroid of the ink, the blue guides left out. */
function landedTap(rgba: Uint8Array, at: { x: number; y: number }) {
  let sx = 0, sy = 0, s = 0;
  const cx = Math.round(at.x), cy = Math.round(at.y);
  for (let y = Math.max(0, cy - 250); y < Math.min(S, cy + 250); y++) {
    for (let x = Math.max(0, cx - 250); x < Math.min(S, cx + 250); x++) {
      const i = (y * S + x) * 4;
      if (rgba[i + 1] > 40 || rgba[i + 2] > 40) continue;
      sx += rgba[i + 3] * (x + 0.5);
      sy += rgba[i + 3] * (y + 0.5);
      s += rgba[i + 3];
    }
  }
  return { x: Math.round((sx / s) * 100) / 100, y: Math.round((sy / s) * 100) / 100 };
}

const runId = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

export async function captureProcreateProbes(options: ProcreateCaptureOptions): Promise<{ dir: string; manifest: ProcreateCaptureManifest }> {
  const { log } = options;
  const started = new Date(), run = runId(started);
  const probes = procreateProbes({ bridges: options.bridges });
  const setName = procreateProbeSetName(probes, options.brush);
  // Every point as it will land, snapped to the screen's whole points, so the manifest says where the paint went.
  const plan = planProcreateCapture(probes, { prefix: `capture-${run}`, only: options.only, repeats: options.repeats }).map((canvas) => ({
    ...canvas, steps: canvas.steps.map((step) => ({ ...step, strokes: step.strokes.map((stroke) => stroke.map(procreateTouchedPoint)) })),
  }));
  const dir = join(options.capturesDir, run);
  mkdirSync(dir, { recursive: true });
  log(`capture ${run}: ${plan.length} canvases, ${plan.reduce((n, c) => n + c.layers.length, 0)} probe layers, set ${setName}`);

  const ipad = connectedIpad();
  const docs = iosAppDocuments(ipad.udid, PROCREATE_BUNDLE_ID);
  const procreate = iosAppVersion(ipad.udid, PROCREATE_BUNDLE_ID);
  await ensureWebDriverAgent(ipad.udid, log);
  const driver = new ProcreateDriver(await WebDriverAgentSession.open(WEBDRIVERAGENT_URL, PROCREATE_BUNDLE_ID));
  await driver.assertScreen();
  if (!docs.list().includes(PROCREATE_STAGING_FOLDER)) docs.mkdir(PROCREATE_STAGING_FOLDER);
  const stage = (local: string, name: string) => {
    for (const old of docs.list(PROCREATE_STAGING_FOLDER)) docs.remove(`${PROCREATE_STAGING_FOLDER}/${old}`);
    docs.push(local, `${PROCREATE_STAGING_FOLDER}/${name}`);
  };

  const canvases: ProcreateCaptureManifest['canvases'] = [];
  let colour: ReturnType<typeof pngColour> | undefined;
  for (const [index, canvas] of plan.entries()) {
    const canvasStart = Date.now();
    const canvasDir = join(dir, canvas.name);
    mkdirSync(canvasDir, { recursive: true });
    const template = join(canvasDir, 'template.png');
    withStudioTemp('capture-template', (tmp) => {
      writeFileSync(join(tmp, 'template.rgba'), drawProcreateCaptureTemplate(canvas));
      runFfmpeg(['-nostdin', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${S}x${S}`, '-i', join(tmp, 'template.rgba'), '-y', template]);
    });
    stage(template, `${canvas.name}.png`);
    log(`${canvas.name}: importing the template`);
    await driver.importStagedTemplate();
    await driver.prepareCanvas(PROCREATE_CAPTURE_GROUND_LAYER);
    if (index === 0 && !(await driver.hasBrushSet(setName))) {
      log(`importing ${setName} into Procreate`);
      withStudioTemp('capture-brushset', (tmp) => {
        writeProcreateProbeBrushset({ archive: options.archive, brush: options.brush, out: join(tmp, 'set.brushset'), probes });
        stage(join(tmp, 'set.brushset'), `${setName}.brushset`);
      });
      await driver.importStagedBrushSet(`${setName}.brushset`, setName);
    }

    const probeSeconds: Record<string, number> = {};
    const paintStep = async (step: ProcreateCaptureCanvas['steps'][number]) => {
      await driver.selectBrush(setName, step.probe);
      await driver.setColor(step.color);
      await driver.paint(step.strokes);
    };
    // The ground layer's marks first, while it's the only layer and so the selected one.
    for (const step of canvas.steps.filter((s) => s.layer === PROCREATE_CAPTURE_GROUND_LAYER)) await paintStep(step);
    for (const layer of canvas.layers) {
      const t = Date.now();
      await driver.addLayer(layer);
      for (const step of canvas.steps.filter((s) => s.layer === layer)) await paintStep(step);
      probeSeconds[layer] = (Date.now() - t) / 1000;
      log(`${canvas.name}: ${layer} in ${probeSeconds[layer].toFixed(1)} s`);
    }
    const paintSeconds = (Date.now() - canvasStart) / 1000;

    const exportStart = Date.now();
    for (const old of docs.list().filter((f) => f.startsWith(`${canvas.name}-`))) docs.remove(old);
    await driver.exportLayers();
    const expected = canvas.layers.length + 1;
    let exported: string[] = [];
    for (const deadline = Date.now() + 180_000; exported.length < expected;) {
      if (Date.now() > deadline) throw new Error(`capture: ${canvas.name} exported ${exported.length} of ${expected} layers to Procreate's folder; if none, point Save to Files at On My iPad › Procreate once by hand`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      exported = docs.list().filter((f) => f.startsWith(`${canvas.name}-`) && f.endsWith('.png'));
    }
    const files: Record<string, string> = {};
    for (const name of exported) {
      const pulled = join(canvasDir, name);
      docs.pull(name, pulled);
      docs.remove(name);
      const layer = pngLayerTitle(pulled), file = `${layer}.png`;
      renameSync(pulled, join(canvasDir, file));
      files[layer] = file;
    }
    const missing = [PROCREATE_CAPTURE_GROUND_LAYER, ...canvas.layers].filter((l) => !files[l]);
    if (missing.length) throw new Error(`capture: ${canvas.name}'s export lacks ${missing.join(', ')}`);
    colour ??= pngColour(join(canvasDir, files[PROCREATE_CAPTURE_GROUND_LAYER]));
    const ground = readPngRgba(join(canvasDir, files[PROCREATE_CAPTURE_GROUND_LAYER]));
    const calibration = PROCREATE_CAPTURE_CALIBRATION_TAPS.map(procreateTouchedPoint).map((asked) => ({ asked, landed: landedTap(ground, asked) }));
    const exportSeconds = (Date.now() - exportStart) / 1000;
    canvases.push({ ...canvas, template: 'template.png', files, calibration, probeSeconds, seconds: { paint: paintSeconds, export: exportSeconds, total: (Date.now() - canvasStart) / 1000 } });
    log(`${canvas.name}: painted in ${paintSeconds.toFixed(0)} s, exported ${expected} layers in ${exportSeconds.toFixed(0)} s; calibration off by ${calibration.map((c) => `${(c.landed.x - c.asked.x).toFixed(2)},${(c.landed.y - c.asked.y).toFixed(2)}`).join(' and ')} px`);
    await driver.toGallery();
  }

  const manifest: ProcreateCaptureManifest = {
    run, startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
    device: { name: ipad.name, productType: ipad.productType, osVersion: ipad.osVersion, osBuild: ipad.osBuild },
    procreate,
    canvas: { width: S, height: S, profile: colour!.profile, bitDepth: colour!.bitDepth, screen: PROCREATE_CANVAS_ON_SCREEN },
    brushSet: { name: setName, template: options.brush, archive: options.archive },
    touch: { pointsPerSecond: 250, tapHoldMs: 60, pressure: 'none: a finger' },
    probes, canvases,
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return { dir, manifest };
}

/**
 * Each probe painted more than once across the runs in `runDirs` (a repeat canvas's `Probe NN #k` layers, and the
 * same probe in another run), its copies cropped to their boxes and compared.
 */
export function measureProcreateCaptureRepeats(runDirs: readonly string[]): Record<string, ProcreateRepeatVariation & { mark: string }> {
  type Copy = { label: string; file: string; box: { x: number; y: number; width: number; height: number } };
  const copies = new Map<string, Copy[]>();
  for (const runDir of runDirs) {
    const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')) as ProcreateCaptureManifest;
    for (const canvas of manifest.canvases) {
      for (const step of canvas.steps.filter((s) => s.layer !== PROCREATE_CAPTURE_GROUND_LAYER)) {
        const key = `${step.probe} ${step.mark}`;
        copies.set(key, [...(copies.get(key) ?? []), { label: `${manifest.run}/${step.layer}`, file: join(runDir, canvas.name, canvas.files[step.layer]), box: step.box }]);
      }
    }
  }
  const out: Record<string, ProcreateRepeatVariation & { mark: string }> = {};
  for (const [key, list] of copies) {
    if (list.length < 2) continue;
    const crops = list.map(({ label, file, box }) => {
      const rgba = runFfmpeg(['-nostdin', '-v', 'error', '-i', file, '-vf', `crop=${box.width}:${box.height}:${box.x}:${box.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 26 });
      const alpha = new Uint8Array(box.width * box.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      return { label, width: box.width, height: box.height, alpha };
    });
    out[key] = { mark: key.split(' ').at(-1)!, ...measureProcreateRepeatVariation(crops) };
  }
  return out;
}
