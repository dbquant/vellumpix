import type {
  BrowserSessionConfig,
  BrowserRuntimeMetadata,
  SessionMetadata,
} from "../sessionManager.js";
import { sessionStore } from "../sessionStore.js";
import { threadStore, type VellumPixThread } from "../threadStore.js";
import { isThreadRunLockActive } from "../threadRunLock.js";
import { closeTab, listRemoteChromeTargets, type RemoteTargetInfo } from "./chromeLifecycle.js";
import { DEFAULT_BROWSER_CONFIG } from "./config.js";
import { hasActiveBrowserTargetLease } from "./tabLeaseRegistry.js";
import { extractConversationIdFromUrl } from "./reattachHelpers.js";
import type { BrowserLogger } from "./types.js";

interface TargetAssociation {
  threadId: string;
  conversationId?: string;
  lastUsedMs: number;
  archived: boolean;
}

export interface ThreadTargetCacheCandidate extends TargetAssociation {
  targetId: string;
  url: string;
  protected: boolean;
  current: boolean;
}

export interface ThreadTargetCacheDecision {
  targetId: string;
  reason: "duplicate" | "archived" | "idle" | "capacity";
}

export function planThreadTargetCachePrune(options: {
  candidates: readonly ThreadTargetCacheCandidate[];
  maxRetainedTabs: number;
  idleTimeoutMs: number;
  nowMs: number;
}): ThreadTargetCacheDecision[] {
  const decisions = new Map<string, ThreadTargetCacheDecision>();
  const close = (
    candidate: ThreadTargetCacheCandidate,
    reason: ThreadTargetCacheDecision["reason"],
  ) => {
    if (!candidate.protected && !candidate.current && !decisions.has(candidate.targetId)) {
      decisions.set(candidate.targetId, { targetId: candidate.targetId, reason });
    }
  };

  const byConversation = new Map<string, ThreadTargetCacheCandidate[]>();
  for (const candidate of options.candidates) {
    const key = candidate.conversationId ?? `target:${candidate.targetId}`;
    const group = byConversation.get(key) ?? [];
    group.push(candidate);
    byConversation.set(key, group);
  }
  for (const group of byConversation.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort(compareCandidates)[0];
    for (const candidate of group) {
      if (candidate.targetId !== keep?.targetId) close(candidate, "duplicate");
    }
  }

  for (const candidate of options.candidates) {
    if (decisions.has(candidate.targetId)) continue;
    if (candidate.archived) {
      close(candidate, "archived");
      continue;
    }
    if (
      options.idleTimeoutMs > 0 &&
      options.nowMs - candidate.lastUsedMs >= options.idleTimeoutMs
    ) {
      close(candidate, "idle");
    }
  }

  const retained = options.candidates
    .filter((candidate) => !decisions.has(candidate.targetId))
    .sort(compareCandidates);
  let retainedCount = retained.length;
  for (let index = retained.length - 1; index >= 0; index -= 1) {
    const candidate = retained[index];
    if (!candidate) continue;
    if (retainedCount <= options.maxRetainedTabs) break;
    if (candidate.protected || candidate.current) continue;
    close(candidate, "capacity");
    retainedCount -= 1;
  }
  return [...decisions.values()];
}

function compareCandidates(a: ThreadTargetCacheCandidate, b: ThreadTargetCacheCandidate): number {
  const aPriority = Number(a.current) * 2 + Number(a.protected);
  const bPriority = Number(b.current) * 2 + Number(b.protected);
  return (
    bPriority - aPriority || b.lastUsedMs - a.lastUsedMs || a.targetId.localeCompare(b.targetId)
  );
}

