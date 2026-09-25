// whole-video.ts: plays a video from memory. Workers static assets ignores Range requests, and a <video> whose host
// won't serve ranges can't seek until the whole file has come in, so a cue click or a previs scrub would snap back
// to 0:00. The lab's videos are small (the largest is ~22 MB), so each is fetched once, kept for the page's life,
// and played from a blob URL, which seeks the same on any host.
import { useEffect, useState } from 'react';

const wholeVideos = new Map<string, Promise<string>>();

function loadLabWholeVideo(url: string): Promise<string> {
  let loading = wholeVideos.get(url);
  if (!loading) {
    loading = fetch(url).then((r) => r.blob()).then((blob) => URL.createObjectURL(blob));
    wholeVideos.set(url, loading);
  }
  return loading;
}

/** A seekable URL for the video at `url`, or undefined while it downloads. */
export function useLabWholeVideo(url: string | null | undefined): string | undefined {
  const [ready, setReady] = useState<{ url: string; src: string }>();
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadLabWholeVideo(url).then((src) => live && setReady({ url, src }));
    return () => {
      live = false;
    };
  }, [url]);
  return ready && ready.url === url ? ready.src : undefined;
}
