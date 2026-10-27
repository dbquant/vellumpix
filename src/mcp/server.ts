#!/usr/bin/env node
import "dotenv/config";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { getCliVersion } from "../version.js";
import { registerChatGptImageTool } from "./tools/chatgptImage.js";
import { registerConsultTool } from "./tools/consult.js";
import { registerProjectSourcesTool } from "./tools/projectSources.js";
import { registerSessionsTool } from "./tools/sessions.js";
import { registerWaitTool } from "./tools/wait.js";
import { registerThreadsTool } from "./tools/threads.js";
import { registerSessionResources } from "./tools/sessionResources.js";
import { MCP_SERVER_NAME } from "../brand.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: getCliVersion(),
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerConsultTool(server);
  registerChatGptImageTool(server);
  registerProjectSourcesTool(server);
  registerSessionsTool(server);
  registerThreadsTool(server);
  registerWaitTool(server);
  registerSessionResources(server);
  return server;
}

export async function startMcpServer(): Promise<void> {
  serveStdio(createMcpServer, {
    legacy: "serve",
    onerror: (error) => console.error("MCP transport error:", error),
  });
}

export function shouldStartMcpServerFromModule(
  moduleUrl: string = import.meta.url,
  argv1: string | undefined = process.argv[1],
): boolean {
  return argv1 ? moduleUrl === pathToFileURL(argv1).href : false;
}

if (shouldStartMcpServerFromModule()) {
  startMcpServer().catch((error) => {
    console.error(`Failed to start ${MCP_SERVER_NAME}:`, error);
    process.exitCode = 1;
  });
}
