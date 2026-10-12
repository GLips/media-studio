import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { HotkeyCheatsheet } from './hotkey-cheatsheet.tsx';
import { QuickOpen } from './quick-open.tsx';
import { useGlobalHotkeys } from './use-global-hotkeys.ts';

type StudioOverlays = { readonly openCheatsheet: () => void; readonly openQuickOpen: () => void };

const StudioOverlaysContext = createContext<StudioOverlays | null>(null);

/**
 * The cheatsheet, quick-open and the global keys, once for the whole app. Not in the shell: two shells mount at once
 * while a route's pending page gives way, and a key registered twice on the document throws.
 */
export function StudioOverlaysProvider({ children }: { readonly children: ReactNode }) {
  const [cheatsheet, setCheatsheet] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  useGlobalHotkeys({ toggleCheatsheet: () => setCheatsheet((o) => !o), openQuickOpen: () => setQuickOpen(true) });
  const overlays = useMemo<StudioOverlays>(() => ({ openCheatsheet: () => setCheatsheet(true), openQuickOpen: () => setQuickOpen(true) }), []);
  return (
    <StudioOverlaysContext value={overlays}>
      {children}
      <HotkeyCheatsheet opened={cheatsheet} onClose={() => setCheatsheet(false)} />
      <QuickOpen opened={quickOpen} onClose={() => setQuickOpen(false)} />
    </StudioOverlaysContext>
  );
}

export function useStudioOverlays(): StudioOverlays {
  const overlays = useContext(StudioOverlaysContext);
  if (!overlays) throw new Error('useStudioOverlays needs the StudioOverlaysProvider the root route renders');
  return overlays;
}
