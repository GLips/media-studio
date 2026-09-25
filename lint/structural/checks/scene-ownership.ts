// ─── (b) Scene ownership ──────────────────────────────────────────────
//
// A scene's helpers live in its own folder (`bars/<id>/`, `scenes/<id>/`), so
// splitting a big scene file can't launder its tangle into a sibling. Within a
// project, a scene and its helpers reach only their own folder, declared shared
// modules, the timeline, sounds, media and generated modules. Nothing a scene
// can reach (a shared module, the timeline, a sound) imports back into a scene
// or into an unclassified project file.
//
// Type-only imports count: they still couple two scenes' code. Edges to another
// project are import-policy's; the composition (`video.tsx`) may import every
// scene and isn't held here.

import type { ProjectRole } from '../../policy/studio-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'scene-ownership';

/** Roles a scene's code can reach, and so roles held to this check. */
const SCENE_REACHABLE = new Set(['scene', 'scene-helper', 'model', 'shared', 'timeline', 'sfx']);
/** Roles any scene-reachable file may import. */
const OPEN_TARGETS = new Set(['shared', 'timeline', 'sfx', 'media', 'generated', 'brand']);

const sceneOf = (role: ProjectRole) => ('scene' in role ? role.scene : undefined);

export const sceneOwnershipCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      const from = context.positionOf(file.path);
      if (from.kind !== 'project' || !SCENE_REACHABLE.has(from.role)) continue;
      for (const edge of context.edgesFrom(file)) {
        if (edge.target.kind !== 'module') continue;
        const to = context.positionOf(edge.target.path);
        if (to.kind !== 'project' || to.project !== from.project || OPEN_TARGETS.has(to.role)) continue;
        const own = sceneOf(from), theirs = sceneOf(to);
        if (own !== undefined && own === theirs) continue;
        let message: string;
        if (to.role === 'unclassified') {
          message = `reaches ${edge.target.path}, which is neither this scene's helper nor a declared shared module: `
            + `move it into the scene's folder, or declare it in lint/policy/declared-shared.ts`;
        } else if (theirs !== undefined) {
          message = own !== undefined
            ? `scene ${own} imports scene ${theirs}'s code; reach its moments through the timeline's cues`
            : `a ${from.role} module imports back into scene ${theirs}`;
        } else {
          message = `a scene's code imports the project's ${to.role} (${edge.target.path})`;
        }
        findings.push({ check: ID, path: file.path, line: edge.line, key: edge.scanned.specifier, message });
      }
    }
    return findings;
  },
};
