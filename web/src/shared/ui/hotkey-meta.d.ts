// hotkey-meta.d.ts: every registration names its group and its name, so the cheatsheet groups it and HotkeyTooltip
// finds its key by name. `name` is the library's own (optional there); the cheatsheet lists a nameless one by its key.
/** The cheatsheet's sections; HOTKEY_GROUP_ORDER (hotkey-cheatsheet.tsx) sets their order. */
export type StudioHotkeyGroup =
  | 'global' | 'playback' | 'still' | 'timeline' | 'notes' | 'composer' | 'compare' | 'draw' | 'board' | 'decision' | 'plan' | 'dashboard';

declare module '@tanstack/hotkeys' {
  interface HotkeyMeta {
    group: StudioHotkeyGroup;
  }
}
