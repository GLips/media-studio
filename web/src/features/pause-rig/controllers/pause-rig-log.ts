// pause-rig-log.ts: what the pause rig keeps of a tuning session, for whoever reads it after: each note written on a
// clip and each "1 or 2?" pick, one JSON object a line, appended to a file in work/ that nothing else writes.
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { STUDIO_ROOT } from '#web/infrastructure/studio-engine.server.ts';

// Where the rig's logs live: notes.jsonl and picks.jsonl.
const PAUSE_RIG_LOG_DIR = join(STUDIO_ROOT, 'work', 'rigs', 'gap-speedup');

// `entry` is the line as the page wrote it with JSON.stringify, which never writes a newline.
const PauseRigLogLine = Schema.Struct({ log: Schema.Literals(['notes', 'picks']), entry: Schema.String });

/** A value a log line holds: what JSON writes. */
type PauseRigLogValue = string | number | boolean | null | undefined | readonly PauseRigLogValue[] | { readonly [key: string]: PauseRigLogValue };
/** What one line of a log holds: what was played and what the listener said, by name. */
export type PauseRigLogEntry = { readonly [key: string]: PauseRigLogValue };

/** Appends `entry` as one line of the rig's `log`, and answers the file. */
export const appendPauseRigLogFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(PauseRigLogLine))
  .handler(async ({ data }) => {
    JSON.parse(data.entry);
    await mkdir(PAUSE_RIG_LOG_DIR, { recursive: true });
    const file = join(PAUSE_RIG_LOG_DIR, `${data.log}.jsonl`);
    await appendFile(file, `${data.entry}\n`);
    return file;
  });
