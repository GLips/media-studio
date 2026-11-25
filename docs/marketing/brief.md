# media-studio marketing brief

A prompt for agents writing about media-studio (README, posts, changelogs, the demo video's script). Every claim you
write must trace to §7 or to the code you're describing. Never invent a number, a user or a capability.

## 1. Snapshot

```
- One-liner: A media studio for you and your agents: code-based tools for making video and images, and a review app where you leave specific notes, frame by frame.
- Category: agent-driven video production; "make videos with Claude Code"; code-based motion graphics (Remotion).
- What it does: A `studio` CLI, a set of Claude Code skills shipped as a plugin, and a local review app. Your agent
  plans, captures, animates, paints, voices, scores and renders a video from building blocks in code; you watch it in
  the review app and pin notes on the frames, words and regions you want changed, and the agent acts on them.
- Stage: early. Open source (MIT), one maintainer, used daily by its author; 17 GitHub stars (2026-11-24). Mac only.
```

## 2. Positioning

```
- Competitive alternatives:
    - Nothing: ship without a video, or post a screenshot. The most common choice.
    - After Effects / Premiere / DaVinci by hand: you do every keyframe, retime and re-export yourself.
    - A motion designer: you give notes on what matters, but each round costs days and money.
    - Remotion plus an agent in chat: the agent does the work, but you describe frames in words ("the second zoom,
      around 0:14"), there's no review surface, and every building block is written from scratch.
    - AI video generators (Sora, Veo, Runway): a note means re-rolling the clip; no control of a single beat, and
      they can't show your real UI.
    - Descript / Screen Studio for recordings: good at one take, not connected to the rest of the video.
- Unique attributes:
    1. Building blocks for many styles, all code: captured UI, motion, 3D blockouts, flat 2D, a GPU paint engine
       (watercolour, gouache, crayon, pencil, ink, from brush packs you own), cut paper, music-cut timing, generated
       footage.
    2. A review app wired to the project's files: notes pinned to a frame, a word or a region follow it across
       re-renders; a sign-off flags itself when what it approved changes; the agent watches for notes and replies.
    3. A ladder of cheap sign-offs (treatment, scene table, animatic on a free draft voice) before anything paid or
       slow.
    4. The agent checks its own frames and stills before you see them.
    5. Studio Recorder: one key records screen, camera, mic and an input log, each its own file, into a transcribed,
       searchable footage library the agent can slice, dice and pick takes from.
    6. Ships with skills via a Claude Code plugin: the agent already knows the craft (how to paint each style, how to
       run the ladder, how to capture, animate, mix and hand work over for review). Useful out of the box.
- Value (+ proof):
    - The agent takes the drudgery out of basic tasks: timing to words, capture, re-renders, mixing, checks.
      (§7: studio check, still check, voice sync, capture, mix)
    - Feedback on the important bits is easy and lands exactly where you point. (§7: review notes, stale sign-offs)
    - Many styles from one studio, not one template look. (§7: paint engine, gallery renders)
    - Your own footage becomes material the agent can cut. (§7: recorder, library)
    - It works the first day, because the skills carry the know-how. (§7: 9 skills)
- Best-fit customer: people who direct coding agents and care how the result looks: developers making videos for
  what they ship, and creative coders who want painted, 3D or motion pieces without hand-keyframing.
  EXCLUDE: people who want one-click output with no back-and-forth; people who want a timeline editor they drive
  themselves; anyone not on a Mac.
- Market category / frame: a studio for agent-human collaboration and iteration on video. Judge it against how a
  person and a collaborator make video together, not against "type a prompt, get a clip".
- Differentiators vs. table stakes:
    - Differentiators: the review and collaboration surface; the range of building blocks; skills that make the
      agent competent out of the box; Studio Recorder.
    - Table stakes (never lead with): renders MP4, built on Remotion, voiceover, music, captions.
```

## 3. Audience & jobs

```
- Persona(s):
    - The builder-director: a developer who ships with Claude Code, has something to show (a launch, a feature, a
      walkthrough), no motion designer, and opinions about how it should look.
    - The creative coder: works in WebGL, generative art or motion; wants painted or 3D pieces and wants to direct,
      not keyframe.
- Job stories:
    - When I've shipped something worth showing, I want my agent to make the video while I only weigh in on what
      matters, so I can ship a video instead of nothing.
    - When I watch a draft and something's off, I want to point at the exact frame or word, so I can trust the next
      render fixes that and nothing else.
    - When I've recorded a rough demo, I want the good takes found and cut for me, so I can skip the scrubbing.
    - When I want a look no template has (watercolour, cut paper), I want my agent to know how to make it, so I can
      try it without learning the tool.
- Pains: re-recording for every change; describing frames in chat; scrubbing hours of takes; template-looking
  output; paying for a render before knowing the plan is right.
- Gains: notes that land; a video that looks made, not generated; footage that's ready to cut; cheap early yeses.
```

## 4. Messaging

```
- Key message (roof) [LOCKED]: A media studio for you and your agents: code-based tools for making video and
  images, and a review app where you leave specific notes, frame by frame.
  Why "media", from Graham: it's called Media Studio, and it's not just about video: stills and images too.
  Graham's words: "A video studio for you and your agents. Tools to support code-based video and image creation plus
  a review UI for you to provide specific notes frame-by-frame."
- Pillars:
    1. Building blocks for many styles — motion, 3D, flat 2D, painting, cut paper, your own footage, all in code your
       agent edits. — §7 paint engine, gallery
    2. A review room for the important bits — pin a note to a frame, a word or a region; sign-offs notice when the
       work changes. — §7 review app
    3. Capture without the scrubbing — Studio Recorder files every take so the agent can find and cut the good
       ones. — §7 recorder, library
    4. Competent out of the box — the plugin's skills teach your agent the craft, from the ladder of cheap sign-offs
       to how each style paints. — §7 skills
- Show, don't headline: the agent is connected to the review app live. It wakes on your note, answers in the
  thread, asks you about frames, and posts side-by-side candidates to pick from. Use it in the demo video and as a
  detail under pillar 2, not as a pillar.
- Benefit ladder:
    - Pinned notes → the next render changes what you pointed at → you trust the loop and stop babysitting.
    - Cheap sign-off ladder → you approve the plan on a free draft voice → no paid voice or footage on a wrong plan.
    - Recorder + library → takes are transcribed and searchable → recording stops being the dreaded part.
```

## 5. Voice ⚙

```
- Traits:
    | Trait | Do | Don't |
    |-------|----|-------|
    | Concrete | "Pin a note on a frame, and it knows the scene and the sound under it." | "Seamless, intuitive feedback workflows." |
    | Plain | "It films your pages itself: clicks, scrolls, typing." | "Leverages browser automation to capture product experiences." |
    | Matter-of-fact | "Every paid verb states its price in its --help." | "Incredibly affordable!" |
    | Builder to builder | "Your agent does the drudgery; you weigh in on what matters." | "Empower your team to unlock creativity." |
- Tone: serious-leaning (dry humour allowed); casual; respectful; matter-of-fact.
- Writer persona: the builder showing another developer who directs agents what their own setup does.
```

## 6. Vocabulary ⚙

```
- Always use: media-studio (lowercase, hyphen); the `studio` CLI; Studio Recorder; the review app; skills; a
  project; the plan; notes; sign off / sign-off; animatic; building blocks.
- Term swaps: video studio → media studio; AI-generated → made by your agent; feedback loop → notes; timeline → the plan; users → you;
  "templates" → building blocks.
- Never use: revolutionize, effortless, magic/magical, seamless (except in Graham's own quote), stunning,
  cinematic-quality, AI-powered, one-click, democratize, supercharge, next-gen.
```

## 7. Fact bank ⚙

```
| Claim | Evidence | Source |
|-------|----------|--------|
| Ships 9 skills as a Claude Code plugin | studio-setup, video-kickoff, video-capture, video-motion, paint, video-gen, video-sound, stills, studio-review | skills/, .claude-plugin/ |
| The CLI has 34 verbs, each self-documenting | `studio --help` lists them; `studio <verb> --help` | cli/ |
| Notes pin to a frame, a word or a region and the agent watches for them | `studio review watch/notes/reply` | `studio review --help`, skills/studio-review |
| A sign-off flags itself when what it approved changes | "Changed since you approved it" in the plan page | web/src/features/plan/ui/plan-scene-panel.tsx |
| Frames are checked before review | `studio check`: highlights off screen, clicks under captions, holds too short to read | `studio check --help` |
| Stills are refused when they fail the check | text cut off, under a platform's buttons, failing contrast | `studio still --help` |
| GPU paint engine: watercolour, gouache, crayon, pencil, ink; paintings animate, wrap onto 3D, fold as cut paper | lib/paint/, docs/brush-engine.md | skills/paint |
| Painted looks need a brush pack you own, imported as a private style | Procreate / Photoshop packs, `studio brushes import` | skills/paint/references/styles.md |
| Studio Recorder: one key records screen, camera, mic, input log as separate files | screen.mp4, camera.mp4, mic.m4a, input.jsonl | `studio recorder --help` |
| Recordings land in a transcribed, searchable library | `studio library add/search`, local whisper | `studio library --help`, `studio transcribe --help` |
| Free without keys: capture, motion, painting, draft voice (macOS say), sfx, mix, transcription, renders, review | OpenRouter key unlocks real voice and generation | skills/studio-setup |
| The agent works the review live: it wakes on each note, replies, hands back a fix with its render, asks you questions on frames, and posts candidates for you to pick | `studio review watch --follow`, `reply`, `ask`, `decide` | `studio review --help` |
| Paid results are cached by their inputs | asking again costs nothing | skills/studio-setup |
| Visitors come mostly from X | 12 of 14 unique referrals via t.co | GitHub traffic, 2026-11-24 |
```

> GAP: time saved per video, videos made with it, any outside user's quote. Graham has none yet; don't claim any.

## 8. Voice samples ⚙

```
- [Graham, in conversation] "It's meant for agent-human collaboration and iteration. Take drudgery out of basic
  tasks. Easy to provide feedback on important bits."
- [Graham, in conversation] "Studio Recorder … is intended to make capturing video seamless and put it in such a way
  that it's easy to slice and dice, pick good takes, etc."
- [Graham, in conversation] "A video studio for you and your agents. Tools to support code-based video and image
  creation plus a review UI for you to provide specific notes frame-by-frame."
- [README hero, existing] "Every frame is code, so a note like \"hold that shot longer\" is an edit and a re-render,
  not a redo."
- [contrast] BAD: "Create stunning AI videos in one click." → GOOD: "Your agent makes the video; you pin notes on the
  frames you want changed."
```

## 9. Channel notes

```
- X / social: the audience is developers and creative coders; lead with a clip or a frame, then one concrete line.
  No hashtags.
- Changelog: say what you can now do, in the present tense; name the verb or skill.
- README: the demo video first, the key message in the first two lines, then the four pillars, then setup for a
  person and for an agent. Never open with "Introduction" or a feature list without a thesis.
- Landing page: none yet.
```
