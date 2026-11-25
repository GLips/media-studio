# Script first

The words are written for the video: steps 1–2 are the treatment, step 3 the scene table, step 4 the animatic,
voiced last.

## 1. Take the dump

The first message is usually messy and dictated. Pull these out of it, and ask only about what's missing:

- **What it's for**, and **the one thing a viewer should take away** (or, for a piece with no message, the one
  feeling). Without one, settle it before anything else.
- **Audience**: the client, customers or developers. That sets the vocabulary and how much gets explained.
- **Source material**: docs, a PR, a transcript, a launch-post draft, a thread. Read every one. Asked from inside a
  product repo, the change itself (its diff, docs and PR) is source material.
- **What it's cut to**: a voice, music, or neither. That picks the project's capability and each scene's driver.
  Recordings to cut it from are the `producer` skill's; a few recorded lines among read ones follow
  `${CLAUDE_PLUGIN_ROOT}/skills/producer/references/recorded-footage.md`.
- **What's on screen.** For a real product's UI: the URL, theme or preview query for each state the story needs, and
  whether it needs a sign-in (`video-capture`). For a product repo's own components: that repo becomes the project's
  host (`studio-setup`).
- **The brand**: a client's kit in `work/brands/` is named in the project's `brand.ts`
  (`${CLAUDE_PLUGIN_ROOT}/skills/studio-setup/references/brand-kits.md`); a one-off's colours are constants.
- **A reference video**, if they have one for the style.
- **Rough length, and the frame**: another shape or rate than the default is `defineVideo({ format })`. An overlay or
  hero animation over a page's own background is `format: { transparent: true }` in a silent project.

Done when you can state the purpose, takeaway, audience and driver in one line each, and every source is read.

## 2. Five angles, then one

Give **5 story angles of 2–3 sentences each**, in the chat: different ways into the story (the problem first, a
number that surprises), not five wordings of one idea. Refine the one the user picks. Done when they say it feels right.

## 3. The plan

Write the plan from the angle (the skill's **The plan**). A voiced scene, its lines written by
`${CLAUDE_PLUGIN_ROOT}/skills/video-kickoff/references/voiceover-lines.md`:

```ts
intro: {
  onScreen: 'Add To Cart, big and centred',
  motion: 'The cursor comes in and clicks on "click"; the page locks under the spinner',
  lines: {
    intro: { text: 'Every click on Add To Cart used to lock the page.', paragraph: true, cues: { click: 'click' } },
  },
  reads: ['The button the whole video is about.'],
},
```

- Write each `motion` over captures (`video-capture`), by **Real UI only** below.
- Leave `timing` out until the animatic: each line is timed from its word count until it's voiced.
- An ad, teaser, social or promo cut to music takes the high-energy register (`video-motion`): a beat sheet, one bar
  per idea on the storyboard's `grid` (`{ tempo: 120 }` until there's a track), in place of scenes on a voice. Each
  bar is a scene with `beats` and its cues on them, drawn in `bars/<id>.tsx`; a mixed project puts lines on beats
  (`at`):

  ```ts
  drop: {
    onScreen: 'The scattered notes snap into one graph', motion: 'Hit on 1; the graph settles by 3',
    beats: 4, cues: { hit: 0, settled: 2 },
  },
  ```

Done when every scene is signed off on the plan page.

## 4. The animatic

The storyboard is the video itself, **blocked**: each scene's real pieces moving on its real cues, rising in place to
final, so the animatic and the cut can't drift. Blocking is `video-motion`'s (a camera move through a set is a 3D
blockout, `video-gen`).

**Cut to music:**

1. Put the plan on the track's grid. A track the user brings is added and fitted first (`video-sound`), and the grid
   names it (`{ music: '<track>-fit' }`). Otherwise draft on `{ tempo: 120 }`, a click, at the tempo you'll generate
   at (a 4/4 bar is 2 s), and generate after sign-off. `music fit` never stretches a track: at another tempo cues
   keep their beats, but a move's `over` in frames takes another share of the beat.
2. Block each bar on its cues (the music-led starter `studio new` writes is the pattern); its row is its note.
3. Render the animatic and read it yourself, bar by bar (`studio look <p> --video out/wip/animatic.mp4 --bar N`).
   Ready to send when each idea arrives on its beat and the cut lands on the final hit.

**Voiced:**

1. Capture the states the plan needs (`video-capture`), by **Real UI only** below.
2. Block each scene over its captures, its row as its note: one camera and at most one highlight, the highlight on
   its word's cue so it lands again on the real voice. No cursor paths, blur or polish yet.
3. Render the animatic and read it yourself as a strip (`studio look <p> --video out/wip/animatic.mp4 --strip a:b`).
   Ready to send when every scene's event and each of its reads shows in its frames, and nothing sits off the frame or
   under the caption.

Hand it to the user for review (`studio-review`); pacing notes go into `storyboard.ts`: the row, its lines, its
`timing` (lead, gap, tail, `nudge`). Done when the user signs the animatic off.

Then voice it with `studio voice sync <p>` (keyless: the user runs it under their secret launcher,
`studio-setup`). `--draft` is for timing only. Takes are all kept: `reread` for another performance, `use` to return
to one; `listen to <line>` means two takes may sound apart (`studio voice takes <p> <line>`).
Re-render the animatic, then hand over to `video-motion` and `video-sound`.

## Real UI only

Everything of the product on screen is the real product: anyone who uses it knows what it looks like, and one made-up
button breaks it for all of them.

- Capture it (`video-capture`), or compose the host's real components (`video-motion`). A product with nothing to
  capture yet (pre-launch, no build) gets its screens built in DOM, consistent with each other and the brief, each
  named in its scene's `onScreen` for the user to approve as the product. A state that can't be
  photographed (an open native `<select>`, a `confirm()` dialog) is rebuilt in DOM from the product's own words and
  styles, as `ConfirmDialog` and `NativeMenu` in `#studio` are.
- Pull real icons and logos from the site's assets. On a Mac, an app's icon is in its bundle:
  `sips -s format png /Applications/X.app/Contents/Resources/*.icns --out icon.png`. A coloured square standing in for
  an icon fails review.
- **Generate only around the product**: title-card art, a background, a physical product's shot from its real photo,
  a concept icon (`video-motion`, generated stills). Name each in its scene's `onScreen`.
- **Show only what the scene needs**: the one part the story is about, large, on a clean background. `camFit` stops
  at 1.6× because captures soften past it; to go bigger, capture that element at a higher `scale`.
- Check each claim in the source against the live product, and note where they disagree in the plan's `brief` under
  a dated heading (`'Checked against the dev theme, <yyyy-mm-dd>'`), a line per claim and what the product shows.
