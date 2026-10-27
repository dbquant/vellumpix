import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { setVellumPixHomeDirOverrideForTest } from "../src/vellumpixHome.js";
import { acquireThreadRunLock, getThreadRunLockDir } from "../src/threadRunLock.js";

let tempHome: string | undefined;

afterEach(async () => {
  setVellumPixHomeDirOverrideForTest(null);
  if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
  tempHome = undefined;
});

async function useTempHome(): Promise<void> {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "vellumpix-thread-lock-"));
  setVellumPixHomeDirOverrideForTest(tempHome);
}

describe("Thread run lock", () => {
  test("rejects a concurrent run and permits the next run after release", async () => {
    await useTempHome();
    const first = await acquireThreadRunLock("visual-series", "session-a");

    await expect(acquireThreadRunLock("visual-series", "session-b")).rejects.toThrow(
      /already running in session "session-a"/,
    );

    await first.release();
    const second = await acquireThreadRunLock("visual-series", "session-b");
    await second.release();
  });

  test("recovers a stale lock whose owner process is gone", async () => {
    await useTempHome();
    const lockDir = getThreadRunLockDir("stale-thread");
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({
        id: "stale-owner",
        threadId: "stale-thread",
        sessionId: "dead-session",
        pid: 2_147_483_000,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );

    const recovered = await acquireThreadRunLock("stale-thread", "new-session");
    await recovered.release();
    await expect(fs.stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves an invalid owner record instead of risking split-brain control", async () => {
    await useTempHome();
    const lockDir = getThreadRunLockDir("invalid-owner");
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), "{}\n", "utf8");

    await expect(acquireThreadRunLock("invalid-owner", "new-session")).rejects.toThrow(
      /no valid owner record; preserving it/,
    );
    await expect(fs.stat(lockDir)).resolves.toBeDefined();
  });
});
