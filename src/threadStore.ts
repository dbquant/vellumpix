import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getVellumPixHomeDir } from "./vellumpixHome.js";

export type ThreadStatus = "active" | "archived";

export interface VellumPixThread {
  id: string;
  title: string;
  tags: string[];
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  rootSessionId?: string;
  headSessionId?: string;
  sessionIds: string[];
}

export interface CreateThreadInput {
  id?: string;
  title: string;
  tags?: string[];
}

const THREAD_FILE_MODE = 0o600;
const THREAD_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export function getThreadsDir(): string {
  return path.join(getVellumPixHomeDir(), "threads");
}

export function normalizeThreadId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/u, "");
  if (!normalized || !THREAD_ID_PATTERN.test(normalized)) {
    throw new Error(
      "Thread id must contain 1-64 lowercase letters, numbers, or hyphens and must start/end with a letter or number.",
    );
  }
  return normalized;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 32);
}

function threadDir(id: string): string {
  return path.join(getThreadsDir(), normalizeThreadId(id));
}

function threadPath(id: string): string {
  return path.join(threadDir(id), "thread.json");
}

async function writeThread(record: VellumPixThread): Promise<void> {
  const dir = threadDir(record.id);
  await fs.mkdir(dir, { recursive: true });
  const destination = threadPath(record.id);
  const temporary = path.join(dir, `.thread-${process.pid}-${randomUUID()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: THREAD_FILE_MODE,
  });
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    await fs.rm(destination, { force: true });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class FileThreadStore {
  async ensureStorage(): Promise<void> {
    await fs.mkdir(getThreadsDir(), { recursive: true });
  }

  async createThread(input: CreateThreadInput): Promise<VellumPixThread> {
    const title = input.title.trim();
    if (!title) throw new Error("Thread title is required.");
    const id = normalizeThreadId(input.id ?? title);
    if (await this.readThread(id)) {
      throw new Error(`Thread "${id}" already exists.`);
    }
    const now = new Date().toISOString();
    const record: VellumPixThread = {
      id,
      title,
      tags: normalizeTags(input.tags),
      status: "active",
      createdAt: now,
      updatedAt: now,
      sessionIds: [],
    };
    await writeThread(record);
    return record;
  }

  async ensureThread(id: string, title?: string, tags?: string[]): Promise<VellumPixThread> {
    const normalizedId = normalizeThreadId(id);
    const existing = await this.readThread(normalizedId);
    if (existing) return existing;
    return this.createThread({ id: normalizedId, title: title?.trim() || normalizedId, tags });
  }

  async readThread(id: string): Promise<VellumPixThread | null> {
    try {
      const raw = await fs.readFile(threadPath(id), "utf8");
      const parsed = JSON.parse(raw) as VellumPixThread;
      if (!parsed || parsed.id !== normalizeThreadId(id) || !Array.isArray(parsed.sessionIds)) {
        return null;
      }
      return {
        ...parsed,
        tags: normalizeTags(parsed.tags),
        status: parsed.status === "archived" ? "archived" : "active",
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async listThreads(
    options: {
      includeArchived?: boolean;
      query?: string;
    } = {},
  ): Promise<VellumPixThread[]> {
    await this.ensureStorage();
    const entries = await fs.readdir(getThreadsDir(), { withFileTypes: true });
    const records = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.readThread(entry.name)),
    );
    const query = options.query?.trim().toLowerCase();
    return records
      .filter((record): record is VellumPixThread => Boolean(record))
      .filter((record) => options.includeArchived || record.status !== "archived")
      .filter(
        (record) =>
          !query ||
          record.id.includes(query) ||
          record.title.toLowerCase().includes(query) ||
          record.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async attachSession(threadId: string, sessionId: string): Promise<VellumPixThread> {
    const record = await this.readThread(threadId);
    if (!record) throw new Error(`Thread "${threadId}" not found.`);
    const sessions = record.sessionIds.includes(sessionId)
      ? record.sessionIds
      : [...record.sessionIds, sessionId];
    const next: VellumPixThread = {
      ...record,
      rootSessionId: record.rootSessionId ?? sessionId,
      headSessionId: sessionId,
      sessionIds: sessions,
      updatedAt: new Date().toISOString(),
    };
    await writeThread(next);
    return next;
  }

  async updateThread(
    id: string,
    updates: { title?: string; tags?: string[]; status?: ThreadStatus },
  ): Promise<VellumPixThread> {
    const record = await this.readThread(id);
    if (!record) throw new Error(`Thread "${id}" not found.`);
    const title = updates.title?.trim();
    if (updates.title !== undefined && !title) throw new Error("Thread title cannot be empty.");
    const next: VellumPixThread = {
      ...record,
      ...(title ? { title } : {}),
      ...(updates.tags ? { tags: normalizeTags(updates.tags) } : {}),
      ...(updates.status ? { status: updates.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    await writeThread(next);
    return next;
  }
}

export const threadStore = new FileThreadStore();
