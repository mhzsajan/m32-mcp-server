import assert from "node:assert/strict";
import test from "node:test";
import { expandRoot, KNOWN_LEAF_PATHS, leavesUnder, parseDumpRoot, resolvePath } from "../src/core/nodes.js";

test("index widths match the console: channels use 01, DCAs use 1", () => {
  assert.equal(expandRoot("ch", 1)[0], "/ch/01");
  assert.equal(expandRoot("dca", 1)[0], "/dca/1");
  assert.equal(expandRoot("mtx", 6)[0], "/mtx/06");
});

test("known leaves carry correct types and audible flags", () => {
  assert.deepEqual(
    { type: resolvePath("/ch/01/mix/fader").type, audible: resolvePath("/ch/01/mix/fader").audible },
    { type: "float", audible: true },
  );
  assert.equal(resolvePath("/ch/01/config/name").audible, false);
  assert.equal(resolvePath("/dca/3/fader").type, "float");
  assert.equal(resolvePath("/main/st/mix/pan").type, "float");
});

test("unverified paths are rejected with a useful hint", () => {
  assert.throws(() => resolvePath("/ch/01/mix/mute"), /Unsupported M32 leaf/);
  assert.throws(() => resolvePath("/fx/01/config/name"), /Unsupported M32 leaf/);
  assert.throws(() => resolvePath("/ch/1/mix/fader"), /Did you mean \/ch\/01\/mix\/fader/);
});

test("MTX has no pan leaf and bus has no source leaf", () => {
  assert.equal(KNOWN_LEAF_PATHS.includes("/mtx/01/mix/pan"), false);
  assert.equal(KNOWN_LEAF_PATHS.includes("/bus/01/config/source"), false);
});

test("dump roots accept only one strip", () => {
  assert.equal(parseDumpRoot("/ch/01").root.key, "ch");
  assert.equal(parseDumpRoot("/main/st").index, null);
  assert.throws(() => parseDumpRoot("/ch"), /indexed strip root/);
  assert.throws(() => parseDumpRoot("/"), /indexed strip root/);
});

test("leavesUnder returns every known leaf for a strip", () => {
  assert.equal(leavesUnder("/ch/01").length, 6);
  assert.equal(leavesUnder("/mtx/01").length, 4);
  assert.equal(leavesUnder("/dca/1").length, 4);
  assert.equal(leavesUnder("/main/st").length, 5);
});
