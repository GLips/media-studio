// ─── Capability match ─────────────────────────────────────────────────
//
// A project's capability, declared in project.ts, is held to what the project
// binds: its storyboard's grid (music) and voice (voice), read off the
// defineStoryboard call, and its stills.tsx's defineStills (stills). A bound
// storyboard with neither is silent. A storyboard counts only when video.tsx
// hands it to defineVideo; a video.tsx without a storyboard.ts fits no
// capability.
//
// Negative space: what a part holds isn't judged here (a beat scene's cues, a
// still's presets); the storyboard's diagnostics, the retime check and the
// still check hold those. Nor is a silent video's quiet: a scene can place a
// sound anywhere, so its delivered file's review holds that it has no audio.

import { STORYBOARD_CONSTRUCTOR } from '../../policy/timing-constructors.ts';
import { capabilityOfParts, PROJECT_CAPABILITIES, type ProjectCapability, type ProjectPart } from '#lib/platform/project/models/capability.ts';
import { declaredProperty, propertyKeyName, unwrapExpression } from '../project-declaration.ts';
import type { AstNode, SourceFile } from '../source-tree.ts';
import { callsTo, type CheckContext, type Finding, type StructuralCheck } from '../check-context.ts';

const ID = 'capability-match';
const DEFINE_VIDEO = { path: 'lib/picture/video/studio/video.ts', name: 'defineVideo' };
const DEFINE_STILLS = { path: 'lib/picture/stills/studio/stills.tsx', name: 'defineStills' };
/** The keys of a storyboard that make a part. */
const STORYBOARD_PARTS: Readonly<Record<string, ProjectPart>> = { grid: 'music', voice: 'voice' };

type ProjectRoots = { project?: SourceFile; storyboard?: SourceFile; video?: SourceFile; stills?: SourceFile };

export const capabilityMatchCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const projects = new Map<string, ProjectRoots>();
    for (const file of context.tree.sources) {
      const position = context.positionOf(file.path);
      if (position.kind !== 'project') continue;
      const roots = projects.get(position.project) ?? {};
      if (position.role === 'project' || position.role === 'storyboard' || position.role === 'video' || position.role === 'stills') roots[position.role] = file;
      projects.set(position.project, roots);
    }
    return [...projects.values()].flatMap((roots) => matchProject(context, roots));
  },
};

function matchProject(context: CheckContext, { project, storyboard, video, stills }: ProjectRoots): Finding[] {
  const composition = video ?? stills ?? storyboard;
  if (!composition) return [];
  const findings: Finding[] = [];
  const report = (file: SourceFile, line: number, key: string, message: string) => findings.push({ check: ID, path: file.path, line, key, message });

  const parts: ProjectPart[] = [];
  let timed = false;
  if (storyboard) {
    const [call] = callsTo(context, storyboard, STORYBOARD_CONSTRUCTOR);
    // SAFETY: a CallExpression's `arguments` is always an array of expression nodes.
    const plan = call && unwrapExpression((call.arguments as AstNode[])[0]);
    if (plan?.type !== 'ObjectExpression') {
      report(storyboard, 1, 'storyboard unreadable', 'states no defineStoryboard({ … }) whose grid and voice can be read');
    } else {
      for (const key of propertyNames(plan)) if (STORYBOARD_PARTS[key]) parts.push(STORYBOARD_PARTS[key]);
    }
    if (!video || !callsTo(context, video, DEFINE_VIDEO).length) {
      report(storyboard, 1, 'storyboard unbound', 'no video.tsx hands this storyboard to defineVideo, so no picture plays on it');
    } else {
      timed = true;
    }
  } else if (video) {
    report(video, 1, 'video without storyboard', 'has no plan to time its scenes: state them in a storyboard.ts and hand it to defineVideo');
  }
  if (stills) {
    if (callsTo(context, stills, DEFINE_STILLS).length) parts.push('stills');
    else report(stills, 1, 'stills unregistered', 'registers no designs with defineStills');
  }

  const found = capabilityOfParts(parts, { timed });
  const binds = parts.length ? parts.join(' and ') : 'no music, voice or stills';
  if (!project) {
    report(composition, 1, 'no project.ts', found
      ? `declares no capability: add project.ts, \`export default { capability: '${found}' } satisfies ProjectDeclaration\``
      : `declares no capability, and binds ${binds} for one to match`);
    return findings;
  }
  const declared = declaredCapability(project);
  if (!declared) {
    report(project, 1, 'capability unreadable', `default-exports no { capability } that is one of ${PROJECT_CAPABILITIES.join(', ')}`);
  } else if (declared !== found) {
    report(project, 1, `${declared} binds ${binds}`, `declares ${declared}, but the project binds ${binds}${found ? `: that is ${found}` : ''}`);
  }
  return findings;
}

function declaredCapability(file: SourceFile): ProjectCapability | undefined {
  const value = declaredProperty(file, 'capability');
  return value?.type === 'Literal' && PROJECT_CAPABILITIES.includes(value.value as ProjectCapability) ? value.value as ProjectCapability : undefined;
}

function propertyNames(object: AstNode): string[] {
  return (object.properties as AstNode[]).flatMap((p) => (p.type === 'Property' ? [propertyKeyName(p)].filter((k): k is string => k !== undefined) : []));
}
