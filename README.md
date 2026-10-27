# VellumPix 🪶 — ChatGPT Web for writing and images

<p align="center">
  <a href="https://github.com/dbquant/vellumpix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dbquant/vellumpix/ci.yml?branch=main&style=flat-square&label=ci" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/@dbquant/vellumpix"><img src="https://img.shields.io/npm/v/@dbquant/vellumpix?style=flat-square" alt="npm version"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/@dbquant/vellumpix?style=flat-square" alt="Node.js version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dbquant/vellumpix?style=flat-square" alt="License"></a>
</p>

VellumPix is a session-aware CLI and MCP server for using a signed-in ChatGPT Web account for writing, image generation, follow-ups, and project-aware AI workflows. Windows uses an isolated Edge profile by default with Chrome fallback; macOS and Linux prefer Chrome.

Full documentation is at [github.com/dbquant/vellumpix](https://github.com/dbquant/vellumpix).

## Install

Install the npm package globally:

```bash
npm install -g @dbquant/vellumpix
```

VellumPix requires Node.js 24 or newer. To try it without installing:

```bash
npx -y @dbquant/vellumpix --help
```

See the [installation guide](docs/install.md) for pnpm, updates, API keys, and storage paths.

## Quick start

Build a review bundle locally before connecting any model:

```bash
vellumpix --render \
  -p "Review the package metadata for release risks" \
  --file package.json
```

This prints the exact prompt and numbered file contents VellumPix would send. It does not need credentials and does not contact a model.

When an engine is configured, remove `--render` to request an answer:

```bash
vellumpix \
  -p "Audit the model runner for race conditions" \
  --file "src/vellumpix/**/*.ts" \
  --file "!**/*.test.ts"
```

VellumPix chooses API mode when an OpenAI key is available and browser mode otherwise. Use `--engine api` or `--engine browser` to make the choice explicit. The [quickstart](docs/quickstart.md) covers the first API and browser runs.

## Choose an engine

| Path    | Use it when                                                                 | Setup                                                |
| ------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| API     | You want provider APIs, reliable automation, or multiple models in one run. | Set the key for the provider you use.                |
| Browser | You want VellumPix to use a signed-in ChatGPT or Gemini browser session.    | Install Chrome and complete the one-time login flow. |
| Render  | You want to inspect, copy, or paste the bundle yourself.                    | No account or key is required.                       |

API mode supports OpenAI, Azure OpenAI, Anthropic, Gemini, xAI, OpenRouter, and compatible endpoints. Browser mode uses Chrome automation for ChatGPT and a cookie-based Gemini client. See [browser mode](docs/browser-mode.md) and [provider endpoints](docs/openai-endpoints.md) for setup and limits.

## Control the context

`--file` accepts files, directories, globs, and `!` exclusions. Repeat it to compose the context you want reviewed. Preview the resolved files and token estimate before sending:

```bash
vellumpix --dry-run summary --files-report \
  -p "Audit the model runner for race conditions" \
  --file "src/vellumpix/**/*.ts" \
  --file "!**/*.test.ts"
```

Generated text bundles include stable line numbers so answers can cite `path:line`. In browser mode, one uploaded text/source file stays native and multiple text/source files are packed into one bundle: flattened text for text-only `auto` uploads, or a ZIP when raw files are present or `--browser-bundle-format zip` is set. Native images and documents remain direct attachments when possible. The [CLI reference](docs/cli-reference.md) lists the file, size, output, and browser controls.

## Sessions and follow-ups

VellumPix stores runs under `~/.vellumpix/sessions` so long responses can finish in the background and completed answers can be replayed. List recent work with:

```bash
vellumpix status --hours 72
```

Use `vellumpix session` to reattach to a run, `vellumpix restart` to repeat one, or `--followup` to continue a supported API or ChatGPT conversation with more context. See [sessions](docs/sessions.md) and [follow-ups](docs/followup.md) for the lifecycle and provider limits.

## Multiple models and automation

`--models` runs an API panel and records per-model usage, cost, output, and partial failures in one session. `vellumpix doctor --providers` inspects readiness for the selected models without exposing credentials. The [multi-model guide](docs/multimodel.md) covers routing and output files.

For agent integrations, run the `vellumpix-mcp` stdio server or install the VellumPix skill from this repository. See [MCP setup](docs/mcp.md) and [agent setup](docs/agents.md) for Claude Code, Codex, Cursor, and other MCP clients.

## Documentation

| Topic                      | Guide                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation and first run | [Install](docs/install.md) · [Quickstart](docs/quickstart.md)                                                                               |
| Browser automation         | [Browser mode](docs/browser-mode.md) · [Linux](docs/linux.md) · [Windows](docs/windows.md)                                                  |
| Providers                  | [OpenAI and Azure](docs/openai-endpoints.md) · [Anthropic](docs/anthropic.md) · [Gemini](docs/gemini.md) · [OpenRouter](docs/openrouter.md) |
| Runs and models            | [Sessions](docs/sessions.md) · [Follow-ups](docs/followup.md) · [Multi-model](docs/multimodel.md)                                           |
| Configuration and commands | [Configuration](docs/configuration.md) · [CLI reference](docs/cli-reference.md)                                                             |
| Agent integrations         | [Agents](docs/agents.md) · [MCP](docs/mcp.md) · [Bridge](docs/bridge.md)                                                                    |

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm docs:check
```

Manual browser and provider tests are documented in [docs/manual-tests.md](docs/manual-tests.md).

## License

MIT. See [LICENSE](LICENSE).
