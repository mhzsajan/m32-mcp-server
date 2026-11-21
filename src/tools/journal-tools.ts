import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { M32Error, M32ValueError } from "../core/errors.js";
import { saveConfig } from "../core/config.js";
import { resolvePath } from "../core/nodes.js";
import { coerceValue, planRestore, type M32Context } from "../core/write.js";
import { assertShowModeAllows, describeWrite, writeAssignments } from "../core/write.js";
import { textResult, wrapM32Tool } from "./util.js";

export function registerJournalTools(server: McpServer, ctx: M32Context): void {
  server.registerTool(
    "m32_history",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Midas M32: write history",
      description:
        "Lists the most recent write batches this server made, newest first, with each key's previous " +
        "and new value and whether it was audible. Batches survive restarts; those from another server " +
        "session are marked. Pass a batchId to m32_undo.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    ({ limit }) =>
      wrapM32Tool(async () => {
        ctx.journal.refresh();
        const batches = ctx.journal.history(limit ?? 20).map((b) => ({ ...b, thisSession: ctx.journal.isFromThisSession(b) }));
        const lines = batches.map((b) => {
          const flags = [b.undoneAt ? "UNDONE" : "", b.undoOf ? "undo of " + b.undoOf : "", b.thisSession ? "" : "other session"].filter(Boolean);
          return b.batchId + " " + b.startedAt + " " + b.origin + " - " + b.entries.length + " write(s)" +
            (flags.length ? " [" + flags.join(", ") + "]" : "") +
            "\n" + b.entries.map((e) => "    " + e.path + ": " + JSON.stringify(e.previous) + " -> " + JSON.stringify(e.next) +
              (e.audible ? " [AUDIBLE]" : "")).join("\n");
        });
        const text = batches.length === 0 ? "No journaled writes yet." : lines.join("\n");
        return {
          content: [textResult(text + "\n\nWrites this session: " + ctx.journal.unsavedChanges())],
          structuredContent: { batches, writesThisSession: ctx.journal.unsavedChanges() },
        };
      }),
  );

  server.registerTool(
    "m32_undo",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Midas M32: undo a write batch",
      description:
        "Restores every key in a journaled batch to the value it held before that batch. Defaults to the " +
        "most recent batch from this server session that has not been undone; older batches need their " +
        "batchId from m32_history. Restores are verified like any write. dryRun shows the plan. Undoing " +
        "an old batch overwrites anything changed since on the same keys.",
      inputSchema: {
        batchId: z.string().optional(),
        dryRun: z.boolean().optional(),
        confirm: z.boolean().optional().describe("Required to undo an audible batch when show mode is on."),
      },
    },
    ({ batchId, dryRun, confirm }) =>
      wrapM32Tool(async () => {
        ctx.journal.refresh();
        const batch = batchId ? ctx.journal.find(batchId) : ctx.journal.lastUndoable();
        if (!batch) {
          if (batchId) throw new M32ValueError("No journaled batch '" + batchId + "' (see m32_history).");
          throw new M32ValueError("Nothing to undo in this session. Use m32_history to find a batch from another session.");
        }
        if (batch.undoneAt && !dryRun) {
          throw new M32Error("Batch " + batch.batchId + " was already undone at " + batch.undoneAt);
        }
        const { assignments, skipped } = planRestore(batch.entries);
        // Validate the whole restore before writing any of it.
        for (const item of assignments) {
          coerceValue(resolvePath(item.path), item.value);
        }
        if (!dryRun) {
          assertShowModeAllows(ctx, batch.entries.filter((e) => e.audible).map((e) => e.path), confirm);
        }
        const result = await writeAssignments(ctx, assignments, {
          dryRun,
          confirm: true, // the show-mode gate was already checked for the whole batch
          origin: "m32_undo",
        });
        if (!dryRun && result.ok) ctx.journal.markUndone(batch.batchId);
        const text = describeWrite(result) + "\n  undo of: " + batch.batchId +
          (skipped.length ? "\n  not restorable (previous value unknown): " + skipped.join(", ") : "");
        return {
          content: [textResult(text)],
          structuredContent: { undone: batch.batchId, skipped, ...result },
          isError: result.dryRun || result.ok ? undefined : true,
        };
      }),
  );

  server.registerTool(
    "m32_show_mode",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      title: "Midas M32: show-mode safety gate",
      description:
        "Reads or changes the persisted show mode. With show mode ON, every audible write (faders, " +
        "mutes, pan, input source) is refused unless the caller passes confirm: true. Cosmetic writes " +
        "(names, colors) remain allowed. The setting is saved in the config file and survives restarts. " +
        "Omit `on` to read the current value without changing it.",
      inputSchema: { on: z.boolean().optional() },
    },
    ({ on }) =>
      wrapM32Tool(async () => {
        if (on !== undefined && on !== ctx.config.showMode) {
          ctx.config.showMode = on;
          saveConfig(ctx.configPath, ctx.config);
        }
        const text = "Show mode is " + (ctx.config.showMode ? "ON - audible writes require confirm: true" : "off - audible writes are allowed");
        return { content: [textResult(text)], structuredContent: { showMode: ctx.config.showMode, configPath: ctx.configPath } };
      }),
  );
}
