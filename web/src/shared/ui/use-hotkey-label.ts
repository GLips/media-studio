import { formatForDisplay, formatHotkeySequence, getHotkeyManager, getSequenceManager, toHotkeyRegistrationView, type HotkeyMeta } from '@tanstack/react-hotkeys';
import { useSyncExternalStore } from 'react';

/** A binding as the cheatsheet and tooltips read it: its meta and its key, formatted for this platform. */
export type StudioHotkeyBinding = { meta: HotkeyMeta | undefined; keys: string; enabled: boolean };

/** Every key and sequence registered now. */
export function studioHotkeyBindings(): StudioHotkeyBinding[] {
  const hotkeys = [...getHotkeyManager().registrations.state.values()].map(toHotkeyRegistrationView);
  const sequences = [...getSequenceManager().registrations.state.values()];
  return [
    ...hotkeys.map((h) => ({ meta: h.options.meta, keys: formatForDisplay(h.hotkey), enabled: h.options.enabled !== false })),
    ...sequences.map((s) => ({ meta: s.options.meta, keys: formatHotkeySequence(s.sequence), enabled: s.options.enabled !== false })),
  ];
}

function subscribeToHotkeyRegistry(onChange: () => void): () => void {
  const keys = getHotkeyManager().registrations.subscribe(onChange);
  const sequences = getSequenceManager().registrations.subscribe(onChange);
  return () => {
    keys.unsubscribe();
    sequences.unsubscribe();
  };
}

/**
 * A string read off the hotkey registry, re-rendering only when that string changes. Only a string: useHotkeys
 * re-sets every binding's options while its component renders, and a reader whose snapshot then compared unequal would
 * be updated in the middle of that render.
 */
export function useHotkeyRegistryString(read: () => string): string {
  return useSyncExternalStore(subscribeToHotkeyRegistry, read, read);
}

/** The key bound to `name`, preferring a binding that's on now; '' when nothing registers that name. */
function hotkeyLabelOf(name: string): string {
  const named = studioHotkeyBindings().filter((b) => b.meta?.name === name);
  return (named.find((b) => b.enabled) ?? named[0])?.keys ?? '';
}

/**
 * The key bound to the action registered as `name`, formatted for this platform (⌘⇧C on a Mac), or null when nothing
 * registers that name now. Read from the live registry, so a tooltip can't drift from its binding.
 */
export function useHotkeyLabel(name: string): string | null {
  return useHotkeyRegistryString(() => hotkeyLabelOf(name)) || null;
}
