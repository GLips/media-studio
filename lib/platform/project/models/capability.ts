// capability.ts: what a project is made of, declared once in its project.ts (`studio new` writes it) and held by
// check:arch's capability match to what the project actually binds.
//
// A project's parts: music, when its timeline.ts cuts scenes to a beat grid; voice, when its timeline.ts lays scenes
// on recorded lines; stills, when its stills.tsx registers designs. One part names its capability; two or more make
// it mixed. A music bed under a voice is sound, not a part: the voice still sets the timing. A timeline with neither
// is a silent video on fixed spans: it plays no voice, music or sound at all, and delivers with no audio track.

export const PROJECT_CAPABILITIES = ['music-led', 'voice-led', 'still-only', 'mixed', 'silent'] as const;
export type ProjectCapability = (typeof PROJECT_CAPABILITIES)[number];

/** A project's project.ts: `export default { capability: 'voice-led' } satisfies ProjectDeclaration;` */
export type ProjectDeclaration = {
  capability: ProjectCapability;
  /**
   * The project's shared modules, as paths inside it (`['look.ts', 'hud/hud.ts']`), written out as literals for
   * check:arch to read: files every scene may import (a palette, a HUD), held to never importing back into a scene.
   * A scene's own file or a root module can't be declared shared.
   */
  shared?: readonly string[];
};

export type ProjectPart = 'music' | 'voice' | 'stills';

const SINGLE_PART: Record<ProjectPart, ProjectCapability> = { music: 'music-led', voice: 'voice-led', stills: 'still-only' };

/**
 * The capability a project's parts make: `silent` for a timeline with no part (`timed`), undefined for no timeline
 * and no part.
 */
export function capabilityOfParts(parts: readonly ProjectPart[], { timed }: { timed: boolean }): ProjectCapability | undefined {
  const distinct = [...new Set(parts)];
  if (distinct.length > 1) return 'mixed';
  if (distinct.length) return SINGLE_PART[distinct[0]];
  return timed ? 'silent' : undefined;
}
