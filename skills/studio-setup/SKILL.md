---
name: studio-setup
description: Setup for the studio on this machine, then the person's own pieces. Use when asked to set up media-studio, when `studio` isn't on the PATH or `work/` is missing, when a paid command fails for want of a key, or when a video needs a brand kit or a product repo's components.
---

# Setting up the studio

Once installed, the studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read
and Edit. Run what you can yourself; hand the person only what needs them: an account, a key, a choice.

## 0. Find or clone

`studio home` prints the clone's root when the studio is installed: go to step 3. Otherwise find the clone. The plugin
installed from a local clone loads in place, so `${CLAUDE_PLUGIN_ROOT}` is that clone when it lies outside
`~/.claude/plugins/`. Inside it, the plugin is a cached copy from a remote marketplace: clone the studio somewhere it
can stay (`git clone https://github.com/GLips/media-studio.git`, where the person picks), then install the plugin
from the clone in place of the copy:

```
/plugin marketplace add <clone>
/plugin install media-studio@media-studio
```

Installed this way the skills are the clone's own files: `git pull` there updates the CLI and the skills together,
from the next session or `/reload-plugins`, with no `/plugin update`. Done when you have the clone's absolute path.

## 1. Prerequisites

Check each, and give the one command that installs whatever is missing (Homebrew on a Mac): **Node 24**, which runs
the studio's TypeScript directly; **git** and **ffmpeg** on the PATH; **a GPU Chrome can use** (a render refuses
software GL, and says so on its first run); **macOS** for the draft voice (`say`), the Safari alpha video
(VideoToolbox) and `bin/studio-secrets` (the keychain). Elsewhere, say which of those three won't work.

## 2. Install

In the clone:

```sh
npm install               # also turns on the studio's pre-commit gate
npm link                  # puts `studio` on the PATH, pointing at this clone
studio workspace init     # makes work/, the person's own git repository
```

Done when `studio home`, run from another directory, prints the clone. Inside another checkout of the studio (a
worktree), `studio` runs that checkout's own CLI on its own `work/`.

## 3. Their workspace

Everything they make lives in `work/` (`studio workspace --help`): a git repository of its own that the studio's
ignores, so client names never reach the studio's history and `git pull` never touches their work. Recordings, renders
and generated media stay on the machine; only what they write is committed. Offer it a private remote:
`gh repo create <name> --private --source=work --push`. Done when `work/` has its remote, or the person chose to
keep it local.

## 4. Keys (only for what they want to make)

Ask what they want to make first: captures, motion, a draft voice (`studio voice --read=draft`), sound effects, the
mix, renders and review all run free.

- **`OPENROUTER_API_KEY`** (openrouter.ai/keys, with credit): a real voice (`studio voice`, `studio audition`) and
  generation (`studio music gen`, `studio gen image`, `studio gen video`). Each verb's `--help` gives its price.
- **An S3-compatible bucket** (Cloudflare R2 works), for the reference video `studio gen video` uploads for its
  provider to fetch: `STUDIO_UPLOAD_S3_ENDPOINT`, `STUDIO_UPLOAD_S3_BUCKET`, `STUDIO_UPLOAD_S3_ACCESS_KEY_ID`,
  `STUDIO_UPLOAD_S3_SECRET_ACCESS_KEY`, and `STUDIO_UPLOAD_S3_REGION` for a bucket outside R2.

The studio reads keys from the environment. The person types them where their secrets live, outside this chat:

- **Their shell profile**: `export OPENROUTER_API_KEY=…` in `~/.zshrc`, then a new terminal.
- **1Password**: `work/.env.op` holds one `NAME=op://<vault>/<item>/<field>` reference a line, and
  `"$(studio home)/bin/studio-secrets" <command>` resolves them for that one command, with a service account's token
  from the macOS keychain (its error says how to store one). Give that account read access to one vault only: code
  running as the person can read the keychain item.

Each paid result is cached by its inputs in the project's `generated/`, so asking again costs nothing. Done when each
key a wanted verb needs is in its environment, or the person has chosen to stay free.

## 5. Brand kits, styles and product repos (when a video needs one)

- **A brand kit** (colours, fonts, logos, voice) is `work/brands/<name>/`:
  `${CLAUDE_PLUGIN_ROOT}/skills/studio-setup/references/brand-kits.md` says what it holds and how to make one.
- **A painting style** is `work/styles/<name>/`, private because its brushes come from a bought pack: the
  `video-canvas` skill, and `studio brushes --help`.
- **A product repo** whose real components a video shows is a host (`studio hosts --help`). `studio hosts sync <p>
  --install` runs the host's own install, lifecycle scripts included; a working copy named in `work/hosts.local.json`
  is used as it stands, so install its packages there yourself. Plain CSS and CSS modules load; Tailwind and PostCSS don't.

## 6. Prove it

`studio new hello --capability=silent`, `studio render hello --animatic`, then `studio review open hello`. Done when
the review page plays the animatic in their browser; hand over to `video-kickoff` for their first real video.
