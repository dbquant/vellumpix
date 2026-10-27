import chalk from "chalk";
import os from "node:os";
import path from "node:path";
import { loadUserConfig } from "../../config.js";
import { resolveRemoteServiceConfig } from "../../remote/remoteServiceConfig.js";

export interface BridgeClaudeConfigCliOptions {
  printToken?: boolean;
  localBrowser?: boolean;
  vellumpixHomeDir?: string;
  browserProfileDir?: string;
}

export async function runBridgeClaudeConfig(options: BridgeClaudeConfigCliOptions): Promise<void> {
  const { config: userConfig } = await loadUserConfig();
  const resolved = resolveRemoteServiceConfig({
    cliHost: undefined,
    cliToken: undefined,
    userConfig,
    env: process.env,
  });

  const snippet = formatClaudeMcpConfig({
    vellumpixHomeDir:
      options.vellumpixHomeDir ??
      process.env.VELLUMPIX_HOME_DIR ??
      path.join(os.homedir(), options.localBrowser ? ".vellumpix" : ".vellumpix-local"),
    browserProfileDir:
      options.browserProfileDir ??
      process.env.VELLUMPIX_BROWSER_PROFILE_DIR ??
      path.join(
        os.homedir(),
        options.localBrowser ? ".vellumpix" : ".vellumpix-local",
        "browser-profile",
      ),
    remoteHost: resolved.host,
    remoteToken: resolved.token,
    includeToken: Boolean(options.printToken),
    localBrowser: Boolean(options.localBrowser),
  });

  console.log(snippet);
  if (!options.printToken && !options.localBrowser) {
    console.error("");
    console.error(
      chalk.dim("Tip: rerun with --print-token to include VELLUMPIX_REMOTE_TOKEN in the snippet."),
    );
  }
}

export function formatClaudeMcpConfig({
  vellumpixHomeDir,
  browserProfileDir,
  remoteHost,
  remoteToken,
  includeToken,
  localBrowser = false,
}: {
  vellumpixHomeDir: string;
  browserProfileDir: string;
  remoteHost?: string;
  remoteToken?: string;
  includeToken: boolean;
  localBrowser?: boolean;
}): string {
  const env: Record<string, string> = {};
  env["VELLUMPIX_ENGINE"] = "browser";
  env["VELLUMPIX_HOME_DIR"] = vellumpixHomeDir;
  env["VELLUMPIX_BROWSER_PROFILE_DIR"] = browserProfileDir;

  if (remoteHost && !localBrowser) {
    env["VELLUMPIX_REMOTE_HOST"] = remoteHost;
    env["VELLUMPIX_REMOTE_TOKEN"] = includeToken ? (remoteToken ?? "<YOUR_TOKEN>") : "<YOUR_TOKEN>";
  }

  // Claude Code supports project-scoped `.mcp.json` config files:
  // https://docs.anthropic.com/en/docs/claude-code/mcp
  return JSON.stringify(
    {
      mcpServers: {
        vellumpix: {
          type: "stdio",
          command: "vellumpix-mcp",
          args: [],
          env,
        },
      },
    },
    null,
    2,
  );
}
