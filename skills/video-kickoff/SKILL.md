---
name: video-kickoff
description: Start any video, from the first brief or context dump to an approved storyboard: a walkthrough, an explainer, a PR video, a launch ad or teaser, a showreel, an abstract piece. Use when the user asks for a video (from any repo), dumps context for one, asks for story angles, or wants a storyboard or scene table.
---

# Starting a video

A video is planned the way a motion studio plans one: in rungs of rising fidelity, each settling one question
cheaply before the next rung spends more on it. Each rung needs the user's yes before the next.

| Rung | Settles | Here |
|---|---|---|
| **Treatment** | the idea, the tone, the takeaway | steps 1–2: the dump, then the angle |
| **Script or beat sheet** | what happens, in order; the track, if it's cut to music | step 3: the scene table |
| **Style frames** | the look: two to four finished stills of key moments | `stills` skill, reviewed with `studio review` |
| **Animatic (blocking)** | pacing and how things move: every scene blocked in simple shapes at its real timing, on the voice or music; flat (`blockingScene`) for a 2D scene, 3D where a camera moves through space | step 4: `studio render --animatic`, then `studio review`; `video-gen` when a video model will take the motion |
| **Polish, then sound** | the finish | `video-motion`, then `video-sound` |

**Choose the path at kickoff, and say which.** The full ladder suits a piece whose pacing or look is uncertain, or
whose later rungs are expensive (generated footage, a long reel). To try a few ideas fast, take treatment → beat sheet
→ animatic → polish, and skip style frames. Whatever the path, nothing gets a real voice or motion polish
before the animatic is signed off: a scene table is cheap to change, and voiced, polished motion is not.

**An autonomous brief skips the gates.** When the user hands over the creative calls ("go all out", "surprise me",
"don't check in"), make each gate's decision yourself: pick the angle, write the scene table or beat sheet as your
plan, and build through to a render. Show the user the result, not the steps.

Every video lives in the studio repo, whatever repo the request came from. Read the source material where it is, then
work in `studio home` (paths below are relative to it). Each verb explains itself: `studio <verb> --help`;
`references/studio-map.md` is the overview of every verb, a project's files and the studio's pieces. No `studio` on
the PATH, or no `work/` in it: the `studio-setup` skill installs it first.

## 1. Take the dump

The first message is usually messy and dictated. Pull these out of it, and ask only about what's missing:

- **What it's for**, and **the one thing a viewer should take away** (or, for a piece with no message, the one
  feeling). If there isn't one, stop and settle it.
- **Audience**: the client, customers or developers. That sets the vocabulary and how much gets explained.
- **Source material**: docs, a PR, a Loom transcript, a launch-post draft, the Slack thread. Read every one of them.
  Asked from inside a product repo, the change itself (its diff, docs and PR) is source material.
- **What it's cut to**: a voice, music, or neither. That picks each scene's driver (`video-motion`, Timing).
- **What's on screen.** If it shows a real product's UI: the URL, theme, or preview query (e.g. `?view=…`) for each
  state the story needs, and whether it needs a sign-in (the `video-capture` skill, Sites behind a sign-in).
- **Whose code it's about.** If it's a product repo's (a PR, a component), make that repo the project's host once the
  project exists: `work/projects/<p>/host.json` `{ name, ref }`, with `name` a key of `work/hosts.json` (add it if new), then
  `studio hosts sync <p> --install`. That checks out the pinned commit outside the studio and runs the host's own
  install there, lifecycle scripts included. To show unpushed or uncommitted work, map the name to the working copy
  in `work/hosts.local.json` instead: it's used as it stands, and you install its packages yourself.
- **A reference video**, if they have one for the style.
- **Rough length, and the frame.** Frames are 1920×1080 at 30 fps unless the video asks for another shape (a vertical
  cut, a square) or rate: `defineVideo({ format })`. An overlay, lower-third or hero animation that sits on a page's
  own background is `format: { transparent: true }` in a `--capability silent` project; it delivers as WebM and HEVC
  with alpha.

## 2. Five angles, then one

Before writing any scenes, give **5 story angles of 2–3 sentences each**. Make them different ways into the story
(e.g. the problem first, or a number that surprises), not five wordings of one idea. Refine whichever one the user
picks until they say it feels right.

