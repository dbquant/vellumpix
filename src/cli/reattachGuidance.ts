export function formatBrowserReattachGuidance(sessionId: string): string {
  return [
    "This run did not return cleanly, but it may still be alive. Reattach:",
    `  vellumpix session ${sessionId} --render    # final markdown when complete`,
    `  vellumpix session ${sessionId} --live      # tail until done`,
    `  vellumpix session ${sessionId} --harvest   # snapshot the current answer now`,
  ].join("\n");
}
