import { M32Error, M32ShowModeError, M32ValueError } from "./errors.js";
import type { M32Config } from "./config.js";
import type { WriteJournal, JournalEntry } from "./journal.js";
import { resolvePath, type LeafType, type ResolvedLeaf } from "./nodes.js";
import type { M32OscClient } from "./osc-client.js";

export interface M32Context {
  client: M32OscClient;
  config: M32Config;
  configPath: string;
  journal: WriteJournal;
}

export interface WriteOptions {
  dryRun?: boolean;
  confirm?: boolean;
  origin?: string;
}

export interface VerifiedWrite {
  path: string;
  previous: number | string | null;
  sent: number | string;
  stored: number | string | null;
  match: boolean;
  audible: boolean;
  type: LeafType;
  status: "OK" | "MISMATCH" | "DRY_RUN";
}

export interface VerifiedBatch {
  results: VerifiedWrite[];
  status: "OK" | "MISMATCH" | "DRY_RUN";
  ok: boolean;
  dryRun: boolean;
  batchId?: string;
}

export const NAME_MAX_BYTES = 16;

/** Coerce a tool argument to the leaf's OSC type, or fail before any write. */
export function coerceValue(leaf: ResolvedLeaf, value: unknown): number | string {
  if (leaf.type === "string") {
    if (typeof value !== "string") {
      throw new M32ValueError(leaf.path + " expects a string");
    }
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > NAME_MAX_BYTES) {
      throw new M32ValueError(leaf.path + " holds at most " + NAME_MAX_BYTES + " UTF-8 bytes (got " + bytes + ")");
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new M32ValueError(leaf.path + " expects a finite number");
  }
  if (leaf.type === "float") {
    if (value < 0 || value > 1) {
      throw new M32ValueError(leaf.path + " must be between 0.0 and 1.0 (0.0 = -inf, about 0.75 = 0 dB)");
    }
    return value;
  }
  if (!Number.isInteger(value)) {
    throw new M32ValueError(leaf.path + " expects an integer");
  }
  if (leaf.suffix === "mix/on" || leaf.suffix === "on") {
    if (value !== 0 && value !== 1) {
      throw new M32ValueError(leaf.path + " expects 0 (off) or 1 (on)");
    }
  }
  return value;
}

/** Float32 readback is not bit-exact; compare with a small tolerance. */
export function valuesEqual(a: number | string | null, b: number | string | null): boolean {
  if (a === null || b === null) return false;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return Math.abs(a - b) <= 1e-5;
}

function valueFromArgs(args: (number | string)[]): number | string | null {
  if (args.length === 0) return null;
  return args[0];
}

export function assertShowModeAllows(ctx: M32Context, audiblePaths: string[], confirm?: boolean): void {
  if (ctx.config.showMode && audiblePaths.length > 0 && !confirm) {
    throw new M32ShowModeError(
      "Show mode is ON: " + audiblePaths.length + " audible write(s) refused without confirm: true. " +
        "Affected: " + audiblePaths.slice(0, 8).join(", ") + (audiblePaths.length > 8 ? " ..." : ""),
    );
  }
}

/**
 * Write one or more leaves and read every key back. Nothing is journaled until
 * the reads are done, and a MISMATCH is reported instead of being hidden.
 */
