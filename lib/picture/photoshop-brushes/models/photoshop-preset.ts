// photoshop-preset.ts: a Photoshop brush preset as the studio types it, and the one table of its fields that every
// path a preset takes reads by: the .abr reader (readPhotoshopPreset), the script that sets a probe on Photoshop's
// brush tool (photoshopPresetScript, applied by photoshop-capture.jsxinc's objToDesc), the read-back check
// (photoshopPresetMismatches) and the walk of its fields (photoshopPresetLeaves) that probed ranges are drawn over.
//
// A field has up to three names: its key in an .abr (a charID where Photoshop uses one), the stringID scripting and
// read-back name it by (the same typeID, so either writes it), and its path here. Units are Photoshop's own: pixels,
// degrees, and percent for most else.
//
// A group Photoshop switches off (Texture, Shape Dynamics, the dual…) is absent, not present and ignored: a preset
// keeps a disabled group's settings, which paint nothing.

import { photoshopTagged, type PhotoshopDescriptor, type PhotoshopValue } from './photoshop-descriptor.ts';

/** What drives a dynamic, by Photoshop's `bVTy` codes in order. */
export const PHOTOSHOP_CONTROLS = ['off', 'fade', 'penPressure', 'penTilt', 'stylusWheel', 'initialDirection', 'direction', 'rotation'] as const;
export type PhotoshopControlKind = (typeof PHOTOSHOP_CONTROLS)[number];

/** A dynamic (`brVr`): its jitter, what drives it, the minimum it falls to (with a control) and a fade's steps (under a fade). */
export type PhotoshopDynamic = { control: PhotoshopControlKind; fadeSteps: number; jitter: number; minimum: number };

export type PhotoshopPresetTip = {
  /** Computed round, sampled, or simulated as it paints (erodible or airbrush, bristle). */
  kind: 'computed' | 'sampled' | 'erodible' | 'bristle';
  /** A sampled tip's sample, by its id in the file. */
  sampledData?: string;
  diameter: number;
  /** A computed tip's hardness; an erodible or airbrush tip's is `simulatedHardness`. */
  hardness?: number;
  simulatedHardness?: number;
  angle: number;
  roundness: number;
  spacing: number;
  /** Spacing on; off stamps once per pointer event. */
  spaced: boolean;
  flipX: boolean;
  flipY: boolean;
};

export type PhotoshopScatter = { scatter: PhotoshopDynamic; bothAxes: boolean; count: number; countDynamics: PhotoshopDynamic };

export type PhotoshopPreset = {
  name?: string;
  tip: PhotoshopPresetTip;
  tipDynamics?: {
    size: PhotoshopDynamic; minimumDiameter: number; angle: PhotoshopDynamic; roundness: PhotoshopDynamic; minimumRoundness: number;
    flipX: boolean; flipY: boolean; projection: boolean;
  };
  scatter?: PhotoshopScatter;
  texture?: {
    /** Its pattern, by name and id; absent in a preset that points at none. */
    pattern?: { name: string; id?: string };
    scale: number; brightness: number; contrast: number;
    /** A blend mode's stringID (`multiply`), or the .abr's own value when it names none Photoshop scripts. */
    mode: string;
    depth: number; eachTip: boolean; invert: boolean; depthDynamics: PhotoshopDynamic; minimumDepth: number; protect: boolean;
  };
  transfer?: { opacity: PhotoshopDynamic; flow: PhotoshopDynamic };
  color?: { swing: PhotoshopDynamic; hue: number; saturation: number; brightness: number; purity: number; perTip: boolean };
  dual?: { mode: string; flip: boolean; tip: PhotoshopPresetTip; scatter: PhotoshopScatter };
  wetEdges: boolean;
  noise: boolean;
  buildUp: boolean;
  pose?: { overridePressure: boolean; pressure: number };
  /** A tool preset's tool options; a brush preset has none. */
  tool?: {
    /** The tool's class: `PbTl` brush, `PcTl` pencil, `MixB` Mixer Brush, or another tool's. */
    kind: string;
    mode: string; opacity: number; flow?: number;
    /** The tool's own dynamics, which a tool preset keeps beside the brush's. */
    sizeDynamics?: PhotoshopDynamic; opacityDynamics?: PhotoshopDynamic; flowDynamics?: PhotoshopDynamic;
    pressureOverridesSize?: boolean; pressureOverridesOpacity?: boolean;
    /** The Mixer Brush's. */
    dryness?: number; wetness?: number; mix?: number; sampleAllLayers?: boolean; autoFill?: boolean; autoClean?: boolean;
  };
};

