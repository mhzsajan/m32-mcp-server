import assert from "node:assert/strict";
import test from "node:test";
import { decodeOscMessage, encodeOscMessage } from "../src/core/osc.js";

test("OSC address and type tag are padded to 4-byte boundaries", () => {
  const buf = encodeOscMessage("/info");
  assert.equal(buf.length % 4, 0);
  assert.equal(buf.subarray(0, 8).toString(), "/info\0\0\0");
  assert.equal(buf.subarray(8, 12).toString(), ",\0\0\0");
});

test("integer argument uses ,i and round-trips", () => {
  const decoded = decodeOscMessage(encodeOscMessage("/ch/01/mix/on", [1]));
  assert.equal(decoded.address, "/ch/01/mix/on");
  assert.equal(decoded.types, ",i");
  assert.deepEqual(decoded.args, [1]);
});

test("forceFloat sends fader values with ,f even when the number is integral", () => {
  const decoded = decodeOscMessage(encodeOscMessage("/ch/01/mix/fader", [1], { forceFloat: true }));
  assert.equal(decoded.types, ",f");
  assert.deepEqual(decoded.args, [1]);
});

test("string arguments round-trip including padded names", () => {
  const decoded = decodeOscMessage(encodeOscMessage("/ch/01/config/name", ["Lead Vox"]));
  assert.equal(decoded.types, ",s");
  assert.deepEqual(decoded.args, ["Lead Vox"]);
});

test("multi-argument replies such as /info are preserved", () => {
  const decoded = decodeOscMessage(encodeOscMessage("/info", ["V2.07", "osc-server", "M32", "4.13"]));
  assert.deepEqual(decoded.args, ["V2.07", "osc-server", "M32", "4.13"]);
});
