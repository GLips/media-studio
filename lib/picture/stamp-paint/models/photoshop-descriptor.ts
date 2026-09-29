// photoshop-descriptor.ts: a Photoshop ActionDescriptor as plain JSON, the shape engine/photoshop-descriptor-codec.ts
// reads an .abr's or .tpl's settings into, and the accessors the brush reader (photoshop-brush.ts) reads them by.

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
  return v as Tagged;
}

/** A key's value as a number, whatever it's stored as (a double, an integer or a unit); `fallback` when it's absent. */
export function photoshopNumber(d: PhotoshopDescriptor | undefined, key: string, fallback = 0): number {
  const v = d?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const tagged = photoshopTagged(v);
  if (tagged && '_unit' in tagged) return tagged.value;
  if (tagged && '_long' in tagged) return tagged._long;
  return fallback;
}

export const photoshopFlag = (d: PhotoshopDescriptor | undefined, key: string) => d?.[key] === true;

export function photoshopEnum(d: PhotoshopDescriptor | undefined, key: string): string | undefined {
  const tagged = photoshopTagged(d?.[key]);
  return tagged && '_enum' in tagged ? tagged.value : undefined;
}

export function photoshopObject(d: PhotoshopDescriptor | undefined, key: string): PhotoshopDescriptor | undefined {
  const v = d?.[key];
  return v && typeof v === 'object' && !Array.isArray(v) && '_class' in v ? (v as PhotoshopDescriptor) : undefined;
}
