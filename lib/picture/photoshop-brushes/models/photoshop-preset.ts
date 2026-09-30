// photoshop-preset.ts: a Photoshop brush preset as the studio types it, derived from the one table of its fields that
// every path a preset takes reads by: the .abr reader (readPhotoshopPreset), the script that sets a probe on
// Photoshop's brush tool (photoshopPresetScript, applied by photoshop-capture.jsxinc's objToDesc), the read-back check
// (photoshopPresetMismatches) and the walk of its fields (photoshopPresetLeaves) that probed ranges are drawn over.
//
// Each field is a codec (PhotoshopPresetField) that reads, scripts, compares and lists itself, so the walkers only
// hand each field its part; PhotoshopPreset is the table's value type. A field has up to three names: its key in an
// .abr (a charID where Photoshop uses one), the stringID scripting and read-back name it by (the same typeID, so
// either writes it), and its path here. Units are Photoshop's own: pixels, degrees, and percent for most else.
//
// A group Photoshop switches off (Texture, Shape Dynamics, the dual…) is absent, not present and ignored: a preset
// keeps a disabled group's settings, which paint nothing. A value outside what the studio knows (a tip class, a
// control code, a mode, a tool) is kept as an `unsupported` case naming it, never passed off as a known one.

import { photoshopTagged, type PhotoshopDescriptor, type PhotoshopValue } from './photoshop-descriptor.ts';

// -- Modes, controls and tools --

/** Photoshop's blend modes: each .abr value and the stringID it scripts and reads back by. */
const PHOTOSHOP_BLEND_MODES = {
  Nrml: 'normal', Dslv: 'dissolve', Dstt: 'dissolve', Drkn: 'darken', Mltp: 'multiply', CBrn: 'colorBurn', linearBurn: 'linearBurn', darkerColor: 'darkerColor',
  Lghn: 'lighten', Scrn: 'screen', CDdg: 'colorDodge', linearDodge: 'linearDodge', lighterColor: 'lighterColor', Ovrl: 'overlay', SftL: 'softLight',
  HrdL: 'hardLight', vividLight: 'vividLight', linearLight: 'linearLight', pinLight: 'pinLight', hardMix: 'hardMix', Dfrn: 'difference', Xclu: 'exclusion',
  blendSubtraction: 'subtract', Sbtr: 'subtract', blendDivide: 'divide', 'H   ': 'hue', Strt: 'saturation', 'Clr ': 'color', Lmns: 'luminosity', Hght: 'height',
  linearHeight: 'linearHeight', Bhnd: 'behind', Clar: 'clear',
} as const;
export type PhotoshopBlendMode = (typeof PHOTOSHOP_BLEND_MODES)[keyof typeof PHOTOSHOP_BLEND_MODES];
const PHOTOSHOP_BLEND_MODE_BY_ABR: Readonly<Record<string, PhotoshopBlendMode | undefined>> = PHOTOSHOP_BLEND_MODES;
/** Every blend mode, once each: what a tool paints in. */
export const PHOTOSHOP_BLEND_MODE_IDS: readonly PhotoshopBlendMode[] = [...new Set(Object.values(PHOTOSHOP_BLEND_MODES))];

/** Photoshop's texture modes, by their stringIDs. */
export const PHOTOSHOP_TEXTURE_MODES = ['multiply', 'subtract', 'darken', 'overlay', 'colorDodge', 'colorBurn', 'linearBurn', 'hardMix', 'linearHeight', 'height'] as const satisfies readonly PhotoshopBlendMode[];
export type PhotoshopTextureMode = (typeof PHOTOSHOP_TEXTURE_MODES)[number];
/** Photoshop's dual brush modes, by their stringIDs. */
export const PHOTOSHOP_DUAL_MODES = ['multiply', 'darken', 'overlay', 'colorDodge', 'colorBurn', 'linearBurn', 'hardMix', 'linearHeight'] as const satisfies readonly PhotoshopBlendMode[];
export type PhotoshopDualMode = (typeof PHOTOSHOP_DUAL_MODES)[number];

/** A mode the field doesn't offer: the stringID the .abr names, or its own value when it names none Photoshop scripts. */
export type PhotoshopUnsupportedMode = { kind: 'unsupported'; mode: string };
/** A mode's name, as a script sets it and a leaf lists it. */
export const photoshopModeName = (mode: string | PhotoshopUnsupportedMode) => (typeof mode === 'string' ? mode : mode.mode);

/** What drives a dynamic, by Photoshop's `bVTy` codes in order. */
export const PHOTOSHOP_CONTROL_CODES = ['off', 'fade', 'penPressure', 'penTilt', 'stylusWheel', 'initialDirection', 'direction', 'rotation'] as const;

