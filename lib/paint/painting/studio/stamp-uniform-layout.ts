// stamp-uniform-layout.ts: a WGSL uniform struct declared once, as a table of its fields, from which both the WGSL
// struct and each field's word offset are generated, by WGSL's uniform layout rules. A pass's writer sets fields by
// name, each value shaped by its field's type, so no offset is counted by hand, the struct and its writer can't
// disagree, and no write runs into the next field.

/**
 * A field's WGSL type: a scalar, a vector, a struct laid out here, a struct laid out and written elsewhere (its name,
 * size and alignment in words), or an array of vec4f.
 */
export type StampUniformType =
  | 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec2u' | 'vec3f' | 'vec4f'
  | { struct: StampUniformLayout<readonly StampUniformField[]> }
  | { external: string; words: number; align: number }
  | { vec4fArray: number };

export type StampUniformField = readonly [name: string, type: StampUniformType];

export type StampUniformLayout<F extends readonly StampUniformField[]> = {
  name: string;
  fields: F;
  /** `struct <name> { … }`. */
  wgsl: string;
  /** Each field's first word, and its type. */
  at: Readonly<Record<F[number][0], number>>;
  types: Readonly<Record<F[number][0], StampUniformType>>;
  words: number;
  align: number;
};

type Words<N extends number, R extends readonly number[] = []> = R['length'] extends N ? R : Words<N, readonly [...R, number]>;

/**
 * The value a field of `T` takes: a number for a scalar, a tuple of a vector's length, a nested struct's own values.
 * An array's length is a computed number, so it's any ArrayLike, checked when written; an external struct's own
 * writer fills it, so it takes nothing here.
 */
export type StampUniformValue<T extends StampUniformType> =
  T extends 'f32' | 'i32' | 'u32' ? number
  : T extends 'vec2f' | 'vec2u' ? Words<2>
  : T extends 'vec3f' ? Words<3>
  : T extends 'vec4f' ? Words<4>
  : T extends { struct: StampUniformLayout<infer F> } ? StampUniformValues<F>
  : T extends { vec4fArray: number } ? ArrayLike<number>
  : never;

type FieldType<F extends readonly StampUniformField[], K> = Extract<F[number], readonly [K, StampUniformType]>[1];

/** Every field of a struct, each by its value. */
export type StampUniformValues<F extends readonly StampUniformField[]> = { readonly [K in F[number][0]]: StampUniformValue<FieldType<F, K>> };

/** Size and alignment in words, as a uniform buffer lays each out: a nested struct and an array align to 16 bytes. */
function sizeAndAlign(type: StampUniformType): readonly [number, number] {
  if (typeof type !== 'object') return ({ f32: [1, 1], i32: [1, 1], u32: [1, 1], vec2f: [2, 2], vec2u: [2, 2], vec3f: [3, 4], vec4f: [4, 4] } as const)[type];
  if ('struct' in type) return [type.struct.words, Math.max(4, type.struct.align)];
  if ('external' in type) return [type.words, Math.max(4, type.align)];
  return [type.vec4fArray * 4, 4];
}

function wgslOf(type: StampUniformType): string {
  if (typeof type !== 'object') return type;
  if ('struct' in type) return type.struct.name;
  if ('external' in type) return type.external;
  return `array<vec4f, ${type.vec4fArray}>`;
}

/** The layout of struct `name` holding `fields` in order. */
export function stampUniformLayout<const F extends readonly StampUniformField[]>(name: string, fields: F): StampUniformLayout<F> {
  let word = 0, align = 1;
  const at: Record<string, number> = {}, types: Record<string, StampUniformType> = {};
  for (const [field, type] of fields) {
    const [size, fieldAlign] = sizeAndAlign(type);
    word = Math.ceil(word / fieldAlign) * fieldAlign;
    at[field] = word;
    types[field] = type;
    word += size;
    align = Math.max(align, fieldAlign);
  }
  const wgsl = `struct ${name} { ${fields.map(([field, type]) => `${field}: ${wgslOf(type)}`).join(', ')} }`;
  // SAFETY: the loop above set a word and a type for every field of F, and only those.
  return { name, fields, wgsl, at: at as Record<F[number][0], number>, types: types as Record<F[number][0], StampUniformType>, words: Math.ceil(word / align) * align, align };
}

/** A layout as a field type of an enclosing struct. */
export const stampUniformStruct = <F extends readonly StampUniformField[]>(layout: StampUniformLayout<F>) => ({ struct: layout });

/** The views of one uniform slot, each over the same words. */
export type StampUniformViews = { floats: Float32Array; ints: Int32Array; words: Uint32Array };

const SCALAR_COUNT = { f32: 1, i32: 1, u32: 1, vec2f: 2, vec2u: 2, vec3f: 3, vec4f: 4 } as const;
function viewOf(type: keyof typeof SCALAR_COUNT, views: StampUniformViews) {
  if (type === 'i32') return views.ints;
  return type === 'u32' || type === 'vec2u' ? views.words : views.floats;
}

/** Writes `value` as `type` at word `at`, throwing, naming `path`, when an array's length isn't the type's. */
function writeStampUniformValue(type: StampUniformType, value: unknown, views: StampUniformViews, at: number, path: string) {
  if (typeof type === 'object' && 'external' in type) throw new Error(`stamp uniform ${path}: ${type.external} is written by its own writer`);
  if (typeof type === 'object' && 'struct' in type) {
    // SAFETY: the writer's signature types a struct field's value as the nested struct's own values.
    const values = value as Readonly<Record<string, unknown>>;
    for (const [field, inner] of type.struct.fields) writeStampUniformValue(inner, values[field], views, at + type.struct.at[field], `${path}.${field}`);
    return;
  }
  // SAFETY: every other type takes a number or an ArrayLike of numbers (StampUniformValue).
  const numbers = typeof value === 'number' ? [value] : (value as ArrayLike<number>);
  const count = typeof type === 'object' ? type.vec4fArray * 4 : SCALAR_COUNT[type];
  if (numbers.length !== count) throw new Error(`stamp uniform ${path}: ${wgslOf(type)} takes ${count} values, given ${numbers.length}`);
  (typeof type === 'object' ? views.floats : viewOf(type, views)).set(numbers, at);
}

/** Sets `layout`'s fields by name in `views`, starting at word `base`, each through its scalar's view. */
export function stampUniformWriter<F extends readonly StampUniformField[]>(layout: StampUniformLayout<F>, views: StampUniformViews, base = 0) {
  return <K extends F[number][0]>(field: K, value: StampUniformValue<FieldType<F, K>>) => {
    writeStampUniformValue(layout.types[field], value, views, base + layout.at[field], `${layout.name}.${field}`);
  };
}
