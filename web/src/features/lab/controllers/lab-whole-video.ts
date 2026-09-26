import { fetchStudioUrl } from '#web/infrastructure/api-client.ts';

// Every page's videos, fetched once each and kept for the page's life.
const wholeVideos = new Map<string, Promise<string>>();

/** An object URL for the whole video at `url`, downloaded once a page. */
export function loadLabWholeVideo(url: string): Promise<string> {
  let loading = wholeVideos.get(url);
  if (!loading) {
    loading = fetchStudioUrl(url).then((response) => response.blob()).then((blob) => URL.createObjectURL(blob));
    wholeVideos.set(url, loading);
  }
  return loading;
}
