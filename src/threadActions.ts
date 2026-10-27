import { sessionStore } from "./sessionStore.js";
import { threadStore, type VellumPixThread } from "./threadStore.js";

export async function attachSessionLineageToThread(
  threadId: string,
  sessionId: string,
): Promise<VellumPixThread> {
  const targetThread = await threadStore.readThread(threadId);
  if (!targetThread) throw new Error(`Thread "${threadId}" not found.`);

  const lineage = [];
  const visited = new Set<string>();
  let currentId: string | undefined = sessionId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const metadata = await sessionStore.readSession(currentId);
    if (!metadata) {
      if (currentId === sessionId) throw new Error(`Session "${sessionId}" not found.`);
      break;
    }
    if (metadata.options.threadId && metadata.options.threadId !== targetThread.id) {
      throw new Error(
        `Session "${metadata.id}" already belongs to thread "${metadata.options.threadId}".`,
      );
    }
    lineage.unshift(metadata);
    currentId = metadata.options.followupSessionId;
  }

  if (
    targetThread.sessionIds.length > 0 &&
    !lineage.some((metadata) => targetThread.sessionIds.includes(metadata.id))
  ) {
    throw new Error(
      `Thread "${targetThread.id}" already has history. Refusing to attach an unrelated session lineage.`,
    );
  }

  let updated = targetThread;
  for (const metadata of lineage) {
    if (metadata.options.threadId !== targetThread.id) {
      await sessionStore.updateSession(metadata.id, {
        options: { ...metadata.options, threadId: targetThread.id },
      });
    }
    updated = await threadStore.attachSession(targetThread.id, metadata.id);
  }
  return updated;
}
