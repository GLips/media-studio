// photoshop-descriptor.ts: a Photoshop ActionDescriptor as plain JSON, the shape engine/photoshop-descriptor-codec.ts
// reads an .abr's or .tpl's settings into, which photoshop-preset.ts reads a brush preset from.

/** A number in a unit: `#Prc` percent, `#Pxl` pixels, `#Ang` degrees. */
export type PhotoshopUnitFloat = { _unit: string; value: number };
export type PhotoshopEnum = { _enum: string; value: string };
/** A 32-bit integer (`long`); a bare number is a double (`doub`), which Photoshop keeps apart. */
export type PhotoshopInteger = { _long: number };
/** Raw bytes (`tdta`, `alis`), as hex. */
export type PhotoshopRaw = { _raw: string; hex: string };
export type PhotoshopClassRef = { _classRef: string };
export type PhotoshopValue =
  | number | boolean | string | PhotoshopUnitFloat | PhotoshopEnum | PhotoshopInteger | PhotoshopRaw | PhotoshopClassRef | PhotoshopValue[] | PhotoshopDescriptor;
/** A descriptor: its class (`_class`), its name when it has one (`_name`), then its keys in order. */
export type PhotoshopDescriptor = { _class: string; _name?: string; [key: string]: PhotoshopValue | undefined };

type Tagged = PhotoshopUnitFloat | PhotoshopEnum | PhotoshopInteger | PhotoshopRaw | PhotoshopClassRef;
/** Which tagged value `v` is, by its tag; a descriptor has a `_class` and none of the tags. */
export function photoshopTagged(v: PhotoshopValue | undefined): Tagged | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v) || '_class' in v) return undefined;
  return v;
}

const isJsonObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `v`, JSON as a manifest stores a descriptor's value, checked and rebuilt as one; throws naming the path that isn't. */
function parsePhotoshopValue(v: unknown, at: string): PhotoshopValue {
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((item, i) => parsePhotoshopValue(item, `${at}[${i}]`));
  if (!isJsonObject(v)) throw new Error(`${at} isn't a descriptor value`);
  if ('_class' in v) return parsePhotoshopDescriptor(v, at);
  if (typeof v._unit === 'string' && typeof v.value === 'number') return { _unit: v._unit, value: v.value };
  if (typeof v._enum === 'string' && typeof v.value === 'string') return { _enum: v._enum, value: v.value };
  if (typeof v._long === 'number') return { _long: v._long };
  if (typeof v._raw === 'string' && typeof v.hex === 'string') return { _raw: v._raw, hex: v.hex };
  if (typeof v._classRef === 'string') return { _classRef: v._classRef };
  throw new Error(`${at} isn't a descriptor value`);
}

/** `v`, a descriptor as JSON holds it (a manifest's preset), checked and rebuilt, every value to its tagged shape. */
export function parsePhotoshopDescriptor(v: unknown, at: string): PhotoshopDescriptor {
  if (!isJsonObject(v) || typeof v._class !== 'string') throw new Error(`${at} isn't a descriptor`);
  const descriptor: PhotoshopDescriptor = { _class: v._class };
  for (const [key, value] of Object.entries(v)) {
    if (key === '_class') continue;
    if (key === '_name') {
      if (typeof value !== 'string') throw new Error(`${at}._name isn't a string`);
      descriptor._name = value;
    } else descriptor[key] = parsePhotoshopValue(value, `${at}.${key}`);
  }
  return descriptor;
}
