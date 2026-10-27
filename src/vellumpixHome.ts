import os from "node:os";
import path from "node:path";
import { HOME_DIR_NAME } from "./brand.js";

let vellumpixHomeDirOverride: string | null = null;

/**
 * Test-only hook: avoid mutating process.env (shared across Vitest worker threads).
 * This override is scoped to the current Node worker.
 */
export function setVellumPixHomeDirOverrideForTest(dir: string | null): void {
  vellumpixHomeDirOverride = dir;
}

export function getVellumPixHomeDir(): string {
  return (
    vellumpixHomeDirOverride ??
    process.env.VELLUMPIX_HOME_DIR ??
    path.join(os.homedir(), HOME_DIR_NAME)
  );
}