/**
 * What drives a dynamic. `minimum` (percent) is what it falls to, on the controls whose range it floors; a fade runs
 * over `steps` stamps; a direction sets an angle outright, with no minimum. Another code is `unsupported`.
 */
export type PhotoshopControl =
  | { kind: 'off' }
  | { kind: 'fade'; steps: number; minimum: number }
  | { kind: 'penPressure'; minimum: number }
  | { kind: 'penTilt'; minimum: number }
  | { kind: 'stylusWheel'; minimum: number }
  | { kind: 'initialDirection' }
  | { kind: 'direction' }
  | { kind: 'rotation'; minimum: number }
  | { kind: 'unsupported'; code: number };

/** A dynamic (`brVr`): its jitter (percent) and what drives it. */
export type PhotoshopDynamic = { control: PhotoshopControl; jitter: number };

/** The minimum a control falls to, 0 where it has none. */
export const photoshopControlMinimum = (control: PhotoshopControl) => ('minimum' in control ? control.minimum : 0);

/** The brush tools whose presets paint: brush, pencil and Mixer Brush, by class. */
export const PHOTOSHOP_TOOL_CLASSES = ['PbTl', 'PcTl', 'MixB'] as const;
export type PhotoshopToolKind = { kind: (typeof PHOTOSHOP_TOOL_CLASSES)[number] } | { kind: 'unsupported'; classId: string };

// -- A field as a codec --

/** A value in the script's JSON: tagged as photoshop-descriptor.ts tags an .abr's, with keys and ids prefixed. */
export type PhotoshopScriptValue = number | boolean | string | { _unit: string; value: number } | { _long: number } | { _enum: string; value: string } | PhotoshopScriptDescriptor;
export type PhotoshopScriptDescriptor = { _class?: string; [key: string]: PhotoshopScriptValue | undefined };
/** The brush tool's options as photoshop-actions.jsxinc's descToObj reads them back: by stringID, else charID. */
export type PhotoshopReadBack = Readonly<Record<string, unknown>>;
/** A field that takes effect, by its path here: a number, or a flag, code or mode as text. A group reads `on` or `off`. */
export type PhotoshopPresetLeaf = { path: string; value: number | string };

/**
 * One field of a preset, each walk of it given the descriptor that holds it (a group's fields sit in their switch's,
 * a nested field reads its own key in it). `path` is the field's own path here.
 */
export type PhotoshopPresetField<T> = {
  read(holder: PhotoshopDescriptor): T;
  script(value: T, holder: PhotoshopScriptDescriptor): void;
  /** Each way `holder`, read back, doesn't hold `value`, as "path: asked X, read Y". */
  mismatches(value: T, holder: PhotoshopReadBack, path: string, out: string[]): void;
  leaves(value: T, path: string, out: PhotoshopPresetLeaf[]): void;
};

type Fields = Readonly<Record<string, PhotoshopPresetField<unknown>>>;
type FieldValue<F> = F extends PhotoshopPresetField<infer T> ? T : never;
type OptionalKeys<F extends Fields> = { [K in keyof F]: undefined extends FieldValue<F[K]> ? K : never }[keyof F];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** A table's value: each field's own, a field that may be absent (a group switched off, an optional leaf) optional. */
export type PhotoshopPresetValue<F extends Fields> = Simplify<
  { [K in Exclude<keyof F, OptionalKeys<F>>]: FieldValue<F[K]> } & { [K in OptionalKeys<F>]?: Exclude<FieldValue<F[K]>, undefined> }
>;

/** A field's .abr key, and the stringID it goes by when that isn't the same. */
type Named = { key: string; id?: string };
/** A key as photoshop-capture.jsxinc's objToDesc takes it: `S:` a stringID, `C:` a charID. */
const scriptKey = ({ key, id }: Named) => (id ? `S:${id}` : key.length === 4 && key !== 'flow' ? `C:${key}` : `S:${key}`);
/** How descToObj names a key: its stringID, else its charID. */
const readKey = (named: Named) => scriptKey(named).slice(2);
const at = (path: string, name: string) => (path ? `${path}.${name}` : name);
const isRecord = (v: unknown): v is PhotoshopReadBack => !!v && typeof v === 'object' && !Array.isArray(v);
const isDescriptor = (v: PhotoshopValue | undefined): v is PhotoshopDescriptor => !!v && typeof v === 'object' && !Array.isArray(v) && '_class' in v;
const descriptorAt = (holder: PhotoshopDescriptor, key: string) => {
  const v = holder[key];
  return isDescriptor(v) ? v : undefined;
};
const readBackAt = (holder: PhotoshopReadBack, named: Named): PhotoshopReadBack => {
  const v = holder[readKey(named)];
  return isRecord(v) ? v : {};
};
/** A read-back number: descToObj gives a unit's as `{ value, unit }`. */
const readBackValue = (v: unknown) => (isRecord(v) && 'value' in v ? v.value : v);
function expect(out: string[], path: string, asked: unknown, got: unknown) {
  if (asked !== got) out.push(`${path}: asked ${JSON.stringify(asked)}, read ${JSON.stringify(got)}`);
}

