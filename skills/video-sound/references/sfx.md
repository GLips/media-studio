# Sound effects

## What already sounds

Don't add these by hand; they'd play twice:

- **Cursor clicks.** `CursorPath` plays `SFX.click` at every key with `{ click: true }`.
- **Takes.** `TakeCursor` plays the take's logged clicks, and `SFX.key` on every typed key, at a lower volume with a
  slight pitch spread so a burst of typing doesn't sound machine-made.

A bare `<Sfx src={SFX.click} …>` is only for a click with no cursor on screen, such as a toggle flipping in a close-up.

## Where sounds come from

The kit has two sounds, `SFX.click` and `SFX.key`, synthesized by `lib/sfx-synth.ts`. `studio sfx` rewrites them into
`lib/studio/sfx/`, seeded so a rerun writes the same files, and there's nothing to license. The kit has no whoosh, hit
or ding yet. For one of those, ask the user for a file they have the rights to. Put it in `projects/<p>/sfx/` and
import it: the render must not fetch a sound by URL.

## Playing one

`<Sfx src at t volume rate>` (`lib/studio/sfx.tsx`, exported from `lib/studio/api.ts`) plays `src` when the scene
clock reaches `at`:

- `at` is in scene seconds, like everything else in `render`, so anchor it to a word or to the camera key it belongs
  to, never to a raw number.
- It sounds only while it's mounted. An effect in a branch the scene has left stays quiet, just as the picture does.
- **It plays 0.2 s of the sound and cuts the rest.** That fits a click or a key but not an accent.
- `volume` is Remotion's 0–1 gain, set by ear: effects aren't levelled or ducked (`mix.md`). The click plays at 0.5 and
  keys at 0.35.

An accent needs the same placement without the 0.2 s cut. Use `Sfx`'s own pattern in the project's `video.tsx`:

```tsx
import { Audio } from '@remotion/media';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import whoosh from './sfx/whoosh.wav';

// frame − t·fps is the scene's start, whatever frame this renders on, so the sound starts exactly at scene time `at`.
function Accent({ src, at, t, volume = 0.5 }: { src: string; at: number; t: number; volume?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Sequence from={frame + Math.round((at - t) * fps)} layout="none" name="accent">
      <Audio src={src} volume={volume} />
    </Sequence>
  );
}

<Accent src={whoosh} at={s.line('reveal').start - 0.4} t={s.t} />
```

Don't write `from={Math.round(at * fps)}`. A scene's frames count from where its fade-in begins, not from `s.t = 0`,
so that version plays early. And any sound stops when its scene stops painting, at the end of the crossfade into the
next scene. An accent that has to ring across a cut belongs to the scene after it.

## When to add one

An accent (a whoosh, hit or ding) needs a reason you can name.

- **At most one every 3–5 s**, and only on a scene change, a reveal or a big camera move.
- **Never on every cut.** When every cut has one, none of them stand out.
- **Never under a spoken word**, except in a gap between words or lines. Check against `s.line(id).word(…)`.
- The picture leads the sound: a whoosh starts slightly before its move lands, a hit on the frame the thing arrives.

These are working rules, not published standards; tune them by ear with the user.
