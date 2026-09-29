// ─── SDK containment: one owner per contained SDK ─────────────────────
//
// A contained package is imported only under its owner folder, a type-only
// import included: a project's capture takes playwright's Page from
// #lib/footage/capture/engine, so playwright's API has one importer. A contained binary is
// named only under its owner: any string that is exactly `ffmpeg` (or a path
// ending in it) counts, whatever call it reaches through, and so does any
// string or template head that starts a command line with it (`ffmpeg -i …`),
// so a shell, `shell: true` or a promisified exec can't hide it. A flag must
// follow, which keeps prose like 'ffmpeg failed' out.

import { SDK_OWNERS, type SdkOwner } from '../../policy/sdk-owners.ts';
import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'sdk-containment';
const COMMAND_LINE = /^\s*((?:\S*\/)?[\w-]+)\s+-/;

const ownerOfPackage = (name: string) => SDK_OWNERS.find((row) => row.packages?.includes(name));
const ownerOfBinary = (command: string) =>
  SDK_OWNERS.find((row) => row.binaries?.some((binary) => command === binary || command.endsWith(`/${binary}`)));

export const sdkContainmentCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      // A tool's config configures that tool by importing it (web/vite.config.ts's defineConfig); it runs nothing.
      if (context.positionOf(file.path).kind === 'root-config') continue;
      const outside = (row: SdkOwner) => !file.path.startsWith(row.owner);
      for (const edge of context.edgesFrom(file)) {
        if (edge.target.kind !== 'package') continue;
        const row = ownerOfPackage(edge.target.name);
        if (!row || !outside(row)) continue;
        findings.push({
          check: ID, path: file.path, line: edge.line, key: edge.target.name,
          message: `imports ${edge.target.name}; only ${row.owner} may, so go through what it exports`,
        });
      }
      const named = (offset: number, command: string) => {
        const row = ownerOfBinary(command);
        if (!row || !outside(row)) return;
        findings.push({
          check: ID, path: file.path, line: file.lineOf(offset), key: command,
          message: `runs ${command}; only ${row.owner} starts it, so call what it exports`,
        });
      };
      walkAst(file.program, (node) => {
        if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' && node.source) return false;
        const text = stringValue(node);
        if (text !== undefined) named(node.start, text);
        const head = node.type === 'TemplateLiteral' ? ((node.quasis as AstNode[])[0].value as { cooked?: string }).cooked : text;
        const command = head === undefined ? undefined : COMMAND_LINE.exec(head)?.[1];
        if (command) named(node.start, command);
      });
    }
    return findings;
  },
};

/** A string literal's text, or a template literal's when it has no expressions. */
function stringValue(node: AstNode | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return ((node.quasis as AstNode[])[0].value as { cooked?: string }).cooked;
  }
  return undefined;
}