export async function pruneThreadBrowserTargetCache(options: {
  threadId: string;
  runtime: BrowserRuntimeMetadata;
  config: BrowserSessionConfig;
  logger: BrowserLogger | ((message: string) => void);
  nowMs?: number;
  deps?: {
    listThreads?: () => Promise<VellumPixThread[]>;
    readSession?: (sessionId: string) => Promise<SessionMetadata | null>;
    listTargets?: (endpoint: { host: string; port: number }) => Promise<RemoteTargetInfo[]>;
    closeTarget?: (
      port: number,
      targetId: string,
      logger: BrowserLogger,
      host: string,
    ) => Promise<boolean>;
    hasActiveLease?: (
      profileDir: string,
      target: { host: string; port: number; targetId: string },
    ) => Promise<boolean>;
    isThreadLocked?: (threadId: string) => Promise<boolean>;
  };
}): Promise<{ closed: ThreadTargetCacheDecision[]; retained: number }> {
  const port = options.runtime.chromePort;
  const currentTargetId = options.runtime.chromeTargetId;
  const profileDir = options.runtime.userDataDir ?? options.config.manualLoginProfileDir;
  if (!port || !currentTargetId || !profileDir) return { closed: [], retained: 0 };
  const host = options.runtime.chromeHost ?? "127.0.0.1";
  const deps = options.deps ?? {};
  const threads = await (
    deps.listThreads ?? (() => threadStore.listThreads({ includeArchived: true }))
  )();
  const readSession =
    deps.readSession ?? ((sessionId: string) => sessionStore.readSession(sessionId));
  const associationsByTarget = new Map<string, TargetAssociation>();
  const associationsByConversation = new Map<string, TargetAssociation>();

  for (const thread of threads) {
    for (const sessionId of thread.sessionIds) {
      const session = await readSession(sessionId);
      const runtime = session?.browser?.runtime;
      if (!session || !runtime) continue;
      const lastUsedMs = Math.max(
        parseTimestamp(thread.updatedAt),
        parseTimestamp(session.completedAt ?? session.createdAt),
      );
      const association: TargetAssociation = {
        threadId: thread.id,
        conversationId: runtime.conversationId,
        lastUsedMs,
        archived: thread.status === "archived",
      };
      if (runtime.chromeTargetId) {
        setNewestAssociation(associationsByTarget, runtime.chromeTargetId, association);
      }
      if (runtime.conversationId) {
        setNewestAssociation(associationsByConversation, runtime.conversationId, association);
      }
    }
  }

  const listTargets = deps.listTargets ?? ((endpoint) => listRemoteChromeTargets(endpoint));
  const liveTargets = await listTargets({ host, port });
  const lockCache = new Map<string, boolean>();
  const isLocked = deps.isThreadLocked ?? isThreadRunLockActive;
  const hasLease = deps.hasActiveLease ?? hasActiveBrowserTargetLease;
  const candidates: ThreadTargetCacheCandidate[] = [];
  for (const target of liveTargets) {
    const targetId = target.targetId ?? target.id;
    if (!targetId || target.type !== "page" || !target.url) continue;
    const conversationId = extractConversationIdFromUrl(target.url);
    const association =
      associationsByTarget.get(targetId) ??
      (conversationId ? associationsByConversation.get(conversationId) : undefined);
    if (!association) continue;
    let threadLocked =
      association.threadId === options.threadId ? false : lockCache.get(association.threadId);
    if (threadLocked === undefined) {
      threadLocked = await isLocked(association.threadId);
      lockCache.set(association.threadId, threadLocked);
    }
    const activeLease = await hasLease(profileDir, { host, port, targetId });
    candidates.push({
      ...association,
      conversationId: conversationId ?? association.conversationId,
      targetId,
      url: target.url,
      current: targetId === currentTargetId,
      protected: activeLease || threadLocked,
    });
  }

  const maxRetainedTabs = normalizePositiveInteger(
    options.config.maxRetainedThreadTabs,
    DEFAULT_BROWSER_CONFIG.maxRetainedThreadTabs,
  );
  const idleTimeoutMs = normalizeNonNegativeNumber(
    options.config.threadTabIdleTimeoutMs,
    DEFAULT_BROWSER_CONFIG.threadTabIdleTimeoutMs,
  );
  const decisions = planThreadTargetCachePrune({
    candidates,
    maxRetainedTabs,
    idleTimeoutMs,
    nowMs: options.nowMs ?? Date.now(),
  });
  const closeTarget = deps.closeTarget ?? closeTab;
  const closed: ThreadTargetCacheDecision[] = [];
  for (const decision of decisions) {
    if (await closeTarget(port, decision.targetId, options.logger as BrowserLogger, host)) {
      closed.push(decision);
    }
  }
  if (closed.length > 0) {
    const reasons = closed.map((item) => `${item.targetId.slice(0, 8)}:${item.reason}`).join(", ");
    options.logger(
      `[browser] Thread tab cache closed ${closed.length} target${closed.length === 1 ? "" : "s"} (${reasons}); retaining up to ${maxRetainedTabs}, idle timeout ${Math.round(idleTimeoutMs / 60_000)}m.`,
    );
  }
  return { closed, retained: candidates.length - closed.length };
}

function setNewestAssociation(
  map: Map<string, TargetAssociation>,
  key: string,
  association: TargetAssociation,
): void {
  const existing = map.get(key);
  if (!existing || association.lastUsedMs >= existing.lastUsedMs) map.set(key, association);
}

function parseTimestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
