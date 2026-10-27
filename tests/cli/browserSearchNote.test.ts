import { describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import { enforceBrowserSearchFlag } from "../../bin/vellumpix-cli.js";
import type { RunVellumPixOptions } from "../../src/vellumpix.js";
import type { SessionMode } from "../../src/sessionStore.js";

const makeRunOptions = (search: boolean | undefined): RunVellumPixOptions => ({
  prompt: "hi",
  model: "gpt-5.1",
  file: [],
  search,
  heartbeatIntervalMs: 30000,
});

describe("browser search note", () => {
  it("logs note and clears search when browser + search=false", () => {
    const logSpy = vi.fn();
    const opts = makeRunOptions(false);
    enforceBrowserSearchFlag(opts, "browser" as SessionMode, logSpy);
    expect(logSpy).toHaveBeenCalledWith(
      chalk.dim("Note: search is not available in browser engine; ignoring search=false."),
    );
    expect(opts.search).toBeUndefined();
  });

  it("leaves search untouched for api", () => {
    const logSpy = vi.fn();
    const opts = makeRunOptions(false);
    enforceBrowserSearchFlag(opts, "api" as SessionMode, logSpy);
    expect(logSpy).not.toHaveBeenCalled();
    expect(opts.search).toBe(false);
  });
});
