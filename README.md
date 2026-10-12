# media-studio

Tell your coding agent what video you want, and it makes it: the story, the shots, the motion, the voice, the music
and the mix, rendered to an MP4 you review in your browser. Built on [Remotion](https://www.remotion.dev), so every
frame is code, and a note like "hold that shot longer" is an edit and a re-render, not a redo.

![Reviewing a render: pin a note on a frame, and it knows the scene and the sound under it](docs/images/review.png)

## What you can make

- **Walkthroughs of real sites.** It films your pages itself: clicks, scrolls, typing, the states you'd show a
  customer, then zooms and highlights exactly the element each line is about.
- **Your product's real UI**, composed from your repo's own React components rather than screenshots of them.
- **Voiced explainers**, with each beat landing on its word, and **ads and teasers cut to music**, on the beat.
- **Generated images, music and footage** for what no capture can show, with each shot blocked out and approved
  before anything is paid for.
- **Stills**: OG images, YouTube thumbnails and social posts at every size, each checked for text that's cut off,
  hidden under a platform's buttons or lost against its background.
- **Sound**: effects synthesized to fit each moment, music fitted to the video's length, and a mastered mix.

![A stills sheet: every variant of an OG image, at full size and as a link card, each checked](docs/images/stills-sheet.png)

## Getting started

You need a Mac with Node 24 and ffmpeg.

1. Clone it somewhere it can stay: `git clone https://github.com/GLips/media-studio.git`
2. Add the skills to Claude Code from your clone, once per machine:

   ```
   /plugin marketplace add <path to your clone>
   /plugin install media-studio@media-studio
   ```

   Installed from a local clone, the skills load from the clone itself, so a `git pull` there updates the studio and
   its skills together, from your next session (or `/reload-plugins`).

3. Tell your agent: *"Set up media-studio."* It walks you through the rest, including the optional
   [OpenRouter](https://openrouter.ai) key that unlocks a real voice and generated media.

Then ask for a video, from any repo: *"make a 30-second teaser for our new pricing page."*

Your projects live in `work/`, a git repository of your own inside the clone, so they stay private while the studio
updates.

## The skills

- `studio-setup`: installs the studio and walks you through keys, your workspace, brand kits and product repos.
- `video-kickoff`: from a brief to an animatic you've signed off. Start every video here.
- `video-capture`, `video-motion`, `video-canvas`, `video-gen`, `video-sound`: the production passes: filming a site,
  motion, painted and drawn layers, generated footage, and sound.
- `stills`: OG images, thumbnails and social posts.
- `studio-review`: handing work over in the review app, notes and choices.

Every verb documents itself: `studio --help`, then `studio <verb> --help`. Working on the studio itself: `CLAUDE.md`.

## License

MIT
