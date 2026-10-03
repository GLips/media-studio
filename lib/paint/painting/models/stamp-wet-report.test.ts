import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPassageScope, StampWell } from './stamp-paint-recipe-types.ts';
import { assertStampWetEffects, stampWetReport, stampWetReportStrictFailures, stampWetReportWarnings } from './stamp-wet-report.ts';
import { compileStampWetness, stampDrying, stampPaintMedia } from './stamp-wetness.ts';
import { stampRoundTipsOf, stampRoundTipStatedProfile } from './stamp-tip-support.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampDrawnLine, stampGradedWash } from './stamp-technique-catalogue.ts';
import { stampBloom, stampCharge, stampBackrun } from './stamp-wet-techniques.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
  name: 'Round',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({}),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 1,
};
brush.profile = stampRoundTipStatedProfile(brush);
const medium = PAINT_MEDIA.watercolour;
const sky = { kind: 'polygon' as const, points: [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 360 }, { x: 40, y: 360 }] };

/** The wet report of one wash over a sky, painted by `body`, strict if `strict`. */
function reported(body: (wash: StampPassageScope) => void, strict?: boolean) {
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', { ...(strict && { strict }) }, (wash) => {
    wash.fill('sky', { brush, size: 40, application: { kind: 'flood' }, region: sky, well: { paint: { kind: 'color', color: '#4466aa' } } });
    body(wash);
  }))));
  return stampWetReport(painting, compileStampWetness(painting, stampPaintMedia(painting, () => medium), stampRoundTipsOf()));
}

test('a bloom into damp paint and a backrun along a junction act; the report gives their waits and the drying', () => {
  const report = reported((wash) => {
    stampBloom(wash, 'drop', { brush, size: 50, at: [{ x: 300, y: 200 }] });
    stampBackrun(wash, 'edge', { along: [{ x: 500, y: 100 }, { x: 600, y: 300 }], brush, size: 24 });
  });
  const [wash] = report.washes;
  assert.deepEqual(wash.effects.map(({ kind, id, mayActing }) => [kind, id, mayActing]), [['bloom', 'g/w/drop', 'all'], ['backrun', 'g/w/edge', 'all']]);
  const [drop] = wash.effects[0].touches;
  assert.ok(drop.bloom.mayAct && drop.finds.workable);
  assert.deepEqual(wash.waits.map(({ under, effect }) => [under, effect?.id]), [['deposits', 'g/w/drop'], ['deposits', 'g/w/edge']]);
  assert.equal(wash.dryings.length, 1);
  assert.equal(wash.dryings[0].closes, 'end');
  assert.doesNotThrow(() => assertStampWetEffects(report));
});

test("an operation's condition judges the paper under its own deposits, and one already past its target takes no time, said so", () => {
  const report = reported((wash) => {
    wash.stroke('far', { brush, size: 30, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }], well: { paint: { kind: 'color', color: '#224488' }, water: 1 }, when: 'shiny' });
    // Its water is the wettest paper now; under the near stroke, though, the sky is already past shiny.
    wash.stroke('near', { brush, size: 30, path: [{ x: 500, y: 300 }, { x: 600, y: 320 }], well: { paint: { kind: 'color', color: '#224488' } }, when: 'shiny' });
  });
  const [first, second] = report.washes[0].waits;
  assert.ok(first.seconds === 0 && first.alreadyDrier && first.judged > 0);
  assert.ok(second.seconds === 0 && second.alreadyDrier);
  const wholeWash = reported((wash) => {
    wash.stroke('far', { brush, size: 30, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }], well: { paint: { kind: 'color', color: '#224488' }, water: 1 } });
    wash.wait('shiny');
    wash.stroke('near', { brush, size: 30, path: [{ x: 500, y: 300 }, { x: 600, y: 320 }], well: { paint: { kind: 'color', color: '#224488' } } });
  }).washes[0].waits[0];
  const { rate } = stampDrying(medium.wetting, { color: '#ffffff' });
  assert.ok(Math.abs(wholeWash.seconds - (1 - medium.wetting.sheen.shiny) / rate) < 1e-6);
});

