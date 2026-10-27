import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { formatClaudeMcpConfig } from "../../src/cli/bridge/claudeConfig.ts";

const execFileAsync = promisify(execFile);
const CLI_ENTRY = path.join(process.cwd(), "bin", "vellumpix-cli.ts");

describe("formatClaudeMcpConfig", () => {
  test("prints a remote Claude Code MCP config without exposing tokens by default", () => {
    const parsed = JSON.parse(
      formatClaudeMcpConfig({
        vellumpixHomeDir: "/Users/test/.vellumpix-local",
        browserProfileDir: "/Users/test/.vellumpix-local/browser-profile",
        remoteHost: "127.0.0.1:9473",
        remoteToken: "secret-token",
        includeToken: false,
      }),
    );

    expect(parsed.mcpServers.vellumpix).toMatchObject({
      type: "stdio",
      command: "vellumpix-mcp",
      args: [],
    });
    expect(parsed.mcpServers.vellumpix.env).toMatchObject({
      VELLUMPIX_ENGINE: "browser",
      VELLUMPIX_HOME_DIR: "/Users/test/.vellumpix-local",
      VELLUMPIX_BROWSER_PROFILE_DIR: "/Users/test/.vellumpix-local/browser-profile",
      VELLUMPIX_REMOTE_HOST: "127.0.0.1:9473",
      VELLUMPIX_REMOTE_TOKEN: "<YOUR_TOKEN>",
    });
  });

  test("prints a local-browser Claude Code MCP config without remote bridge env", () => {
    const parsed = JSON.parse(
      formatClaudeMcpConfig({
        vellumpixHomeDir: "/Users/test/.vellumpix",
        browserProfileDir: "/Users/test/.vellumpix/browser-profile",
        remoteHost: "127.0.0.1:9473",
        remoteToken: "secret-token",
        includeToken: true,
        localBrowser: true,
      }),
    );

    expect(parsed.mcpServers.vellumpix.env).toEqual({
      VELLUMPIX_ENGINE: "browser",
      VELLUMPIX_HOME_DIR: "/Users/test/.vellumpix",
      VELLUMPIX_BROWSER_PROFILE_DIR: "/Users/test/.vellumpix/browser-profile",
    });
  });

  test("prints local-browser CLI config as parseable stdout JSON", async () => {
    const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-claude-config-"));
    const browserProfileDir = path.join(vellumpixHome, "browser-profile");
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "bridge", "claude-config", "--local-browser"],
        {
          env: {
            ...process.env,
            NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=DEP0205"]
              .filter(Boolean)
              .join(" "),
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_HOME_DIR: vellumpixHome,
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_BROWSER_PROFILE_DIR: browserProfileDir,
          },
        },
      );

      const parsed = JSON.parse(stdout);
      expect(stderr.trim()).toBe("");
      expect(parsed.mcpServers.vellumpix.env).toEqual({
        VELLUMPIX_ENGINE: "browser",
        VELLUMPIX_HOME_DIR: vellumpixHome,
        VELLUMPIX_BROWSER_PROFILE_DIR: browserProfileDir,
      });
    } finally {
      await rm(vellumpixHome, { recursive: true, force: true });
    }
  }, 15_000);
});
