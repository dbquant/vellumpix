---
title: Install
description: "Install VellumPix via npm or run on demand with npx. Node 24+ required."
---

## npm / pnpm

```bash
npm install -g @dbquant/vellumpix
# or
pnpm add -g @dbquant/vellumpix
```

Requires Node **24 or newer**. After install:

```bash
vellumpix --help
vellumpix --version
```

## Run without installing

```bash
npx -y @dbquant/vellumpix --help
pnpx @dbquant/vellumpix --help
```

`npx` is fine for CI, ad-hoc scripts, or when you don't want a global binary on the box. Cache the package in CI by pinning the version (`@dbquant/vellumpix@0.12.1`) so you don't re-download on every job.

## API keys (optional)

API mode is opt-in and reads keys from the environment. Set whichever providers you'll use:

| Provider     | Env var                                                           | Models                                                  |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------- |
| OpenAI       | `OPENAI_API_KEY`                                                  | GPT-5.x, GPT-5.x Pro, GPT-5.1 Codex                     |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `..._DEPLOYMENT` | Same models, hosted on Azure                            |
| Google       | `GEMINI_API_KEY`                                                  | Gemini 3.1 Pro, Gemini 3.5 Flash, Gemini 3.1 Flash-Lite |
| Anthropic    | `ANTHROPIC_API_KEY`                                               | Claude Sonnet 4.6, Claude Opus 4.1                      |
| OpenRouter   | `OPENROUTER_API_KEY`                                              | Any OpenRouter id (e.g. `minimax/minimax-m2`)           |

If no key is set, VellumPix defaults to **browser mode** and drives ChatGPT directly — see [Browser Mode](browser-mode.md) for the manual-login flow.

## Where VellumPix stores state

| Path                          | Contents                                                 |
| ----------------------------- | -------------------------------------------------------- |
| `~/.vellumpix/config.json`    | Defaults (JSON5). See [Configuration](configuration.md). |
| `~/.vellumpix/sessions/<id>/` | Run logs, bundles, transcripts, generated artifacts      |
| `~/.vellumpix/cookies.json`   | (Optional) inline ChatGPT cookies for browser mode       |

Override the root with `VELLUMPIX_HOME_DIR=/some/path` if you'd rather keep state under XDG config or per-project.

## Updating

```bash
brew upgrade vellumpix      # Homebrew
npm update -g @dbquant/vellumpix
```

`vellumpix --version` reports the current build. Releases land on [GitHub Releases](https://github.com/dbquant/vellumpix/releases) with notes copied from the [changelog](https://github.com/dbquant/vellumpix/blob/main/CHANGELOG.md).
