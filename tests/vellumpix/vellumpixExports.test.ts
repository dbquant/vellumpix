import { describe, expect, test } from "vitest";
import * as vellumpix from "../../src/vellumpix.js";

describe("vellumpix entrypoint exports", () => {
  test("exposes core helpers", () => {
    expect(vellumpix.DEFAULT_MODEL).toBeDefined();
    expect(typeof vellumpix.createDefaultClientFactory).toBe("function");
    expect(typeof vellumpix.runVellumPix).toBe("function");
    expect(typeof vellumpix.formatFileSection).toBe("function");
    expect(typeof vellumpix.formatFileSections).toBe("function");
    expect(vellumpix.PRO_MODELS instanceof Set).toBe(true);
  });

  test("preserves raw exported file-section formatting by default", () => {
    const rawDefault = vellumpix.formatFileSection("a.txt", "hello");
    expect(rawDefault).not.toContain("Lines:");
    expect(rawDefault).toContain("```\nhello\n```");

    const numbered = vellumpix.formatFileSection("a.txt", "hello", { lineNumbers: true });
    expect(numbered).toContain("Lines: 1-1");
    expect(numbered).toContain("1 | hello");
  });

  test("exposes generated file-section list formatting", () => {
    const out = vellumpix.formatFileSections([
      { displayPath: "a.txt", content: "hello" },
      { displayPath: "b.txt", content: "world" },
    ]);
    expect(out).toContain("### File: a.txt");
    expect(out).toContain("1 | hello");
    expect(out).toContain("\n\n### File: b.txt");
    expect(out).toContain("1 | world");
  });

  test("asks models to use line-specific file citations", () => {
    expect(vellumpix.DEFAULT_SYSTEM_PROMPT).toContain("path:line");
    expect(vellumpix.DEFAULT_SYSTEM_PROMPT).toContain("path:line-line");
  });
});
