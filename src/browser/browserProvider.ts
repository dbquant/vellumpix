import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Launcher } from "chrome-launcher";

export type BrowserProvider = "auto" | "chrome" | "edge";
export type ConcreteBrowserProvider = Exclude<BrowserProvider, "auto">;

export interface ResolvedBrowserProvider {
  requested: BrowserProvider;
  selected: ConcreteBrowserProvider;
  fallback: ConcreteBrowserProvider | null;
  executablePath: string | null;
}

export function defaultBrowserProvider(
  platform: NodeJS.Platform = process.platform,
): ConcreteBrowserProvider {
  return platform === "win32" ? "edge" : "chrome";
}

export function defaultBrowserFallbackProvider(
  platform: NodeJS.Platform = process.platform,
): ConcreteBrowserProvider {
  return platform === "win32" ? "chrome" : "edge";
}

export function normalizeBrowserProvider(value: unknown): BrowserProvider | undefined {
  return value === "auto" || value === "chrome" || value === "edge" ? value : undefined;
}

export function normalizeBrowserFallbackProvider(
  value: unknown,
): ConcreteBrowserProvider | null | undefined {
  if (value === null || value === "none") return null;
  return value === "chrome" || value === "edge" ? value : undefined;
}

export function resolveBrowserProvider(
  options: {
    provider?: BrowserProvider | null;
    fallbackProvider?: ConcreteBrowserProvider | null;
    explicitPath?: string | null;
    platform?: NodeJS.Platform;
    homeDir?: string;
  } = {},
): ResolvedBrowserProvider {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const requested = options.provider ?? "auto";
  const preferred = requested === "auto" ? defaultBrowserProvider(platform) : requested;
  const fallback =
    options.fallbackProvider === undefined
      ? requested === "auto"
        ? defaultBrowserFallbackProvider(platform)
        : requested === "edge"
          ? "chrome"
          : "edge"
      : options.fallbackProvider;

  if (options.explicitPath?.trim()) {
    return {
      requested,
      selected: inferBrowserProviderFromPath(options.explicitPath) ?? preferred,
      fallback,
      executablePath: options.explicitPath.trim(),
    };
  }

  const preferredPath = findBrowserExecutable(preferred, platform, homeDir);
  if (preferredPath) {
    return { requested, selected: preferred, fallback, executablePath: preferredPath };
  }
  if (fallback && fallback !== preferred) {
    const fallbackPath = findBrowserExecutable(fallback, platform, homeDir);
    if (fallbackPath) {
      return { requested, selected: fallback, fallback, executablePath: fallbackPath };
    }
  }
  if (preferred === "chrome" || fallback === "chrome") {
    const launcherPath = Launcher.getFirstInstallation();
    if (launcherPath) {
      return { requested, selected: "chrome", fallback, executablePath: launcherPath };
    }
  }
  return { requested, selected: preferred, fallback, executablePath: null };
}

export function defaultBrowserProfileDir(
  provider: ConcreteBrowserProvider,
  homeDir: string = os.homedir(),
): string {
  return path.join(homeDir, ".oracle", "browser-profiles", provider);
}

export function findBrowserExecutable(
  provider: ConcreteBrowserProvider,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string | null {
  const envName = provider === "edge" ? "EDGE_PATH" : "CHROME_PATH";
  const envPath = process.env[envName]?.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  for (const candidate of browserExecutableCandidates(provider, platform, homeDir)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function inferBrowserProviderFromPath(
  executablePath?: string | null,
): ConcreteBrowserProvider | null {
  const normalized = executablePath?.toLowerCase() ?? "";
  if (normalized.includes("msedge") || normalized.includes("microsoft edge")) return "edge";
  if (normalized.includes("chrome")) return "chrome";
  return null;
}

function browserExecutableCandidates(
  provider: ConcreteBrowserProvider,
  platform: NodeJS.Platform,
  homeDir: string,
): string[] {
  if (platform === "win32") {
    const join = path.win32.join;
    const localAppData = process.env.LOCALAPPDATA ?? join(homeDir, "AppData", "Local");
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    return provider === "edge"
      ? [
          join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]
      : [
          join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
          join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
          join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        ];
  }
  if (platform === "darwin") {
    return provider === "edge"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  return provider === "edge"
    ? ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
}
