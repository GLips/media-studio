// stamp-uniform-layout.ts: a WGSL uniform struct declared once, as a table of its fields, from which both the WGSL
// struct and each field's word offset are generated, by WGSL's uniform layout rules. A pass's writer sets fields by
// name, so no offset is counted by hand and the struct and its writer can't disagree.

/** A field's WGSL type: a scalar, a vector, a struct laid out elsewhere (its size and alignment in words), or an array of vec4f. */
export type StampUniformType =
  | 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec2u' | 'vec3f' | 'vec4f'
  | { struct: string; words: number; align: number }
  | { vec4fArray: number };

type Field = readonly [name: string, type: StampUniformType];

export type StampUniformLayout<K extends string> = {
  /** `struct <name> { … }`. */
  wgsl: string;
  /** Each field's first word. */
  at: Readonly<Record<K, number>>;
  /** Which view a field is written through: its scalar's. */
  kind: Readonly<Record<K, 'float' | 'int' | 'uint'>>;
  words: number;
  align: number;
};

/** Size and alignment in words, as a uniform buffer lays each out: a nested struct and an array align to 16 bytes. */
function sizeAndAlign(type: StampUniformType): [number, number] {
  if (typeof type === 'object') return 'struct' in type ? [type.words, Math.max(4, type.align)] : [type.vec4fArray * 4, 4];
  return { f32: [1, 1], i32: [1, 1], u32: [1, 1], vec2f: [2, 2], vec2u: [2, 2], vec3f: [3, 4], vec4f: [4, 4] }[type] as [number, number];
}

const kindOf = (type: StampUniformType) => (typeof type === 'object' ? 'float' : type === 'i32' ? 'int' : type === 'u32' || type === 'vec2u' ? 'uint' : 'float');
const wgslOf = (type: StampUniformType) => (typeof type === 'object' ? ('struct' in type ? type.struct : `array<vec4f, ${type.vec4fArray}>`) : type);

/** The layout of struct `name` holding `fields` in order. */
export function stampUniformLayout<const F extends readonly Field[]>(name: string, fields: F): StampUniformLayout<F[number][0]> {
  let word = 0, align = 1;
  const at: Record<string, number> = {}, kind: Record<string, 'float' | 'int' | 'uint'> = {};
  for (const [field, type] of fields) {
    const [size, fieldAlign] = sizeAndAlign(type);
    word = Math.ceil(word / fieldAlign) * fieldAlign;
    at[field] = word;
    kind[field] = kindOf(type);
    word += size;
    align = Math.max(align, fieldAlign);
  }
  const wgsl = `struct ${name} { ${fields.map(([field, type]) => `${field}: ${wgslOf(type)}`).join(', ')} }`;
  return { wgsl, at: at as Record<F[number][0], number>, kind: kind as Record<F[number][0], 'float' | 'int' | 'uint'>, words: Math.ceil(word / align) * align, align };
}

/** A layout as a field type of an enclosing struct. */
export const stampUniformStruct = (name: string, layout: StampUniformLayout<string>): StampUniformType => ({ struct: name, words: layout.words, align: layout.align });

/** The views of one uniform slot, each over the same words. */
export type StampUniformViews = { floats: Float32Array; ints: Int32Array; words: Uint32Array };

/** Sets `layout`'s fields by name in `views`, starting at word `base`, each through its scalar's view. */
export function stampUniformWriter<K extends string>(layout: StampUniformLayout<K>, views: StampUniformViews, base = 0) {
  return (field: K, values: ArrayLike<number> | number) => {
    const view = { float: views.floats, int: views.ints, uint: views.words }[layout.kind[field]];
    view.set(typeof values === 'number' ? [values] : values, base + layout.at[field]);
  };
}
