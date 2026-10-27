import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  defaultBrowserProfileDir,
  resolveBrowserProvider,
} from "../../src/browser/browserProvider.js";

describe("browser provider resolution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefers Edge on Windows and falls back to Chrome", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((candidate) =>
      String(candidate).toLowerCase().includes("google\\chrome"),
    );
    const resolved = resolveBrowserProvider({
      platform: "win32",
      homeDir: "C:\\Users\\test",
    });
    expect(resolved.requested).toBe("auto");
    expect(resolved.selected).toBe("chrome");
    expect(resolved.executablePath).toMatch(/chrome\.exe$/i);
  });

  it("keeps Edge and Chrome automation profiles separate", () => {
    const homeDir = path.join("fixture", "home");
    expect(defaultBrowserProfileDir("edge", homeDir)).toBe(
      path.join(homeDir, ".vellumpix", "browser-profiles", "edge"),
    );
    expect(defaultBrowserProfileDir("chrome", homeDir)).toBe(
      path.join(homeDir, ".vellumpix", "browser-profiles", "chrome"),
    );
  });

  it("uses an explicit executable path and infers its provider", () => {
    const resolved = resolveBrowserProvider({
      provider: "edge",
      explicitPath: "D:\\Apps\\Google\\Chrome\\Application\\chrome.exe",
      platform: "win32",
    });
    expect(resolved.selected).toBe("chrome");
    expect(resolved.executablePath).toContain("chrome.exe");
  });

  it("uses the other browser family as an explicit provider's default fallback", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(resolveBrowserProvider({ provider: "chrome", platform: "win32" }).fallback).toBe("edge");
    expect(resolveBrowserProvider({ provider: "edge", platform: "win32" }).fallback).toBe("chrome");
  });
});
