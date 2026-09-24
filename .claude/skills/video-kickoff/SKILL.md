---
name: video-kickoff
description: Start a new walkthrough or launch video. Use when the user starts a video project, dumps context for one, asks for story angles, or wants a storyboard or scene table.
---

# Starting a video

Four gates, in order: **dump → angle → scene table → storyboard**. Each gate needs the user's yes before the next.
Nothing gets a real voice or motion polish until the storyboard is signed off. A scene table is cheap to change;
voiced, polished motion is not.

## 1. Take the dump

The first message is usually messy and dictated. Pull these out of it, and ask only about what's missing:

- **What's launching**, and **the one thing a viewer should take away**. If there isn't one takeaway, stop and settle it.
- **Audience**: the client, customers or developers. That sets the vocabulary and how much gets explained.
- **Source material**: docs, a PR, a Loom transcript, a launch-post draft, the Slack thread. Read every one of them.
- **Where the real UI is**: the URL, theme, or preview query (e.g. `?view=…`) for each state the story needs.
- **A reference video**, if they have one for the style.
- **Rough length.** Frames are 1920×1080.

## 2. Five angles, then one

Before writing any scenes, give **5 story angles of 2–3 sentences each**. Make them different ways into the story
(e.g. the problem first, or a number that surprises), not five wordings of one idea. Refine whichever one the user picks until they say it feels right.

## 3. Scene table

Start the project with `npm run new -- <slug> --url=<page> --title="…"`. Then write the chosen angle out scene by
scene in `projects/<p>/storyboard.md`, under the audience, source and takeaway:

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
- Write each Motion entry in the `video-motion` skill's words (push in, pull back, pan, hard cut, match cut, and so
  on), so it turns straight into code.
- End with a **Deliberately left out** list: true things the video skips, and why. It stops them creeping back in
  during review (see `projects/2026-09-sale-only-view/storyboard.md`).

Get the user's yes on the table before building anything.

## 4. Storyboard: an animatic you can click through

The storyboard is the video itself, rough, and never a separate drawing, so it can't drift from what ships.

1. Write the lines into `voiceover.json`, with `"paragraph": true` on each line that starts a new beat so the read
   pauses there, and run `node scripts/tts.ts projects/<p> --estimate`. That times each line from its word count, for
   free.
2. Add the states to `capture.ts` and run it, by the **Real UI only** rules below.
3. Build `video.tsx` as an **animatic**: one scene per table row, with the table's text as its `note`, one camera and at
   most one highlight per scene. Anchor the highlight to its word (`s.line(id).word(…)`) now, so it lands again once
   the real voice replaces the estimate. No cursor paths, blur or polish yet.
4. Run `node scripts/storyboard.ts projects/<p>` and look at `out/storyboard/index.html` yourself. It's ready to send
   when every scene's event and each of its listed reads shows in its stills, and nothing is off the frame or under
   the caption.
5. Send the user the page. Their notes go into the table, the lines and the animatic, and the page is rebuilt, until
   they sign off.

Once signed off, voice it for real (`npm run tts -- projects/<p>` reads the whole script as one take), rebuild the storyboard to check the timing, then
do the motion pass with the `video-motion` skill.

## Real UI only

Everything on screen is the real product. Anyone who uses it knows what it looks like, and one made-up button
breaks it for all of them.

- Capture states with `capture.ts` (Playwright, through `openCaptureSession`). If a state can't be photographed (an
  open native `<select>`, a `confirm()` dialog), rebuild it in DOM **from the product's own words and styles**, as
  `ConfirmDialog` and `NativeMenu` in `lib/studio/kit.tsx` do.
- Pull real icons and logos from the site's assets. On a Mac, an app's icon sits in its bundle:
  `sips -s format png /Applications/X.app/Contents/Resources/*.icns --out icon.png`. A coloured square standing in for
  an icon fails review.
- **Show only what the scene needs.** Frame the one part the story is about, large, on a clean background, instead of
  the whole page. `camFit` caps at 1.6× because captures soften past that. To go bigger, capture that element at a
  higher `deviceScaleFactor`.
- Check each claim in the source doc against the live product, and note in `storyboard.md` where they disagree (see
  the "Checked against" table in `projects/2026-09-simple-buy-box/storyboard.md`).
