import { createContext, useContext, type ReactNode } from 'react';

/** One place quick-open can go: a project, a file, a decision, a script. */
export type QuickOpenEntry = {
  key: string;
  glyph: ReactNode;
  label: string;
  /** Where it is, dim after the label and searched with it: the project of a file. */
  context?: string;
  href: string;
  /** In the project on screen: ranked above another project's place that matches as well (its `animatic`). */
  near?: boolean;
};

/** Draws quick-open's body with its places: undefined until they've loaded. */
export type QuickOpenEntriesBody = (entries: readonly QuickOpenEntry[] | undefined) => ReactNode;

/**
 * Wraps quick-open's body in whatever loads its places, a component that loads them while mounted, which is while
 * quick-open is open.
 */
export type QuickOpenEntriesSource = (body: QuickOpenEntriesBody) => ReactNode;

const NoQuickOpenEntries: QuickOpenEntriesSource = (body) => body([]);

// Shared code can't reach a feature, so the places come from whoever mounts the provider (the root route).
const QuickOpenEntriesContext = createContext<QuickOpenEntriesSource>(NoQuickOpenEntries);

/** Supplies quick-open's places. */
export function QuickOpenEntriesProvider({ source, children }: { readonly source: QuickOpenEntriesSource; readonly children: ReactNode }) {
  return <QuickOpenEntriesContext value={source}>{children}</QuickOpenEntriesContext>;
}

/** The source the provider supplies, for quick-open to mount while open. */
export function useQuickOpenEntriesSource(): QuickOpenEntriesSource {
  return useContext(QuickOpenEntriesContext);
}
