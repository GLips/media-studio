// use-library-input-log.ts: an item's input log (clicks, keys, the cursor's path) for a scene, read from the media
// folder as the page is served it. It's library data, not source: it stays beside the item's media, however long.
import { Result } from 'effect';
import { useEffect, useState } from 'react';
import { useDelayRender } from 'remotion';
import { parseRecorderInputLog, type InputLog } from '#lib/footage/input-log/models/input-log.ts';
import type { LibraryFootage } from '../models/library-footage.ts';
import { libraryMediaUrl } from './library-media.ts';

// One fetch per log for the page, however many scenes and frames read it.
const loading = new Map<string, Promise<InputLog>>();

/** `footage`'s input log once loaded (a render waits for it), null until then. Throws for an item with none. */
export function useLibraryInputLog(footage: LibraryFootage): InputLog | null {
  const { id, input } = footage.item;
  if (!input) throw new Error(`${id} has no input log: only a recording made with one (Studio Recorder) has clicks and a cursor path`);
  const url = libraryMediaUrl(id, input.file);
  const [log, setLog] = useState<InputLog | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  useEffect(() => {
    const handle = delayRender(`loading ${id}'s input log`);
    let promise = loading.get(url);
    if (!promise) {
      promise = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`${id}'s input log isn't served (${response.status}): is the library's media folder online?`);
        const read = parseRecorderInputLog(await response.text(), `${id}'s ${input.file}`);
        if (Result.isFailure(read)) throw read.failure;
        return { ...read.success, coordinates: input.coordinates };
      });
      loading.set(url, promise);
    }
    promise.then((loaded) => {
      setLog(loaded);
      return continueRender(handle);
    }, (error: Error) => cancelRender(error));
  }, [url, id, input.file, input.coordinates, delayRender, continueRender, cancelRender]);
  return log;
}
