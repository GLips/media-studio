# Directing a video: a short course

Enough vocabulary and technique to direct product walkthroughs and launch videos, and to give notes an agent can act on. It isn't tied to any engine. The `video-motion` skill (`skills/video-motion`) maps these terms to code.

The one idea underneath all of it: **every frame has one job, and the viewer's eye should never have to hunt.** Almost every technique below is a way of telling the eye where to look and when.

---

## 1. Shot sizes

In film, these are measured against a person. For UI, measure them against the screen:

| Shot | Film | Our equivalent |
|---|---|---|
| **Establishing / wide** | The whole location | The whole page, so the viewer knows where they are |
| **Medium** | Waist up | One region: the buy box, the nav, a card |
| **Close-up** | A face | One control: a button, a price, a dropdown |
| **Insert / extreme close-up** | A hand on a doorknob | One detail: a strikethrough price, a "29% Off" badge, a cursor on a checkbox |

**The grammar: establish, then go in.** Show where we are before the detail. Going straight to a close-up with no wide shot first disorients people, unless the voice has already set up the context. When the story moves somewhere new, pull back to re-establish.

---

## 2. Camera moves

| Move | What it is | Use it for |
|---|---|---|
| **Push in** | The camera moves closer | "Look at this": emphasis, arriving at the point |
| **Pull back** | The camera moves away | Context, "here's the bigger picture", endings |
| **Pan** | The camera slides sideways | Following a flow across the page, comparing neighbours |
| **Tilt** | The camera slides up or down (strictly a pivot, but on a flat page it's a vertical pan) | Scrolling the story down a page |
| **Tracking / follow** | The camera moves with a subject | Staying with a dropdown as it opens, a prompt as it types, a cart total as it updates |
| **Whip pan** | A pan so fast it blurs | Energetic transitions between places: "meanwhile, over here" |
| **Drift** | A slow move you barely notice (2–5% over the whole shot) | Keeping a still shot alive. A dead-still screenshot reads as a slide |
| **Rack focus** | Sharpness shifts from one subject to another | For UI: blur the background and keep the subject sharp, then swap which one is sharp |

**Motivated movement.** Every move should have a reason the viewer can feel: the voice named something, the cursor went there, something changed. An unmotivated move feels like the camera operator got bored. If you can't say why the camera moves, hold it still, or give it a subtle drift.

**One dominant move at a time.** Each moment has one move the viewer reads, and anything else moving only supports it: the camera settling, a card's contents following the card. Don't pan while a highlight draws on while the cursor travels. The container moves first and its contents follow, overlapping it by 30–50%; secondary action (a ring, a badge) starts 100 ms or more after the main move lands. Moves competing to be read are chaos.

**Speed.** Big moves (wide to close-up) need about 1–1.5 s. Small reframes need about 0.5 s. If everything feels rushed, the usual note is "slow every camera move to 0.7×".

---

## 3. Cuts and transitions

| Term | What it is | When |
|---|---|---|
| **Hard cut** | The next shot starts on the very next frame | The default. It's invisible when it's motivated |
| **Crossfade / dissolve** | One shot fades through the other | Passing time, a soft change of topic. Overuse feels like a slideshow |
| **Match cut** | Something lines up across the cut (same spot, shape or motion), so two shots read as one | Before and after: the old buy box becomes the new one with the button in the same place |
| **Cut on action** | Cut in the middle of a motion and let it finish in the next shot | Hides the cut. Cut while the click happens, not after |
| **Jump cut** | Cut forward in time within the same framing | Skipping the boring part: typing, loading |
| **Smash cut** | An abrupt cut to a sharp contrast | Comedy, or a jolt: calm UI, then the error |
| **Morph / shared-element** | One element turns into the next (a button grows into a dialog) | Showing cause and effect. It feels like the product itself |
| **Wipe / slide** | The new shot pushes the old one off | Moving through steps. **Keep direction consistent**: forward is right-to-left, like reading |
| **Whip transition** | Whip pan out, then whip pan in | High-energy sequences |

**Direction continuity.** If a scene leaves to the left, the next one enters from the right. Sticking to one screen direction for "forward" makes the video feel like a single camera move. Breaking it makes it feel stitched together.

**Eye trace.** Before a cut, note where the viewer is looking, and put the next shot's subject at that same spot. It's the best way to make cuts feel smooth.

### Sound across cuts (J-cuts and L-cuts)

- **J-cut:** the next scene's audio starts *before* its picture, so you hear what's coming first. It pulls the viewer forward.
- **L-cut:** this scene's audio carries on *over* the next picture, which smooths the handoff.

Section cards with the voice continuing straight over them are L-cuts. Cutting sound and picture at exactly the same frame is what makes amateur edits feel choppy.

---

## 4. Timing and pacing

- **A beat** is the smallest unit of timing: one thing happening. Scenes are made of beats.
- **A read** is one thing the viewer has to *understand*: "the price dropped", "that option is out of stock". Each read
  needs time for the eye to find it, time to get it, and a moment before the next one starts. Small, fast or subtle
  things take longer to read than big, central, obvious ones. Listing a scene's reads, each with a start and an end,
  is the best way to time it.
- **One read at a time.** When two things happen at once, the viewer sees only one of them.
- **Fast actions, slow meanings.** A move can be quick if it's anticipated, but what it *means* needs held time. The
  contrast between quick and held is what gives a video rhythm; one constant speed, fast or slow, makes it flat.
- **Cause, then reaction.** Show the click, then what it did, one after the other. The reaction often matters most, so
  give it the time.
- **Let the reads set the length.** A scene with many reads can't be short; one whose reads have landed shouldn't be
  padded. The last read of the video needs time to land before it ends.
- **Anchor beats to words.** The highlight lands when the voice says "price", not at 3.2 s. With word-level timing we can anchor to the exact word.
- **Lead and hold.** Give the viewer about 0.3–0.5 s to find the subject *before* it acts, and hold about 0.5–1 s *after* something important changes. "Let it land" / "let it breathe" means hold longer.
- **Reading time.** On-screen text needs about 0.3 s per word plus 1 s. If the voice is talking, don't make them read a paragraph too.
- **Rhythm.** Vary the length of shots. A run of equal-length shots drones. Speed up to build energy, then slow down for the key moment.
- **Hook.** The first 3 seconds decide whether anyone watches. Open with the payoff or the problem, not a logo.

---

## 5. Easing and physics

Nothing real starts or stops instantly. Easing curves are how things move:

| Term | Feel | Use |
|---|---|---|
| **Linear** | Robotic | Almost never. Only for continuous things like a progress bar or a drift |
| **Ease-in-out** | Starts and stops gently | Camera moves (the default) |
| **Ease-out** (decelerate) | Arrives fast, settles | Things *entering*: cards, text, a highlight drawing on |
| **Ease-in** (accelerate) | Starts slow, leaves fast | Things *exiting* |
| **Spring / overshoot** | Goes slightly past and settles back | Playful UI: a badge popping, a button press. Keep it subtle |
| **Anticipation** | A small wind-up the opposite way first | A cursor pulling back slightly before a click, a card dipping before it flies up |
| **Stagger / cascade** | Items animate one after another, 40–80 ms apart | Lists, words, grids. "Words cascade up" |
| **Follow-through** | Parts settle at different times | A panel stops, and its contents settle a beat later |
| **Arcs** | Living things move on curves, not straight lines | A cursor curving to its target; a thrown item |
| **Weight** | How something starts and stops says how heavy it is | Heavy: slow to start and stop, little bounce. Light: snaps into motion, flutters to rest |
| **Exaggeration** | Push it past natural, because subtle reads as nothing | A bigger push, a stronger pop, a longer hold |
| **Secondary action** | Small motion that supports the main one without competing | A badge settling after a card lands |

**Twinning** is the tell of motion made in code: two things moving identically and at the same time (both panels
zooming in sync, a whole list popping at once). Offset their timing, or give one the action and the other something
smaller.

Illustrated styles add a few terms:

- **Key poses:** the frames that tell the story as stills. If they don't read, the motion in between won't fix it.
- **Boil:** hand-drawn lines that wobble slightly from drawing to drawing. It's what makes painted animation feel
  alive rather than digital.
- **On twos:** each drawing is held for two frames. It feels snappier and more hand-made than a new drawing every frame.

Notes you'll give: **"floaty"** (the ease is too long or too gentle; tighten it), **"snappy"** (shorter, more ease-out), **"mechanical"** (linear, or everything moving in sync; add easing and stagger).

---

## 6. Composition

- **One focal point per frame.** If two things compete, dim one of them (spotlight), make it smaller, or show them in sequence.
- **Rule of thirds.** Put the subject on a third line, not dead centre, when there's text or a second element to balance. Centre is fine for a single hero element.
- **Lead room.** Leave space in the direction something is moving or pointing. A cursor heading right needs empty space on its right.
- **Safe areas.** Keep the subject out of the caption band and away from the edges. Platforms put their own UI over the bottom and right.
- **Negative space.** Empty space around the subject reads as confident. A crowded frame reads as a screenshot.
- **Scale up.** UI at 1:1 is unreadable in video. Show only what the scene needs, about 1.5–2× bigger, on a clean background.

---

## 7. Ways to show emphasis on UI

From subtle to loud:

1. **Drift toward it.** The camera slowly favours it.
2. **Highlight ring** drawn around it.
3. **Spotlight:** everything else dims.
4. **Push in** until it fills the frame.
5. **Callout / tag:** a label naming it.
6. **Isolate:** lift it off the page onto a clean background, enlarged.
7. **Kinetic type:** the key phrase animates on screen.

Use the quietest one that works. If everything gets a spotlight, nothing stands out.

**Comparison devices:** a split screen (before | after, side by side), a match cut (before, then after, in the same spot), or a wipe (a line sweeps across to reveal the after).

---

## 8. Sound

- **Voiceover (VO)** leads. Picture serves the voice, not the other way round.
- **Music bed:** music under the whole video. **Ducking** lowers it automatically while the voice speaks, by about 10–15 dB, and brings it back up in the gaps.
- **Stingers:** short musical hits on key moments or section changes.
- **SFX:** subtle clicks, whooshes on fast moves, a soft pop when things appear. Used sparingly, they make motion feel physical.
- **Loudness:** web and social videos target **−14 LUFS** integrated, with true peak under −1 dBTP. That keeps the video from being quieter or louder than whatever plays before and after it.
- **Room tone / silence:** a completely silent gap feels like a bug. Keep the bed or a tiny bit of ambience under the pauses.

---

## 9. Structure

- **Hook → problem → solution → proof → call to action.** It works for almost every launch or walkthrough.
- **Show, don't tell.** If the voice says "it's instant", show the instant response. Don't put the word "instant" on screen.
- **One idea per scene.** If a scene needs "and also", split it.
- **Every scene has an event.** Something changes between its first frame and its last. "The page, sitting there" is
  not a scene.
- **Pay it off.** Whatever a scene sets up (a spinner, a question, a "watch this") gets resolved on screen.
- **Rhyme the ending with the opening:** the same place, shot or motif, changed. The walkthrough that opens on the old
  buy box can end on the new one in the same framing. It makes the video feel whole.
- **Sections:** in videos longer than about 90 s, chapter cards help the viewer know where they are.
- **End card:** what to do next, held for at least 2–3 s.

---

## 10. Giving notes

Good notes name **what**, **where**, and **the feeling**, and leave the fix to whoever is building. "At the price reveal, the push in feels floaty. Tighten it and let the price land before the voice moves on."

| You say | It means |
|---|---|
| "Let it land / let it breathe" | Hold longer after the moment |
| "It's floaty" | The ease is too long or too soft |
| "It's busy" | Too many things moving at once; stagger or cut some |
| "Motivate that move" | The camera moves for no reason; tie it to a word or an action |
| "Cheat it" | Fake it for the camera: make it bigger, closer or cleaner than it really is, as long as it's still honest |
| "Button it" | End the scene with a clear final beat |
| "Tighten" | Cut the dead time |
| "Too on the nose" | The picture just repeats what the voice says; show something that adds to it |
| "I missed it" | A read went by before it landed; give it more time, or lead the eye there first |
| "They're twinning" | Two things move in lockstep; offset them |
| "Pay that off" | Something was set up and never resolved |

---

## Watch list

To train your eye, watch Apple product videos, Linear's and Stripe's launch videos, and HeyGen's HyperFrames launches ([heygen-com/hyperframes-launches](https://github.com/heygen-com/hyperframes-launches) has the source for several). Watch each one with the sound off and count the camera moves, and ask what motivates each. Then watch it with sound and notice where the audio leads the cut.
