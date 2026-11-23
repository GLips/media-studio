// library-media.ts: where a page finds the library's media. Every page that plays it is served the media folder at
// `/library-media` (footage/library-media's server): the studio app on its own origin, a render and `studio preview`
// on a loopback server of their own, whose origin the page is handed as it loads (VideoProps' libraryMedia).
//
// Negative space: nothing here knows whether the media is online. A request for offline media fails where it's served,
// which says so.

let origin = '';

/** Sets the origin this page's library media is served from, once, as it loads. */
export function setLibraryMediaOrigin(url: string): void {
  origin = url.replace(/\/$/, '');
}

/** The URL of `file` in library item `item`'s media folder, as this page is served it. */
export const libraryMediaUrl = (item: string, file: string): string =>
  `${origin}/library-media/${encodeURIComponent(item)}/${file.split('/').map(encodeURIComponent).join('/')}`;

/** What a render's page asks its server for: a video file's picture at `t` media seconds, `width` pixels wide, on an `fps` grid. */
export type LibraryFrameRequest = { item: string; file: string; t: number; width: number; fps: number };

/** The URL of one picture of a video file, served only to a render, which serves its pages from an origin of its own. */
export function libraryFrameUrl({ item, file, t, width, fps }: LibraryFrameRequest): string {
  if (!origin) throw new Error("this render serves no library media: it's drawn by `studio render`, whose pages are handed where it is");
  return `${origin}/library-frames?${new URLSearchParams({ item, file, t: t.toFixed(4), width: String(width), fps: String(fps) })}`;
}