// -- Leaves --

/** `identity`: a name or id, which says nothing of how a brush paints; `scripted: false`, not set on the tool by script. */
type LeafOptions = { id?: string; identity?: true; scripted?: false };

/**
 * A single value under `key`: `fallback` where the descriptor lacks it or holds another type (Photoshop's default),
 * or `undefined` for a leaf that may be absent.
 */
function photoshopLeaf<T extends number | boolean | string, F extends T | undefined>(
  key: string, fallback: F, options: LeafOptions, readRaw: (v: PhotoshopValue) => T | undefined, scriptRaw: (v: T) => PhotoshopScriptValue,
): PhotoshopPresetField<T | F> {
  const named = { key, id: options.id };
  return {
    read: (holder) => {
      const v = holder[key];
      return (v === undefined ? undefined : readRaw(v)) ?? fallback;
    },
    script(value, holder) {
      if (value !== undefined && options.scripted !== false) holder[scriptKey(named)] = scriptRaw(value);
    },
    mismatches(value, holder, path, out) {
      if (value !== undefined && options.scripted !== false && !options.identity) expect(out, path, value, readBackValue(holder[readKey(named)]));
    },
    leaves(value, path, out) {
      if (value !== undefined && !options.identity) out.push({ path, value: typeof value === 'number' ? value : String(value) });
    },
  };
}

function readNumber(v: PhotoshopValue): number | undefined {
  if (typeof v === 'number') return v;
  const tagged = photoshopTagged(v);
  if (tagged && '_unit' in tagged) return tagged.value;
  if (tagged && '_long' in tagged) return tagged._long;
  return undefined;
}

const UNIT_TAGS = { percent: '#Prc', pixels: '#Pxl', angle: '#Ang' } as const;
const unitLeaf = (unit: keyof typeof UNIT_TAGS) => <F extends number | undefined>(key: string, fallback: F, options: LeafOptions = {}) =>
  photoshopLeaf(key, fallback, options, readNumber, (value: number) => ({ _unit: UNIT_TAGS[unit], value }));
const percent = unitLeaf('percent'), pixels = unitLeaf('pixels'), angle = unitLeaf('angle');
/** A 32-bit integer (`long`). */
const integer = <F extends number | undefined>(key: string, fallback: F, options: LeafOptions = {}) => photoshopLeaf(key, fallback, options, readNumber, (value: number) => ({ _long: value }));
/** A double, which Photoshop keeps apart from an integer. */
const double = <F extends number | undefined>(key: string, fallback: F, options: LeafOptions = {}) => photoshopLeaf(key, fallback, options, readNumber, (value: number) => value);
const flag = <F extends boolean | undefined>(key: string, fallback: F, options: LeafOptions = {}) => photoshopLeaf(key, fallback, options, (v) => v === true, (value: boolean) => value);
const text = <F extends string | undefined>(key: string, fallback: F, options: LeafOptions = {}) =>
  photoshopLeaf(key, fallback, options, (v) => (typeof v === 'string' ? v : undefined), (value: string) => value);

/** A blend mode out of `modes`; any other the .abr gives is `unsupported`. */
function photoshopMode<M extends PhotoshopBlendMode>(named: Named, modes: readonly M[], fallback: M): PhotoshopPresetField<M | PhotoshopUnsupportedMode> {
  const type = { key: 'BlnM', id: 'blendMode' };
  return {
    read(holder) {
      const tagged = photoshopTagged(holder[named.key]);
      if (!tagged || !('_enum' in tagged)) return fallback;
      const id = PHOTOSHOP_BLEND_MODE_BY_ABR[tagged.value];
      return modes.find((mode) => mode === id) ?? { kind: 'unsupported', mode: id ?? tagged.value };
    },
    script: (value, holder) => void (holder[scriptKey(named)] = { _enum: scriptKey(type), value: `S:${photoshopModeName(value)}` }),
    mismatches: (value, holder, path, out) => expect(out, path, photoshopModeName(value), holder[readKey(named)]),
    leaves: (value, path, out) => void out.push({ path, value: photoshopModeName(value) }),
  };
}

// -- Records, groups and nested descriptors --