export async function writeAssignments(
  ctx: M32Context,
  assignments: { path: string; value: unknown }[],
  options: WriteOptions = {},
): Promise<VerifiedBatch> {
  if (assignments.length === 0) throw new M32ValueError("No assignments given");
  const plans = assignments.map(({ path, value }) => {
    const leaf = resolvePath(path);
    return { leaf, sent: coerceValue(leaf, value) };
  });
  const paths = plans.map((p) => p.leaf.path);
  const dryRun = Boolean(options.dryRun);
  assertShowModeAllows(ctx, plans.filter((p) => p.leaf.audible).map((p) => p.leaf.path), options.confirm);

  const before = await ctx.client.getMany(paths);
  const previousValues = new Map<string, number | string | null>();
  for (const path of paths) {
    const msg = before.values.get(path);
    previousValues.set(path, msg ? valueFromArgs(msg.args) : null);
  }

  let after: { values: Map<string, { args: (number | string)[] }>; errors: Record<string, string> } = {
    values: new Map(),
    errors: {},
  };
  if (!dryRun) {
    for (const plan of plans) {
      await ctx.client.set(plan.leaf.path, plan.sent, plan.leaf.type);
    }
    // The M32 applies a SET asynchronously (measured around 20 ms). A read
    // sent in the same instant can return the old value. Retry briefly before
    // declaring a MISMATCH so a real write is not reported as a failure.
    const settleMs = 40;
    const attempts = 6;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      after = await ctx.client.getMany(paths);
      const allMatch = plans.every((plan) => {
        const msg = after.values.get(plan.leaf.path);
        return valuesEqual(plan.sent, msg ? valueFromArgs(msg.args) : null);
      });
      if (allMatch) break;
    }
  }

  const results: VerifiedWrite[] = plans.map((plan) => {
    const storedMsg = after.values.get(plan.leaf.path);
    const stored = storedMsg ? valueFromArgs(storedMsg.args) : null;
    const match = !dryRun && valuesEqual(plan.sent, stored);
    return {
      path: plan.leaf.path,
      previous: previousValues.get(plan.leaf.path) ?? null,
      sent: plan.sent,
      stored,
      match,
      audible: plan.leaf.audible,
      type: plan.leaf.type,
      status: dryRun ? "DRY_RUN" : match ? "OK" : "MISMATCH",
    };
  });

  let batchId: string | undefined;
  if (!dryRun) {
    const entries: JournalEntry[] = results.map((r) => ({
      path: r.path,
      previous: r.previous,
      next: r.sent,
      audible: r.audible,
    }));
    batchId = ctx.journal.record(options.origin || "m32_write", entries).batchId;
  }
  const status = dryRun ? "DRY_RUN" : results.every((r) => r.match) ? "OK" : "MISMATCH";
  return { results, status, ok: !dryRun && status === "OK", dryRun, batchId };
}

/** Plain-text summary used in tool content blocks. */
export function describeWrite(batch: VerifiedBatch): string {
  const head = batch.dryRun
    ? "DRY RUN - no values written."
    : batch.status === "OK"
      ? "Write verified (status OK)."
      : "MISMATCH - the console did not store the requested value(s).";
  const lines = batch.results.map((r) => {
    const isDry = r.status === "DRY_RUN";
    const mark = r.status === "MISMATCH" ? " [MISMATCH]" : "";
    return "  " + r.path + ": " + JSON.stringify(r.previous) + " -> " + JSON.stringify(r.sent) +
      (isDry ? " (dry run)" : " stored " + JSON.stringify(r.stored)) +
      (r.audible ? " [AUDIBLE]" : "") + mark;
  });
  return [head, ...lines, "  status: " + batch.status + (batch.batchId ? "  batch: " + batch.batchId : "")].join("\n");
}

/** Plan the restore of a journal batch to the values held before its first write. */
export function planRestore(entries: JournalEntry[]): { assignments: { path: string; value: number | string }[]; skipped: string[] } {
  const first = new Map<string, number | string | null>();
  for (const entry of entries) {
    if (!first.has(entry.path)) first.set(entry.path, entry.previous);
  }
  const assignments: { path: string; value: number | string }[] = [];
  const skipped: string[] = [];
  for (const [path, value] of first) {
    if (value === null) {
      skipped.push(path);
      continue;
    }
    assignments.push({ path, value });
  }
  return { assignments, skipped };
}

export function requireOk(batch: VerifiedBatch): void {
  if (!batch.dryRun && batch.status !== "OK") {
    throw new M32Error("Write verification failed: " + batch.results.filter((r) => !r.match).map((r) => r.path).join(", "));
  }
}
