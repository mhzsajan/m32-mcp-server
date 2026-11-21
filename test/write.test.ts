import assert from "node:assert/strict";
import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";
import { WriteJournal } from "../src/core/journal.js";
import { resolvePath } from "../src/core/nodes.js";
import { decodeOscMessage, encodeOscMessage } from "../src/core/osc.js";
import { M32OscClient } from "../src/core/osc-client.js";
import {
  assertShowModeAllows,
  coerceValue,
  planRestore,
  valuesEqual,
  writeAssignments,
  type M32Context,
} from "../src/core/write.js";

async function startFakeConsole(initial: Record<string, number | string> = {}) {
  const state = new Map<string, number | string>(Object.entries(initial));
  const refused = new Set<string>();
  const socket = dgram.createSocket("udp4");
  socket.on("message", (msg, rinfo) => {
    let decoded;
    try {
      decoded = decodeOscMessage(msg);
    } catch {
      return;
    }
    if (decoded.args.length === 0) {
      const value = state.get(decoded.address);
      if (value !== undefined) {
        const isFloat = /fader|pan/.test(decoded.address);
        socket.send(encodeOscMessage(decoded.address, [value], { forceFloat: isFloat }), rinfo.port, rinfo.address);
      }
      return;
    }
    const value = decoded.args[0];
    if (typeof value !== "number" && typeof value !== "string") return;
    if (refused.has(decoded.address)) {
      state.set(decoded.address, typeof value === "number" ? value + 0.25 : value + "X");
    } else {
      state.set(decoded.address, value);
    }
  });
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  const port = (socket.address() as AddressInfo).port;
  return {
    state,
    refused,
    port,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}

async function makeContext(port: number, tmp: string, showMode = false): Promise<{ ctx: M32Context; client: M32OscClient }> {
  const configPath = path.join(tmp, "config.json");
  const loaded = loadConfig(configPath);
  loaded.config.host = "127.0.0.1";
  loaded.config.port = port;
  loaded.config.showMode = showMode;
  const client = new M32OscClient({ host: "127.0.0.1", port, requestTimeoutMs: 300, batchTimeoutMs: 300 });
  return { ctx: { client, config: loaded.config, configPath, journal: new WriteJournal(configPath) }, client };
}

test("verified write reads back previous and stored values", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m32-test-"));
  const fake = await startFakeConsole({ "/ch/01/mix/fader": 0.5 });
  try {
    const { ctx, client } = await makeContext(fake.port, tmp);
    const batch = await writeAssignments(ctx, [{ path: "/ch/01/mix/fader", value: 0.75 }], { origin: "test" });
    assert.equal(batch.status, "OK");
    assert.equal(batch.ok, true);
    assert.equal(batch.results[0].previous, 0.5);
    assert.equal(batch.results[0].sent, 0.75);
    assert.equal(batch.results[0].stored, 0.75);
    assert.equal(batch.results[0].match, true);
    assert.equal(ctx.journal.history(1).length, 1);
    await client.close();
  } finally {
    await fake.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a console that stores something else reports MISMATCH, not success", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m32-test-"));
  const fake = await startFakeConsole({ "/ch/01/mix/on": 0 });
  fake.refused.add("/ch/01/mix/on");
  try {
    const { ctx, client } = await makeContext(fake.port, tmp);
    const batch = await writeAssignments(ctx, [{ path: "/ch/01/mix/on", value: 1 }], { origin: "test" });
    assert.equal(batch.status, "MISMATCH");
    assert.equal(batch.ok, false);
    assert.equal(batch.results[0].match, false);
    await client.close();
  } finally {
    await fake.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("dryRun never changes the console and journals nothing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m32-test-"));
  const fake = await startFakeConsole({ "/ch/01/config/name": "Old" });
  try {
    const { ctx, client } = await makeContext(fake.port, tmp);
    const batch = await writeAssignments(ctx, [{ path: "/ch/01/config/name", value: "New" }], { dryRun: true });
    assert.equal(batch.status, "DRY_RUN");
    assert.equal(batch.results[0].stored, null);
    assert.equal(fake.state.get("/ch/01/config/name"), "Old");
    assert.equal(ctx.journal.history(1).length, 0);
    await client.close();
  } finally {
    await fake.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("show mode blocks audible writes without confirm but allows cosmetic writes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m32-test-"));
  const fake = await startFakeConsole({ "/ch/01/mix/fader": 0.5, "/ch/01/config/name": "Old" });
  try {
    const { ctx, client } = await makeContext(fake.port, tmp, true);
    await assert.rejects(
      writeAssignments(ctx, [{ path: "/ch/01/mix/fader", value: 0.7 }]),
      /Show mode is ON/,
    );
    assert.equal(fake.state.get("/ch/01/mix/fader"), 0.5);
    const cosmetic = await writeAssignments(ctx, [{ path: "/ch/01/config/name", value: "Lead" }]);
    assert.equal(cosmetic.status, "OK");
    const confirmed = await writeAssignments(ctx, [{ path: "/ch/01/mix/fader", value: 0.7 }], { confirm: true });
    assert.equal(confirmed.status, "OK");
    assert.throws(() => assertShowModeAllows(ctx, ["/ch/01/mix/fader"]), /Show mode is ON/);
    await client.close();
  } finally {
    await fake.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("value coercion enforces types and ranges before any write", () => {
  const fader = resolvePath("/ch/01/mix/fader");
  assert.equal(coerceValue(fader, 0.75), 0.75);
  assert.throws(() => coerceValue(fader, 2), /between 0.0 and 1.0/);
  assert.throws(() => coerceValue(fader, "0.5"), /expects a finite number/);
  const on = resolvePath("/ch/01/mix/on");
  assert.throws(() => coerceValue(on, 2), /expects 0 \(off\) or 1 \(on\)/);
  assert.throws(() => coerceValue(on, 1.5), /expects an integer/);
  const name = resolvePath("/ch/01/config/name");
  assert.equal(coerceValue(name, ""), "");
  assert.throws(() => coerceValue(name, "x".repeat(17)), /at most 16 UTF-8 bytes/);
  assert.equal(valuesEqual(0.75, 0.7500001), true);
  assert.equal(valuesEqual(0.75, 0.76), false);
});

test("restore planning uses the first previous value and skips unknown ones", () => {
  const plan = planRestore([
    { path: "/ch/01/mix/fader", previous: 0.5, next: 0.7, audible: true },
    { path: "/ch/01/mix/fader", previous: 0.7, next: 0.8, audible: true },
    { path: "/ch/02/config/name", previous: null, next: "A", audible: false },
  ]);
  assert.deepEqual(plan.assignments, [{ path: "/ch/01/mix/fader", value: 0.5 }]);
  assert.deepEqual(plan.skipped, ["/ch/02/config/name"]);
});
