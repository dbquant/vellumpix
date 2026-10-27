// Ensure API keys are present during tests so runVellumPix doesn't fail early when CI
// runs without real credentials.
import os from "node:os";
import path from "node:path";

process.env.OPENAI_API_KEY ||= "sk-test";
process.env.GEMINI_API_KEY ||= "gm-test";
process.env.VELLUMPIX_MIN_PROMPT_CHARS ||= "1";
// Avoid writing under ~/.vellumpix in constrained environments; keep test sessions isolated.
process.env.VELLUMPIX_HOME_DIR ||= path.join(os.tmpdir(), `vellumpix-tests-${process.pid}`);
delete process.env.VELLUMPIX_ENGINE;
delete process.env.VELLUMPIX_REMOTE_HOST;
delete process.env.VELLUMPIX_REMOTE_TOKEN;
