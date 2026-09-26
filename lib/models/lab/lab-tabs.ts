/** The lab's tabs in order, each a lever the studio pulls when it makes a video. Its id is its URL: /lab/<id>. */
export const LAB_TABS = [
  { id: 'curves', label: 'Curves & springs' },
  { id: 'stagger', label: 'Stagger' },
  { id: 'kit', label: 'Kit pieces' },
  { id: 'hold', label: 'Hold check' },
  { id: 'sound', label: 'Sound' },
  { id: 'media', label: 'Generated media' },
] as const;

export type LabTabId = (typeof LAB_TABS)[number]['id'];

export const isLabTabId = (id: string): id is LabTabId => LAB_TABS.some((t) => t.id === id);
