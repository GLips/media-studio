// stamp-sheet-state-key.ts: a sheet program's state keys (ENGINE 4.2): K₀ hashes the program's head, each Kₖ the key
// before it and entry k as read: its digest (stamp-canonical.ts) and pose. SHA-256, alike in Node and the browser, so
// equal keys mean equal state on any machine.

import { textSha256Hex } from '#lib/platform/hash/models/sha256.ts';
import type { StampSheetEntry } from './stamp-sheet-program.ts';

/** K₀: the key of a program's incoming state, from its head's canonical text. */
export const stampSheetHeadKey = (head: string) => textSha256Hex(`head\n${head}`);

/** Kₖ: the key after an entry, from the key before it and the entry as read: its datum's digest at rest and the map posing it. */
export const stampSheetEntryKey = (before: string, entry: Pick<StampSheetEntry, 'digest' | 'pose'>) => textSha256Hex(`${before}\n${entry.digest}\n${entry.pose}`);