/** Photoshop's blend modes: each .abr value and the stringID it scripts and reads back by. */
const PHOTOSHOP_BLEND_MODES: Readonly<Record<string, string>> = {
  Nrml: 'normal', Dslv: 'dissolve', Dstt: 'dissolve', Drkn: 'darken', Mltp: 'multiply', CBrn: 'colorBurn', linearBurn: 'linearBurn', darkerColor: 'darkerColor',
  Lghn: 'lighten', Scrn: 'screen', CDdg: 'colorDodge', linearDodge: 'linearDodge', lighterColor: 'lighterColor', Ovrl: 'overlay', SftL: 'softLight',
  HrdL: 'hardLight', vividLight: 'vividLight', linearLight: 'linearLight', pinLight: 'pinLight', hardMix: 'hardMix', Dfrn: 'difference', Xclu: 'exclusion',
  blendSubtraction: 'subtract', Sbtr: 'subtract', blendDivide: 'divide', 'H   ': 'hue', Strt: 'saturation', 'Clr ': 'color', Lmns: 'luminosity', Hght: 'height',
  linearHeight: 'linearHeight', Bhnd: 'behind', Clar: 'clear',
};

type Unit = 'percent' | 'pixels' | 'angle' | 'integer' | 'double' | 'flag' | 'text';
const UNIT_TAGS: Partial<Record<Unit, string>> = { percent: '#Prc', pixels: '#Pxl', angle: '#Ang' };

/** A field's .abr key, and the stringID it goes by when that isn't the same. */
type Named = { key: string; id?: string };
/** `identity`: a name or id, which says nothing of how a brush paints; `scripted: false`, not set on the tool by script. */
type Leaf = Named & {
  unit: Unit; fallback?: number | boolean | string; optional?: true; identity?: true; scripted?: false;
  /** Whether it takes effect, given its neighbours, when not always. */
  counts?: (within: Record<string, unknown>) => boolean;
};
type Coded = Named & { codes: readonly string[]; fallback: string };
type Enumerated = Named & { type: Named; values: Readonly<Record<string, string>>; fallback: string };
/** A descriptor held under a key; `switch` in it turns it on (absent when off); `kinds` names its class by its `kind`. */
type Nested = Named & { class: Named; kinds?: Readonly<Record<string, string>>; fields: Fields; switch?: Named; optional?: true; flatInScript?: true };
/** Fields in the same descriptor as their switch, present when it's on; `alwaysOn` when Photoshop holds it on. */
type Group = { switch: Named; fields: Fields; alwaysOn?: true };
type Field = ({ leaf: Leaf } | { coded: Coded } | { enumerated: Enumerated } | { nested: Nested } | { group: Group });
type Fields = Readonly<Record<string, Field>>;

const leaf = (key: string, unit: Unit, more: Omit<Leaf, 'key' | 'unit'> = {}): Field => ({ leaf: { key, unit, ...more } });
const blendMode = (key: string, id: string, fallback: string): Field => ({ enumerated: { key, id, type: { key: 'BlnM', id: 'blendMode' }, values: PHOTOSHOP_BLEND_MODES, fallback } });

const DYNAMIC: Fields = {
  control: { coded: { key: 'bVTy', codes: PHOTOSHOP_CONTROLS, fallback: 'off' } },
  fadeSteps: leaf('fStp', 'integer', { fallback: 25, counts: (d) => d.control === 'fade' }),
  jitter: leaf('jitter', 'percent', { fallback: 0 }),
  minimum: leaf('Mnm ', 'percent', { id: 'minimum', fallback: 0, counts: (d) => d.control !== 'off' }),
};
const dynamic = (key: string, optional?: true): Field => ({ nested: { key, class: { key: 'brVr' }, fields: DYNAMIC, ...(optional && { optional }) } });