/** Fields that sit side by side in one descriptor, walked in the table's order. */
function photoshopRecord<F extends Fields>(fields: F): PhotoshopPresetField<PhotoshopPresetValue<F>> {
  const entries = Object.entries(fields);
  return {
    read(holder) {
      const value: Record<string, unknown> = {};
      for (const [name, field] of entries) {
        const v = field.read(holder);
        if (v !== undefined) value[name] = v;
      }
      // The table's one cast: each key holds its own field's read, which is what PhotoshopPresetValue says, but
      // TypeScript can't follow a record built key by key.
      return value as PhotoshopPresetValue<F>;
    },
    script(value, holder) {
      const values: PhotoshopReadBack = value;
      for (const [name, field] of entries) field.script(values[name], holder);
    },
    mismatches(value, holder, path, out) {
      const values: PhotoshopReadBack = value;
      for (const [name, field] of entries) field.mismatches(values[name], holder, at(path, name), out);
    },
    leaves(value, path, out) {
      const values: PhotoshopReadBack = value;
      for (const [name, field] of entries) field.leaves(values[name], at(path, name), out);
    },
  };
}

/** Fields in the same descriptor as their switch, present when it's on; a leaf reads the group `on` or `off`. */
function photoshopGroup<F extends Fields>(switchKey: string, fields: F): PhotoshopPresetField<PhotoshopPresetValue<F> | undefined> {
  const record = photoshopRecord(fields), named = { key: switchKey };
  return {
    read: (holder) => (holder[switchKey] === true ? record.read(holder) : undefined),
    script(value, holder) {
      holder[scriptKey(named)] = value !== undefined;
      if (value !== undefined) record.script(value, holder);
    },
    mismatches(value, holder, path, out) {
      expect(out, path, value !== undefined, holder[readKey(named)]);
      if (value !== undefined) record.mismatches(value, holder, path, out);
    },
    leaves(value, path, out) {
      out.push({ path, value: value === undefined ? 'off' : 'on' });
      if (value !== undefined) record.leaves(value, path, out);
    },
  };
}

/** A group Photoshop holds on whatever its switch says: always read, and scripted on. */
function photoshopAlwaysOnGroup<F extends Fields>(switchKey: string, fields: F): PhotoshopPresetField<PhotoshopPresetValue<F>> {
  const record = photoshopRecord(fields), named = { key: switchKey };
  return {
    read: (holder) => record.read(holder),
    script(value, holder) {
      holder[scriptKey(named)] = true;
      record.script(value, holder);
    },
    mismatches(value, holder, path, out) {
      expect(out, path, true, holder[readKey(named)]);
      record.mismatches(value, holder, path, out);
    },
    leaves: (value, path, out) => record.leaves(value, path, out),
  };
}

/** `inner` in a descriptor of class `cls` under `named`; what lacks one reads as that class's defaults. */
function photoshopNested<T>(named: Named, cls: Named, inner: PhotoshopPresetField<T>): PhotoshopPresetField<T> {
  return {
    read: (holder) => inner.read(descriptorAt(holder, named.key) ?? { _class: cls.key }),
    script(value, holder) {
      const d: PhotoshopScriptDescriptor = { _class: scriptKey(cls) };
      inner.script(value, d);
      holder[scriptKey(named)] = d;
    },
    mismatches: (value, holder, path, out) => inner.mismatches(value, readBackAt(holder, named), path, out),
    leaves: (value, path, out) => inner.leaves(value, path, out),
  };
}

/** As photoshopNested, absent where the descriptor lacks it. */
function photoshopOptionalNested<T>(named: Named, cls: Named, inner: PhotoshopPresetField<T>): PhotoshopPresetField<T | undefined> {
  const nested = photoshopNested(named, cls, inner);
  return {
    read: (holder) => (descriptorAt(holder, named.key) ? nested.read(holder) : undefined),
    script: (value, holder) => value !== undefined && nested.script(value, holder),
    mismatches: (value, holder, path, out) => value !== undefined && nested.mismatches(value, holder, path, out),
    leaves: (value, path, out) => value !== undefined && nested.leaves(value, path, out),
  };
}

/** As photoshopNested, present when `switchKey` in it is on; a script always writes it, switched off when absent. */
function photoshopSwitchedNested<T>(named: Named, cls: Named, switchKey: string, inner: PhotoshopPresetField<T>): PhotoshopPresetField<T | undefined> {
  const switched = { key: switchKey };
  return {
    read(holder) {
      const d = descriptorAt(holder, named.key);
      return d?.[switchKey] === true ? inner.read(d) : undefined;
    },
    script(value, holder) {
      const d: PhotoshopScriptDescriptor = { _class: scriptKey(cls), [scriptKey(switched)]: value !== undefined };
      if (value !== undefined) inner.script(value, d);
      holder[scriptKey(named)] = d;
    },
    mismatches(value, holder, path, out) {
      const got = readBackAt(holder, named);
      expect(out, path, value !== undefined, got[readKey(switched)]);
      if (value !== undefined) inner.mismatches(value, got, path, out);
    },
    leaves(value, path, out) {
      out.push({ path, value: value === undefined ? 'off' : 'on' });
      if (value !== undefined) inner.leaves(value, path, out);
    },
  };
}

// -- Dynamics --