## 3. Scene table

Start the project with `studio new <slug> --capability <voice-led|music-led|mixed|silent>` (silent: fixed-length
scenes with no voice, music or sound, delivered with no audio track), adding `--url` only for a public
page that loads as it is. Every scene starts blocked, a few flat pieces moving on its cues, so `studio render <p> --animatic`
and `studio review <p>` show the storyboard as it plays before anything is built. If the video is about a product repo's code, give it a host
(step 1). Then write the chosen angle out scene by scene in `work/projects/<p>/storyboard.md`, under the audience,
source and takeaway:

```
| #  | Scene     | On screen                              | Motion                  | Lines        |
|----|-----------|----------------------------------------|-------------------------|--------------|
| 1  | intro     | Add To Cart button, big and centred    | cursor comes in, clicks | intro        |
| 2  | lock      | Page locks under the spinner           | push in on the spinner  | control-lock |
| 3  | instant   | Same click on the new buy box          | match cut, same spot    | new-instant  |
```

- **Scene** and **Lines** become the `id`s in `video.tsx` and `voiceover.json`.
- Every scene needs an **event**: something changes between its first frame and its last. Under the table, list each
  scene's reads (what the viewer must understand, in order). It's the timing sheet the motion pass works from.
- Plan the whole video: something set up is paid off, and the ending rhymes with the opening where it can.
- Write each Motion entry so it turns straight into code; over captures, in the camera vocabulary (`video-motion`,
  `references/walkthrough.md`).
