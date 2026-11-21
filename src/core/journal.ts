import fs from "node:fs";
import path from "node:path";
import { M32Error } from "./errors.js";

export interface JournalEntry {
  path: string;
  previous: number | string | null;
  next: number | string;
  audible: boolean;
}

export interface JournalBatch {
  batchId: string;
  startedAt: string;
  origin: string;
  session: string;
  entries: JournalEntry[];
  undoneAt?: string;
  undoOf?: string;
}

const SESSION = "ses-" + process.pid + "-" + Date.now().toString(36);

function defaultJournalPath(configPath: string): string {
  return path.join(path.dirname(path.resolve(configPath)), "journal.json");
}

export class WriteJournal {
  private readonly filePath: string;
  private batches: JournalBatch[] = [];

  constructor(configPath: string, filePath?: string) {
    this.filePath = filePath ? path.resolve(filePath) : defaultJournalPath(configPath);
    this.refresh();
  }

  getJournalPath(): string {
    return this.filePath;
  }

  refresh(): void {
    if (!fs.existsSync(this.filePath)) {
      this.batches = [];
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.batches = Array.isArray(parsed) ? (parsed as JournalBatch[]) : [];
    } catch (err) {
      throw new M32Error("Cannot read journal " + this.filePath + ": " + (err as Error).message);
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.batches, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  record(origin: string, entries: JournalEntry[], undoOf?: string): JournalBatch {
    this.refresh();
    const batch: JournalBatch = {
      batchId: "b-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      startedAt: new Date().toISOString(),
      origin,
      session: SESSION,
      entries: entries.map((e) => ({ ...e })),
    };
    if (undoOf) batch.undoOf = undoOf;
    this.batches.push(batch);
    this.persist();
    return batch;
  }

  history(limit = 20): JournalBatch[] {
    this.refresh();
    return [...this.batches].reverse().slice(0, limit);
  }

  find(batchId: string): JournalBatch | undefined {
    this.refresh();
    return this.batches.find((b) => b.batchId === batchId);
  }

  isFromThisSession(batch: JournalBatch): boolean {
    return batch.session === SESSION;
  }

  lastUndoable(options: { includeOtherSessions?: boolean } = {}): JournalBatch | undefined {
    this.refresh();
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const batch = this.batches[i];
      if (batch.undoneAt) continue;
      if (!options.includeOtherSessions && !this.isFromThisSession(batch)) continue;
      return batch;
    }
    return undefined;
  }

  markUndone(batchId: string): void {
    this.refresh();
    const batch = this.batches.find((b) => b.batchId === batchId);
    if (batch) {
      batch.undoneAt = new Date().toISOString();
      this.persist();
    }
  }

  /** Number of leaf writes made by this server since it started. */
  unsavedChanges(): number {
    return this.history(1000)
      .filter((b) => b.session === SESSION)
      .reduce((sum, b) => sum + b.entries.length, 0);
  }
}