const CONTROL_CODE = integer('bVTy', 0), FADE_STEPS = integer('fStp', 25), CONTROL_MINIMUM = percent('Mnm ', 0, { id: 'minimum' }), JITTER = percent('jitter', 0);

function readControl(d: PhotoshopDescriptor): PhotoshopControl {
  const code = CONTROL_CODE.read(d), minimum = CONTROL_MINIMUM.read(d);
  const kind: (typeof PHOTOSHOP_CONTROL_CODES)[number] | undefined = PHOTOSHOP_CONTROL_CODES[code];
  switch (kind) {
    case 'off': return { kind };
    case 'fade': return { kind, steps: FADE_STEPS.read(d), minimum };
    case 'penPressure': case 'penTilt': case 'stylusWheel': case 'rotation': return { kind, minimum };
    case 'initialDirection': case 'direction': return { kind };
    case undefined: return { kind: 'unsupported', code };
  }
}

const controlCode = (control: PhotoshopControl) => (control.kind === 'unsupported' ? control.code : PHOTOSHOP_CONTROL_CODES.indexOf(control.kind));

/**
 * A dynamic in its `brVr`. A script sets every key a `brVr` holds, a fade's steps and the minimum at Photoshop's
 * defaults (25, 0) where the control has none; only what the control uses is compared or listed.
 */
const DYNAMIC: PhotoshopPresetField<PhotoshopDynamic> = {
  read: (d) => ({ control: readControl(d), jitter: JITTER.read(d) }),
  script({ control, jitter }, d) {
    CONTROL_CODE.script(controlCode(control), d);
    FADE_STEPS.script(control.kind === 'fade' ? control.steps : 25, d);
    JITTER.script(jitter, d);
    CONTROL_MINIMUM.script(photoshopControlMinimum(control), d);
  },
  mismatches({ control, jitter }, d, path, out) {
    CONTROL_CODE.mismatches(controlCode(control), d, at(path, 'control'), out);
    if (control.kind === 'fade') FADE_STEPS.mismatches(control.steps, d, at(path, 'control.steps'), out);
    if ('minimum' in control) CONTROL_MINIMUM.mismatches(control.minimum, d, at(path, 'control.minimum'), out);
    JITTER.mismatches(jitter, d, at(path, 'jitter'), out);
  },
  leaves({ control, jitter }, path, out) {
    out.push({ path: at(path, 'control'), value: control.kind === 'unsupported' ? `code ${control.code}` : control.kind });
    if (control.kind === 'fade') out.push({ path: at(path, 'control.steps'), value: control.steps });
    if ('minimum' in control) out.push({ path: at(path, 'control.minimum'), value: control.minimum });
    out.push({ path: at(path, 'jitter'), value: jitter });
  },
};
const BRUSH_VARIATION = { key: 'brVr' };
const dynamic = (key: string) => photoshopNested({ key }, BRUSH_VARIATION, DYNAMIC);
const optionalDynamic = (key: string) => photoshopOptionalNested({ key }, BRUSH_VARIATION, DYNAMIC);

// -- Tips --

// Photoshop lists a tip's diameter, then its own settings, then the rest of its geometry; a script keeps that order.
const TIP_DIAMETER = photoshopRecord({ diameter: pixels('Dmtr', 100, { id: 'diameter' }) });
const TIP_PLACEMENT = photoshopRecord({
  angle: angle('Angl', 0, { id: 'angle' }), roundness: percent('Rndn', 100, { id: 'roundness' }), spacing: percent('Spcn', 25, { id: 'spacing' }),
  /** Spacing on; off stamps once per pointer event. */
  spaced: flag('Intr', false, { id: 'interfaceIconFrameDimmed' }),
  flipX: flag('flipX', false), flipY: flag('flipY', false),
});
export type PhotoshopTipGeometry = FieldValue<typeof TIP_DIAMETER> & FieldValue<typeof TIP_PLACEMENT>;

