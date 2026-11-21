import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { M32Context } from "../core/write.js";
import { registerCoreTools } from "./core.js";
import { registerJournalTools } from "./journal-tools.js";
import { registerNameTools } from "./names.js";
import { registerReportTool } from "./report.js";
import { registerWriteTools } from "./write-tools.js";

export const TOOL_NAMES = [
  "m32_status",
  "m32_get",
  "m32_get_many",
  "m32_dump",
  "m32_list_names",
  "m32_set",
  "m32_bulk_set",
  "m32_history",
  "m32_undo",
  "m32_show_mode",
  "m32_console_report",
] as const;

export function registerAllTools(server: McpServer, ctx: M32Context): void {
  registerCoreTools(server, ctx);
  registerNameTools(server, ctx);
  registerWriteTools(server, ctx);
  registerJournalTools(server, ctx);
  registerReportTool(server, ctx);
}
