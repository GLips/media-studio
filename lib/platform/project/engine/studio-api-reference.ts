// studio-api-reference.ts: what lib/api.ts exports, read from the code by the TypeScript compiler, so the
// reference can't drift from it. `studio api` prints it.
//
// Signatures are the declarations' own source text (with their inline property comments) where there is one, and
// the checker's type where a const is an expression.
import { relative } from 'node:path';
import type { Node } from 'typescript/unstable/ast';
import { isArrowFunction, isFunctionDeclaration, isFunctionExpression, isVariableDeclaration } from 'typescript/unstable/ast/is';
import { API, SymbolFlags, type Checker, type Symbol as TsSymbol } from 'typescript/unstable/sync';
import { STUDIO_ROOT } from './studio-project.ts';

const API_MODULE = 'lib/api.ts';
const INDEX_WIDTH = 118;

export type StudioApiExport = {
  name: string;
  /** Relative to the studio root. */
  file: string;
  kind: 'function' | 'const' | 'type' | 'class';
  /** One per declaration: overloads, or a type and a value that share the name. */
  signatures: string[];
  doc: string;
  tags: { name: string; text?: string }[];
};

/** Every export of lib/api.ts, in file order. */
export function readStudioApiExports(): StudioApiExport[] {
  const api = new API({ cwd: STUDIO_ROOT });
  try {
    const project = api.updateSnapshot({ openProjects: [`${STUDIO_ROOT}/tsconfig.json`] }).getProjects()[0];
    const { checker, program } = project;
    const sourceFile = program.getSourceFile(`${STUDIO_ROOT}/${API_MODULE}`);
    if (!sourceFile) throw new Error(`${API_MODULE} isn't in tsconfig.json's program`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) throw new Error(`${API_MODULE} isn't a module`);

    const found = checker.getExportsOfModule(moduleSymbol).map((exported) => {
      const symbol = exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declarations = symbol.declarations.map((handle) => handle.resolve(project)).filter((node): node is Node => node !== undefined);
      const file = declarations[0]?.getSourceFile();
      return {
        position: [file?.fileName ?? '', declarations[0]?.getStart() ?? 0] as const,
        entry: {
          name: exported.name,
          file: file ? relative(STUDIO_ROOT, file.fileName) : '?',
          kind: exportKind(symbol, declarations),
          signatures: declarations.map((node) => signatureText(node, symbol, checker)),
          doc: checker.getDocumentationCommentOfSymbol(symbol),
          tags: checker.getJsDocTagsOfSymbol(symbol).map(({ name, text }) => ({ name, text })),
        } satisfies StudioApiExport,
      };
    });
    found.sort((a, b) => a.position[0].localeCompare(b.position[0]) || a.position[1] - b.position[1]);
    return found.map((f) => f.entry);
  } finally {
    api.close();
  }
}

function exportKind(symbol: TsSymbol, declarations: readonly Node[]): StudioApiExport['kind'] {
  if (symbol.flags & SymbolFlags.Class) return 'class';
  if (symbol.flags & SymbolFlags.Function) return 'function';
  if (symbol.flags & SymbolFlags.Variable) {
    const init = declarations.find(isVariableDeclaration)?.initializer;
    return init && (isArrowFunction(init) || isFunctionExpression(init)) ? 'function' : 'const';
  }
  return 'type';
}

function signatureText(node: Node, symbol: TsSymbol, checker: Checker): string {
  const source = node.getSourceFile();
  const text = (from: number, to: number) => source.text.slice(from, to).trim().replace(/^export\s+(declare\s+)?/, '');
  if (isFunctionDeclaration(node)) return text(node.getStart(source), node.body ? node.body.pos : node.end);
  if (isVariableDeclaration(node)) {
    const keyword = source.text.slice(node.parent.getStart(source)).match(/^(const|let|var)\b/)?.[1] ?? 'const';
    if (node.type) return `${keyword} ${text(node.getStart(source), node.type.end)}`;
    const init = node.initializer;
    if (init && (isArrowFunction(init) || isFunctionExpression(init))) {
      return `${keyword} ${text(node.getStart(source), node.name.end)} = ${text(init.getStart(source), init.body.pos).replace(/\s*=>$/, '')} => …`;
    }
    const type = checker.getTypeOfSymbol(symbol);
    return `${keyword} ${text(node.getStart(source), node.name.end)}: ${type ? checker.typeToString(type) : '?'}`;
  }
  return text(node.getStart(source), node.end);
}

/** The first sentence of a doc comment, on one line. */
const summaryOf = (doc: string) => {
  const flat = doc.replace(/\s+/g, ' ').trim();
  return flat.match(/^.*?(?<!\be\.g|\bi\.e)[.:;](?=\s|$)/)?.[0] ?? flat;
};

/** Every export, one line each under its file, with the first sentence of its doc comment. */
export function formatStudioApiIndex(exports: readonly StudioApiExport[]): string {
  const byFile = new Map<string, StudioApiExport[]>();
  for (const e of exports) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  const width = Math.max(...exports.map((e) => e.name.length + (e.kind === 'type' ? 5 : 0)));
  const out = [`${exports.length} exports of ${API_MODULE}; \`studio api <name>\` for one's signature and doc.`];
  for (const [file, entries] of byFile) {
    out.push('', file);
    for (const e of entries) {
      const label = (e.kind === 'type' ? `type ${e.name}` : e.name).padEnd(width);
      const line = `  ${label}  ${summaryOf(e.doc)}`.trimEnd();
      out.push(line.length > INDEX_WIDTH ? `${line.slice(0, INDEX_WIDTH - 1)}…` : line);
    }
  }
  return out.join('\n');
}

/** One export's signatures, doc and tags. */
export function formatStudioApiExport(entry: StudioApiExport): string {
  const tags = entry.tags.map((t) => `@${t.name}${t.text ? ` ${t.text}` : ''}`);
  return [entry.file, '', ...entry.signatures.flatMap((s) => [s, '']), entry.doc, ...(tags.length ? ['', ...tags] : [])].join('\n').trimEnd();
}

/** The export called `name`; failing that, a message naming the closest ones. */
export function findStudioApiExport(exports: readonly StudioApiExport[], name: string): StudioApiExport {
  const exact = exports.find((e) => e.name === name) ?? exports.filter((e) => e.name.toLowerCase() === name.toLowerCase()).at(0);
  if (exact) return exact;
  const near = exports.filter((e) => e.name.toLowerCase().includes(name.toLowerCase())).map((e) => e.name);
  throw new Error(`${API_MODULE} exports no ${name}${near.length ? `; did you mean ${near.join(', ')}?` : '; `studio api` lists every export'}`);
}
