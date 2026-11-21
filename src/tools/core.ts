import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseDumpRoot, leavesUnder } from "../core/nodes.js";
import type { M32Context } from "../core/write.js";
import { textResult, valueOf, wrapM32Tool } from "./util.js";

const PATH = z.string().regex(/^\//, "path must start with /");

export function registerCoreTools(server: McpServer, ctx: M32Context): void {
  server.registerTool(
    "m32_status",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32: connection status",
      description:
        "Health check for the M32. Reads /info and /status live, reports reachability and round-trip " +
        "latency, the configured host/port and local UDP reply port, the persisted config path, show mode, " +
        "and how many writes this server has journaled. Never fabricates console data: if the console does " +
        "not answer, reachable is false and the fields are omitted.",
    },
    () =>
      wrapM32Tool(async () => {
        const started = Date.now();
        let info: (number | string)[] | null = null;
        let status: (number | string)[] | null = null;
        let latencyMs: number | null = null;
        let reachable = false;
        try {
          info = (await ctx.client.get("/info")).args;
          latencyMs = Date.now() - started;
          status = (await ctx.client.get("/status")).args;
          reachable = true;
        } catch {
          reachable = false;
        }
        const result = {
          reachable,
          host: ctx.config.host,
          port: ctx.config.port,
          localUdpPort: await ctx.client.localPort(),
          latencyMs,
          console: info
            ? {
                protocol: info[0] ?? null,
                server: info[1] ?? null,
                model: info[2] ?? null,
                firmware: info[3] ?? null,
                state: status?.[0] ?? null,
                ip: status?.[1] ?? null,
                serial: status?.[2] ?? null,
              }
            : null,
          showMode: ctx.config.showMode,
          configPath: ctx.configPath,
          journalPath: ctx.journal.getJournalPath(),
          writesThisSession: ctx.journal.unsavedChanges(),
        };
        const text = reachable
          ? `M32 at ${ctx.config.host}:${ctx.config.port} answered in ${latencyMs} ms. ` +
            `Model ${result.console?.model}, firmware ${result.console?.firmware}, serial ${result.console?.serial}. ` +
            `Show mode ${ctx.config.showMode ? "ON" : "off"}. ${result.writesThisSession} write(s) journaled this session.`
          : `Console at ${ctx.config.host}:${ctx.config.port} did not answer. Check power, network and port 10023.`;
        return { content: [textResult(text)], structuredContent: result };
      }),
  );

  server.registerTool(
    "m32_get",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32: read one leaf",
      description:
        "Reads one OSC leaf and returns its typed value. Any address starting with / is accepted; an " +
        "address the console does not answer is reported as an error, never as a made-up value. Known " +
        "leaves are listed in docs/PROTOCOL.md. Faders and pan are floats 0.0..1.0; mute/on flags are " +
        "integers 0 or 1; names are strings.",
      inputSchema: { path: PATH },
    },
    ({ path }) =>
      wrapM32Tool(async () => {
        const msg = await ctx.client.get(path);
        const value = valueOf(msg.args);
        const type = typeof value === "string" ? "string" : typeof value === "number" ? Number.isInteger(value) && msg.types === ",i" ? "int" : "float" : "null";
        return {
          content: [textResult(path + " = " + JSON.stringify(msg.args.length === 1 ? value : msg.args) + " (" + msg.types + ")")],
          structuredContent: { path, value, args: msg.args, types: msg.types, valueType: type },
        };
      }),
  );

  server.registerTool(
    "m32_get_many",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32: read many leaves",
      description:
        "Reads up to 200 OSC leaves in one tool call. Queries are sent in small chunks and replies are " +
        "matched by the address the console echoes. Paths that do not answer appear under `errors`; " +
        "the call itself still succeeds so one bad path cannot hide the other 199.",
      inputSchema: { paths: z.array(PATH).min(1).max(200) },
    },
    ({ paths }) =>
      wrapM32Tool(async () => {
        const { values, errors } = await ctx.client.getMany(paths);
        const result: Record<string, number | string | null> = {};
        for (const path of paths) result[path] = values.has(path) ? valueOf(values.get(path)!.args) : null;
        const lines = paths.map((p) => (p in errors ? p + ": NO REPLY" : p + " = " + JSON.stringify(result[p])));
        return { content: [textResult(lines.join("\n"))], structuredContent: { values: result, errors } };
      }),
  );

  server.registerTool(
    "m32_dump",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32: dump one strip",
      description:
        "Reads every known leaf under one indexed strip, e.g. /ch/01, /auxin/01, /bus/01, /mtx/01, " +
        "/dca/1, /main/st or /main/m. Only leaves verified on this console are included; paths the " +
        "console does not expose are not invented. Whole-namespace dumps are refused.",
      inputSchema: { path: PATH },
    },
    ({ path }) =>
      wrapM32Tool(async () => {
        const { root, index } = parseDumpRoot(path);
        const base = index === null ? root.base : root.base + "/" + String(index).padStart(root.width, "0");
        const leaves = leavesUnder(base);
        const { values, errors } = await ctx.client.getMany(leaves.map((l) => l.path));
        const entries: Record<string, number | string | null> = {};
        for (const leaf of leaves) entries[leaf.suffix] = values.has(leaf.path) ? valueOf(values.get(leaf.path)!.args) : null;
        const text = [`Dumped ${Object.keys(entries).length} leaf/leaves under ${base}`,
          ...Object.entries(entries).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`)].join("\n");
        return { content: [textResult(text)], structuredContent: { path: base, entries, errors } };
      }),
  );
}