const TIP: Fields = {
  sampledData: leaf('sampledData', 'text', { optional: true, identity: true, scripted: false }),
  diameter: leaf('Dmtr', 'pixels', { id: 'diameter', fallback: 100 }),
  hardness: leaf('Hrdn', 'percent', { id: 'hardness', optional: true }),
  simulatedHardness: leaf('dtipsHardness', 'percent', { optional: true }),
  angle: leaf('Angl', 'angle', { id: 'angle', fallback: 0 }),
  roundness: leaf('Rndn', 'percent', { id: 'roundness', fallback: 100 }),
  spacing: leaf('Spcn', 'percent', { id: 'spacing', fallback: 25 }),
  spaced: leaf('Intr', 'flag', { id: 'interfaceIconFrameDimmed', fallback: false }),
  flipX: leaf('flipX', 'flag', { fallback: false }),
  flipY: leaf('flipY', 'flag', { fallback: false }),
};
const TIP_KINDS = { computedBrush: 'computed', sampledBrush: 'sampled', dTips: 'erodible', dBrush: 'bristle' };
const tip = (): Field => ({ nested: { key: 'Brsh', id: 'brush', class: { key: 'computedBrush' }, kinds: TIP_KINDS, fields: TIP } });

const SCATTER: Group = {
  switch: { key: 'useScatter' },
  fields: {
    scatter: dynamic('scatterDynamics'), bothAxes: leaf('bothAxes', 'flag', { fallback: false }), count: leaf('Cnt ', 'integer', { id: 'count', fallback: 1 }),
    countDynamics: dynamic('countDynamics'),
  },
};

