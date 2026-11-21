import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./core/config.js";
import { WriteJournal } from "./core/journal.js";
import { M32OscClient } from "./core/osc-client.js";
import type { M32Context } from "./core/write.js";
import { registerAllTools } from "./tools/index.js";

export const SERVER_NAME = "m32-mcp-server";
export const SERVER_VERSION = "0.1.0";

export interface RunOptions {
  configPath?: string;
}

export async function createServer(options: RunOptions = {}): Promise<{ server: McpServer; ctx: M32Context; client: M32OscClient }> {
  const loaded = loadConfig(options.configPath);
  const client = new M32OscClient({
    host: loaded.config.host,
    port: loaded.config.port,
    requestTimeoutMs: loaded.config.requestTimeoutMs,
    batchTimeoutMs: loaded.config.batchTimeoutMs,
  });
  const journal = new WriteJournal(loaded.filePath);
  const ctx: M32Context = {
    client,
    config: loaded.config,
    configPath: loaded.filePath,
    journal,
  };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server, ctx);
  return { server, ctx, client };
}

export async function runServer(options: RunOptions = {}): Promise<void> {
  const { server, client } = await createServer(options);
  await server.connect(new StdioServerTransport());
  const shutdown = async (): Promise<void> => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
