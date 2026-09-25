// ─── (f) One snapshot loader ──────────────────────────────────────────
//
// Every render writes its snapshot beside it, and a reader of a render reads
// that snapshot, never the latest check's out/check/timeline.json. Held by who
// may name what:
//
// - `renderMedia` and `stitchFramesToVideo` are imported only by the render session, whose renderVideo
//   writes the snapshot, so no render path skips the writer. The previs
//   blockout is exempt: a scene's layout sketch sent to generation, not the video.
// - The timeline file name (a path-like string ending in `timeline.json`) is
//   spelt only where Video.tsx names the artifact and the render session
//   names the report, and those constants reach only lib/engine/render, which
//   reads the artifact and writes the check's report, however they're re-exported.
// - The snapshot file name (`.snapshot.json`) is spelt only in the loader's
//   folder, so a snapshot is read through loadRenderSnapshot.
//
// Negative space: prose naming the files (a command's help) has spaces and
// isn't a path, so it's not caught, and nor is a name built by concatenation.

import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'render-snapshot';
/** The renderer's calls that write a video file. */
const VIDEO_WRITERS = ['renderMedia', 'stitchFramesToVideo'];
const RENDER_OWNERS = ['lib/engine/render/render-session.ts', 'lib/engine/render/previs-render.ts'];
/** Where the timeline file is named, and the constant each names it by. */
const TIMELINE_NAMES = [{ path: 'lib/studio/Video.tsx', name: 'TIMELINE_ARTIFACT' }, { path: 'lib/engine/render/render-session.ts', name: 'TIMELINE_REPORT_NAME' }];
const TIMELINE_ARTIFACT_READERS = 'lib/engine/render/';
const SNAPSHOT_OWNER = 'lib/engine/snapshot/';

export const renderSnapshotCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    const isArtifact = (origin: { path: string; name: string }) => TIMELINE_NAMES.some((owner) => owner.path === origin.path && owner.name === origin.name);
    const reachesTimelineArtifact = (target: string, names: readonly string[] | '*') =>
      (names === '*' ? context.exportedNames(target) : names).some((name) => context.originsOf(target, name).some(isArtifact));
    for (const file of context.tree.sources) {
      const found = (line: number, key: string, message: string) => findings.push({ check: ID, path: file.path, line, key, message });
      for (const edge of context.edgesFrom(file)) {
        const { names } = edge.scanned;
        const imports = (name: string) => names === '*' || names.includes(name);
        const writer = VIDEO_WRITERS.find(imports);
        if (edge.target.kind === 'package' && edge.target.name === '@remotion/renderer' && writer && !RENDER_OWNERS.includes(file.path)) {
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
            found(file.lineOf(node.start), text, 'names a render\'s snapshot file: read it through loadRenderSnapshot (lib/engine/snapshot)');
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
