# The reel's rules, and critiquing a cut

The rules a music-led cut (an ad, a teaser, a promo, a reel) is built to and judged by, and the brief for a
fresh-context critique once it's assembled: a critic who didn't build it, judging what's on screen, not what the
storyboard meant. Run the critique before calling a cut done, and again after the fixes.

## The rules

- **Every beat carries a strong frame.** No near-black, empty or muddy frame before the final fade: a dark ground
  always holds a big figure.
- **Always moving.** Nothing holds still longer than about half a beat: a held word breathes, drifts or re-lights; a
  held field punches on the beats. The camera moves at most once per bar, on a phrase.
- **Cuts land on the grid**, the picture a frame or two ahead of the sound, and **every cut is a change of value**:
  figure and ground trade places, or the scale jumps.
- **Transitions are built**: a hard cut on the hit, a zoom through a shape into its colour, a match on position or
  shape, a speed-matched whip. A dissolve is the exception.
- **One dominant move at a time.** Secondary moves follow it by a frame or two.
- **Colour runs in the script's order.** The storyboard's colour script says what each colour means and when the
  ground changes. A ground is a full-bleed colour, not a tint, and one that changes for no reason reads as random,
  however good each frame is.
- **Type is the image**: display type a quarter of the frame height and up, set tight, with care. No orphaned word,
  no clipped glyph, no default spacing.
- **The subject is the hero** wherever it's shown (the product, in an ad): pushed in until it fills the frame, never
  a small card in a field.
- **The signature moment lands**: the one thing no template has. Would someone describe it to a friend?
- **The HUD reads** over every ground, on every frame, and never fights the picture.
- **Sounds land with the music.** The music carries the beat; a placed sound marks what it can't (a slam on a beat the
  track leaves empty, or a hit of its own), and lands with the music's hit, not ahead of it as a flam.
- **The ending resolves**: the last hit lands, the logo or the message holds long enough to read, the sound finishes.

## Inputs

The render (an MP4 with its music), the project's `storyboard.md` (the beat sheet and its colour script), and the
reference it answers, if any, with its breakdown.

## Method

1. `studio study <render.mp4> --bpm=<the track's> --sections=<one per bar>` writes the overview (per-frame mean
   colour, motion energy, cuts against the beat grid) and a strip per section. Read the overview first: it's the
   whole cut at a glance, the way a viewer feels it.
2. Read every section's strip, then the hit frames at full size (`studio look <project> --frames=<f1,f2,…>`, the
   frames from `studio clock`). Put each strip beside the reference section it answers.
3. `studio mix <project> --check` measures each placed sound against the music (a flam, a sound buried or sitting on
   top) and lists the beats the track leaves empty.
4. Judge every rule above. A rule that fails names its frames.

Done when every rule has a verdict, and every failing one its frames.

## The report

Ranked, most damaging first, at most a dozen notes. Each gives the frames (video frame numbers), what's wrong as a
viewer sees it, and a concrete fix (what to change, by how much). Then the three best moments, so the fixes keep
them. No generic praise, and no note without frames.