/** Every field of a preset, in the order a script sets them. */
export const PHOTOSHOP_PRESET_FIELDS: Fields = {
  name: leaf('Nm  ', 'text', { id: 'name', optional: true, identity: true, scripted: false }),
  tip: tip(),
  tipDynamics: {
    group: {
      switch: { key: 'useTipDynamics' },
      fields: {
        size: dynamic('szVr'), minimumDiameter: leaf('minimumDiameter', 'percent', { fallback: 0 }), angle: dynamic('angleDynamics'),
        roundness: dynamic('roundnessDynamics'), minimumRoundness: leaf('minimumRoundness', 'percent', { fallback: 0 }),
        flipX: leaf('flipX', 'flag', { fallback: false }), flipY: leaf('flipY', 'flag', { fallback: false }), projection: leaf('brushProjection', 'flag', { fallback: false }),
      },
    },
  },
  scatter: { group: SCATTER },
  transfer: { group: { switch: { key: 'usePaintDynamics' }, fields: { opacity: dynamic('opVr'), flow: dynamic('prVr') } } },
  texture: {
    group: {
      switch: { key: 'useTexture' },
      fields: {
        pattern: {
          nested: {
            key: 'Txtr', id: 'texture', class: { key: 'Ptrn', id: 'pattern' }, optional: true,
            fields: { name: leaf('Nm  ', 'text', { id: 'name', fallback: '', identity: true }), id: leaf('Idnt', 'text', { optional: true, identity: true, scripted: false }) },
          },
        },
        scale: leaf('textureScale', 'percent', { fallback: 100 }), brightness: leaf('textureBrightness', 'integer', { fallback: 0 }),
        contrast: leaf('textureContrast', 'integer', { fallback: 0 }), mode: blendMode('textureBlendMode', 'textureBlendMode', 'multiply'),
        depth: leaf('textureDepth', 'percent', { fallback: 100 }), eachTip: leaf('TxtC', 'flag', { id: 'textClickPoint', fallback: false }),
        invert: leaf('InvT', 'flag', { id: 'invertTexture', fallback: false }), depthDynamics: dynamic('textureDepthDynamics'),
        minimumDepth: leaf('minimumDepth', 'percent', { fallback: 0 }), protect: leaf('protectTexture', 'flag', { fallback: false }),
      },
    },
  },
  color: {
    group: {
      switch: { key: 'useColorDynamics' },
      fields: {
        swing: dynamic('clVr'), hue: leaf('H   ', 'percent', { fallback: 0 }), saturation: leaf('Strt', 'percent', { fallback: 0 }),
        brightness: leaf('Brgh', 'percent', { fallback: 0 }), purity: leaf('purity', 'percent', { fallback: 0 }), perTip: leaf('colorDynamicsPerTip', 'flag', { fallback: true }),
      },
    },
  },
  dual: {
    nested: {
      key: 'dualBrush', class: { key: 'dualBrush' }, switch: { key: 'useDualBrush' },
      // The dual pane has no Scatter switch: Photoshop reads it back on whatever a script sets, and every .abr holds it on.
      fields: { mode: blendMode('BlnM', 'blendMode', 'multiply'), flip: leaf('Flip', 'flag', { id: 'flip', fallback: false }), tip: tip(), scatter: { group: { ...SCATTER, alwaysOn: true } } },
    },
  },
  wetEdges: leaf('Wtdg', 'flag', { id: 'wetEdges', fallback: false }),
  noise: leaf('Nose', 'flag', { id: 'noise', fallback: false }),
  buildUp: leaf('Rpt ', 'flag', { id: 'repeat', fallback: false }),
  pose: {
    group: {
      switch: { key: 'useBrushPose' },
      fields: { overridePressure: leaf('overridePosePressure', 'flag', { fallback: false }), pressure: leaf('brushPosePressure', 'percent', { fallback: 0 }) },
    },
  },
  tool: {
    nested: {
      key: 'toolOptions', class: { key: 'PbTl' }, kinds: {}, optional: true, flatInScript: true,
      fields: {
        mode: blendMode('Md  ', 'mode', 'normal'), opacity: leaf('Opct', 'integer', { id: 'opacity', fallback: 100 }), flow: leaf('flow', 'integer', { optional: true }),
        sizeDynamics: dynamic('szVr', true), opacityDynamics: dynamic('opVr', true), flowDynamics: dynamic('prVr', true),
        pressureOverridesSize: leaf('usePressureOverridesSize', 'flag', { optional: true }), pressureOverridesOpacity: leaf('usePressureOverridesOpacity', 'flag', { optional: true }),
        dryness: leaf('dryness', 'percent', { optional: true }), wetness: leaf('wetness', 'percent', { optional: true }), mix: leaf('mix', 'percent', { optional: true }),
        sampleAllLayers: leaf('sampleAllLayers', 'flag', { optional: true }), autoFill: leaf('autoFill', 'flag', { optional: true }), autoClean: leaf('autoClean', 'flag', { optional: true }),
      },
    },
  },
};

// -- Reading an .abr's descriptor --

function readLeaf(d: PhotoshopDescriptor, f: Leaf): unknown {
  const v = d[f.key];
  if (v === undefined) return f.optional ? undefined : f.fallback;
  if (f.unit === 'flag') return v === true;
  if (f.unit === 'text') return typeof v === 'string' ? v : f.fallback;
  if (typeof v === 'number') return v;
  const tagged = photoshopTagged(v);
  if (tagged && '_unit' in tagged) return tagged.value;
  if (tagged && '_long' in tagged) return tagged._long;
  return f.optional ? undefined : f.fallback;
}

const isDescriptor = (v: PhotoshopValue | undefined): v is PhotoshopDescriptor => !!v && typeof v === 'object' && !Array.isArray(v) && '_class' in v;

