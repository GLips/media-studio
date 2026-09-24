---
name: video-capture
description: Capture a site for a video by writing a project's capture.ts (stills and takes with captureShots). Use when adding or redoing a shot, when a shot blanks, times out or misses its target.
---

# Capturing

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it. `projects/<p>/capture.ts` declares
named shots with `captureShots` from `lib/capture.ts`, whose header and types are the API. `studio capture <p>` films
them into `captures/`; `--only=a,b` redoes just those, and the rest keep their last capture.
`projects/2026-09-simple-buy-box-story/capture.ts` is a worked example.

Find selectors with `studio probe <p> <url-or-path>` (`--at=x,y` for one spot): it opens the page as the shots will,
signed in and styled, and lists elements with rect specs and match counts. Use it instead of a throwaway Playwright
script.

## Still or take

- **Still**, the default: a high-DPI screenshot plus the page rects of what scenes point at. Cameras pan and zoom over
  it, and a state change dissolves between two stills of the same page. Close-ups whose point is sharpness stay here;
  take frames are JPEG.
- **Take**: a screencast of real clicks, scrolls and typing. It earns its place only where the viewer must watch the
  action happen (a carousel sliding, a menu opening) and a cut between stills would jump. Takes film in real time,
  one at a time, at the site's pace; the scene fits them to the voice later, and past ~1.5× they read rushed, so
  leave `wait`s where a read needs room.

## Every shot stands alone

- `setup` takes a fresh page to its state by itself, so `--only=name` redoes that shot alone. Shots share helper
  functions, never order.
- `prepare` runs once per device before any shot (a preview cookie, a consent click). Each shot gets its own context
  seeded from it, so a cart add in one shot never shows in another.
- What `setup` returns is passed to `data` and to a function `scrollY`. `data` records what a screenshot can't hold
  (a native menu's option names) for the scene to redraw.
- `scrollY` captures just the viewport, scrolled there: the way to show a sticky bar where a visitor sees it. A
  function measures it after `setup`.
- A rect that matches nothing throws unless it's `optional`, so a finished capture holds every rect scenes ask for.
- Anchor a rect's `text` regex (`'^Sign in$'`), or longer text containing the words matches too.

## Sites behind a sign-in

- `prepare` signs in once per device, and every shot starts from its cookies.
- Credentials come only from environment variables the user names: read `process.env.X` in `capture.ts`, and have
  the user run `studio capture` under their secret launcher. Never write them to a file or go looking for them; if
  none are given, ask. Where the product runs locally, film a demo instance on seeded data instead, with its own
  throwaway password.
- A sign-in form ignores submits until the app hydrates, even though its fields keep what's typed. Call
  `waitForHydration(page, submitSelector)` before filling it, not `networkidle` or a fixed timeout.

## Takes

- `setup` reaches the opening frame off camera; `perform(rec)` is what's filmed. The cursor isn't filmed: the studio
  draws it from the log.
- `rec.moveTo`, `click`, `type` and `scrollTo` each take a `mark` that names the moment (arrival, the click, the first
  key, the scroll's start) and measures `rects` then; `rec.mark` names a moment on its own. Scenes pin marks to words.
- Mark rects are page coordinates. The studio shifts them by each frame's scroll, so scenes aim through `onTake`.
- Leave about a second (`rec.wait`) between marks a scene will pin to words: the stretch between two pins plays at
  the pace of their words, so close marks play in slow motion.
- The frame count `studio capture` prints counts repaints (Chrome sends a frame only when the page changes), not
  quality. A low count over a still stretch is fine.

## Gotchas

- Live storefronts never reach `networkidle`. Wait on the specific thing: a selector, an image's decode.
- Lazy images blank mid-take as they come into view. In `setup`, set each gallery image's `loading = 'eager'` and
  `await img.decode()`, off camera.
- `rec.click` throws if its target is out of view. Slide the carousel and scroll the page in `setup`.
- In a split panel the bottom ~25% of the viewport lands under the caption. Scroll so a click target sits ~60% down.
- Popups that arrive at random (an SMS teaser, a chat bubble) flicker between crossfading states. Hide them with
  `captureShots({ css })`.
- Stills run four at a time, so a slow site can time out one of them. Rerun just it with `--only`.

