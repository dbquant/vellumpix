import type { Command } from "commander";
import { sessionStore } from "../sessionStore.js";
import { summarizeThread } from "../threadSummary.js";
import { threadStore, type VellumPixThread } from "../threadStore.js";
import { attachSessionLineageToThread } from "../threadActions.js";

function formatThread(record: Awaited<ReturnType<typeof summarizeThread>>): string {
  const tags = record.tags.length > 0 ? ` [${record.tags.join(", ")}]` : "";
  const conversation = record.conversationId ? ` conversation=${record.conversationId}` : "";
  return `${record.status.padEnd(8)} ${record.id} — ${record.title}${tags} sessions=${record.sessionIds.length} images=${record.imageCount}${conversation}`;
}

async function printThread(record: VellumPixThread): Promise<void> {
  const summary = await summarizeThread(record, sessionStore);
  console.log(`Thread: ${summary.id}`);
  console.log(`Title: ${summary.title}`);
  console.log(`Status: ${summary.status}`);
  console.log(`Tags: ${summary.tags.join(", ") || "(none)"}`);
  console.log(`Sessions: ${summary.sessionIds.length}`);
  console.log(`Root session: ${summary.rootSessionId ?? "(none)"}`);
  console.log(`Head session: ${summary.headSessionId ?? "(none)"}`);
  console.log(`Head status: ${summary.headStatus ?? "(none)"}`);
  console.log(`Images: ${summary.imageCount}`);
  console.log(`Conversation id: ${summary.conversationId ?? "(not captured yet)"}`);
  console.log(`Conversation URL: ${summary.conversationUrl ?? "(not captured yet)"}`);
  if (summary.lastPromptPreview) console.log(`Last prompt: ${summary.lastPromptPreview}`);
  if (summary.sessionIds.length > 0) {
    console.log("Session history:");
    for (const sessionId of summary.sessionIds) console.log(`  - ${sessionId}`);
  }
}

export function registerThreadCommands(program: Command): void {
  const thread = program
    .command("thread")
    .description("Manage durable task lines and ChatGPT conversation mappings.");

  thread
    .command("list")
    .description("List saved task threads.")
    .option("--all", "Include archived threads.", false)
    .option("--query <text>", "Filter by id, title, or tag.")
    .action(async (options: { all?: boolean; query?: string }) => {
      const records = await threadStore.listThreads({
        includeArchived: options.all,
        query: options.query,
      });
      if (records.length === 0) {
        console.log("No saved threads.");
        return;
      }
      for (const record of records)
        console.log(formatThread(await summarizeThread(record, sessionStore)));
    });

  thread
    .command("create <id>")
    .description("Create an empty task thread. Use --thread <id> on a run to attach or resume it.")
    .requiredOption("--title <title>", "Human-friendly thread title.")
    .option("--tag <tag...>", "Searchable tags.")
    .action(async (id: string, options: { title: string; tag?: string[] }) => {
      const record = await threadStore.createThread({
        id,
        title: options.title,
        tags: options.tag,
      });
      await printThread(record);
    });

  thread
    .command("show <id>")
    .description("Show one thread, its conversation mapping, and session history.")
    .action(async (id: string) => {
      const record = await threadStore.readThread(id);
      if (!record) throw new Error(`Thread "${id}" not found.`);
      await printThread(record);
    });

  thread
    .command("attach <id> <session>")
    .description("Adopt an existing session and its parent lineage into a task thread.")
    .action(async (id: string, session: string) => {
      await printThread(await attachSessionLineageToThread(id, session));
    });

  thread
    .command("archive <id>")
    .description(
      "Hide a thread from the default list without deleting sessions or ChatGPT history.",
    )
    .action(async (id: string) =>
      printThread(await threadStore.updateThread(id, { status: "archived" })),
    );

  thread
    .command("activate <id>")
    .description("Return an archived thread to the active list.")
    .action(async (id: string) =>
      printThread(await threadStore.updateThread(id, { status: "active" })),
    );
}
