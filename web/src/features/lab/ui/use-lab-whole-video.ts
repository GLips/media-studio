import { useEffect, useState } from 'react';
import { loadLabWholeVideo } from '../controllers/lab-whole-video.ts';

/**
 * A seekable URL for the video at `url`, or undefined while it downloads. An export's host may ignore Range, and a
 * <video> without ranges can't seek until the whole file is in, so a cue click would snap back to 0:00. The lab's
 * videos are small (~22 MB at most), so each plays from a blob, which seeks anywhere.
 */
export function useLabWholeVideo(url: string | null | undefined): string | undefined {
  const [ready, setReady] = useState<{ url: string; src: string }>();
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    void loadLabWholeVideo(url).then((src) => live && setReady({ url, src }));
    return () => {
      live = false;
    };
  }, [url]);
  return ready && ready.url === url ? ready.src : undefined;
}
