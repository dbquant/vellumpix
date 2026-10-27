#!/usr/bin/env node
import { startMcpServer } from "../src/mcp/server.js";

startMcpServer().catch((error) => {
  console.error("vellumpix-mcp exited with an error:", error);
  process.exitCode = 1;
});
