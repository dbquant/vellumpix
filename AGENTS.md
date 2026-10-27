# AGENTS.MD

VellumPix-specific notes:

- Pro browser runs: allow up to 10 minutes; never click "Answer now"; keep at least 1–2 Pro live tests (reattach must stay Pro); move other tests to faster models where safe.
- Live smoke tests: OpenAI live tests are opt-in. Run `VELLUMPIX_LIVE_TEST=1 pnpm vitest run tests/live/openai-live.test.ts` with a real `OPENAI_API_KEY` when you need the background path; gpt-5-pro can take ~10 minutes.
- Wait defaults: gpt-5-pro API runs detach by default; use `--wait` to stay attached. gpt-5.1 and browser runs block by default; every run prints `vellumpix session <id>` for reattach.
- Session storage: VellumPix stores session data under `~/.vellumpix`; delete it if you need a clean slate.
- CLI output: the first line of any top-level CLI start banner should use the vellumpix emoji, e.g. `🪶 vellumpix (<version>) ...`; keep it only for the initial command headline. Exception: the TUI exit message also keeps the emoji.
- Before a release, skim manual smokes in `docs/manual-tests.md` and rerun any that cover your change surface (especially browser/serve paths).
- If browser smokes echo the prompt (Instant), rerun with `--browser-keep-browser --verbose` in tmux, then inspect DOM with `pnpm tsx scripts/browser-tools.ts eval ...` to confirm assistant turns exist; we fixed a case by refreshing assistant snapshots post-send.
- Browser “Pro thinking” gate: never click/auto-click ChatGPT’s “Answer now” button. Treat it as a placeholder and wait 10m–1h for the real assistant response (auto-clicking skips long thinking and changes behavior).
- Browser smokes should preserve Markdown (lists, fences); if output looks flattened or echoed, inspect the captured assistant turn via `browser-tools.ts eval` before shipping.
- Working on Windows? Read and update `docs/windows-work.md` before you start.

Browser-mode debug notes (ChatGPT URL override)

- When a ChatGPT folder/workspace URL is set, Cloudflare can block automation even after cookie sync. Use `--browser-keep-browser` to leave Chrome open, solve the interstitial manually, then rerun.
- If a run stalls/looks finished but CLI didn’t stream output, check the latest session (`vellumpix status`) and open it (`vellumpix session <id> --render`) to confirm completion.
- Active Chrome port/pid live in session metadata (`~/.vellumpix/sessions/<id>/meta.json`). Connect with `npx tsx scripts/browser-tools.ts eval --port <port> "({ href: window.location.href, ready: document.readyState })"` to inspect the page.
- To debug with agent-tools, launch Chrome via a VellumPix browser run (cookies copied) and keep it open (`--browser-keep-browser`). Then use `browser-tools ... --port <port>` with the port from `~/.vellumpix/sessions/<id>/meta.json`. Avoid starting a fresh browser-tools Chrome when you need the synced cookies.
- Double-hop nav is implemented (root then target URL), but Cloudflare may still need manual clearance or inline cookies.
- After finishing a feature, ask whether it matters to end users; if yes, update the changelog. Read the top ~100 lines first and group related edits into one entry instead of scattering multiple bullets.
- Beta publishing: when asked to ship a beta to npm, bump the version with a beta suffix (e.g., `0.4.4-beta.1`) before publishing; npm will not let you overwrite an existing beta tag without a new version.
