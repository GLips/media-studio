# Directing a character from a score

A rigged character (the brand's clapper, an imported glTF) is directed by one flat **score**: rows of
`{ at, <verb>: value }`, each landing on a storyboard moment. `compileCueScore(clock, cast, rows)` in the scene's
binding compiles it; `score.sample(s.t)` gives the frame to draw, plain data. `studio api compileCueScore` prints the
row's fields; `studio api defineCueCharacter` what a character declares.

## When

`at` is a storyboard cue (`'first'`, a word cue, `'arrive.settle'`), `[bar, beat]` from 1, counted from the beat scene's own
first beat (the grid's `beatsPerBar` sets the bar), or `{ from, offset: { seconds | frames | beats } }`. There's no bare number: a score
holds no times of its own, so a retimed storyboard moves the performance. Put a repeated rhythm in the score as
offsets from one cue (`{ from: 'first', offset: { seconds: 0.5 * k } }`), and check its last hit lands on the cue
the plan names for it.

## What a row sets

- `pose`, `expression`, `set: { <slider>: n }`: only what the character declares, so a typo fails the typecheck.
- `move: { name, align: 'hit', rate, end }`: a ready-made performance. Align it on its marker so the contact lands
  on the beat; `rate` 1.7 fits a 0.8 s snap into a half-second rhythm. `end: 'hold'` keeps its last pose,
  `{ return: blend }` goes back. A later row takes only the controls it sets; the rest of the move plays on.
- `position`, `squash` (whole body, constant volume), `camera`.
- `look` (and `palette`): the look catalog's. Looks and palettes cut. A painted look redraws at its own rate (12 fps)
  and the pose steps with it, while the camera stays smooth.
- `by`: a cut unless given; `{ ease: { seconds } }` or `{ spring: { duration, bounce } }` (curves.md's springs).

An imported model's poses and moves are clips: leave their `by` a cut, since the clip fades itself in and an eased
clip would scrub its playhead. A character only does what it was built with: an imported model has its clips and morph targets, not the clapper's
brows. Don't promise a control the model lacks.
