// review-search.ts: the review screen's URL, `/projects/<p>/artifacts/<file>?f=120&note=12…`, so a reload, a copied
// link or a render switch lands where the reviewer was. Router search values arrive JSON-parsed: `?f=120` is a number.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { optionalSearchParam, useRouteSearchWriter, type RouteSearchWriting } from '#web/shared/route-search.ts';

const Frame = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)));
const ThreadId = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)));

export const ReviewSearch = Schema.Struct({
  /** The settled frame, on the shown render's clock. Absent is 0. */
  f: optionalSearchParam(Frame),
  /** The thread in focus. */
  note: optionalSearchParam(ThreadId),
  /** The marked range, frames on the render's clock. */
  in: optionalSearchParam(Frame),
  out: optionalSearchParam(Frame),
  /** The render shown, by hash; absent is the newest. */
  r: optionalSearchParam(Schema.String),
  /** The render compared against, by hash. */
  vs: optionalSearchParam(Schema.String),
  cmp: optionalSearchParam(Schema.Literals(['flip', 'wipe', 'side'])),
  /** The wipe's position across the frame, 0–1. */
  w: optionalSearchParam(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))),
  /** Absent is the stage. */
  view: optionalSearchParam(Schema.Literals(['stage', 'board', 'grid'])),
  /** On a folder's URL, the still its grid opens on, by file name; the folder redirects to that still's own URL. */
  still: optionalSearchParam(Schema.String),
  /** The thread's filter; absent is `active` (all but resolved). */
  filter: optionalSearchParam(Schema.Literals(['active', 'open', 'all'])),
  /** 1 is 1:1; absent fits the stage. */
  z: optionalSearchParam(Schema.Literal(1)),
});
export type ReviewSearch = typeof ReviewSearch.Type;

/**
 * The route's `validateSearch`. The router writes a string that would parse as a number quoted, so a numeric-looking
 * render hash round-trips; a param edited by hand into nonsense is dropped.
 */
export const reviewSearchValidator = Schema.toStandardSchemaV1(ReviewSearch);

/** The wipe's default position: the middle of the frame. */
const REVIEW_WIPE_MIDDLE = 0.5;

/** Leaves out what the screen assumes when a key is absent (frame 0, the stage, the active filter), so links stay plain. */
function withoutReviewSearchDefaults({ f, view, filter, w, ...rest }: ReviewSearch): ReviewSearch {
  return {
    ...rest,
    ...(f !== undefined && f > 0 && { f }),
    ...(view !== undefined && view !== 'stage' && { view }),
    ...(filter !== undefined && filter !== 'active' && { filter }),
    ...(w !== undefined && w !== REVIEW_WIPE_MIDDLE && { w }),
  };
}

/** `note`, `r` and `view` are places; `f` and `w` are written as the playhead settles or the wipe drags. */
const REVIEW_SEARCH_WRITING: RouteSearchWriting<ReviewSearch> = {
  pushed: ['note', 'r', 'view'], debounced: ['f', 'w'], withoutDefaults: withoutReviewSearchDefaults,
};

export type SetReviewSearch = (patch: ReviewSearch) => void;

/** The URL's search and its writer. */
export function useReviewSearch(): readonly [ReviewSearch, SetReviewSearch] {
  const search = useSearch({ from: '/projects/$project/artifacts/$' });
  const navigate = useNavigate({ from: '/projects/$project/artifacts/$' });
  return [search, useRouteSearchWriter(navigate, REVIEW_SEARCH_WRITING)];
}
