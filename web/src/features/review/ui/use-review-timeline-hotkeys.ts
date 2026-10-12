import { useHotkeys } from '@tanstack/react-hotkeys';

/** How far one press of `=` or `-` zooms. */
const REVIEW_TIMELINE_ZOOM_STEP = 2;

/** The dock's zoom: `=` in and `-` out at the playhead, `0` back to the whole render. */
export function useReviewTimelineHotkeys({ zoomBy, fit }: { readonly zoomBy: (factor: number) => void; readonly fit: () => void }) {
  useHotkeys([
    { hotkey: '=', callback: () => zoomBy(REVIEW_TIMELINE_ZOOM_STEP), options: { meta: { group: 'timeline', name: 'Zoom in' } } },
    { hotkey: '-', callback: () => zoomBy(1 / REVIEW_TIMELINE_ZOOM_STEP), options: { meta: { group: 'timeline', name: 'Zoom out' } } },
    { hotkey: '0', callback: fit, options: { meta: { group: 'timeline', name: 'Fit timeline' } } },
  ]);
}
