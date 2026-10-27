import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isProcessAlive, readProcessStartTimeMs } from "./browser/profileState.js";
import { getThreadsDir, normalizeThreadId } from "./threadStore.js";

const OWNER_FILE = "owner.json";
const START_TIME_TOLERANCE_MS = 2_000;

interface ThreadRunLockOwner {
  id: string;
  threadId: string;
  sessionId: string;
  pid: number;
  processStartedAtMs?: number;
  createdAt: string;
}

export interface ThreadRunLock {
  threadId: string;
  sessionId: string;
  release(): Promise<void>;
}

export function getThreadRunLockDir(threadId: string): string {
  return path.join(getThreadsDir(), normalizeThreadId(threadId), "run.lock");
}

async function readOwner(lockDir: string): Promise<ThreadRunLockOwner | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(lockDir, OWNER_FILE), "utf8"),
    ) as Partial<ThreadRunLockOwner>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.threadId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.pid !== "number" ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return parsed as ThreadRunLockOwner;
  } catch {
    return null;
  }
}

async function ownerIsAlive(owner: ThreadRunLockOwner): Promise<boolean> {
  if (!isProcessAlive(owner.pid)) return false;
  if (owner.processStartedAtMs === undefined) return true;
  const actualStartedAtMs = await readProcessStartTimeMs(owner.pid);
  return (
    actualStartedAtMs === null ||
    Math.abs(actualStartedAtMs - owner.processStartedAtMs) <= START_TIME_TOLERANCE_MS
  );
}

async function retireStaleLock(lockDir: string): Promise<void> {
  const retired = `${lockDir}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fs.rename(lockDir, retired);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await fs.rm(retired, { recursive: true, force: true });
}

export async function acquireThreadRunLock(
  threadId: string,
  sessionId: string,
): Promise<ThreadRunLock> {
  const normalizedThreadId = normalizeThreadId(threadId);
  const lockDir = getThreadRunLockDir(normalizedThreadId);
  await fs.mkdir(path.dirname(lockDir), { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.mkdir(lockDir);
      const owner: ThreadRunLockOwner = {
        id: randomUUID(),
        threadId: normalizedThreadId,
        sessionId,
        pid: process.pid,
        ...(await readProcessStartTimeMs(process.pid).then((value) =>
          value === null ? {} : { processStartedAtMs: value },
        )),
        createdAt: new Date().toISOString(),
      };
      try {
        await fs.writeFile(path.join(lockDir, OWNER_FILE), `${JSON.stringify(owner, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }

      let released = false;
      return {
        threadId: normalizedThreadId,
        sessionId,
        release: async () => {
          if (released) return;
          const current = await readOwner(lockDir);
          if (current?.id !== owner.id) {
            throw new Error(
              `Thread "${normalizedThreadId}" run lock changed owners before release; preserving it.`,
            );
          }
          await fs.rm(lockDir, { recursive: true, force: true });
          released = true;
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner = await readOwner(lockDir);
      if (!owner && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        owner = await readOwner(lockDir);
      }
      if (!owner) {
        throw new Error(
          `Thread "${normalizedThreadId}" run lock has no valid owner record; preserving it to avoid concurrent browser control.`,
        );
      }
      if (owner && (await ownerIsAlive(owner))) {
        throw new Error(
          `Thread "${normalizedThreadId}" is already running in session "${owner.sessionId}" (PID ${owner.pid}). Wait for it to finish before starting another run.`,
        );
      }
      await retireStaleLock(lockDir);
    }
  }
  throw new Error(`Unable to acquire run lock for Thread "${normalizedThreadId}".`);
}
