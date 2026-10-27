import type { SessionMetadata } from "./sessionManager.js";
import type { SessionStore } from "./sessionStore.js";
import type { VellumPixThread } from "./threadStore.js";
import { resolveBrowserResumeConversationUrl } from "./cli/followup.js";

export interface ThreadSummary extends VellumPixThread {
  headStatus?: string;
  lastPromptPreview?: string;
  conversationId?: string;
  conversationUrl?: string;
  imageCount: number;
}

export async function summarizeThread(
  thread: VellumPixThread,
  sessions: Pick<SessionStore, "readSession">,
): Promise<ThreadSummary> {
  let head: SessionMetadata | null = null;
  let conversation: SessionMetadata | null = null;
  let imageCount = 0;
  for (let index = thread.sessionIds.length - 1; index >= 0; index -= 1) {
    const sessionId = thread.sessionIds[index];
    if (!sessionId) continue;
    const metadata = await sessions.readSession(sessionId);
    if (!metadata) continue;
    head ??= metadata;
    imageCount += metadata.artifacts?.filter((artifact) => artifact.kind === "image").length ?? 0;
    if (!conversation && resolveBrowserResumeConversationUrl(metadata)) {
      conversation = metadata;
    }
  }
  return {
    ...thread,
    headStatus: head?.status,
    lastPromptPreview: head?.promptPreview,
    conversationId: conversation?.browser?.runtime?.conversationId,
    conversationUrl: conversation
      ? (resolveBrowserResumeConversationUrl(conversation) ?? undefined)
      : undefined,
    imageCount,
  };
}

export async function resolveThreadResumeSessionId(
  thread: VellumPixThread,
  sessions: Pick<SessionStore, "readSession">,
): Promise<string | undefined> {
  for (let index = thread.sessionIds.length - 1; index >= 0; index -= 1) {
    const sessionId = thread.sessionIds[index];
    if (!sessionId) continue;
    const metadata = await sessions.readSession(sessionId);
    if (metadata && resolveBrowserResumeConversationUrl(metadata)) return metadata.id;
  }
  return thread.headSessionId;
}
