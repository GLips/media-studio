// ─── The file a rule is linting, placed in the studio's tree ──────────
//
// oxlint hands a rule an absolute filename and the directory it ran from.
// Every rule here reads position from lint/policy/studio-tree.ts through this
// one door, so the per-file tier and the structural tier agree on where a file
// sits. `shared` is empty: a per-file rule cannot read a project.ts, so a
// project's declared shared modules classify as `unclassified` here.
// ──────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { defineRule, type Context, type Rule, type Visitor } from "@oxlint/plugins";
import {
  classifyStudioPath,
  expandStudioAlias,
  normalizeRepoPath,
  type StudioPosition,
  type WebPlace,
} from "../../policy/studio-tree.ts";

export type RuleFile = {
  /** Repo-relative and `/`-separated, as studio-tree.ts takes it. */
  path: string;
  position: StudioPosition;
};

export function ruleFileOf(filename: string, cwd: string): RuleFile {
  const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
  const path = filename.startsWith(root) ? filename.slice(root.length) : filename;
  return { path, position: classifyStudioPath(path, {}) };
}

/** Test files, ambient declarations and generated output: nobody authors their shape, or they name violations on purpose. */
const UNAUTHORED_OR_TEST = /\.(test|d|gen)\.[cm]?[jt]sx?$/;

function isAuthoredSource(file: RuleFile): boolean {
  if (UNAUTHORED_OR_TEST.test(file.path)) return false;
  const { position } = file;
  if (position.kind === "project" && position.role === "generated") return false;
  return !("place" in position && position.place === "generated");
}

type SourceRuleDefinition = {
  meta: Parameters<typeof defineRule>[0]["meta"];
  create: (context: Context, file: RuleFile) => Visitor;
};

/**
 * A rule about authored source. The exemption lives here rather than in each body, so a rule
 * can't forget it. A rule whose subject IS a test file (no-module-mocking) uses plain `defineRule`.
 */
export function defineSourceRule(definition: SourceRuleDefinition): Rule {
  return defineRule({
    meta: definition.meta,
    create(context) {
      const file = ruleFileOf(context.filename, context.cwd);
      if (!isAuthoredSource(file)) return {};
      return definition.create(context, file);
    },
  });
}

/** A file that can hold JSX. The react rules read these alone: a `.ts` hook module has no components to count. */
export function isComponentFile(file: RuleFile): boolean {
  return /\.[jt]sx$/.test(file.path);
}

/** Where a web/src/ file sits, or undefined for every file outside the web app. */
export function webPlaceOf(position: StudioPosition): WebPlace | undefined {
  return position.kind === "web-client" || position.kind === "web-server" ? position : undefined;
}

const importsByRoot = new Map<string, Readonly<Record<string, string>>>();

/** package.json's `imports`, read once per repo root. */
function studioImportsAt(cwd: string): Readonly<Record<string, string>> {
  let imports = importsByRoot.get(cwd);
  if (imports === undefined) {
    // SAFETY: the studio's own package.json, whose `imports` npm and Node already hold to this shape.
    const manifest = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8")) as { imports?: Record<string, string> };
    imports = manifest.imports ?? {};
    importsByRoot.set(cwd, imports);
  }
  return imports;
}

/** The position a relative or `#` specifier names, or undefined for a package. */
export function importedPosition(file: RuleFile, specifier: string, cwd: string): StudioPosition | undefined {
  let target: string | undefined;
  if (specifier.startsWith("#")) target = expandStudioAlias(specifier, studioImportsAt(cwd));
  else if (specifier.startsWith(".")) target = normalizeRepoPath(`${file.path.slice(0, file.path.lastIndexOf("/") + 1)}${specifier}`);
  return target === undefined ? undefined : classifyStudioPath(target, {});
}
