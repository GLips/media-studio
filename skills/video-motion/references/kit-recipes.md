# Kit recipes: words, numbers, strokes

Shortcuts in `lib/studio/kit.tsx`, all raw: each eases itself.

- **Words coming in**: `<WordReveal t={s.t - at} text x y width />` staggers words 60 ms apart (`timing.each`,
  40–80 ms reads as one gesture), each rising 12 px (`rise`) as it fades in. The box is laid out whole from its
  first frame, so the line never shifts. `letters` is for one short display word only. To have it finished as a
  word is spoken, start it at `w.start - wordRevealFinish(text)`, passing it the same `letters` and `timing`.
- **A number rolling**: `<Odometer t={s.t} value={(t) => lerp(0, 1299, motionCurves.cubic.entrance(seg(t, a, a + 1.2,
  motionCurves.linear)))} mode="direct" prefix="$" x y />` turns digit wheels to whatever `value` reads at `t` and
  lands pin-sharp; `y` is the baseline. `direct` is the calm roll (1.2–2.5 s); the default `mechanical` blurs the ones
  past, for a price that snaps. Name it (`motion="total"`) and `expect` it to hold once it lands.
- **A stroke drawing on**: `<DrawPath d k={seg(…, motionCurves.linear)} />` draws a path from its start with
  `@remotion/paths`: an underline, an arrow, a check. `viewBox` plus `box` draws an icon's path into a rect. Draw-on
  only; morph paths directly.