function readFields(d: PhotoshopDescriptor, fields: Fields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    let value: unknown;
    if ('leaf' in field) value = readLeaf(d, field.leaf);
    else if ('coded' in field) {
      const code = readLeaf(d, { key: field.coded.key, unit: 'integer', fallback: 0 }) as number;
      value = field.coded.codes[code] ?? String(code);
    } else if ('enumerated' in field) {
      const tagged = photoshopTagged(d[field.enumerated.key]);
      const abr = tagged && '_enum' in tagged ? tagged.value : undefined;
      value = abr === undefined ? field.enumerated.fallback : (field.enumerated.values[abr] ?? abr);
    } else if ('group' in field) {
      if (field.group.alwaysOn || d[field.group.switch.key] === true) value = readFields(d, field.group.fields);
    } else {
      const n = field.nested, inner = d[n.key];
      if (isDescriptor(inner)) {
        if (!n.switch || inner[n.switch.key] === true) value = { ...(n.kinds && { kind: n.kinds[inner._class] ?? inner._class }), ...readFields(inner, n.fields) };
      } else if (!n.optional && !n.switch) value = readFields({ _class: n.class.key }, n.fields);
    }
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** An .abr's or .tpl's `brushPreset` descriptor, typed; what it lacks is Photoshop's default. */
export function readPhotoshopPreset(d: PhotoshopDescriptor): PhotoshopPreset {
  const preset = readFields(d, PHOTOSHOP_PRESET_FIELDS) as PhotoshopPreset;
  // A computed tip's class is the table's fallback, which a descriptor without a tip still reads as.
  preset.tip.kind ??= 'computed';
  return preset;
}

// -- Scripting it onto the brush tool --

/** A key as photoshop-capture.jsxinc's objToDesc takes it: `S:` a stringID, `C:` a charID. */
const scriptKey = ({ key, id }: Named) => (id ? `S:${id}` : key.length === 4 && key !== 'flow' ? `C:${key}` : `S:${key}`);

/** A value in the script's JSON: tagged as photoshop-descriptor.ts tags an .abr's, with keys and ids prefixed. */
export type PhotoshopScriptValue = number | boolean | string | { _unit: string; value: number } | { _long: number } | { _enum: string; value: string } | PhotoshopScriptDescriptor;
export type PhotoshopScriptDescriptor = { _class?: string; [key: string]: PhotoshopScriptValue | undefined };

const TIP_CLASSES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(TIP_KINDS).map(([cls, kind]) => [kind, cls]));

function scriptFields(value: Record<string, unknown>, fields: Fields, out: PhotoshopScriptDescriptor) {
  for (const [name, field] of Object.entries(fields)) {
    const v = value[name];
    if ('leaf' in field) {
      const f = field.leaf;
      if (v === undefined || f.scripted === false) continue;
      const tag = UNIT_TAGS[f.unit];
      out[scriptKey(f)] = tag ? { _unit: tag, value: v as number } : f.unit === 'integer' ? { _long: v as number } : (v as number | boolean | string);
    } else if ('coded' in field) out[scriptKey(field.coded)] = { _long: Math.max(0, field.coded.codes.indexOf(v as string)) };
    else if ('enumerated' in field) out[scriptKey(field.enumerated)] = { _enum: scriptKey(field.enumerated.type), value: `S:${v as string}` };
    else if ('group' in field) {
      out[scriptKey(field.group.switch)] = v !== undefined;
      if (v !== undefined) scriptFields(v as Record<string, unknown>, field.group.fields, out);
    } else {
      const n = field.nested;
      if (v === undefined && !n.switch) continue;
      const inner = v as Record<string, unknown> | undefined;
      if (n.flatInScript) {
        scriptFields(inner!, n.fields, out);
        continue;
      }
      const cls = n.kinds && inner ? (TIP_CLASSES[inner.kind as string] ?? (inner.kind as string)) : undefined;
      const d: PhotoshopScriptDescriptor = { _class: cls ? `S:${cls}` : scriptKey(n.class) };
      if (n.switch) d[scriptKey(n.switch)] = inner !== undefined;
      if (inner) scriptFields(inner, n.fields, d);
      out[scriptKey(n)] = d;
    }
  }
}

/**
 * `preset` as the brush tool's options, for photoshop-capture.jsxinc to set: every field it holds, and each group it
 * lacks switched off. A tool preset's own options (opacity, flow, mode) sit among the rest, as the tool holds them.
 */
export function photoshopPresetScript(preset: PhotoshopPreset): PhotoshopScriptDescriptor {
  const out: PhotoshopScriptDescriptor = {};
  scriptFields(preset, PHOTOSHOP_PRESET_FIELDS, out);
  return out;
}

