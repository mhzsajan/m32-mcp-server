import { M32ValueError } from "./errors.js";

/** Value types that the M32 accepts on a leaf. Numeric types set the OSC type tag. */
export type LeafType = "float" | "int" | "string";

export interface LeafDef {
  /** Path suffix below the strip base, e.g. "mix/fader". */
  suffix: string;
  type: LeafType;
  /** True when writing this leaf can change the sound. Names and colors are cosmetic. */
  audible: boolean;
}

export interface RootDef {
  key: string;
  /** Strip base without a trailing slash, e.g. "/ch/01" or "/main/st". */
  base: string;
  indexed: boolean;
  first: number;
  last: number;
  /** Number of digits in an index ("01" for channels, "1" for DCAs). */
  width: number;
  leaves: LeafDef[];
}

const NAME: LeafDef = { suffix: "config/name", type: "string", audible: false };
const COLOR: LeafDef = { suffix: "config/color", type: "int", audible: false };
const SOURCE: LeafDef = { suffix: "config/source", type: "int", audible: true };
const FADER: LeafDef = { suffix: "mix/fader", type: "float", audible: true };
const ON: LeafDef = { suffix: "mix/on", type: "int", audible: true };
const PAN: LeafDef = { suffix: "mix/pan", type: "float", audible: true };
const DCA_FADER: LeafDef = { suffix: "fader", type: "float", audible: true };
const DCA_ON: LeafDef = { suffix: "on", type: "int", audible: true };

/**
 * Leaf catalog. Every entry below was answered by a live GET against
 * 192.168.1.10:10023 on 2026-11-21. Paths that did not answer (for example
 * /ch/01/mix/mute, /mtx/01/mix/pan or any scene/snapshot path) are NOT listed.
 */
export const ROOTS: RootDef[] = [
  { key: "ch", base: "/ch", indexed: true, first: 1, last: 32, width: 2, leaves: [NAME, SOURCE, COLOR, FADER, ON, PAN] },
  { key: "auxin", base: "/auxin", indexed: true, first: 1, last: 8, width: 2, leaves: [NAME, SOURCE, COLOR, FADER, ON, PAN] },
  { key: "bus", base: "/bus", indexed: true, first: 1, last: 16, width: 2, leaves: [NAME, COLOR, FADER, ON, PAN] },
  { key: "mtx", base: "/mtx", indexed: true, first: 1, last: 6, width: 2, leaves: [NAME, COLOR, FADER, ON] },
  { key: "dca", base: "/dca", indexed: true, first: 1, last: 8, width: 1, leaves: [NAME, COLOR, DCA_FADER, DCA_ON] },
  { key: "main.st", base: "/main/st", indexed: false, first: 1, last: 1, width: 0, leaves: [NAME, COLOR, FADER, ON, PAN] },
  { key: "main.m", base: "/main/m", indexed: false, first: 1, last: 1, width: 0, leaves: [NAME, FADER, ON] },
];

export interface ResolvedLeaf extends LeafDef {
  path: string;
  rootKey: string;
  index: number | null;
}

function padIndex(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function baseFor(root: RootDef, index: number): string {
  return root.indexed ? root.base + "/" + padIndex(index, root.width) : root.base;
}

const BY_PATH = new Map<string, ResolvedLeaf>();

for (const root of ROOTS) {
  const last = root.indexed ? root.last : 1;
  for (let i = root.first; i <= last; i++) {
    const base = baseFor(root, i);
    for (const leaf of root.leaves) {
      const path = base + "/" + leaf.suffix;
      BY_PATH.set(path, { ...leaf, path, rootKey: root.key, index: root.indexed ? i : null });
    }
  }
}

export const KNOWN_LEAF_PATHS: readonly string[] = [...BY_PATH.keys()];

export function rootByKey(key: string): RootDef | undefined {
  return ROOTS.find((r) => r.key === key);
}

/** All strip bases for a root (or one base when an index is supplied). */
export function expandRoot(key: string, index?: number): string[] {
  const root = rootByKey(key);
  if (!root) {
    throw new M32ValueError("Unknown root '" + key + "'. Known roots: " + ROOTS.map((r) => r.key).join(", "));
  }
  if (!root.indexed) return [root.base];
  if (index !== undefined) {
    if (!Number.isInteger(index) || index < root.first || index > root.last) {
      throw new M32ValueError("Index " + index + " is out of range for " + key + " (" + root.first + "-" + root.last + ")");
    }
    return [baseFor(root, index)];
  }
  const out: string[] = [];
  for (let i = root.first; i <= root.last; i++) out.push(baseFor(root, i));
  return out;
}

/** Leaf definitions under a strip base, in catalog order. */
export function leavesUnder(base: string): ResolvedLeaf[] {
  const prefix = base.replace(/\/$/, "") + "/";
  return KNOWN_LEAF_PATHS.filter((p) => p.startsWith(prefix)).map((p) => BY_PATH.get(p) as ResolvedLeaf);
}

/** Resolve a canonical leaf path, or fail with a useful hint. */
export function resolvePath(path: string): ResolvedLeaf {
  const found = BY_PATH.get(path);
  if (found) return found;
  const trimmed = path.replace(/\/+$/, "");
  const alternate = trimmed.length !== path.length ? BY_PATH.get(trimmed) : undefined;
  if (alternate) return alternate;
  // A common mistake is the wrong index width, e.g. /ch/1 instead of /ch/01.
  const parts = trimmed.split("/");
  let hint = "";
  if (parts.length >= 4 && rootByKey(parts[1])) {
    const root = rootByKey(parts[1]);
    if (root && root.indexed && /^\d+$/.test(parts[2])) {
      const n = Number(parts[2]);
      if (n >= root.first && n <= root.last) {
        const guess = baseFor(root, n) + "/" + parts.slice(3).join("/");
        if (BY_PATH.has(guess)) hint = " Did you mean " + guess + "?";
      }
    }
  }
  throw new M32ValueError("Unsupported M32 leaf '" + path + "'." + hint);
}

/** Parse a dump root such as /ch/01 or /main/st into its root key and optional index. */
export function parseDumpRoot(path: string): { root: RootDef; index: number | null } {
  const trimmed = path.replace(/\/+$/, "");
  const byBase = ROOTS.find((r) => r.base === trimmed && !r.indexed);
  if (byBase) return { root: byBase, index: null };
  for (const root of ROOTS) {
    if (!root.indexed) continue;
    const match = new RegExp("^" + root.base.replace("/", "\\/") + "\\/(\\d+)$").exec(trimmed);
    if (!match) continue;
    const n = Number(match[1]);
    if (n >= root.first && n <= root.last) return { root, index: n };
  }
  throw new M32ValueError(
    "m32_dump accepts one indexed strip root, e.g. /ch/01, /auxin/01, /bus/01, /mtx/01, /dca/1, /main/st or /main/m. Got '" + path + "'.",
  );
}
