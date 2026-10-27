import { describe, expect, test, vi } from "vitest";
import type { SessionMetadata } from "../../src/sessionManager.js";
import type { VellumPixThread } from "../../src/threadStore.js";
import {
  planThreadTargetCachePrune,
  pruneThreadBrowserTargetCache,
  type ThreadTargetCacheCandidate,
} from "../../src/browser/threadTargetCache.js";

function candidate(
  targetId: string,
  options: Partial<ThreadTargetCacheCandidate> = {},
): ThreadTargetCacheCandidate {
  return {
    targetId,
    url: `https://chatgpt.com/c/${options.conversationId ?? targetId}`,
    conversationId: options.conversationId ?? targetId,
    threadId: options.threadId ?? targetId,
    lastUsedMs: options.lastUsedMs ?? 1_000,
    archived: options.archived ?? false,
    protected: options.protected ?? false,
    current: options.current ?? false,
  };
}

describe("Thread browser target cache", () => {
  test("deduplicates a conversation while keeping the current target", () => {
    const decisions = planThreadTargetCachePrune({
      candidates: [
        candidate("old", { conversationId: "same", lastUsedMs: 10 }),
        candidate("current", { conversationId: "same", lastUsedMs: 20, current: true }),
      ],
      maxRetainedTabs: 3,
      idleTimeoutMs: 0,
      nowMs: 100,
    });
    expect(decisions).toEqual([{ targetId: "old", reason: "duplicate" }]);
  });

  test("expires idle and archived targets without touching protected work", () => {
    const decisions = planThreadTargetCachePrune({
      candidates: [
        candidate("idle", { lastUsedMs: 1 }),
        candidate("archived", { lastUsedMs: 99, archived: true }),
        candidate("active", { lastUsedMs: 1, protected: true }),
      ],
      maxRetainedTabs: 3,
      idleTimeoutMs: 50,
      nowMs: 100,
    });
    expect(decisions).toEqual([
      { targetId: "idle", reason: "idle" },
      { targetId: "archived", reason: "archived" },
    ]);
  });

  test("evicts least-recently-used targets above capacity", () => {
    const decisions = planThreadTargetCachePrune({
      candidates: [
        candidate("newest", { lastUsedMs: 30 }),
        candidate("middle", { lastUsedMs: 20 }),
        candidate("oldest", { lastUsedMs: 10 }),
        candidate("locked", { lastUsedMs: 1, protected: true }),
      ],
      maxRetainedTabs: 3,
      idleTimeoutMs: 0,
      nowMs: 100,
    });
    expect(decisions).toEqual([{ targetId: "oldest", reason: "capacity" }]);
  });

  test("closes persisted duplicate targets but ignores unrelated browser tabs", async () => {
    const currentThread: VellumPixThread = {
      id: "current-thread",
      title: "Current",
      tags: [],
      status: "active",
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:10:00.000Z",
      rootSessionId: "old-session",
      headSessionId: "new-session",
      sessionIds: ["old-session", "new-session"],
    };
    const sessions = new Map<string, SessionMetadata>([
      [
        "old-session",
        makeSession("old-session", "old-target", "conversation-1", "2026-10-27T00:01:00.000Z"),
      ],
      [
        "new-session",
        makeSession("new-session", "new-target", "conversation-1", "2026-10-27T00:10:00.000Z"),
      ],
    ]);
    const closeTarget = vi.fn(async () => true);
    const logger = (_message: string): void => {};
    const result = await pruneThreadBrowserTargetCache({
      threadId: "current-thread",
      runtime: {
        chromeHost: "127.0.0.1",
        chromePort: 5165,
        chromeTargetId: "new-target",
        userDataDir: "C:/profile",
      },
      config: { maxRetainedThreadTabs: 3, threadTabIdleTimeoutMs: 0 },
      logger,
      nowMs: Date.parse("2026-10-27T00:11:00.000Z"),
      deps: {
        listThreads: async () => [currentThread],
        readSession: async (sessionId) => sessions.get(sessionId) ?? null,
        listTargets: async () => [
          {
            id: "old-target",
            type: "page",
            url: "https://chatgpt.com/c/conversation-1",
          },
          {
            targetId: "new-target",
            type: "page",
            url: "https://chatgpt.com/c/conversation-1",
          },
          { targetId: "unrelated", type: "page", url: "https://example.com/" },
        ],
        closeTarget,
        hasActiveLease: async () => false,
        isThreadLocked: async () => true,
      },
    });
    expect(result.closed).toEqual([{ targetId: "old-target", reason: "duplicate" }]);
    expect(closeTarget).toHaveBeenCalledExactlyOnceWith(5165, "old-target", logger, "127.0.0.1");
  });
});

function makeSession(
  id: string,
  targetId: string,
  conversationId: string,
  completedAt: string,
): SessionMetadata {
  return {
    id,
    createdAt: completedAt,
    completedAt,
    status: "completed",
    options: { threadId: "current-thread" },
    browser: { runtime: { chromeTargetId: targetId, conversationId } },
  };
}
