import fs from "node:fs/promises";
import { DEFAULT_SYSTEM_PROMPT } from "../vellumpix/config.js";
import { buildPrompt } from "../vellumpix/request.js";
import { createFileSections, readFiles } from "../vellumpix/files.js";
import { createFsAdapter } from "../vellumpix/fsAdapter.js";
import { buildPromptMarkdown } from "../vellumpix/promptAssembly.js";
import type { MinimalFsModule, RunVellumPixOptions, FileContent } from "../vellumpix/types.js";

export interface MarkdownBundle {
  markdown: string;
  promptWithFiles: string;
  systemPrompt: string;
  files: FileContent[];
}

export async function buildMarkdownBundle(
  options: Pick<RunVellumPixOptions, "prompt" | "file" | "system" | "maxFileSizeBytes">,
  deps: { cwd?: string; fs?: MinimalFsModule } = {},
): Promise<MarkdownBundle> {
  const cwd = deps.cwd ?? process.cwd();
  const fsModule = deps.fs ?? createFsAdapter(fs);
  const files = await readFiles(options.file ?? [], {
    cwd,
    fsModule,
    maxFileSizeBytes: options.maxFileSizeBytes,
  });
  const sections = createFileSections(files, cwd);
  const systemPrompt = options.system?.trim() || DEFAULT_SYSTEM_PROMPT;
  const userPrompt = (options.prompt ?? "").trim();

  const markdown = buildPromptMarkdown(systemPrompt, userPrompt, sections);
  const promptWithFiles = buildPrompt(userPrompt, files, cwd);
  return { markdown, promptWithFiles, systemPrompt, files };
}
