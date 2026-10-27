import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { sessionStore } from "../../sessionStore.js";
import { summarizeThread } from "../../threadSummary.js";
import { threadStore } from "../../threadStore.js";
import { attachSessionLineageToThread } from "../../threadActions.js";

const threadsInputShape = {
  action: z.enum(["list", "get", "create", "attach", "archive", "activate"]).default("list"),
  id: z.string().optional().describe("Stable thread id."),
  title: z.string().optional().describe("Human-friendly title; required when creating."),
  tags: z.array(z.string()).optional().describe("Searchable tags used when creating."),
  query: z.string().optional().describe("List filter across id, title, and tags."),
  includeArchived: z.boolean().optional().describe("Include archived threads when listing."),
  sessionId: z.string().optional().describe("Historical session to adopt for action=attach."),
};

const threadSummaryShape = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  rootSessionId: z.string().optional(),
  headSessionId: z.string().optional(),
  sessionIds: z.array(z.string()),
  headStatus: z.string().optional(),
  lastPromptPreview: z.string().optional(),
  conversationId: z.string().optional(),
  conversationUrl: z.string().optional(),
  imageCount: z.number(),
});

export function registerThreadsTool(server: McpServer): void {
  server.registerTool(
    "threads",
    {
      title: "Manage VellumPix task threads",
      description:
        "Create, list, inspect, archive, or reactivate durable task lines. A thread maps an evolving task to its VellumPix sessions, ChatGPT conversation, and generated images. Pass its id to consult.threadId to start or resume work.",
      inputSchema: z.object(threadsInputShape),
      outputSchema: z.object({ threads: z.array(threadSummaryShape) }),
    },
    async (input: unknown) => {
      const parsed = z.object(threadsInputShape).parse(input);
      let records;
      if (parsed.action === "list") {
        records = await threadStore.listThreads({
          includeArchived: parsed.includeArchived,
          query: parsed.query,
        });
      } else if (parsed.action === "create") {
        if (!parsed.id || !parsed.title) {
          throw new Error("threads.create requires both id and title.");
        }
        records = [
          await threadStore.createThread({ id: parsed.id, title: parsed.title, tags: parsed.tags }),
        ];
      } else {
        if (!parsed.id) throw new Error(`threads.${parsed.action} requires id.`);
        const current = await threadStore.readThread(parsed.id);
        if (!current) throw new Error(`Thread "${parsed.id}" not found.`);
        if (parsed.action === "attach") {
          if (!parsed.sessionId) throw new Error("threads.attach requires sessionId.");
          records = [await attachSessionLineageToThread(parsed.id, parsed.sessionId)];
        } else if (parsed.action === "archive") {
          records = [await threadStore.updateThread(parsed.id, { status: "archived" })];
        } else if (parsed.action === "activate") {
          records = [await threadStore.updateThread(parsed.id, { status: "active" })];
        } else {
          records = [current];
        }
      }
      const summaries = await Promise.all(
        records.map((record) => summarizeThread(record, sessionStore)),
      );
      const text = summaries
        .map(
          (record) =>
            `${record.id} | ${record.status} | sessions=${record.sessionIds.length} | images=${record.imageCount} | ${record.title}`,
        )
        .join("\n");
      return {
        content: [{ type: "text" as const, text: text || "No saved threads." }],
        structuredContent: { threads: summaries },
      };
    },
  );
}
