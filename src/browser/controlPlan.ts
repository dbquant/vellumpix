import { resolveBrowserNoFocus } from "./config.js";
import type { BrowserAutomationConfig } from "./types.js";
import { defaultBrowserProvider } from "./browserProvider.js";

type BrowserControlConfig = Pick<
  BrowserAutomationConfig,
  | "attachRunning"
  | "browserTabRef"
  | "remoteChrome"
  | "headless"
  | "hideWindow"
  | "keepBrowser"
  | "manualLogin"
  | "noFocus"
  | "browserProvider"
  | "resolvedBrowserProvider"
>;

export interface BrowserControlPlan {
  mode: "attach-running" | "remote-chrome" | "headless" | "hidden-window" | "visible-window";
  launchesChrome: boolean;
  mayFocusWindow: boolean;
  /** --browser-no-focus: VellumPix skips Chrome activation for launch, new tabs, and send. */
  noFocus?: boolean;
  summary: string;
  guidance: string[];
}

export function describeBrowserControlPlan(config: BrowserControlConfig = {}): BrowserControlPlan {
  const guidance: string[] = [];
  const browserName =
    config.resolvedBrowserProvider === "edge" ||
    config.browserProvider === "edge" ||
    (config.browserProvider === "auto" && defaultBrowserProvider() === "edge")
      ? "Edge"
      : "Chrome";
  const tabRef = String(config.browserTabRef ?? "").trim();
  const reusesExistingTab = tabRef.length > 0;
  const noFocus = resolveBrowserNoFocus(config);
  const noFocusGuidance = reusesExistingTab
    ? "VellumPix reuses that tab without bringing Chrome to the front (--browser-no-focus)."
    : "VellumPix opens its tab in a background window and skips Chrome activation during launch, tab creation, and send (--browser-no-focus). A reattach that falls back to relaunching Chrome can still bring it forward.";

  if (config.attachRunning) {
    guidance.push(
      reusesExistingTab
        ? `VellumPix reuses the matching ChatGPT tab (${tabRef}) and leaves the existing browser process alone.`
        : "VellumPix opens a dedicated tab and leaves the existing browser process alone.",
    );
    if (config.keepBrowser) {
      guidance.push("The browser stays open because VellumPix did not launch it.");
    }
    if (noFocus) guidance.push(noFocusGuidance);
    return {
      mode: "attach-running",
      launchesChrome: false,
      mayFocusWindow: !noFocus,
      ...(noFocus ? { noFocus } : {}),
      summary: reusesExistingTab
        ? "attach to an already-running local Chrome tab"
        : "attach to an already-running local Chrome session",
      guidance,
    };
  }

  if (config.remoteChrome) {
    guidance.push(
      reusesExistingTab
        ? `VellumPix reuses the matching ChatGPT tab (${tabRef}) in the configured remote Chrome session.`
        : "VellumPix opens a dedicated tab in the configured remote Chrome session.",
    );
    guidance.push("Local Chrome launch, cookie copy, and window hiding flags are skipped.");
    // Opening the tab and Page.bringToFront activate a remote Chrome too.
    guidance.push(
      noFocus
        ? noFocusGuidance
        : "Opening the tab and sending the prompt can still bring that Chrome to the front; add --browser-no-focus to keep it in the background.",
    );
    return {
      mode: "remote-chrome",
      launchesChrome: false,
      mayFocusWindow: !noFocus,
      ...(noFocus ? { noFocus } : {}),
      summary: reusesExistingTab
        ? "reuse an existing remote Chrome tab"
        : "reuse an existing remote Chrome session",
      guidance,
    };
  }

  if (config.headless) {
    guidance.push("Headless mode avoids visible UI but may be blocked by ChatGPT or Cloudflare.");
    return {
      mode: "headless",
      launchesChrome: true,
      mayFocusWindow: false,
      summary: `launch headless ${browserName}`,
      guidance,
    };
  }

  if (config.hideWindow) {
    guidance.push(
      "On macOS, VellumPix launches Chrome off-screen while keeping the page rendered.",
    );
    guidance.push(
      noFocus
        ? noFocusGuidance
        : "For the calmest shared-desktop flow, prefer --browser-attach-running or --remote-chrome.",
    );
    return {
      mode: "hidden-window",
      launchesChrome: true,
      mayFocusWindow: !noFocus,
      ...(noFocus ? { noFocus } : {}),
      summary: `launch ${browserName} in hidden-window mode`,
      guidance,
    };
  }

  if (config.manualLogin) {
    guidance.push(
      `Manual-login mode may show the persistent VellumPix ${browserName} profile for sign-in or automation.`,
    );
  } else if (!noFocus) {
    guidance.push(
      `A visible automation ${browserName} window may take focus while VellumPix controls ChatGPT.`,
    );
  }
  guidance.push(
    noFocus
      ? noFocusGuidance
      : "Use --browser-hide-window, --browser-attach-running, or --remote-chrome to reduce desktop disruption.",
  );
  if (config.keepBrowser) {
    guidance.push(
      `${browserName} will remain open after the run because --browser-keep-browser is enabled.`,
    );
  }

  return {
    mode: "visible-window",
    launchesChrome: true,
    mayFocusWindow: !noFocus,
    ...(noFocus ? { noFocus } : {}),
    summary: `launch visible ${browserName}`,
    guidance,
  };
}

export function formatBrowserControlPlan(plan: BrowserControlPlan, label = "browser"): string[] {
  const risk = plan.mayFocusWindow
    ? "may focus/control the browser UI"
    : plan.noFocus
      ? "keeps Chrome in the background"
      : "does not use a visible local browser window";
  return [
    `[${label}] Browser control: ${plan.summary}; ${risk}.`,
    ...plan.guidance.map((entry) => `[${label}] Browser guidance: ${entry}`),
  ];
}
