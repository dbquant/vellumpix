import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile, readdir, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  type ChildProcess,
  type ChildProcessByStdio,
  execFile,
  spawn,
  type ExecFileOptions,
} from "node:child_process";
import type { Readable } from "node:stream";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_ENTRY = path.join(process.cwd(), "bin", "vellumpix-cli.ts");
const TSX_LOADER = pathToFileURL(
  path.join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs"),
).href;
const CLIENT_FACTORY = path.join(process.cwd(), "tests", "fixtures", "mockClientFactory.cjs");
const INTEGRATION_TIMEOUT = 60000;
const AZURE_ENV_KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
] as const;
const originalAzureEnv = Object.fromEntries(AZURE_ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of AZURE_ENV_KEYS) {
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of AZURE_ENV_KEYS) {
    const value = originalAzureEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function execCli(
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", CLI_ENTRY, ...args],
      options,
      (error, stdout, stderr) => {
        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolve({
          code,
          stdout: typeof stdout === "string" ? stdout : stdout.toString("utf8"),
          stderr: typeof stderr === "string" ? stderr : stderr.toString("utf8"),
        });
      },
    );
  });
}

type CliChild = ChildProcessByStdio<null, Readable, Readable>;

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForChildOutput(child: CliChild, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      child.stdout.off("data", done);
      child.stderr.off("data", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    child.stdout.once("data", done);
    child.stderr.once("data", done);
  });
}

