# A project's files

`studio new` writes a project at `$(studio home)/work/projects/<yyyy-mm>-<slug>/` that passes the studio's checks from
its first commit. A `<project>` argument to any verb is that slug, a unique part of the name, or a path.

```
project.ts         its capability (music-led, voice-led, mixed, silent, still-only), held to what it binds;
                   `shared`, the modules every scene may import; `styles`, the painting styles it paints in
storyboard.ts      the plan, the one place a line is written: the brief, a row per scene (on screen, motion,
                   reads, its lines with their word cues, or its beats or seconds), the left-out list
scenes/, bars/     a file per scene (bars/ for one cut on the beat), its helpers in a folder of its name
video.tsx          defineVideo: format, voice, music, and each scene bound to its clock
capture.ts         the named shots of a site, stills and takes (the video-capture skill)
stills.tsx         defineStills: each still design, its presets and variants (the stills skill)
brand.ts           the brand kit it uses, and what it changes for this project
host.json          the product repo it shows real components from (studio hosts --help)
review/            the reviewer's notes, replies, decisions and sign-offs (committed)

captures/, audio/, music/, generated/, out/, host     made by the studio's verbs, kept off git
```

A scene reaches another scene's moment through a cue in `storyboard.ts`, never by importing it, and shares code only
through the modules `project.ts` declares `shared`. In a voiced scene the lines set its length, so a reworded line
re-times the video with no other edit. The workspace's retime check times every storyboard; a project has no test of
its own for it.