const COMPUTED_TIP = photoshopRecord({ hardness: percent('Hrdn', 100, { id: 'hardness' }) });
/** A sample, by its id in the file (the .abr's `samp`), which a script can't set: the rig selects it by name. */
const SAMPLED_TIP = photoshopRecord({ sample: text('sampledData', '', { identity: true, scripted: false }) });
// Bristle, erodible and airbrush tips are read, not yet painted (vid-105) nor scripted onto Photoshop by the rig. Their
// fallbacks are only for a descriptor lacking a key, which no .abr at hand does. A bristle tip's sizes are fractions
// (1.42 is 142%), though tagged percent.
const BRISTLE_TIP = photoshopRecord({
  shape: integer('Shp ', 0), density: percent('Dnst', 0.5), length: percent('Lngt', 1), clumping: percent('clumping', 0.25), thickness: percent('thickness', 0.5),
  stiffness: percent('stiffness', 0.5), physics: flag('physics', true),
});
/** `dtipsType` tells the two `dTips` apart: 0 erodible, 1 airbrush. */
const DTIPS_TYPE = integer('dtipsType', 0);
// An erodible tip also holds the airbrush's settings, at their defaults, which it doesn't use. Its height map
// (`dtipsErodibleTipHeightMap`, gridSize² floats) is kept apart, as an asset of the pack (import-photoshop-pack.ts).
const ERODIBLE_TIP = photoshopRecord({
  shape: integer('Shp ', 0), simulatedHardness: percent('dtipsHardness', 100), lengthRatio: percent('dtipsLengthRatio', 100), gridSize: integer('dtipsGridSize', 11),
  customized: flag('dtipsErodibleTipCustomized', false), physics: flag('physics', true),
});
const AIRBRUSH_TIP = photoshopRecord({
  shape: integer('Shp ', 5), simulatedHardness: percent('dtipsHardness', 100), lengthRatio: percent('dtipsLengthRatio', 100), cutoffAngle: double('dtipsAirbrushCutoffAngle', 15),
  granularity: percent('dtipsAirbrushGranularity', 0), streakiness: percent('dtipsAirbrushStreakiness', 1), splatSize: percent('dtipsAirbrushSplatSize', 1),
  splatCount: integer('dtipsAirbrushSplatCount', 100), physics: flag('physics', true),
});

type Tip<K extends string, F extends PhotoshopPresetField<unknown>> = Simplify<{ kind: K; geometry: PhotoshopTipGeometry } & FieldValue<F>>;
/** A computed round tip, a sample, or a tip Photoshop simulates as it paints; another class is `unsupported`. */
export type PhotoshopPresetTip =
  | Tip<'computed', typeof COMPUTED_TIP>
  | Tip<'sampled', typeof SAMPLED_TIP>
  | Tip<'bristle', typeof BRISTLE_TIP>
  | Tip<'erodible', typeof ERODIBLE_TIP>
  | Tip<'airbrush', typeof AIRBRUSH_TIP>
  | { kind: 'unsupported'; classId: string };
export type PhotoshopKnownTip = Exclude<PhotoshopPresetTip, { kind: 'unsupported' }>;

function readTip(d: PhotoshopDescriptor): PhotoshopPresetTip {
  const geometry = { ...TIP_DIAMETER.read(d), ...TIP_PLACEMENT.read(d) };
  switch (d._class) {
    case 'computedBrush': return { kind: 'computed', geometry, ...COMPUTED_TIP.read(d) };
    case 'sampledBrush': return { kind: 'sampled', geometry, ...SAMPLED_TIP.read(d) };
    case 'dBrush': return { kind: 'bristle', geometry, ...BRISTLE_TIP.read(d) };
    case 'dTips': {
      const type = DTIPS_TYPE.read(d);
      if (type === 0) return { kind: 'erodible', geometry, ...ERODIBLE_TIP.read(d) };
      // A dTips of another type is unsupported by its class, the type being the class's own switch.
      if (type === 1) return { kind: 'airbrush', geometry, ...AIRBRUSH_TIP.read(d) };
    }
  }
  return { kind: 'unsupported', classId: d._class };
}

/** A known tip's class, and its own settings bound to their fields. */
function tipParts(tip: PhotoshopKnownTip) {
  const bind = <V>(classId: string, own: PhotoshopPresetField<V>, value: V, dtipsType?: number) => ({
    classId,
    script(d: PhotoshopScriptDescriptor) {
      if (dtipsType !== undefined) DTIPS_TYPE.script(dtipsType, d);
      TIP_DIAMETER.script(tip.geometry, d);
      own.script(value, d);
      TIP_PLACEMENT.script(tip.geometry, d);
    },
    mismatches(d: PhotoshopReadBack, path: string, out: string[]) {
      TIP_DIAMETER.mismatches(tip.geometry, d, at(path, 'geometry'), out);
      own.mismatches(value, d, path, out);
      TIP_PLACEMENT.mismatches(tip.geometry, d, at(path, 'geometry'), out);
    },
    leaves(path: string, out: PhotoshopPresetLeaf[]) {
      TIP_DIAMETER.leaves(tip.geometry, at(path, 'geometry'), out);
      own.leaves(value, path, out);
      TIP_PLACEMENT.leaves(tip.geometry, at(path, 'geometry'), out);
    },
  });
  switch (tip.kind) {
    case 'computed': return bind('computedBrush', COMPUTED_TIP, tip);
    case 'sampled': return bind('sampledBrush', SAMPLED_TIP, tip);
    case 'bristle': return bind('dBrush', BRISTLE_TIP, tip);
    case 'erodible': return bind('dTips', ERODIBLE_TIP, tip, 0);
    case 'airbrush': return bind('dTips', AIRBRUSH_TIP, tip, 1);
  }
}

