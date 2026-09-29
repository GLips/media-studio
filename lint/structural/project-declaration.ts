// ─── A project's project.ts, read off its AST ─────────────────────────
//
// `export default { capability: 'music-led', shared: ['look.ts'], styles: ['wash'] }
// satisfies ProjectDeclaration` (lib/platform/project/models/capability.ts). Read statically,
// never imported: check:arch judges a snapshot, not the working tree. Only
// literals are read, so a value built at runtime is reported as unreadable
// rather than guessed at.

import { normalizeRepoPath, type DeclaredShared } from '../policy/studio-tree.ts';
import type { AstNode, SourceFile } from './source-tree.ts';

/** What a project.ts declares that the checks can't read as written. */
export type DeclarationProblem = { path: string; line: number; key: string; message: string };

/** `x satisfies T`, `x as T` and `(x)` are x. */
export function unwrapExpression(node: AstNode | undefined): AstNode | undefined {
  while (node && ['TSSatisfiesExpression', 'TSAsExpression', 'ParenthesizedExpression'].includes(node.type)) node = node.expression as AstNode;
  return node;
}

export function propertyKeyName(property: AstNode): string | undefined {
  const key = property.key as AstNode;
  if (property.computed) return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
  return key.type === 'Identifier' ? key.name as string : key.type === 'Literal' ? String(key.value) : undefined;
}

/** The value of `name` in project.ts's default-exported object, unwrapped; undefined when it has no such property. */
export function declaredProperty(file: SourceFile, name: string): AstNode | undefined {
  const exported = (file.program.body as AstNode[]).find((node) => node.type === 'ExportDefaultDeclaration');
  const object = exported && unwrapExpression(exported.declaration as AstNode);
  if (object?.type !== 'ObjectExpression') return undefined;
  const property = (object.properties as AstNode[]).find((p) => p.type === 'Property' && propertyKeyName(p) === name);
  return property && unwrapExpression(property.value as AstNode);
}

/**
 * Each project's `shared` list, keyed by project, from the project.ts files given (`project` names each one's
 * project). An entry is a path inside the project, normalized; one that isn't a string literal, or that climbs out
 * of the project, is a problem and declares nothing.
 */
export function readDeclaredShared(declarations: readonly { project: string; file: SourceFile }[]): { shared: DeclaredShared; problems: DeclarationProblem[] } {
  const shared: Record<string, readonly string[]> = {};
  const problems: DeclarationProblem[] = [];
  for (const { project, file } of declarations) {
    const value = declaredProperty(file, 'shared');
    if (!value) continue;
    const problem = (node: AstNode, key: string, message: string) => problems.push({ path: file.path, line: file.lineOf(node.start), key, message });
    if (value.type !== 'ArrayExpression') {
      problem(value, 'shared unreadable', 'declares `shared` as something other than an array of paths written out, so no module is shared');
      continue;
    }
    const paths: string[] = [];
    for (const element of value.elements as (AstNode | null)[]) {
      const entry = unwrapExpression(element ?? undefined);
      if (entry?.type !== 'Literal' || typeof entry.value !== 'string') {
        problem(element ?? value, 'shared unreadable', 'lists a shared module that isn\'t a path written out as a string, so it declares nothing');
        continue;
      }
      const inside = normalizeRepoPath(entry.value);
      if (inside === '' || inside === '..' || inside.startsWith('../') || entry.value.startsWith('/')) {
        problem(entry, `shared ${entry.value}`, `lists ${entry.value}, which isn't a file inside the project: a shared module is one of its own`);
        continue;
      }
      paths.push(inside);
    }
    shared[project] = paths;
  }
  return { shared, problems };
}

/** Project directory name → the styles in work/styles/ its project.ts's `styles` names. */
export type DeclaredStyles = Readonly<Record<string, readonly string[]>>;

/**
 * Each project's `styles` list, keyed by project. An entry is a folder name in work/styles/; one that isn't a string
 * literal, or that is a path rather than a name, is a problem and declares nothing.
 */
export function readDeclaredStyles(declarations: readonly { project: string; file: SourceFile }[]): { styles: DeclaredStyles; problems: DeclarationProblem[] } {
  const styles: Record<string, readonly string[]> = {};
  const problems: DeclarationProblem[] = [];
  for (const { project, file } of declarations) {
    const value = declaredProperty(file, 'styles');
    if (!value) continue;
    const problem = (node: AstNode, key: string, message: string) => problems.push({ path: file.path, line: file.lineOf(node.start), key, message });
    if (value.type !== 'ArrayExpression') {
      problem(value, 'styles unreadable', 'declares `styles` as something other than an array of names written out, so it uses no style');
      continue;
    }
    const names: string[] = [];
    for (const element of value.elements as (AstNode | null)[]) {
      const entry = unwrapExpression(element ?? undefined);
      if (entry?.type !== 'Literal' || typeof entry.value !== 'string') {
        problem(element ?? value, 'styles unreadable', 'lists a style that isn\'t a name written out as a string, so it declares nothing');
        continue;
      }
      if (!/^[\w.-]+$/.test(entry.value) || entry.value.startsWith('.')) {
        problem(entry, `styles ${entry.value}`, `lists ${entry.value}, which isn't a style's folder name in work/styles/`);
        continue;
      }
      names.push(entry.value);
    }
    styles[project] = names;
  }
  return { styles, problems };
}
