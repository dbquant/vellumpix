# Windows compatibility notes

Keep this in sync as we learn more. Read this before doing browser runs on Windows.

- Browser engine is enabled on Windows now, but automation is flakier than macOS. If it fails, rerun with `--engine api --wait` or use `--remote-chrome` to point at a logged-in Chrome with remote debugging.
- Cookies: live-profile cookie sync is disabled by default on every platform, and Windows ChatGPT cookies are additionally often app-bound (`v20`) and fail decryption. Use `--browser-manual-login` to reuse a persistent automation profile and sign in once (skips cookie copy entirely). Inline cookies remain available (`--browser-inline-cookies(-file)` / `VELLUMPIX_BROWSER_COOKIES_JSON`).
- Manual login flow: run with `--browser-manual-login` and sign into chatgpt.com in the opened automation browser; VellumPix waits until the session is active. Windows defaults to a dedicated Edge profile at `~/.vellumpix/browser-profiles/edge`, with Chrome as the executable fallback at `~/.vellumpix/browser-profiles/chrome`. This never opens your normal Edge or Chrome `User Data` directory. Select explicitly with `--browser-provider edge|chrome`, disable/change fallback with `--browser-fallback-provider none|edge|chrome`, or override the profile with `VELLUMPIX_BROWSER_PROFILE_DIR` / `browser.manualLoginProfileDir`. For initial login/setup or debugging, add `--browser-keep-browser`.
- Cookie paths: preferred path is `%LOCALAPPDATA%\\Google\\Chrome\\User Data\\<Profile>\\Network\\Cookies`. If that errors, try the top-level `Cookies` file or supply the exact path via `--browser-cookie-path`.
- mcporter chrome-devtools: requires a valid `CHROME_DEVTOOLS_URL` from a live session; otherwise calls will fail.
- The agent-scripts `runner` helper is bash-based and may fail under PowerShell/CMD; run commands directly if it misbehaves.
