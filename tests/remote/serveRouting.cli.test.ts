import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { expect, test } from "vitest";

test("built service honors host Chrome routing without launching a local browser", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.resolve("scripts/serve-attach-proof.mjs")],
    { timeout: 220_000 },
  );
  for (const mode of ["flags", "config", "environment", "classic"])
    expect(stdout).toContain(`PASS ${mode}:`);
}, 225_000);
