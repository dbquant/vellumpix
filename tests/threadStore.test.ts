import { afterEach, beforeEach, describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { setVellumPixHomeDirOverrideForTest } from "../src/vellumpixHome.js";
import { sessionStore } from "../src/sessionStore.js";
import { summarizeThread } from "../src/threadSummary.js";
import { threadStore } from "../src/threadStore.js";
import { attachSessionLineageToThread } from "../src/threadActions.js";

describe("threadStore", () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), "vellumpix-threads-"));
    setVellumPixHomeDirOverrideForTest(tmpHome);
  });

  afterEach(async () => {
    setVellumPixHomeDirOverrideForTest(null);
    await rm(tmpHome, { recursive: true, force: true });
  });

  test("groups sessions and resolves the durable ChatGPT mapping", async () => {
    const thread = await threadStore.createThread({
      id: "brand-winter-canal",
      title: "品牌冬季主视觉",
      tags: ["品牌 A", "生图", "生图"],
    });
    const first = await sessionStore.createSession(
      {
        prompt: "创建第一版",
        model: "gpt-5.5-pro",
        mode: "browser",
        threadId: thread.id,
        browserConfig: { url: "https://chatgpt.com/", manualLogin: true },
      },
      process.cwd(),
    );
    await sessionStore.updateSession(first.id, {
      status: "completed",
      browser: {
        config: first.browser?.config,
        runtime: {
          conversationId: "abc-123",
          tabUrl: "https://chatgpt.com/c/abc-123",
        },
      },
      artifacts: [{ kind: "image", path: "first.png" }],
    });
    const second = await sessionStore.createSession(
      {
        prompt: "改成雨夜",
        model: "gpt-5.5-pro",
        mode: "browser",
        threadId: thread.id,
        followupSessionId: first.id,
        browserConfig: {
          url: "https://chatgpt.com/",
          resumeConversationUrl: "https://chatgpt.com/c/abc-123",
        },
      },
      process.cwd(),
    );

    const stored = await threadStore.readThread(thread.id);
    expect(stored).toMatchObject({
      rootSessionId: first.id,
      headSessionId: second.id,
      sessionIds: [first.id, second.id],
      tags: ["品牌 A", "生图"],
    });
    const summary = await summarizeThread(stored!, sessionStore);
    expect(summary).toMatchObject({
      conversationId: "abc-123",
      conversationUrl: "https://chatgpt.com/c/abc-123",
      imageCount: 1,
    });
  });

  test("lists by tag and hides archived threads by default", async () => {
    await threadStore.createThread({ id: "storyboard-main", title: "分镜主线", tags: ["分镜"] });
    await threadStore.createThread({ id: "poster-main", title: "海报主线", tags: ["海报"] });
    await threadStore.updateThread("poster-main", { status: "archived" });

    expect((await threadStore.listThreads({ query: "分镜" })).map((item) => item.id)).toEqual([
      "storyboard-main",
    ]);
    expect((await threadStore.listThreads()).map((item) => item.id)).toEqual(["storyboard-main"]);
    expect(await threadStore.listThreads({ includeArchived: true })).toHaveLength(2);
  });

  test("adopts an existing parent lineage and records thread ownership", async () => {
    const parent = await sessionStore.createSession(
      { prompt: "first", model: "gpt-5.5-pro", mode: "browser" },
      process.cwd(),
    );
    const child = await sessionStore.createSession(
      {
        prompt: "second",
        model: "gpt-5.5-pro",
        mode: "browser",
        followupSessionId: parent.id,
      },
      process.cwd(),
    );
    const thread = await threadStore.createThread({
      id: "imported-history",
      title: "Imported history",
    });

    const attached = await attachSessionLineageToThread(thread.id, child.id);
    expect(attached.sessionIds).toEqual([parent.id, child.id]);
    expect(attached.rootSessionId).toBe(parent.id);
    expect(attached.headSessionId).toBe(child.id);
    expect((await sessionStore.readSession(parent.id))?.options.threadId).toBe(thread.id);
    expect((await sessionStore.readSession(child.id))?.options.threadId).toBe(thread.id);
  });
});
