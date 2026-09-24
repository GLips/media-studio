---
name: video-kickoff
description: Start a new walkthrough or launch video, from the first context dump to an approved storyboard, before any animation. Use when the user starts a video project, dumps context for one, asks for story angles, or wants a storyboard or scene table. Triggers include "new video", "let's make a video about", "storyboard this", "give me some angles".
---

# Starting a video

Three gates, in order: **dump → angle → storyboard**. Don't animate until the user signs off on the storyboard. It's much cheaper to change a scene table than a timeline.

## 1. Take the dump

The first message is usually messy and dictated. Pull these out of it, and ask only about what's missing:

- **What's launching**, and **the one thing a viewer should take away**. If there isn't one takeaway, stop and settle it.
- **Audience**: the client, customers or developers. That sets the vocabulary and how much gets explained.
- **Source material**: docs, a PR, a Loom transcript, a launch-post draft, the Slack thread. Read every one of them.
- **Where the real UI is**: the URL, theme, or preview query (e.g. `?view=…`) for each state the story needs.
- **A reference video**, if they have one for the style.
- **Aspect ratio and rough length.**

## 2. Five angles, then one

Before writing any scenes, give **5 story angles of 2–3 sentences each**. Make them different ways into the story (the problem first, the before and after, a customer's day, a number, a demo run straight through), not five wordings of one idea. Refine whichever one the user picks until they say it feels right.

## 3. Scene table

Write the chosen angle out scene by scene. Scenes that carry voice take a Line column, which later becomes the ids in `voiceover.json`:

```
| #  | On screen                                  | Motion                      | Line        |
|----|--------------------------------------------|-----------------------------|-------------|
| 1  | Add To Cart button, big and centred        | cursor comes in, clicks     | intro       |
| 2  | Page locks under the spinner               | push in on the spinner      | control-lock |
| 3  | Same click on the new buy box              | match cut, same spot        | new-instant |
```

Keep each **Motion** entry to words from the `video-motion` skill (push in, pull back, pan, hard cut, match cut, and so on) so it turns straight into code.

## 4. Storyboard of stills

Make one still per scene from the **real captures** and lay them out as `projects/<p>/storyboard.html` (see `projects/2026-09-sale-only-view/storyboard.html` for the format). Once scenes exist, `node lib/render.mjs projects/<p> --sheet=…` gives a contact sheet of real frames. Look at it yourself before showing it, then get the user's approval.

## Real UI only

Everything on screen is the real product. Anyone who uses it knows what it looks like, and one made-up button breaks it for all of them.

- Capture states with `capture.mjs` (Playwright). If a state can't be photographed (a native `<select>` open, a `confirm()` dialog), redraw it in the studio **from the product's own words and styles**, as `drawConfirmDialog` and `drawNativeMenu` in `lib/studio/kit.js` do.
- Pull real icons and logos from the site's assets. On a Mac, an app's icon sits in its bundle: `sips -s format png /Applications/X.app/Contents/Resources/*.icns --out icon.png`. A coloured square standing in for an icon fails review.
- **Show only what the scene needs.** Frame the one part the story is about, around 1.8× bigger on a clean background, instead of the whole page. `camFit` caps at 1.6× because captures soften past that. To go bigger, capture that element at a higher `deviceScaleFactor`.
- Check each claim in the source doc against the live product, and note in the storyboard where they disagree (see the "Checked against" table in `projects/2026-09-simple-buy-box/storyboard.md`).
