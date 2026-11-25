// cue-state.ts: a character's state as controls. A declaration gives one nested object of plain data; each leaf is a
// control a cue can set: a number eases, a fixed tuple of numbers eases as one control, a string or boolean cuts.
// Dot paths name leaves and subtrees (`pose.armLeft`), so a move can claim an arm and leave the face alone.
//
// Only that grammar: no optional keys, no other arrays, no class instances. A state built from it is comparable data,
// which painted looks cache their solves by.

/** One control's value. */
export type CueLeaf = number | string | boolean | readonly number[];

/** Plain nested data whose leaves are controls. */
export type CueState = { readonly [key: string]: CueLeaf | CueState };

/** Every dot path to a leaf of `S`. */
export type CueLeafPath<S> = {
  [K in keyof S & string]: S[K] extends CueState ? `${K}.${CueLeafPath<S[K]>}` : K;
}[keyof S & string];

/** Every dot path to a number leaf of `S`: what a slider can drive. */
export type CueNumberPath<S> = {
  [K in keyof S & string]: S[K] extends number ? K : S[K] extends CueState ? `${K}.${CueNumberPath<S[K]>}` : never;
}[keyof S & string];

/** Every dot path to a leaf or subtree of `S`: what a move's mask can claim. */
export type CuePath<S> = {
  [K in keyof S & string]: S[K] extends CueState ? K | `${K}.${CuePath<S[K]>}` : K;
}[keyof S & string];

/** Some of `S`'s leaves, nested as `S` nests them. */
export type CuePatch<S> = { readonly [K in keyof S]?: CuePatchValue<S[K]> };
type CuePatchValue<V> = V extends CueState ? CuePatch<V> : V;

/** A state's leaves in a fixed order, each with its path, read once from its initial value. */
export type CueSchema = {
  readonly paths: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  /** Each subtree's (and leaf's) path to the leaf indices under it. */
  readonly under: ReadonlyMap<string, readonly number[]>;
  /** Every subtree's path, parents first: an empty one (a model with no morphs) holds no leaf but still rebuilds. */
  readonly groups: readonly string[];
};

type CueNode = CueLeaf | CueState | CuePatch<CueState> | undefined;
const isLeaf = (value: CueNode): value is CueLeaf => typeof value !== 'object' || Array.isArray(value);

export function cueSchema(initial: CueState): CueSchema {
  const paths: string[] = [], groups: string[] = [], under = new Map<string, number[]>();
  const walk = (node: CueState, prefix: string, owners: readonly string[]) => {
    for (const [key, value] of Object.entries(node)) {
      if (key.includes('.')) throw new Error(`cue state: the key "${key}" holds a dot, which paths split on`);
      const path = prefix ? `${prefix}.${key}` : key, chain = [...owners, path];
      if (!isLeaf(value)) {
        groups.push(path);
        under.set(path, under.get(path) ?? []);
        walk(value, path, chain);
        continue;
      }
      const n = paths.push(path) - 1;
      for (const owner of chain) under.set(owner, [...(under.get(owner) ?? []), n]);
    }
  };
  walk(initial, '', []);
  return { paths, index: new Map(paths.map((path, n) => [path, n])), under, groups };
}

/** The leaf indices a path names: one leaf, or every leaf of a subtree. Throws on a path the state doesn't have. */
export function cueSchemaLeaves(schema: CueSchema, path: string): readonly number[] {
  const leaves = schema.under.get(path);
  if (!leaves) throw new Error(`cue state: no control or group "${path}"`);
  return leaves;
}

/** The leaf a patch (or a whole state) sets at `path`, or undefined where it sets none. */
export function cuePatchLeaf(patch: CuePatch<CueState> | CueState, path: string): CueLeaf | undefined {
  let node: CueNode = patch;
  for (const key of path.split('.')) {
    if (node === undefined || isLeaf(node)) return undefined;
    node = node[key];
  }
  return node !== undefined && isLeaf(node) ? node : undefined;
}

/** `state`'s leaves in the schema's order. */
export function cueStateLeaves(schema: CueSchema, state: CueState): CueLeaf[] {
  return schema.paths.map((path) => {
    const leaf = cuePatchLeaf(state, path);
    if (leaf === undefined) throw new Error(`cue state: no value at ${path}`);
    return leaf;
  });
}

/** The nested state from leaves in the schema's order. */
export function cueStateFromLeaves(schema: CueSchema, leaves: readonly CueLeaf[]): CueState {
  type Building = { [key: string]: CueLeaf | Building };
  const root: Building = {};
  const place = (path: string, value: CueLeaf | Building) => {
    const keys = path.split('.');
    let node = root;
    for (const key of keys.slice(0, -1)) {
      const next = node[key] ?? {};
      if (isLeaf(next)) throw new Error(`cue state: ${path} runs through the leaf ${key}`);
      node = node[key] = next;
    }
    node[keys.at(-1)!] = value;
  };
  for (const group of schema.groups) place(group, {});
  schema.paths.forEach((path, n) => place(path, leaves[n]));
  return root;
}

/** `a` mixed `t` of the way to `b`: numbers and tuples lerp (t may overshoot); strings and booleans switch when `arrived`. */
export function mixCueLeaf(a: CueLeaf, b: CueLeaf, t: number, arrived: boolean): CueLeaf {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x: number, k) => x + (b[k] - x) * t);
  return arrived ? b : a;
}
