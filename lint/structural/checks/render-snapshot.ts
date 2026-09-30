// ─── (f) One snapshot loader ──────────────────────────────────────────
//
// Every render writes its snapshot beside it, and a reader of a render reads
// that snapshot, never the latest check's out/check/timeline.json. Held by who
// may name what:
//
// - Only the render session imports the video writers, so no render path skips
//   the snapshot. The previs blockout is exempt: it's a sketch, not the video.
// - A path ending in `timeline.json` is spelt only in the two TIMELINE_NAMES
//   constants, which reach only the render feature's engine, however re-exported.
// - `.snapshot.json` is spelt only in the loader's module and its spec, so a
//   snapshot is read through loadRenderSnapshot.
//
// Negative space: prose naming the files (it has spaces) and a name built by
// concatenation aren't caught.

import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'render-snapshot';
/** The renderer's calls that write a video file. */
const VIDEO_WRITERS = ['renderMedia', 'stitchFramesToVideo'];
const RENDER_OWNERS = new Set(['lib/output/render/engine/render-session.ts', 'lib/output/render/engine/previs-render.ts']);
/** Where the timeline file is named, and the constant each names it by. */
const TIMELINE_NAMES = [{ path: 'lib/picture/composition/studio/Video.tsx', name: 'TIMELINE_ARTIFACT' }, { path: 'lib/output/render/engine/render-session.ts', name: 'TIMELINE_REPORT_NAME' }];
const TIMELINE_ARTIFACT_READERS = 'lib/output/render/engine/';
const SNAPSHOT_OWNER = 'lib/output/render/engine/render-snapshot';

export const renderSnapshotCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    const isArtifact = (origin: { path: string; name: string }) => TIMELINE_NAMES.some((owner) => owner.path === origin.path && owner.name === origin.name);
    const reachesTimelineArtifact = (target: string, names: readonly string[] | '*') =>
      (names === '*' ? context.exportedNames(target) : names).some((name) => context.originsOf(target, name).some(isArtifact));
    for (const file of context.tree.sources) {
      // lint/ names the files this polices, and renders nothing.
      if (context.positionOf(file.path).kind === 'lint') continue;
      const found = (line: number, key: string, message: string) => findings.push({ check: ID, path: file.path, line, key, message });
      for (const edge of context.edgesFrom(file)) {
        const { names } = edge.scanned;
        const imports = (name: string) => names === '*' || names.includes(name);
        const writer = VIDEO_WRITERS.find(imports);
        if (edge.target.kind === 'package' && edge.target.name === '@remotion/renderer' && writer && !RENDER_OWNERS.has(file.path)) {
          found(edge.line, writer, 'renders a video past the render session, so it gets no snapshot: render through session.renderVideo');
        }
        if (edge.target.kind === 'module' && !file.path.startsWith(TIMELINE_ARTIFACT_READERS) && reachesTimelineArtifact(edge.target.path, names)) {
          found(edge.line, 'timeline name', 'reaches for the timeline artifact or the check\'s timeline.json: a render\'s timeline is in its snapshot (loadRenderSnapshot)');
        }
      }
      walkAst(file.program, (node) => {
        for (const text of stringParts(node).filter((part) => !/\s/.test(part))) {
          if (text.endsWith('timeline.json') && !TIMELINE_NAMES.some((owner) => owner.path === file.path)) {
            found(file.lineOf(node.start), text, 'names timeline.json, the latest check\'s report: a render\'s timeline is in its snapshot (loadRenderSnapshot)');
          }
          if (text.includes('.snapshot.json') && !file.path.startsWith(SNAPSHOT_OWNER)) {
            found(file.lineOf(node.start), text, 'names a render\'s snapshot file: read it through loadRenderSnapshot (lib/output/render/engine/render-snapshot.ts)');
          }
        }
      });
    }
    return findings;
  },
};

/** A string literal's text, or each literal piece of a template. Comments aren't nodes, so they're never read. */
function stringParts(node: AstNode): string[] {
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') return (node.quasis as AstNode[]).map((q) => (q.value as { cooked?: string }).cooked ?? '');
  return [];
}
