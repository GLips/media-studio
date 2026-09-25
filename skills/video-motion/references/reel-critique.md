# Critiquing a high-energy cut

The brief for a fresh-context critique of a music-led cut (an ad, a teaser, a promo, a reel) once it's assembled: a
critic who didn't build it, judging what's on screen, not what the storyboard meant. Run it before calling a cut
done, and again after the fixes.

## Inputs

The render (an MP4 with its music), the project's `storyboard.md` (the beat sheet and its colour script), and the
reference it answers, if any, with its breakdown (`showreel-breakdown.md` or the project's own).

## Method

1. `studio study <render.mp4> --bpm=<the track's> --sections=<one per bar>` writes the overview (per-frame mean
   colour, motion energy, cuts against the beat grid) and a strip per section. Read the overview first: it's the
   whole cut at a glance, the way a viewer feels it.
2. Read every section's strip, then `studio look <project> --sheet=…` at the hit frames, full size. Put each strip
   beside the reference section it answers.
3. Judge each rule below. A rule that fails names its frames.

## The rules

- **Every beat carries a strong frame.** List any near-black, empty or muddy frame before the final fade.
- **Colour runs in the script's order.** The overview's colour band should read as the colour script. Name any
  ground that changes for no reason.
- **Always moving.** Energy never sits at zero; nothing holds longer than half a beat.
- **Cuts land on the grid**, the picture a frame or two ahead of the sound, and **every cut is a change of value**:
  figure and ground trade, or the scale jumps.
- **One dominant move at a time**, and transitions are built (a match, a whip, a zoom through), not dissolved.
- **The product is the hero** wherever it's shown: it fills the frame and reads.
- **The signature moment lands**: the one thing no template has. Would someone describe it to a friend?
- **Type is the image**: big, tight, set with care. No orphaned word, no clipped glyph, no default spacing.
- **The HUD reads** over every ground and never fights the picture.
- **The ending resolves**: the last hit lands, the logo or the message holds long enough to read, the sound finishes.

## The report

Ranked, most damaging first, at most a dozen notes. Each gives the frames (video frame numbers), what's wrong as a
viewer sees it, and a concrete fix (what to change, by how much). Then the three best moments, so the fixes keep
them. No generic praise, and no note without frames.