test("an effect that certainly won't act is warned of, with the bloom stage's reason, and the strict check throws", () => {
  // Dropped and charged once the sky has dried: nothing there is workable.
  const late = (wash: StampPassageScope) => {
    wash.wait('set');
    stampBloom(wash, 'late', { brush, size: 50, at: [{ x: 300, y: 200 }] });
    stampCharge(wash, 'late-charge', { placement: { kind: 'area', region: sky }, touches: 3, well: { paint: { kind: 'set', entries: [{ id: 'a', material: { kind: 'color', color: '#aa4422' }, weight: 1 }] } }, brush, size: [20, 20], length: [30, 30], when: 'damp' });
  };
  const report = reported(late);
  // A strict passage fails on them, and on the waits that judged paper with no water, which never was damp.
  assert.deepEqual(stampWetReportStrictFailures(report), []);
  const strict = stampWetReportStrictFailures(reported(late, true));
  assert.equal(strict.length, 4);
  // The bloom's damp is its own default, the charge's its author's: only the author's is warned of as doing nothing.
  assert.equal(strict[0], "stamp paint: g/w's wait until damp (for g/w/late) judged paper with no water: it was never damp");
  const warnings = stampWetReportWarnings(report);
  assert.deepEqual(warnings, [
    "stamp paint: g/w/late-charge's wait until damp does nothing: the paper under it held no water, so it was never damp",
    "stamp paint: g/w/late (bloom) won't bloom: the paint there has set (or the paper was dry)",
    "stamp paint: g/w/late-charge (charge) won't mingle: the paint under it had set",
  ]);
  assert.deepEqual(strict.slice(1), warnings);
  assert.throws(() => assertStampWetEffects(report), /3 wet warning\(s\)/);
});

test("the report's dryings are the wash's own, closed where the paper set, whatever the wait was written as", () => {
  const dryings = (wait: (wash: StampPassageScope) => void) => reported((wash) => {
    wait(wash);
    wash.stroke('late', { brush, size: 30, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }], well: { paint: { kind: 'color', color: '#224488' } } });
  }).washes[0].dryings.map(({ closes, deposits, rim }) => ({ closes, deposits, rim }));
  const whenSet = [{ closes: 'wait', deposits: 1, rim: 1 }, { closes: 'end', deposits: 1, rim: 1 }];
  assert.deepEqual(dryings((wash) => wash.wait('set')), whenSet);
  assert.deepEqual(dryings((wash) => wash.wait({ seconds: 3600 })), whenSet);
  assert.deepEqual(dryings((wash) => wash.wait({ seconds: 1 })), [{ closes: 'end', deposits: 2, rim: 1 }]);
});

test("an authored when that can't act is warned of, and strict fails on it; a technique's own default condition isn't", () => {
  const well: StampWell = { paint: { kind: 'color', color: '#aa4422' } };
  const touches = { placement: { kind: 'area' as const, region: sky }, touches: 3, well, brush, size: [20, 20] as const, length: [30, 30] as const };
  // A flood on dry paper lands at the brush's water, already no shinier than shiny: the condition waits 0 s.
  const inert = (wash: StampPassageScope) => stampCharge(wash, 'grey', { ...touches, when: 'shiny' });
  const [wait] = reported(inert).washes[0].waits;
  assert.ok(wait.seconds === 0 && wait.authored && wait.inert?.includes('already no wetter than shiny'));
  assert.deepEqual(stampWetReportWarnings(reported(inert)), [
    "stamp paint: g/w/grey's wait until shiny does nothing: the paper under it was already no wetter than shiny, so it waited 0 s; only paper wetter than that (prepared, or watered) waits",
  ]);
  assert.equal(stampWetReportStrictFailures(reported(inert, true)).length, 1);
  // Under paper wetter than shiny it waits, and nothing is said.
  assert.deepEqual(stampWetReportWarnings(reported((wash) => {
    wash.water('wet', { kind: 'fill', region: sky, brush, size: 40, amount: 1, application: { kind: 'flood' } });
    inert(wash);
  })), []);
  // A bloom's damp is its own default: on paper already damp it waits 0 s, and its effect's verdict is what counts.
  const late = reported((wash) => {
    wash.wait('damp');
    stampBloom(wash, 'drop', { brush, size: 50, at: [{ x: 300, y: 200 }] });
  });
  assert.ok(late.washes[0].waits[1].inert && !late.washes[0].waits[1].authored);
  assert.ok(!stampWetReportWarnings(late).some((line) => line.includes('does nothing')));
});

test("when: 'set' dries the whole passage before the operation, as wait('set') does, in any technique", () => {
  const line = [{ x: 100, y: 100 }, { x: 300, y: 140 }];
  const report = (body: (wash: StampPassageScope) => void) => {
    const { waits, dryings } = reported(body).washes[0];
    return { waits: waits.map(({ until, under, seconds }) => ({ until, under, seconds })), dryings: dryings.map(({ closes, at, deposits }) => ({ closes, at, deposits })) };
  };
  const waited = report((wash) => {
    wash.wait('set');
    stampDrawnLine(wash, 'gully', { path: line, brush, size: 12, well: { paint: { kind: 'color', color: '#223344' } } });
  });
  assert.equal(waited.waits[0].until, 'set');
  assert.deepEqual(report((wash) => stampDrawnLine(wash, 'gully', { path: line, brush, size: 12, well: { paint: { kind: 'color', color: '#223344' } }, when: 'set' })), waited);
  assert.deepEqual(report((wash) => stampGradedWash(wash, 'glaze', { region: sky, brush, size: 40, well: { paint: { kind: 'color', color: '#223344' } }, load: { along: [{ x: 0, y: 40 }, { x: 0, y: 360 }], from: 1, to: 0 }, when: 'set' })).waits[0].until, 'set');
});