const TIP_KEY: Named = { key: 'Brsh', id: 'brush' };
/** A preset's tip, its class by its kind; a preset without one reads as a computed tip of Photoshop's defaults. */
const PHOTOSHOP_TIP: PhotoshopPresetField<PhotoshopPresetTip> = {
  read: (holder) => readTip(descriptorAt(holder, TIP_KEY.key) ?? { _class: 'computedBrush' }),
  script(tip, holder) {
    if (tip.kind === 'unsupported') throw new Error(`photoshop: a ${tip.classId} tip, a class the studio doesn't read, can't be scripted`);
    const parts = tipParts(tip), d: PhotoshopScriptDescriptor = { _class: `S:${parts.classId}` };
    parts.script(d);
    holder[scriptKey(TIP_KEY)] = d;
  },
  mismatches(tip, holder, path, out) {
    const got = readBackAt(holder, TIP_KEY);
    if (tip.kind === 'unsupported') return expect(out, at(path, 'kind'), tip.classId, got._class);
    const parts = tipParts(tip);
    expect(out, at(path, 'kind'), parts.classId, got._class);
    parts.mismatches(got, path, out);
  },
  leaves(tip, path, out) {
    out.push({ path: at(path, 'kind'), value: tip.kind === 'unsupported' ? tip.classId : tip.kind });
    if (tip.kind !== 'unsupported') tipParts(tip).leaves(path, out);
  },
};

// -- The tool --

const TOOL_OPTIONS = photoshopRecord({
  mode: photoshopMode({ key: 'Md  ', id: 'mode' }, PHOTOSHOP_BLEND_MODE_IDS, 'normal'), opacity: integer('Opct', 100, { id: 'opacity' }), flow: integer('flow', undefined),
  /** The tool's own dynamics, which a tool preset keeps beside the brush's. */
  sizeDynamics: optionalDynamic('szVr'), opacityDynamics: optionalDynamic('opVr'), flowDynamics: optionalDynamic('prVr'),
  pressureOverridesSize: flag('usePressureOverridesSize', undefined), pressureOverridesOpacity: flag('usePressureOverridesOpacity', undefined),
  /** The Mixer Brush's. */
  dryness: percent('dryness', undefined), wetness: percent('wetness', undefined), mix: percent('mix', undefined),
  sampleAllLayers: flag('sampleAllLayers', undefined), autoFill: flag('autoFill', undefined), autoClean: flag('autoClean', undefined),
});
export type PhotoshopToolOptions = PhotoshopToolKind & FieldValue<typeof TOOL_OPTIONS>;

/**
 * A tool preset's tool options, which a brush preset lacks. A script sets them among the brush's, as the tool holds
 * them; its class isn't scripted, the rig's tool being the brush.
 */
const PHOTOSHOP_TOOL: PhotoshopPresetField<PhotoshopToolOptions | undefined> = {
  read(holder) {
    const d = descriptorAt(holder, 'toolOptions');
    if (!d) return undefined;
    const known = PHOTOSHOP_TOOL_CLASSES.find((cls) => cls === d._class);
    const kind: PhotoshopToolKind = known ? { kind: known } : { kind: 'unsupported', classId: d._class };
    return { ...kind, ...TOOL_OPTIONS.read(d) };
  },
  script: (tool, holder) => tool && TOOL_OPTIONS.script(tool, holder),
  mismatches: (tool, holder, path, out) => tool && TOOL_OPTIONS.mismatches(tool, holder, path, out),
  leaves(tool, path, out) {
    if (!tool) return;
    out.push({ path: at(path, 'kind'), value: tool.kind === 'unsupported' ? tool.classId : tool.kind });
    TOOL_OPTIONS.leaves(tool, path, out);
  },
};

// -- The preset --

const SCATTER_FIELDS = {
  scatter: dynamic('scatterDynamics'), bothAxes: flag('bothAxes', false), count: integer('Cnt ', 1, { id: 'count' }), countDynamics: dynamic('countDynamics'),
};

