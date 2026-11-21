import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WriteJournal } from "../src/core/journal.js";

test("journal persists batches across instances and tracks undo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m32-journal-"));
  const file = path.join(tmp, "journal.json");
  try {
    const first = new WriteJournal(path.join(tmp, "config.json"), file);
    const batch = first.record("m32_set", [{ path: "/ch/01/config/name", previous: "", next: "Lead", audible: false }]);
    assert.equal(first.history(1)[0].batchId, batch.batchId);
    assert.equal(first.isFromThisSession(batch), true);

    const second = new WriteJournal(path.join(tmp, "config.json"), file);
    assert.equal(second.find(batch.batchId)?.entries[0].next, "Lead");
    assert.equal(second.lastUndoable()?.batchId, batch.batchId);
    second.markUndone(batch.batchId);
    assert.equal(second.lastUndoable(), undefined);
    assert.equal(new WriteJournal(path.join(tmp, "config.json"), file).find(batch.batchId)?.undoneAt !== undefined, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
