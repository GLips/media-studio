---
name: studio-setup
description: Install the studio on this machine and walk its person through the rest: prerequisites, the `studio` command, their private workspace, API keys for voice and generation, brand kits and product repos. Use when asked to set up media-studio, when `studio` isn't on the PATH or `work/` is missing, or when a paid command fails for want of a key.
---

# Setting up the studio

The person has cloned the studio and installed this plugin; everything else is yours to do or to walk them through.
Do what you can run yourself, and hand them only what needs them: an account, a key, a choice.

## 1. Prerequisites

Check each, and tell them what's missing with the one command that installs it (Homebrew on a Mac):

- **macOS.** The draft voice (`say`), the Safari alpha video (VideoToolbox) and `bin/studio-secrets` (the keychain)
  need it. Elsewhere, most of the studio still works; say which parts won't.
- **Node 24** (`node --version`). `studio` is TypeScript that Node 24 runs directly.
- **git** and **ffmpeg** on the PATH (`ffmpeg -version`).
- **A GPU Chrome can use.** A render refuses software GL, and says so on its first run.

## 2. Install

From the clone:

```sh
npm install               # also turns on the studio's pre-commit gate
npm link                  # puts `studio` on the PATH, pointing at this checkout
studio workspace init     # makes work/, the person's own git repository
```

`studio home` then prints the clone's root from anywhere. Run inside another checkout of the studio (a worktree, a
second clone), `studio` runs that checkout's own CLI on its own `work/`.

## 3. Their workspace

Everything they make lives in `work/`: `work/projects/<yyyy-mm-name>/`, brand kits in `work/brands/`, product repos
in `work/hosts.json`. It's a git repository of its own that the studio's ignores, so their projects and client names
never reach the studio's history, and pulling studio updates never touches their work. Recordings, renders and
generated media stay on the machine (its `.gitignore`); only what they write is committed. Its commits run their own
gate: `check:arch --scope workspace`, lint, the typecheck and their projects' tests.

Offer to give it a private remote. With `gh`: `gh repo create <name> --private --source=work --push`.

## 4. Keys (optional)

Ask what they want to make before asking for keys: much of the studio costs nothing.

| Needs | Free without a key | Key |
|---|---|---|
| A real voice (`studio voice`, `studio audition`), generated music, images and footage (`studio gen`) | a draft voice (`--read=draft`, macOS `say`), captures, motion, sound effects, the mix, renders, review | `OPENROUTER_API_KEY`, from openrouter.ai/keys, with credit on the account |
| A reference video for generated footage (`studio gen video`), uploaded for the provider to fetch | everything else | an S3-compatible bucket (Cloudflare R2 works): `STUDIO_UPLOAD_S3_ENDPOINT`, `STUDIO_UPLOAD_S3_BUCKET`, `STUDIO_UPLOAD_S3_ACCESS_KEY_ID`, `STUDIO_UPLOAD_S3_SECRET_ACCESS_KEY`, and `STUDIO_UPLOAD_S3_REGION` for a bucket outside R2 |

The studio reads them from the environment. Never ask them to paste a key into the chat; have them put it where
their shell or password manager keeps secrets. Two ways:

- **Their shell profile.** `export OPENROUTER_API_KEY=…` in `~/.zshrc`, typed by them, then a new terminal.
- **1Password.** `work/.env.op` names each key as a reference, one per line
  (`OPENROUTER_API_KEY=op://<vault>/<item>/<field>`), and `"$(studio home)/bin/studio-secrets" <command>` resolves
  them for that one command. It takes a 1Password service account's token from the macOS keychain (service
  `op-service-account-media-studio`), hands it to `op` alone and strips it before the command starts. Give the account
  read access to one vault only: code running as them can still read the keychain item.

Every paid request is cached by its inputs in the project's `generated/`, so asking again costs nothing.

## 5. Brand kits and product repos (when a video needs them)

- **A brand kit** (colours, fonts, logos, voice) is `work/brands/<name>/`. `docs/brand-kits.md` says what it holds; font
  files stay on the machine, since most are licensed.
- **A painting style** is `work/styles/<name>/`, private because its brushes come from a bought pack
  (`docs/private-styles.md`). Its `brushes/` stays on the machine: each one imports the pack from its own copy.
- **A product repo** a video shows real components from is a host. `work/hosts.json` maps a name to
  `{ "repo": "<git url>" }`; `work/hosts.local.json` (ignored) maps it to a working copy on this machine instead, used as
  it stands. A project opts in with `host.json` `{ "name", "ref", "browserStubs"? }`, and `studio hosts sync <project>`
  checks the ref out under `~/.cache/media-studio/hosts/` and links it at `<project>/host`. A scene imports
  `@host/<path from the host root>`; tsc types it `any`, so `studio look` is the check. Plain CSS and CSS modules load;
  Tailwind/PostCSS doesn't.

## 6. Prove it

```sh
studio new hello --capability=silent
studio render hello --animatic
studio review hello
```

The review opens the animatic in their browser: the studio works. Then hand over to `video-kickoff` for their first
real video, and tell them the studio updates with `git pull` in `studio home`.