/** Every field of a preset, in the order a script sets them. */
export const PHOTOSHOP_PRESET_FIELDS = {
  name: text('Nm  ', undefined, { id: 'name', identity: true, scripted: false }),
  tip: PHOTOSHOP_TIP,
  tipDynamics: photoshopGroup('useTipDynamics', {
    size: dynamic('szVr'), minimumDiameter: percent('minimumDiameter', 0), angle: dynamic('angleDynamics'),
    roundness: dynamic('roundnessDynamics'), minimumRoundness: percent('minimumRoundness', 0),
    flipX: flag('flipX', false), flipY: flag('flipY', false), projection: flag('brushProjection', false),
  }),
  scatter: photoshopGroup('useScatter', SCATTER_FIELDS),
  transfer: photoshopGroup('usePaintDynamics', { opacity: dynamic('opVr'), flow: dynamic('prVr') }),
  texture: photoshopGroup('useTexture', {
    /** Its pattern, by name and id; absent in a preset that points at none. */
    pattern: photoshopOptionalNested({ key: 'Txtr', id: 'texture' }, { key: 'Ptrn', id: 'pattern' }, photoshopRecord({
      name: text('Nm  ', '', { id: 'name', identity: true }), id: text('Idnt', undefined, { identity: true, scripted: false }),
    })),
    scale: percent('textureScale', 100), brightness: integer('textureBrightness', 0), contrast: integer('textureContrast', 0),
    mode: photoshopMode({ key: 'textureBlendMode', id: 'textureBlendMode' }, PHOTOSHOP_TEXTURE_MODES, 'multiply'),
    depth: percent('textureDepth', 100), eachTip: flag('TxtC', false, { id: 'textClickPoint' }), invert: flag('InvT', false, { id: 'invertTexture' }),
    depthDynamics: dynamic('textureDepthDynamics'), minimumDepth: percent('minimumDepth', 0), protect: flag('protectTexture', false),
  }),
  color: photoshopGroup('useColorDynamics', {
    swing: dynamic('clVr'), hue: percent('H   ', 0), saturation: percent('Strt', 0), brightness: percent('Brgh', 0), purity: percent('purity', 0),
    perTip: flag('colorDynamicsPerTip', true),
  }),
  dual: photoshopSwitchedNested({ key: 'dualBrush' }, { key: 'dualBrush' }, 'useDualBrush', photoshopRecord({
    mode: photoshopMode({ key: 'BlnM', id: 'blendMode' }, PHOTOSHOP_DUAL_MODES, 'multiply'), flip: flag('Flip', false, { id: 'flip' }), tip: PHOTOSHOP_TIP,
    // The dual pane has no Scatter switch: Photoshop reads it back on whatever a script sets, and every .abr holds it on.
    scatter: photoshopAlwaysOnGroup('useScatter', SCATTER_FIELDS),
  })),
  wetEdges: flag('Wtdg', false, { id: 'wetEdges' }),
  noise: flag('Nose', false, { id: 'noise' }),
  buildUp: flag('Rpt ', false, { id: 'repeat' }),
  pose: photoshopGroup('useBrushPose', { overridePressure: flag('overridePosePressure', false), pressure: percent('brushPosePressure', 0) }),
  tool: PHOTOSHOP_TOOL,
};

export type PhotoshopPreset = PhotoshopPresetValue<typeof PHOTOSHOP_PRESET_FIELDS>;
export type PhotoshopScatter = NonNullable<PhotoshopPreset['scatter']>;
/** A preset whose own tip the studio reads, the only kind an import keeps. */
export type PhotoshopPaintablePreset = Omit<PhotoshopPreset, 'tip'> & { tip: PhotoshopKnownTip };

/** `preset` with its tip known, or nothing when its tip is a class the studio doesn't read. */
export function photoshopPaintablePreset(preset: PhotoshopPreset): PhotoshopPaintablePreset | undefined {
  const { tip } = preset;
  return tip.kind === 'unsupported' ? undefined : { ...preset, tip };
}

const PHOTOSHOP_PRESET = photoshopRecord(PHOTOSHOP_PRESET_FIELDS);

/** An .abr's or .tpl's `brushPreset` descriptor, typed; what it lacks is Photoshop's default. */
export const readPhotoshopPreset = (d: PhotoshopDescriptor): PhotoshopPreset => PHOTOSHOP_PRESET.read(d);

/**
 * `preset` as the brush tool's options, for photoshop-capture.jsxinc to set: every field it holds, and each group it
 * lacks switched off. A tool preset's own options (opacity, flow, mode) sit among the rest, as the tool holds them.
 */
export function photoshopPresetScript(preset: PhotoshopPreset): PhotoshopScriptDescriptor {
  const out: PhotoshopScriptDescriptor = {};
  PHOTOSHOP_PRESET.script(preset, out);
  return out;
}

/**
 * Each field `preset` sets that `applied` (the tool's options, read back by descToObj) doesn't hold, as "path: asked
 * X, read Y": Photoshop takes a key it doesn't understand without complaint. Names and ids aren't compared.
 */
export function photoshopPresetMismatches(preset: PhotoshopPreset, applied: PhotoshopReadBack): string[] {
  const out: string[] = [];
  PHOTOSHOP_PRESET.mismatches(preset, applied, '', out);
  return out;
}

/** Each field of `preset` that takes effect; names and ids are left out. */
export function photoshopPresetLeaves(preset: PhotoshopPreset): PhotoshopPresetLeaf[] {
  const out: PhotoshopPresetLeaf[] = [];
  PHOTOSHOP_PRESET.leaves(preset, '', out);
  return out;
}
