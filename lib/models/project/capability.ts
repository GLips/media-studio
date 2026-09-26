// capability.ts: what a project is made of, declared once in its project.ts (`studio new` writes it) and held by
// check:arch's capability match to what the project actually binds.
//
// A project's parts: music, when its timeline.ts cuts scenes to a beat grid; voice, when its timeline.ts lays scenes
// on recorded lines; stills, when its stills.tsx registers designs. One part names its capability; two or more make
// it mixed. A music bed under a voice is sound, not a part: the voice still sets the timing.

export const PROJECT_CAPABILITIES = ['music-led', 'voice-led', 'still-only', 'mixed'] as const;
export type ProjectCapability = (typeof PROJECT_CAPABILITIES)[number];

/** A project's project.ts: `export default { capability: 'voice-led' } satisfies ProjectDeclaration;` */
export type ProjectDeclaration = { capability: ProjectCapability };

export type ProjectPart = 'music' | 'voice' | 'stills';

const SINGLE_PART: Record<ProjectPart, ProjectCapability> = { music: 'music-led', voice: 'voice-led', stills: 'still-only' };

/** The capability a project's parts make, or undefined for none (a silent video on fixed spans). */
export function capabilityOfParts(parts: readonly ProjectPart[]): ProjectCapability | undefined {
  const distinct = [...new Set(parts)];
  if (distinct.length > 1) return 'mixed';
  return distinct.length ? SINGLE_PART[distinct[0]] : undefined;
}