// -- Reading it back --

/** How photoshop-actions.jsxinc's descToObj reads a key: its stringID, else its charID. */
const readKey = (key: string) => key.slice(2);
const readValue = (v: unknown) => (v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v);

/**
 * Each field `script` set that `applied` (the tool's options, read back by descToObj) doesn't hold, as "path: asked X,
 * read Y": Photoshop takes a key it doesn't understand without complaint. Names and ids aren't compared.
 */
export function photoshopPresetMismatches(preset: PhotoshopPreset, applied: Record<string, unknown>): string[] {
  const out: string[] = [];
  const compare = (value: Record<string, unknown>, fields: Fields, read: Record<string, unknown>, path: string) => {
    const expect = (name: string, asked: unknown, got: unknown) => {
      if (asked !== got) out.push(`${path}${name}: asked ${JSON.stringify(asked)}, read ${JSON.stringify(got)}`);
    };
    for (const [name, field] of Object.entries(fields)) {
      const v = value[name];
      if ('leaf' in field) {
        if (v !== undefined && field.leaf.scripted !== false && !field.leaf.identity) expect(name, v, readValue(read[readKey(scriptKey(field.leaf))]));
      } else if ('coded' in field) expect(name, field.coded.codes.indexOf(v as string), read[readKey(scriptKey(field.coded))]);
      else if ('enumerated' in field) expect(name, v, read[readKey(scriptKey(field.enumerated))]);
      else if ('group' in field) {
        expect(name, v !== undefined, read[readKey(scriptKey(field.group.switch))]);
        if (v !== undefined) compare(v as Record<string, unknown>, field.group.fields, read, path);
      } else {
        const n = field.nested, inner = v as Record<string, unknown> | undefined;
        if (inner === undefined && !n.switch) continue;
        if (n.flatInScript) {
          compare(inner!, n.fields, read, path);
          continue;
        }
        const got = (read[readKey(scriptKey(n))] ?? {}) as Record<string, unknown>;
        if (n.switch) expect(name, inner !== undefined, got[readKey(scriptKey(n.switch))]);
        if (n.kinds && inner) expect(`${name}.kind`, TIP_CLASSES[inner.kind as string] ?? inner.kind, got._class);
        if (inner) compare(inner, n.fields, got, `${path}${name}.`);
      }
    }
  };
  compare(preset, PHOTOSHOP_PRESET_FIELDS, applied, '');
  return out;
}

// -- Its fields one by one --

/** A field that takes effect, by its path here: a number, or a flag, code or mode as text. A group reads `on` or `off`. */
export type PhotoshopPresetLeaf = { path: string; value: number | string };

/** Each field of `preset` that takes effect; names and ids are left out. */
export function photoshopPresetLeaves(preset: PhotoshopPreset): PhotoshopPresetLeaf[] {
  const leaves: PhotoshopPresetLeaf[] = [];
  const walk = (value: Record<string, unknown>, fields: Fields, prefix: string) => {
    for (const [name, field] of Object.entries(fields)) {
      const v = value[name], path = prefix + name;
      if ('leaf' in field) {
        if (v === undefined || field.leaf.identity || (field.leaf.counts && !field.leaf.counts(value))) continue;
        leaves.push({ path, value: typeof v === 'number' ? v : String(v) });
      } else if ('coded' in field || 'enumerated' in field) leaves.push({ path, value: String(v) });
      else {
        const switched = 'group' in field ? !field.group.alwaysOn : !!field.nested.switch;
        if (switched) leaves.push({ path, value: v === undefined ? 'off' : 'on' });
        if (v === undefined) continue;
        const inner = v as Record<string, unknown>;
        if ('nested' in field && field.nested.kinds) leaves.push({ path: `${path}.kind`, value: String(inner.kind) });
        walk(inner, 'group' in field ? field.group.fields : field.nested.fields, `${path}.`);
      }
    }
  };
  walk(preset, PHOTOSHOP_PRESET_FIELDS, '');
  return leaves;
}
