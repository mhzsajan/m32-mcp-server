import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { M32ValueError } from "../core/errors.js";
import { describeWrite, writeAssignments, type M32Context } from "../core/write.js";
import { textResult, wrapM32Tool } from "./util.js";

const VALUE = z.union([z.number(), z.string()]);
const DRY = z.boolean().optional().describe("Preview the write without changing the console.");
const CONFIRM = z.boolean().optional().describe("Required for an audible write when show mode is on.");

export function registerWriteTools(server: McpServer, ctx: M32Context): void {
  server.registerTool(
    "m32_set",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32 MCP Server: verified set",
      description:
        "Writes one M32 leaf, then reads it back. The result gives previous, sent, stored and match for " +
        "the key and status is MISMATCH if the console stored something else. Numeric values must be " +
        "typed correctly: faders and pan are floats 0.0..1.0 (integers are ignored by the console), " +
        "on/mute flags, colors and sources are integers, names are strings up to 16 UTF-8 bytes. " +
        "`audible` marks writes that change the sound. With show mode on, audible writes need " +
        "confirm: true. Every non-dry write is journaled (m32_history / m32_undo).",
      inputSchema: {
        path: z.string().regex(/^\//, "path must start with /"),
        value: VALUE,
        dryRun: DRY,
        confirm: CONFIRM,
      },
    },
    ({ path, value, dryRun, confirm }) =>
      wrapM32Tool(async () => {
        const batch = await writeAssignments(ctx, [{ path, value }], { dryRun, confirm, origin: "m32_set" });
        return {
          content: [textResult(describeWrite(batch))],
          structuredContent: { path, ...batch },
          isError: batch.dryRun || batch.ok ? undefined : true,
        };
      }),
  );

  server.registerTool(
    "m32_bulk_set",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32 MCP Server: verified bulk set for one strip",
      description:
        "Sets several keys under one strip base (e.g. baseNode '/ch/01' with assignments " +
        '{"mix/fader": 0.7, "config/name": "Lead Vox"}). Keys may use / or . as separator. Every key is ' +
        "validated before any write, then written and read back with previous/sent/stored/match per key. " +
        "A single bad key refuses the whole batch. dryRun and show-mode confirm behave as in m32_set.",
      inputSchema: {
        baseNode: z.string().regex(/^\//, "baseNode must start with /"),
        assignments: z.record(z.string(), VALUE),
        dryRun: DRY,
        confirm: CONFIRM,
      },
    },
    ({ baseNode, assignments, dryRun, confirm }) =>
      wrapM32Tool(async () => {
        const base = baseNode.replace(/\/+$/, "");
        const items = Object.entries(assignments).map(([key, value]) => {
          const suffix = key.replace(/^\/+/, "").replace(/\./g, "/");
          if (suffix.length === 0) throw new M32ValueError("Empty key in assignments");
          return { path: base + "/" + suffix, value };
        });
        if (items.length === 0) throw new M32ValueError("No assignments given");
        const batch = await writeAssignments(ctx, items, { dryRun, confirm, origin: "m32_bulk_set" });
        return {
          content: [textResult(describeWrite(batch))],
          structuredContent: { baseNode: base, ...batch },
          isError: batch.dryRun || batch.ok ? undefined : true,
        };
      }),
  );
}
