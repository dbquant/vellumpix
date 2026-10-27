import { test, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const BACKGROUND = "Browser control: launch visible Chrome; keeps Chrome in the background.";
const FOREGROUND = "Browser control: launch visible Chrome; may focus/control the browser UI.";

test("the CLI honors --browser-no-focus, --no-browser-no-focus and browser.noFocus", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vellumpix-no-focus-cli-"));
  const env = {
    ...process.env,
    VELLUMPIX_HOME_DIR: home,
    VELLUMPIX_NO_DETACH: "1",
    OPENAI_API_KEY: "",
    VELLUMPIX_ENGINE: "",
  };
  const dryRun = async (extra: string[]) =>
    (
      await exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "bin/vellumpix-cli.ts",
          "--engine",
          "browser",
          "--model",
          "gpt-6",
          "--prompt",
          "no-focus default proof",
          "--dry-run",
          "summary",
          ...extra,
        ],
        { env },
      )
    ).stdout;
  try {
    // Off by default; the flag or config turns it on.
    expect(await dryRun([])).toContain(FOREGROUND);
    expect(await dryRun(["--no-browser-no-focus"])).toContain(FOREGROUND);
    await fs.writeFile(
      path.join(home, "config.json"),
      JSON.stringify({ browser: { noFocus: false } }),
    );
    expect(await dryRun([])).toContain(FOREGROUND);
    // An explicit flag still wins over the config opt-out.
    expect(await dryRun(["--browser-no-focus"])).toContain(BACKGROUND);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}, 60_000);