- An ad, launch teaser, social cut or promo cut to music takes the high-energy register (`video-motion`, "The
  high-energy register"): write it as a beat sheet, one bar per idea on the music's grid, not scenes on a voice.
- End with a **Deliberately left out** list: true things the video skips, and why. It stops them creeping back in
  during review. One line each, the reason included:

  ```
  ## Deliberately left out

  - The URL parameter and A/B test setup. They're internal; the rollout scene just says it's tested.
  - Logged-in pro pricing. That needs test accounts, so the pricing scene states it as text instead.
  - The badge change on collection cards. It's real, but it's a second story and would blur this one.
  ```

Get the user's yes on the table before building anything.

## 4. Storyboard: an animatic you can click through

The storyboard is the video itself, blocked, and never a separate drawing, so it can't drift from what ships. Every
scene starts as **blocking** and rises in place to final, so the same page carries the animatic and the finished cut.
Blocking is cheap: block what each scene actually shows, with its real pieces moving on its real cues, rather than a
placeholder that stands for it.

- **A flat scene**: `(clock) => blockingScene(clock, { note, pieces, view })`, labelled flat boxes, type and image
  slots moving on the clock's cues, with an optional push or pan (`video-motion`, "Blocking a flat scene").
- **A scene a camera moves through**: a 3D blockout (`Blockout`, `video-gen`), bound with `rung: 'blocking'`.

Each binding declares its **rung**, `blocking` or `final`: `blockingScene` sets its own, and a built scene says
`rung: 'final'` in its `sceneForTimelineClock`. The rung goes into the render's snapshot, so
`studio review` shows it on each scene of the scrubber, on each storyboard card and in each note. Raise a scene by
changing its binding; `timeline.ts` doesn't change.

**Cut to music** (the high-energy register):

1. Get the track (`video-sound`, music) and cut it to the beat sheet's shape with `studio music fit <p> --bars`. To
   plan before there's a track, put the timeline on a tempo guess (`tempoGrid(120)`): the animatic plays silent, and
   the track, fitted later to the same beat counts, swaps in as `recordedGrid(track)`. Guess the tempo you'll use: a
   different one changes every beat's length, so re-check the pacing once the track is in.
2. Write `timeline.ts` from the beat sheet (`video-motion`, "The high-energy register"): a `beatSpan` per bar, a cue
   for each idea that lands on a beat, named for what lands (`ink.strike2`), the replays and the final hit's landmark.
3. Block each bar in its file, with the beat sheet's text as its `note`: its pieces moving as the idea does, each
   idea's arrival on its cue, so it lands on the beat.
4. Run `studio render <p> --animatic`, then `studio review <p>`. The animatic plays with the music; the scrubber marks
   the cuts, beats and every cue, replay and landmark; the storyboard under it has a card per scene with a still on
   each, captioned where `timeline.ts` puts it (`beat 3 +4f`).
5. Send the user the review page. Their notes name each scene's rung and the cue or beat they're on, in `timeline.ts`'s
   words. A pacing note changes `timeline.ts` and, where the length changes, the music's `--bars`; render the
   animatic again (the page offers the new render, and moves each note to its moment on it) until they sign off. Only then build the bars, and polish nothing before it.

**Voiced**, the animatic is `video.tsx`, rough:

1. Write the lines by `references/voiceover-lines.md` into `voiceover.json`, with `"paragraph": true` on each line that starts a new beat so the read
   pauses there and no caption runs across it (`*word*` emphasises a word in the captions; the voice never sees it), and run `studio voice <p> --read=estimate`. That times each line from its word count, for free.
2. Add the states to `capture.ts` with the `video-capture` skill, by the **Real UI only** rules below, and run
   `studio capture <p>`.
3. Build `video.tsx` as an **animatic**: one scene per table row, with the table's text as its `note`, one camera and at
   most one highlight per scene, over the captures, declared `rung: 'blocking'`; a scene with no capture yet is a
   `blockingScene`. Anchor the highlight to its word (`s.line(id).word(…)`) now, so it lands again once
   the real voice replaces the estimate. No cursor paths, blur or polish yet.
4. Run `studio render <p> --animatic`, then `studio review <p>`, and look at its storyboard yourself: a card per scene
   with a still per line. It's ready to send when every scene's event and each of its listed reads shows in its
   stills, and nothing is off the frame or under the caption.
5. Send the user the review page. Their notes go into the table, the lines and the animatic, and the animatic is
   rendered again, until they sign off.

Once signed off, voice it for real with `studio voice <p>`, which reads the whole script as one take. It needs
`OPENROUTER_API_KEY` in the environment; if that isn't set, don't go looking for it: ask the user to run
`studio voice <p>` themselves, under their secret launcher. Until then, `--read=draft` reads it free with macOS `say`,
to time scenes against real speech. A draft voice is for timing only, never for a delivered video. Then render the animatic again to check the timing, and do
the motion pass with the `video-motion` skill, then the sound pass with `video-sound`. A voiceless teaser is cut to its
music, so it needs the track before the motion pass (`video-sound`, music).

## Real UI only

When a video shows a product, everything of the product on screen is the real product. Anyone who uses it knows what it looks like, and one made-up button
breaks it for all of them.

- Photograph or film it (`video-capture`), or compose the host's real components (`video-motion`, `references/walkthrough.md`).
  If a state can't be photographed (an open native `<select>`, a `confirm()` dialog), rebuild it in DOM **from the
  product's own words and styles**, as `ConfirmDialog` and `NativeMenu` in `lib/picture/kit/studio/kit.tsx` do.
- Pull real icons and logos from the site's assets. On a Mac, an app's icon sits in its bundle:
  `sips -s format png /Applications/X.app/Contents/Resources/*.icns --out icon.png`. A coloured square standing in for
  an icon fails review.
- **Generate only around the product.** A still no capture can give (title-card art, a background, a physical
  product's shot from its real photo, a concept icon) can be generated (`video-motion`, `references/generated-stills.md`). Name it in
  the table's On screen column so the user approves it with the rest.
- **Show only what the scene needs.** Frame the one part the story is about, large, on a clean background, instead of
  the whole page. `camFit` caps at 1.6× because captures soften past that. To go bigger, capture that element at a
  higher `scale`.
- Check each claim in the source doc against the live product, and note in `storyboard.md` where they disagree, in a
  dated table of what the product really shows:

  ```
  ## Checked against the dev theme, <yyyy-mm-dd>

  | Claim | Dev theme shows |
  |---|---|
  | Spinner on every option change | `body.loader-active` while the control refetches the page |
  | Out of stock, swatches | Control: a blank box with a slash, colour hidden. New: colour kept, dashed border |
  ```