describe("vellumpix CLI integration", () => {
  test(
    "exits nonzero when a detached worker receives an unknown session id",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-missing-session-"));
      const result = await execCli(["--exec-session", "missing-session"], {
        env: {
          ...process.env,
          // biome-ignore lint/style/useNamingConvention: env var name
          VELLUMPIX_HOME_DIR: vellumpixHome,
          // biome-ignore lint/style/useNamingConvention: env var name
          VELLUMPIX_DISABLE_KEYTAR: "1",
        },
        timeout: INTEGRATION_TIMEOUT,
      });

      expect(result.code).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "No session found with ID missing-session",
      );
      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "exits nonzero when root options omit the required prompt",
    async () => {
      const result = await execCli(["--engine", "api"], { timeout: INTEGRATION_TIMEOUT });

      expect(result.code).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Prompt is required");
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects dry-run combined with either render flag spelling",
    async () => {
      for (const renderFlag of ["--render-markdown", "--render"]) {
        const result = await execCli(["--dry-run", renderFlag, "-p", "render conflict"], {
          timeout: INTEGRATION_TIMEOUT,
        });

        expect(result.code).toBe(1);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          "--dry-run cannot be combined with --render-markdown.",
        );
      }
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "does not prune stored sessions during a dry-run",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-dry-run-retention-"));
      const oldSessionDir = path.join(vellumpixHome, "sessions", "old-neutral-session");
      try {
        await mkdir(oldSessionDir, { recursive: true });
        await writeFile(
          path.join(oldSessionDir, "meta.json"),
          JSON.stringify({
            id: "old-neutral-session",
            createdAt: "2020-01-01T00:00:00.000Z",
            status: "completed",
            mode: "browser",
            options: {},
          }),
          "utf8",
        );

        const result = await execCli(
          [
            "--dry-run",
            "summary",
            "--retain-hours",
            "1",
            "--engine",
            "browser",
            "--prompt",
            "Neutral dry-run retention check",
          ],
          {
            env: {
              ...process.env,
              // biome-ignore lint/style/useNamingConvention: env var name
              VELLUMPIX_HOME_DIR: vellumpixHome,
              // biome-ignore lint/style/useNamingConvention: env var name
              VELLUMPIX_DISABLE_KEYTAR: "1",
            },
            timeout: INTEGRATION_TIMEOUT,
          },
        );

        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain("Pruned");
        await expect(readFile(path.join(oldSessionDir, "meta.json"), "utf8")).resolves.toContain(
          "old-neutral-session",
        );
      } finally {
        await rm(vellumpixHome, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "SIGINT exits promptly",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-sigint-"));
      const markerPath = path.join(vellumpixHome, "continued-after-sigint");
      const factoryPath = path.join(vellumpixHome, "slowFactory.cjs");
      await writeFile(
        factoryPath,
        `
const fs = require("node:fs");
module.exports = () => ({
  responses: {
    stream: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      fs.writeFileSync(${JSON.stringify(markerPath)}, "continued");
      return {
        async *[Symbol.asyncIterator]() {},
        finalResponse: async () => ({ id: "slow-test", status: "completed" }),
      };
    },
    create: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      fs.writeFileSync(${JSON.stringify(markerPath)}, "continued");
      return { id: "slow-test", status: "completed" };
    },
    retrieve: async (id) => ({ id, status: "completed" }),
  },
});
`,
        "utf8",
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-sigint",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: factoryPath,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--provider",
          "openai",
          "--model",
          "gpt-5.1",
          "--no-background",
          "-p",
          "interrupt slow client",
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });

      await waitForChildOutput(child, 2000);
      child.kill("SIGINT");
      const exit = await waitForChildExit(child, 5000);

      // SIGINT can land just before the CLI installs its handler, in which case Node reports the
      // signal directly instead of the handler-normalized exit code.
      const exitedViaSignal = exit.code === null && exit.signal === "SIGINT";
      const exitedViaHandler = exit.code === 130 && exit.signal === null;
      expect(exitedViaSignal || exitedViaHandler).toBe(true);
      if (exitedViaHandler) {
        expect(output).toContain("Cancelled.");
      }
      await expect(readFile(markerPath, "utf8")).rejects.toThrow();
      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "stores session metadata using stubbed client factory",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-home-"));
      const testFile = path.join(vellumpixHome, "notes.md");
      await writeFile(testFile, "Integration dry run content", "utf8");

      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Integration check",
          "--model",
          "gpt-5.1",
          "--file",
          testFile,
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const sessionIds = await readdir(sessionsDir);
      expect(sessionIds.length).toBe(1);
      const metadataPath = path.join(sessionsDir, sessionIds[0], "meta.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      expect(metadata.status).toBe("completed");
      expect(metadata.response?.requestId).toBe("mock-req");
      expect(metadata.usage?.totalTokens).toBe(20);
      expect(metadata.options?.effectiveModelId).toBe("gpt-5.1");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "honors --provider openai by ignoring Azure env routing",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-provider-openai-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_ENDPOINT: "https://example-resource.openai.azure.com/",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_API_KEY: "az-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--provider",
          "openai",
          "--prompt",
          "Provider route check",
          "--model",
          "gpt-5.1",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const metadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(metadata.options?.azure).toBeUndefined();
      expect(metadata.options?.provider).toBe("openai");
      expect(stdout).toContain("Provider: OpenAI | base: api.openai.com | key: OPENAI_API_KEY");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "stores resolved transport and stale timeouts from explicit overall timeout",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-timeout-plan-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Timeout plan check",
          "--model",
          "gpt-5.1",
          "--timeout",
          "10m",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const metadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(metadata.options?.timeoutSeconds).toBe(600);
      expect(metadata.options?.httpTimeoutMs).toBe(600_000);
      expect(metadata.options?.zombieTimeoutMs).toBe(600_000);

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "keeps Gemini dry-runs in browser mode when Azure env is present",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-provider-gemini-azure-"),
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_ENDPOINT: "https://example-resource.openai.azure.com/",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_API_KEY: "az-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        DOTENV_CONFIG_PATH: "/tmp/nonexistent-vellumpix-env",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };
      delete env.OPENAI_API_KEY;
      delete env.GEMINI_API_KEY;
      delete env.OPENROUTER_API_KEY;
      delete env.VELLUMPIX_ENGINE;

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--dry-run",
          "--prompt",
          "Gemini browser route check",
          "--model",
          "gemini-3.1-pro",
        ],
        { env },
      );

      expect(stdout).toContain("[preview] VellumPix");
      expect(stdout).toContain("browser mode (target=Gemini 3.1 Pro; requested=gemini-3.1-pro)");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "honors VELLUMPIX_ENGINE browser when Azure env is present",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-provider-engine-browser-"),
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_ENDPOINT: "https://example-resource.openai.azure.com/",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_API_KEY: "az-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_DEPLOYMENT: "configured-gpt",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_ENGINE: "browser",
        // biome-ignore lint/style/useNamingConvention: env var name
        DOTENV_CONFIG_PATH: "/tmp/nonexistent-vellumpix-env",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };
      delete env.OPENAI_API_KEY;
      delete env.GEMINI_API_KEY;
      delete env.OPENROUTER_API_KEY;

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--dry-run",
          "--prompt",
          "Engine browser route check",
          "--model",
          "gpt-5.4",
        ],
        { env },
      );

      expect(stdout).toContain("[preview] VellumPix");
      expect(stdout).toContain("browser mode (target=Thinking 5.4; requested=gpt-5.4)");
      expect(stdout).not.toContain("Provider: Azure OpenAI");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "honors project browser config when Azure env is present",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-project-azure-home-"));
      const repoDir = await mkdtemp(path.join(os.tmpdir(), "vellumpix-project-azure-repo-"));
      await mkdir(path.join(repoDir, ".vellumpix"), { recursive: true });
      await writeFile(
        path.join(repoDir, ".vellumpix", "config.json"),
        `{ engine: "browser", browser: { chatgptUrl: "https://chatgpt.com/g/g-p-demo/project" } }`,
        "utf8",
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      env.AZURE_OPENAI_ENDPOINT = "https://example-resource.openai.azure.com/";
      env.AZURE_OPENAI_API_KEY = "az-integration";
      env.AZURE_OPENAI_DEPLOYMENT = "configured-gpt";
      env.DOTENV_CONFIG_PATH = "/tmp/nonexistent-vellumpix-env";
      env.VELLUMPIX_HOME_DIR = vellumpixHome;
      env.VELLUMPIX_DISABLE_KEYTAR = "1";
      delete env.VELLUMPIX_ENGINE;
      delete env.OPENAI_API_KEY;
      delete env.GEMINI_API_KEY;
      delete env.OPENROUTER_API_KEY;

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          TSX_LOADER,
          CLI_ENTRY,
          "--dry-run",
          "--prompt",
          "Project browser route check",
          "--model",
          "gpt-5.4",
        ],
        { env, cwd: repoDir },
      );

      expect(stdout).toContain("[preview] VellumPix");
      expect(stdout).toContain("browser mode (target=Thinking 5.4; requested=gpt-5.4)");
      expect(stdout).not.toContain("Provider: Azure OpenAI");

      await rm(vellumpixHome, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "honors VELLUMPIX_ENGINE api over project config engine",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-project-engine-home-"));
      const repoDir = await mkdtemp(path.join(os.tmpdir(), "vellumpix-project-engine-repo-"));
      await mkdir(path.join(repoDir, ".vellumpix"), { recursive: true });
      await writeFile(
        path.join(repoDir, ".vellumpix", "config.json"),
        `{ engine: "browser", model: "gpt-5.5-pro" }`,
        "utf8",
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      env.DOTENV_CONFIG_PATH = "/tmp/nonexistent-vellumpix-env";
      env.VELLUMPIX_HOME_DIR = vellumpixHome;
      env.VELLUMPIX_ENGINE = "api";
      env.VELLUMPIX_DISABLE_KEYTAR = "1";
      delete env.OPENAI_API_KEY;
      delete env.GEMINI_API_KEY;
      delete env.OPENROUTER_API_KEY;

      const { stdout } = await execFileAsync(
        process.execPath,
        ["--import", TSX_LOADER, CLI_ENTRY, "--dry-run", "--prompt", "Engine env route check"],
        { env, cwd: repoDir },
      );

      expect(stdout).toContain("[dry-run] VellumPix");
      expect(stdout).toContain("would call gpt-5.5-pro");
      expect(stdout).not.toContain("browser mode");

      await rm(vellumpixHome, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "honors API engine overrides over project browser config for API-only models",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-project-api-home-"));
      const repoDir = await mkdtemp(path.join(os.tmpdir(), "vellumpix-project-api-repo-"));
      await mkdir(path.join(repoDir, ".vellumpix"), { recursive: true });
      await writeFile(
        path.join(repoDir, ".vellumpix", "config.json"),
        `{ engine: "browser" }`,
        "utf8",
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      env.DOTENV_CONFIG_PATH = "/tmp/nonexistent-vellumpix-env";
      env.VELLUMPIX_HOME_DIR = vellumpixHome;
      env.VELLUMPIX_DISABLE_KEYTAR = "1";
      delete env.VELLUMPIX_ENGINE;
      delete env.OPENAI_API_KEY;
      delete env.GEMINI_API_KEY;
      delete env.OPENROUTER_API_KEY;

      for (const scenario of [
        { args: ["--engine", "api"], envEngine: undefined },
        { args: [], envEngine: "api" },
      ]) {
        const scenarioEnv = { ...env };
        if (scenario.envEngine) {
          scenarioEnv.VELLUMPIX_ENGINE = scenario.envEngine;
        } else {
          delete scenarioEnv.VELLUMPIX_ENGINE;
        }

        const { stdout } = await execFileAsync(
          process.execPath,
          [
            "--import",
            TSX_LOADER,
            CLI_ENTRY,
            "--dry-run",
            ...scenario.args,
            "--model",
            "claude-4.6-sonnet",
            "--prompt",
            "Explicit API route check",
          ],
          { env: scenarioEnv, cwd: repoDir, timeout: INTEGRATION_TIMEOUT },
        );

        expect(stdout).toContain("[dry-run] VellumPix");
        expect(stdout).toContain("would call claude-4.6-sonnet");
        expect(stdout).not.toContain("browser mode");
      }

      await rm(vellumpixHome, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "persists explicit Azure provider mode for custom deployment sessions",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-provider-azure-"));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_ENDPOINT: "https://example-resource.openai.azure.com/",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_API_KEY: "az-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        DOTENV_CONFIG_PATH: "/tmp/nonexistent-vellumpix-env",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };
      delete env.OPENAI_API_KEY;

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--provider",
          "azure",
          "--azure-deployment",
          "my-o3",
          "--prompt",
          "Azure provider route check",
          "--model",
          "o3-mini",
          "--no-background",
          "--wait",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const metadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(metadata.options?.provider).toBe("azure");
      expect(metadata.options?.azure?.deployment).toBe("my-o3");
      expect(stdout).toContain(
        "Provider: Azure OpenAI | endpoint: example-resource.openai.azure.com | deployment: my-o3 | key: AZURE_OPENAI_API_KEY|OPENAI_API_KEY",
      );

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects missing Azure deployment before detached Pro sessions start",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-provider-detach-azure-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_ENDPOINT: "https://example-resource.openai.azure.com/",
        // biome-ignore lint/style/useNamingConvention: env var name
        AZURE_OPENAI_API_KEY: "az-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "Detached Azure provider route check",
            "--model",
            "gpt-5-pro",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/Azure mode requires --azure-deployment/i);
      }

      const sessionsDir = path.join(vellumpixHome, "sessions");
      let sessionIds: string[] = [];
      try {
        sessionIds = await readdir(sessionsDir);
      } catch {
        sessionIds = [];
      }
      expect(sessionIds).toEqual([]);

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects forced OpenAI non-OpenAI models before detached Pro sessions start",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-provider-detach-openai-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--provider",
            "openai",
            "--prompt",
            "Detached OpenAI provider route check",
            "--model",
            "claude-4.6-sonnet",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/OpenAI provider cannot run claude-4\.6-sonnet/i);
      }

      const sessionsDir = path.join(vellumpixHome, "sessions");
      let sessionIds: string[] = [];
      try {
        sessionIds = await readdir(sessionsDir);
      } catch {
        sessionIds = [];
      }
      expect(sessionIds).toEqual([]);

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects forced OpenAI provider-qualified non-OpenAI dry-runs before sessions start",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-provider-dry-openai-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        DOTENV_CONFIG_PATH: "/tmp/nonexistent-vellumpix-env",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--dry-run",
            "--provider",
            "openai",
            "--prompt",
            "Dry-run provider route check",
            "--model",
            "anthropic/claude-sonnet-4.5",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/OpenAI provider cannot run anthropic\/claude-sonnet-4\.5/i);
      }

      const sessionsDir = path.join(vellumpixHome, "sessions");
      let sessionIds: string[] = [];
      try {
        sessionIds = await readdir(sessionsDir);
      } catch {
        sessionIds = [];
      }
      expect(sessionIds).toEqual([]);

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects invalid forced provider multi-model runs before any session starts",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-provider-multi-openai-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--provider",
            "openai",
            "--prompt",
            "Multi-provider route check",
            "--models",
            "gpt-5.1,claude-4.6-sonnet",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/OpenAI provider cannot run claude-4\.6-sonnet/i);
      }

      const sessionsDir = path.join(vellumpixHome, "sessions");
      let sessionIds: string[] = [];
      try {
        sessionIds = await readdir(sessionsDir);
      } catch {
        sessionIds = [];
      }
      expect(sessionIds).toEqual([]);

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "persists followup lineage and reuses previous_response_id during --exec-session",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-followup-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--prompt", "Parent run", "--model", "gpt-5.1"],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [parentId] = await readdir(sessionsDir);
      expect(parentId).toBeTruthy();
      const parentMeta = JSON.parse(
        await readFile(path.join(sessionsDir, parentId, "meta.json"), "utf8"),
      );
      const parentResponseId = String(parentMeta.response?.responseId ?? "");
      expect(parentResponseId.startsWith("resp_")).toBe(true);

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Child run",
          "--model",
          "gpt-5.1",
          "--followup",
          parentId,
        ],
        { env },
      );

      const allSessions = await readdir(sessionsDir);
      expect(allSessions.length).toBe(2);
      const childId = allSessions.find((id) => id !== parentId);
      expect(childId).toBeTruthy();
      const childMeta = JSON.parse(
        await readFile(path.join(sessionsDir, childId as string, "meta.json"), "utf8"),
      );
      expect(childMeta.options?.previousResponseId).toBe(parentResponseId);
      expect(childMeta.options?.followupSessionId).toBe(parentId);

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--exec-session", childId as string],
        {
          env: {
            ...env,
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_TEST_REQUIRE_PREV: "1",
          },
        },
      );

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "waits for the parent lifecycle handoff before a detached worker starts",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-detached-gate-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--prompt", "Gated worker", "--model", "gpt-5.1"],
        { env },
      );
      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const metadataPath = path.join(sessionsDir, sessionId, "meta.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      await writeFile(
        metadataPath,
        JSON.stringify({ ...metadata, status: "pending", completedAt: undefined }, null, 2),
      );

      const child = spawn(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--exec-session", sessionId],
        {
          env: {
            ...env,
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_DETACHED_START_GATE: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(JSON.parse(await readFile(metadataPath, "utf8")).status).toBe("pending");

      child.stdin.end();
      await expect(waitForChildExit(child, INTEGRATION_TIMEOUT)).resolves.toEqual({
        code: 1,
        signal: null,
      });
      expect(JSON.parse(await readFile(metadataPath, "utf8")).status).toBe("pending");

      const readyChild = spawn(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--exec-session", sessionId],
        {
          env: {
            ...env,
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_DETACHED_START_GATE: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      await writeFile(
        metadataPath,
        JSON.stringify(
          {
            ...metadata,
            status: "pending",
            completedAt: undefined,
            lifecycle: {
              engine: "api",
              execution: "background",
              attached: false,
              detached: true,
              workerPid: readyChild.pid,
              reattachCommand: `vellumpix session ${sessionId}`,
            },
          },
          null,
          2,
        ),
      );
      readyChild.stdin.end("ready\n");
      await expect(waitForChildExit(readyChild, INTEGRATION_TIMEOUT)).resolves.toEqual({
        code: 0,
        signal: null,
      });
      expect(JSON.parse(await readFile(metadataPath, "utf8")).status).toBe("completed");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "persists model overrides for detached --exec-session runs",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-model-overrides-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };
      await writeFile(
        path.join(vellumpixHome, "config.json"),
        JSON.stringify({
          modelOverrides: {
            "gpt-5.5": { apiModel: "gateway-model", reasoning: { effort: "xhigh" } },
          },
        }),
      );

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--prompt", "Persist model override", "--model", "gpt-5.5"],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const metadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(metadata.options?.modelOverrides?.["gpt-5.5"]).toEqual({
        apiModel: "gateway-model",
        reasoning: { effort: "xhigh" },
      });

      await rm(path.join(vellumpixHome, "config.json"));
      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--exec-session", sessionId],
        {
          env: {
            ...env,
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_TEST_REQUIRE_MODEL: "gateway-model",
            // biome-ignore lint/style/useNamingConvention: env var name
            VELLUMPIX_TEST_REQUIRE_REASONING_EFFORT: "xhigh",
          },
        },
      );
      const rerunMetadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(rerunMetadata.status).toBe("completed");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "forwards and persists GPT-5.6 Pro reasoning mode",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-reasoning-mode-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_TEST_REQUIRE_REASONING_MODE: "pro",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_TEST_REQUIRE_REASONING_EFFORT: "max",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--engine",
          "api",
          "--model",
          "gpt-5.6-sol",
          "--reasoning-effort",
          "max",
          "--reasoning-mode",
          "pro",
          "--no-background",
          "--wait",
          "--prompt",
          "Verify GPT-5.6 Pro reasoning mode",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const metadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(metadata.options?.reasoningEffort).toBe("max");
      expect(metadata.options?.reasoningMode).toBe("pro");

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--exec-session", sessionId],
        { env },
      );
      const rerunMetadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(rerunMetadata.status).toBe("completed");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "accepts direct response ids in --followup and persists chain metadata",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-followup-resp-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };
      const directResponseId = "resp_direct_followup_12345";

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Child from direct response id",
          "--model",
          "gpt-5.1",
          "--followup",
          directResponseId,
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      expect(sessionId).toBeTruthy();
      const metadata = JSON.parse(
        await readFile(path.join(sessionsDir, sessionId, "meta.json"), "utf8"),
      );
      expect(metadata.options?.previousResponseId).toBe(directResponseId);
      expect(metadata.options?.followupSessionId).toBeUndefined();
      expect(metadata.options?.followupModel).toBeUndefined();

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects --followup for Gemini API runs",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-followup-gemini-unsupported-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        GEMINI_API_KEY: "gk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "Gemini followup",
            "--model",
            "gemini-3-pro",
            "--followup",
            "resp_parent_1234",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/only supported for OpenAI Responses API runs/i);
        expect(stderr).toMatch(/gemini-3-pro/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects --followup for Claude API runs",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-followup-claude-unsupported-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        ANTHROPIC_API_KEY: "ak-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "Claude followup",
            "--model",
            "claude-4.6-sonnet",
            "--followup",
            "resp_parent_1234",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/only supported for OpenAI Responses API runs/i);
        expect(stderr).toMatch(/claude-4.6-sonnet/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects --followup for custom --base-url providers",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-followup-baseurl-unsupported-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENROUTER_API_KEY: "or-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "OpenRouter followup",
            "--model",
            "gpt-5.1",
            "--base-url",
            "https://openrouter.ai/api/v1",
            "--followup",
            "resp_parent_1234",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/default OpenAI Responses API or Azure OpenAI Responses/i);
        expect(stderr).toMatch(/Custom --base-url providers are not supported/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "prints actionable guidance when --followup session id is missing",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-followup-missing-id-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Parent run for followup suggestions",
          "--model",
          "gpt-5.1",
          "--slug",
          "release-readiness-audit",
        ],
        { env },
      );

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "Child with typo followup id",
            "--model",
            "gpt-5.1",
            "--followup",
            "release-readiness-audti",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/No session found with ID release-readiness-audti/i);
        expect(stderr).toMatch(/Did you mean:\s+"release-readiness-audit"/i);
        expect(stderr).toMatch(/vellumpix status --hours 72 --limit 20/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "requires --followup-model when parent session has multiple model runs",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-followup-multi-error-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Parent multi followup",
          "--models",
          "gpt-5.1,gpt-5.2",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [parentId] = await readdir(sessionsDir);
      expect(parentId).toBeTruthy();

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "Child missing followup model",
            "--model",
            "gpt-5.1",
            "--followup",
            parentId,
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/multiple model runs/i);
        expect(stderr).toMatch(/--followup-model/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "uses --followup-model to continue from the selected parent model response",
    async () => {
      const vellumpixHome = await mkdtemp(
        path.join(os.tmpdir(), "vellumpix-followup-multi-select-"),
      );
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Parent multi followup select",
          "--models",
          "gpt-5.1,gpt-5.2",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [parentId] = await readdir(sessionsDir);
      expect(parentId).toBeTruthy();

      const parentMeta = JSON.parse(
        await readFile(path.join(sessionsDir, parentId, "meta.json"), "utf8"),
      );
      const selectedRun = (
        (parentMeta.models as
          | Array<{ model: string; response?: { responseId?: string } }>
          | undefined) ?? []
      ).find((run) => run.model === "gpt-5.2");
      const selectedResponseId = selectedRun?.response?.responseId;
      expect(selectedResponseId).toBeTruthy();
      expect(String(selectedResponseId).startsWith("resp_")).toBe(true);

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Child with followup model select",
          "--model",
          "gpt-5.1",
          "--followup",
          parentId,
          "--followup-model",
          "gpt-5.2",
        ],
        { env },
      );

      const allSessions = await readdir(sessionsDir);
      expect(allSessions.length).toBe(2);
      const childId = allSessions.find((id) => id !== parentId);
      expect(childId).toBeTruthy();
      const childMeta = JSON.parse(
        await readFile(path.join(sessionsDir, childId as string, "meta.json"), "utf8"),
      );
      expect(childMeta.options?.previousResponseId).toBe(selectedResponseId);
      expect(childMeta.options?.followupSessionId).toBe(parentId);
      expect(childMeta.options?.followupModel).toBe("gpt-5.2");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects mixing --model and --models regardless of source",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-multi-conflict-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "conflict",
            "--model",
            "gpt-5.1",
            "--models",
            "gpt-5.1-pro",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/--models cannot be combined with --model/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "runs gpt-5.1-codex via API-only path",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-codex-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: environment variable name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: environment variable name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: environment variable name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: environment variable name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--prompt", "Codex integration", "--model", "gpt-5.1-codex"],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const sessionIds = await readdir(sessionsDir);
      expect(sessionIds.length).toBe(1);
      const metadataPath = path.join(sessionsDir, sessionIds[0], "meta.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      expect(metadata.model).toBe("gpt-5.1-codex");
      expect(metadata.mode).toBe("api");
      expect(metadata.usage?.totalTokens).toBe(20);

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "rejects gpt-5.1-codex-max until OpenAI ships the API",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-codex-max-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: environment variable name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: environment variable name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: environment variable name
        VELLUMPIX_CLIENT_FACTORY: CLIENT_FACTORY,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_DISABLE_KEYTAR: "1",
      };

      try {
        await execFileAsync(
          process.execPath,
          [
            "--import",
            "tsx",
            CLI_ENTRY,
            "--prompt",
            "Codex Max integration",
            "--model",
            "gpt-5.1-codex-max",
          ],
          { env },
        );
        throw new Error("Expected vellumpix CLI to fail but it succeeded.");
      } catch (error) {
        const stderr =
          error && typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : "";
        expect(stderr).toMatch(/codex-max is not available yet/i);
      }

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "runs multi-model across OpenAI, Gemini, and Claude with custom factory",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-multi-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        GEMINI_API_KEY: "gk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        ANTHROPIC_API_KEY: "ak-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: path.join(
          process.cwd(),
          "tests",
          "fixtures",
          "mockPolyClient.cjs",
        ),
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Multi run test prompt long enough",
          "--models",
          "gpt-5.1,gemini-3-pro,claude-4.6-sonnet",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const sessionIds = await readdir(sessionsDir);
      expect(sessionIds.length).toBe(1);
      const sessionDir = path.join(sessionsDir, sessionIds[0]);
      const metadata = JSON.parse(await readFile(path.join(sessionDir, "meta.json"), "utf8"));
      const selectedModels = (metadata.models as Array<{ model: string }> | undefined)?.map(
        (m: { model: string }) => m.model,
      );
      expect(selectedModels).toEqual(
        expect.arrayContaining(["gpt-5.1", "gemini-3-pro", "claude-4.6-sonnet"]),
      );
      expect(metadata.status).toBe("completed");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "allows partial multi-model success and reports saved outputs before failures",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-multi-partial-"));
      const outputPath = path.join(vellumpixHome, "answer.md");
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        GEMINI_API_KEY: "gk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: path.join(
          process.cwd(),
          "tests",
          "fixtures",
          "mockPolyClient.cjs",
        ),
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_TEST_FAIL_MODEL: "gemini-3-pro",
      };

      const result = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Partial multi-model run prompt long enough",
          "--models",
          "gpt-5.1,gemini-3-pro",
          "--allow-partial",
          "--write-output",
          outputPath,
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const [sessionId] = await readdir(sessionsDir);
      const sessionDir = path.join(sessionsDir, sessionId);
      const metadata = JSON.parse(await readFile(path.join(sessionDir, "meta.json"), "utf8"));
      expect(metadata.status).toBe("partial");
      expect(metadata.options?.partialMode).toBe("ok");
      expect(await readFile(path.join(vellumpixHome, "answer.gpt-5.1.md"), "utf8")).toContain(
        "Echo(gpt-5.1)",
      );
      const manifest = JSON.parse(
        await readFile(path.join(vellumpixHome, "answer.vellumpix.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        version: 1,
        sessionId,
        status: "partial",
        outputBasePath: outputPath,
        models: [
          {
            model: "gpt-5.1",
            status: "completed",
            outputPath: path.join(vellumpixHome, "answer.gpt-5.1.md"),
            usage: { totalTokens: 20 },
          },
          {
            model: "gemini-3-pro",
            status: "error",
          },
        ],
      });
      expect(manifest.models[0].logPath).toContain("gpt-5.1.log");
      expect(manifest.models[1].logPath).toContain("gemini-3-pro.log");

      const savedIndex = result.stdout.indexOf("Saved outputs:");
      const logsIndex = result.stdout.indexOf("Run logs:");
      const failuresIndex = result.stdout.indexOf("Failures:");
      expect(result.stdout).toContain("Multi-model result: partial success, 1/2 succeeded");
      expect(savedIndex).toBeGreaterThanOrEqual(0);
      expect(logsIndex).toBeGreaterThan(savedIndex);
      expect(failuresIndex).toBeGreaterThan(logsIndex);
      expect(result.stdout).toContain("Output manifest:");
      expect(result.stdout).toContain("gemini-3-pro");

      await execFileAsync(
        process.execPath,
        ["--import", "tsx", CLI_ENTRY, "--exec-session", sessionId],
        {
          env,
        },
      );
      const rerunMetadata = JSON.parse(await readFile(path.join(sessionDir, "meta.json"), "utf8"));
      expect(rerunMetadata.status).toBe("partial");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "accepts shorthand multi-model list and normalizes to canonical IDs",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-multi-shorthand-"));
      const env = {
        ...process.env,
        // biome-ignore lint/style/useNamingConvention: env var name
        OPENAI_API_KEY: "sk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        GEMINI_API_KEY: "gk-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        ANTHROPIC_API_KEY: "ak-integration",
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_HOME_DIR: vellumpixHome,
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_CLIENT_FACTORY: path.join(
          process.cwd(),
          "tests",
          "fixtures",
          "mockPolyClient.cjs",
        ),
        // biome-ignore lint/style/useNamingConvention: env var name
        VELLUMPIX_NO_DETACH: "1",
      };

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--prompt",
          "Shorthand multi-model normalization prompt that is safely over twenty characters.",
          "--models",
          "gpt-5.1,gemini,sonnet",
        ],
        { env },
      );

      const sessionsDir = path.join(vellumpixHome, "sessions");
      const sessionIds = await readdir(sessionsDir);
      expect(sessionIds.length).toBe(1);
      const sessionDir = path.join(sessionsDir, sessionIds[0]);
      const metadata = JSON.parse(await readFile(path.join(sessionDir, "meta.json"), "utf8"));
      const selectedModels = (metadata.models as Array<{ model: string }> | undefined)?.map(
        (m: { model: string }) => m.model,
      );
      expect(selectedModels).toEqual(
        expect.arrayContaining(["gpt-5.1", "gemini-3-pro", "claude-4.6-sonnet"]),
      );
      expect(metadata.status).toBe("completed");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );

  test(
    "honors --max-file-size-bytes for root dry-runs ahead of env defaults",
    async () => {
      const vellumpixHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-max-file-"));
      const testFile = path.join(vellumpixHome, "large.txt");
      await writeFile(testFile, "x".repeat(64), "utf8");

      const env = {
        ...process.env,
        VELLUMPIX_HOME_DIR: vellumpixHome,
        VELLUMPIX_DISABLE_KEYTAR: "1",
        VELLUMPIX_MAX_FILE_SIZE_BYTES: "10",
      };

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "--dry-run",
          "summary",
          "--engine",
          "browser",
          "--prompt",
          "Integration dry run",
          "--file",
          testFile,
          "--max-file-size-bytes",
          "128",
        ],
        { env },
      );

      expect(stdout).toContain("[preview]");
      expect(stdout).toContain("includes 1 inline file");

      await rm(vellumpixHome, { recursive: true, force: true });
    },
    INTEGRATION_TIMEOUT,
  );
});
