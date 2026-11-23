// library-media.ts: where a page finds the library's media. Every page that plays it is served the media folder under
// one path: `/library-media` on its own origin, as the studio app (studio-app-library-media.ts) and a render's bundle
// (a link in the bundle's folder) serve it. A page served some other way names its base as it loads.
//
// Negative space: nothing here knows whether the media is online. A request for offline media fails where it's served,
// which says so.

let base = '/library-media';

/** Sets where this page finds library media, once, as it loads. */
export function setLibraryMediaBase(url: string): void {
  base = url.replace(/\/$/, '');
}

/** The URL of `file` in library item `item`'s media folder, as this page is served it. */
export const libraryMediaUrl = (item: string, file: string): string =>
  `${base}/${encodeURIComponent(item)}/${file.split('/').map(encodeURIComponent).join('/')}`;
