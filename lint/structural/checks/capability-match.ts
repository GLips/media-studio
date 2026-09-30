// ─── Capability match ─────────────────────────────────────────────────
//
// A project's capability, declared in project.ts, is held to what the project
// binds: its timeline's grid (music) and voice (voice), read off the
// defineTimeline call, and its stills.tsx's defineStills (stills). A bound
// timeline with neither is silent. A timeline counts only when video.tsx binds
// it with bindTimeline; a video.tsx without a timeline.ts fits no capability.
//
// Negative space: what a part holds isn't judged here (a beat scene's cues, a
// still's presets); the timeline throws at load and the retime runner and
// still check hold those. Nor is a silent video's quiet: a scene can place a
// sound anywhere, so its delivered file's review holds that it has no audio.

import { capabilityOfParts, PROJECT_CAPABILITIES, type ProjectCapability, type ProjectPart } from '#lib/platform/project/models/capability.ts';
import { declaredProperty, propertyKeyName, unwrapExpression } from '../project-declaration.ts';
import type { AstNode, SourceFile } from '../source-tree.ts';
import { callsTo, type CheckContext, type Finding, type StructuralCheck } from '../check-context.ts';

const ID = 'capability-match';
const DEFINE_TIMELINE = { path: 'lib/timing/timeline/models/timeline.ts', name: 'defineTimeline' };
const BIND_TIMELINE = { path: 'lib/timing/timeline/models/bind-timeline.ts', name: 'bindTimeline' };
const DEFINE_STILLS = { path: 'lib/picture/stills/studio/stills.tsx', name: 'defineStills' };
/** The keys of a timeline's spec that make a part. */
const TIMELINE_PARTS: Readonly<Record<string, ProjectPart>> = { grid: 'music', voice: 'voice' };

type ProjectRoots = { project?: SourceFile; timeline?: SourceFile; video?: SourceFile; stills?: SourceFile };

export const capabilityMatchCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const projects = new Map<string, ProjectRoots>();
    for (const file of context.tree.sources) {
      const position = context.positionOf(file.path);
      if (position.kind !== 'project') continue;
      const roots = projects.get(position.project) ?? {};
      if (position.role === 'project' || position.role === 'timeline' || position.role === 'video' || position.role === 'stills') roots[position.role] = file;
      projects.set(position.project, roots);
    }
    return [...projects.values()].flatMap((roots) => matchProject(context, roots));
  },
};

function matchProject(context: CheckContext, { project, timeline, video, stills }: ProjectRoots): Finding[] {
  const composition = video ?? stills ?? timeline;
  if (!composition) return [];
  const findings: Finding[] = [];
  const report = (file: SourceFile, line: number, key: string, message: string) => findings.push({ check: ID, path: file.path, line, key, message });

  const parts: ProjectPart[] = [];
  let timed = false;
  if (timeline) {
    const [call] = callsTo(context, timeline, DEFINE_TIMELINE);
    const spec = call && unwrapExpression((call.arguments as AstNode[])[0]);
    if (spec?.type !== 'ObjectExpression') {
      report(timeline, 1, 'timeline unreadable', 'states no defineTimeline({ … }) whose grid and voice can be read');
    } else {
      for (const key of propertyNames(spec)) if (TIMELINE_PARTS[key]) parts.push(TIMELINE_PARTS[key]);
    }
    if (!video || !callsTo(context, video, BIND_TIMELINE).length) {
      report(timeline, 1, 'timeline unbound', 'no video.tsx binds this timeline with bindTimeline, so no picture plays on it');
    } else {
      timed = true;
    }
  } else if (video) {
    report(video, 1, 'video without timeline', 'times its scenes itself: state them in a timeline.ts and bind them with bindTimeline');
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
