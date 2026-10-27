import type { UserConfig } from "../config.js";
import { normalizeMaxFileSizeBytes } from "../vellumpix/files.js";

export function resolveConfiguredMaxFileSizeBytes(
  userConfig?: UserConfig,
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const envValue = env.VELLUMPIX_MAX_FILE_SIZE_BYTES?.trim();
  if (envValue) {
    return normalizeMaxFileSizeBytes(envValue, "VELLUMPIX_MAX_FILE_SIZE_BYTES");
  }
  if (userConfig?.maxFileSizeBytes !== undefined) {
    return normalizeMaxFileSizeBytes(userConfig.maxFileSizeBytes, "config.maxFileSizeBytes");
  }
  return undefined;
}
