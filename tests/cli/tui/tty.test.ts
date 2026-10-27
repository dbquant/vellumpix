import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ptyAvailable, runVellumPixTuiWithPty } from "../../util/pty.js";
import { setVellumPixHomeDirOverrideForTest } from "../../../src/vellumpixHome.js";

const ptyDescribe =
  process.platform === "linux" ? describe.skip : ptyAvailable ? describe : describe.skip;

ptyDescribe("TUI (interactive, PTY)", () => {
  it("renders the menu and exits cleanly when selecting Exit", async () => {
    const { output, exitCode, homeDir } = await runVellumPixTuiWithPty({
      steps: [
        // Move to the Exit row (ask vellumpix -> ask vellumpix -> newer/reset -> exit). Extra downs are harmless.
        {
          match: "Select a session or action",
          write: "\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\r",
        },
      ],
    });
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});

    expect(exitCode).toBe(0);
    expect(output).toContain("🪶 vellumpix");
    expect(output.toLowerCase()).toContain("closing the book");
  }, 20_000);

  it("prints the vellumpix header only once when forcing the TUI", async () => {
    const { output, homeDir } = await runVellumPixTuiWithPty({
      steps: [
        {
          match: "Select a session or action",
          write: "\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\r",
        },
      ],
    });
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});

    const headerCount = (output.match(/🪶 vellumpix/g) ?? []).length;
    expect(headerCount).toBe(1);
    expect(output).not.toContain("__disabled__");
    expect(output).not.toContain("(Disabled)");
  }, 20_000);

  it("lists recent sessions without disabled placeholders or duplicate headers", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "vellumpix-tui-sessions-"));
    try {
      const { sessionStore } = await import("../../../src/sessionStore.ts");
      setVellumPixHomeDirOverrideForTest(homeDir);

      await sessionStore.ensureStorage();
      await sessionStore.createSession({ prompt: "one", model: "gpt-5.1" }, process.cwd());
      await sessionStore.createSession({ prompt: "two", model: "gpt-5.2-pro" }, process.cwd());

      const { output } = await runVellumPixTuiWithPty({
        homeDir,
        steps: [
          {
            match: "Select a session or action",
            write: "\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\r",
          },
        ],
        killAfterMs: 10_000,
      });

      const disabledMatches = output.match(/__disabled__|\(Disabled\)/g) ?? [];
      expect(disabledMatches.length).toBe(0);
      const statusHeaders = output.match(/Status/g) ?? [];
      expect(statusHeaders.length).toBeGreaterThan(0);
      expect(statusHeaders.length).toBeLessThan(10);
    } finally {
      setVellumPixHomeDirOverrideForTest(null);
      await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});
