import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expandRoot } from "../core/nodes.js";
import type { M32Context } from "../core/write.js";
import { textResult, valueOf, wrapM32Tool } from "./util.js";

/** Read-only engineer handoff snapshot. Never writes to the console. */
export function registerReportTool(server: McpServer, ctx: M32Context): void {
  server.registerTool(
    "m32_console_report",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32 MCP Server: read-only console report",
      description:
        "A read-only snapshot for handoff or diagnosis: live /info and /status, every strip's name, " +
        "fader and on/off state for channels, aux inputs, buses, matrices, DCAs and main outputs, plus " +
        "show mode and journal counts. Nothing is written. Paths that do not answer are reported as null.",
    },
    () =>
      wrapM32Tool(async () => {
        const meta = (await ctx.client.getMany(["/info", "/status"])).values;
        const info = meta.get("/info")?.args ?? [];
        const status = meta.get("/status")?.args ?? [];
        const paths: { path: string; group: string; label: string; field: string }[] = [];
        for (const [group, key] of [
          ["channels", "ch"],
          ["auxins", "auxin"],
          ["buses", "bus"],
          ["matrices", "mtx"],
          ["dcas", "dca"],
          ["main", "main.st"],
        ] as const) {
          for (const base of expandRoot(key)) {
            paths.push({ path: base + "/config/name", group, label: base, field: "name" });
            const fader = key === "dca" ? base + "/fader" : base + "/mix/fader";
            const on = key === "dca" ? base + "/on" : base + "/mix/on";
            paths.push({ path: fader, group, label: base, field: "fader" });
            paths.push({ path: on, group, label: base, field: "on" });
          }
        }
        const { values, errors } = await ctx.client.getMany(paths.map((p) => p.path));
        const strips: Record<string, Record<string, { name: number | string | null; fader: number | string | null; on: number | string | null }>> = {};
        for (const p of paths) {
          const entry = (strips[p.group] ??= {});
          const strip = (entry[p.label] ??= { name: null, fader: null, on: null });
          const msg = values.get(p.path);
          strip[p.field as "name" | "fader" | "on"] = msg ? valueOf(msg.args) : null;
        }
        const result = {
          generatedAt: new Date().toISOString(),
          host: ctx.config.host,
          port: ctx.config.port,
          console: {
            protocol: info[0] ?? null,
            model: info[2] ?? null,
            firmware: info[3] ?? null,
            state: status[0] ?? null,
            ip: status[1] ?? null,
            serial: status[2] ?? null,
          },
          showMode: ctx.config.showMode,
          writesThisSession: ctx.journal.unsavedChanges(),
          strips,
          readErrors: errors,
        };
        const count = Object.values(strips).reduce((n, g) => n + Object.keys(g).length, 0);
        const text = `M32 report for ${ctx.config.host}:${ctx.config.port} at ${result.generatedAt}. ` +
          `${count} strips read. Model ${result.console.model ?? "?"}, firmware ${result.console.firmware ?? "?"}, ` +
          `show mode ${ctx.config.showMode ? "ON" : "off"}, ${Object.keys(errors).length} read error(s).`;
        return { content: [textResult(text)], structuredContent: result };
      }),
  );
}
