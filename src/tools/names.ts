import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { expandRoot, rootByKey } from "../core/nodes.js";
import type { M32Context } from "../core/write.js";
import { textResult, valueOf, wrapM32Tool } from "./util.js";

const GROUPS = [
  ["channels", "ch"],
  ["auxins", "auxin"],
  ["buses", "bus"],
  ["matrices", "mtx"],
  ["dcas", "dca"],
  ["main", "main.st"],
] as const;

export function registerNameTools(server: McpServer, ctx: M32Context): void {
  server.registerTool(
    "m32_list_names",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32 MCP Server: list all strip names",
      description:
        "Reads every channel, aux input, bus, matrix, DCA and main stereo name in one call and returns " +
        "them grouped with their OSC paths. Names that did not answer are reported under `errors` as " +
        "null values; no placeholder names are invented.",
      inputSchema: { includeEmpty: z.boolean().optional().describe("Include empty names in the text summary. Default false.") },
    },
    ({ includeEmpty }) =>
      wrapM32Tool(async () => {
        const specs = GROUPS.map(([group, key]) => {
          const root = rootByKey(key)!;
          const bases = expandRoot(key);
          const entries = bases.map((base, i) => ({
            index: root.indexed ? root.first + i : null,
            path: base + "/config/name",
            base,
          }));
          return { group, root, entries };
        });
        const allPaths = specs.flatMap((s) => s.entries.map((e) => e.path));
        const { values, errors } = await ctx.client.getMany(allPaths);

        const grouped: Record<string, { index: number | null; path: string; name: string | null }[]> = {};
        const lines: string[] = [];
        for (const spec of specs) {
          grouped[spec.group] = spec.entries.map((e) => {
            const msg = values.get(e.path);
            const raw = msg ? valueOf(msg.args) : null;
            const name = typeof raw === "string" ? raw : null;
            return { index: e.index, path: e.path, name };
          });
          const label = spec.root.key.toUpperCase();
          const shown = grouped[spec.group].filter((x) => includeEmpty || (x.name && x.name.length > 0));
          lines.push(label + ": " + (shown.length === 0 ? "(all empty)" : shown.map((x) => (x.index === null ? "main" : String(x.index)) + "=" + JSON.stringify(x.name)).join(", ")));
        }
        return { content: [textResult(lines.join("\n"))], structuredContent: { ...grouped, errors } };
      }),
  );
}
