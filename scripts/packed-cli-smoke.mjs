import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const tmpRoot = mkdtempSync(join(tmpdir(), "vellumpix-packed-cli-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function runPnpm(args, options = {}) {
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry) {
    throw new Error("npm_execpath is unavailable; run this smoke through `pnpm test:packed-cli`");
  }
  return run(process.execPath, [pnpmEntry, ...args], options);
}

try {
  runPnpm(["pack", "--pack-destination", tmpRoot]);
  const tarball = readdirSync(tmpRoot).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("pnpm pack did not produce a .tgz file");
  }

  const installDir = join(tmpRoot, "install");
  mkdirSync(installDir);
  writeFileSync(join(installDir, "package.json"), '{"private":true}\n');
  runPnpm(["add", "--ignore-scripts", join(tmpRoot, tarball)], {
    cwd: installDir,
  });
  const cliPath = join(
    installDir,
    "node_modules",
    "@dbquant",
    "vellumpix",
    "dist",
    "bin",
    "vellumpix-cli.js",
  );
  const help = run(process.execPath, [cliPath, "--help", "--verbose"], { cwd: installDir });

  for (const expected of [
    "--no-azure",
    "--provider <provider>",
    "--http-timeout",
    "--allow-partial",
    "--preflight",
    "docs",
  ]) {
    if (!help.includes(expected)) {
      throw new Error(`packed CLI help is missing ${expected}`);
    }
  }
  console.log("Packed CLI help smoke: ok");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
