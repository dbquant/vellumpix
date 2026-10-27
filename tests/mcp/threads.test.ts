import { afterEach, beforeEach, describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { setVellumPixHomeDirOverrideForTest } from "../../src/vellumpixHome.js";
import { registerThreadsTool } from "../../src/mcp/tools/threads.js";

describe("threads MCP tool", () => {
  let tmpHome: string;
  let handler: (input: unknown) => Promise<unknown>;

  beforeEach(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-mcp-threads-"));
    setVellumPixHomeDirOverrideForTest(tmpHome);
    registerThreadsTool({
      registerTool: (
        _name: string,
        _definition: unknown,
        fn: (input: unknown) => Promise<unknown>,
      ) => {
        handler = fn;
      },
    } as unknown as Parameters<typeof registerThreadsTool>[0]);
  });

  afterEach(async () => {
    setVellumPixHomeDirOverrideForTest(null);
    await rm(tmpHome, { recursive: true, force: true });
  });

  test("creates, lists, archives, and reactivates task threads", async () => {
    const created = (await handler({
      action: "create",
      id: "campaign-key-visual",
      title: "Campaign key visual",
      tags: ["image"],
    })) as { structuredContent: { threads: Array<{ id: string; status: string }> } };
    expect(created.structuredContent.threads[0]).toMatchObject({
      id: "campaign-key-visual",
      status: "active",
    });

    const archived = (await handler({
      action: "archive",
      id: "campaign-key-visual",
    })) as { structuredContent: { threads: Array<{ status: string }> } };
    expect(archived.structuredContent.threads[0]?.status).toBe("archived");

    const hidden = (await handler({ action: "list" })) as {
      structuredContent: { threads: unknown[] };
    };
    expect(hidden.structuredContent.threads).toHaveLength(0);

    const active = (await handler({
      action: "activate",
      id: "campaign-key-visual",
    })) as { structuredContent: { threads: Array<{ status: string }> } };
    expect(active.structuredContent.threads[0]?.status).toBe("active");
  });
});
