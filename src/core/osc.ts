/**
 * Minimal OSC 1.0 encoder/decoder for the X32/M32 UDP protocol.
 *
 * Only the argument types the M32 actually uses are supported:
 *   i = 32-bit signed integer (mute flags, colors, source selection)
 *   f = 32-bit IEEE float (faders, pan)
 *   s = null-terminated string (names, /info, /status)
 *
 * The M32 does not send acknowledgements for SET messages. Verification is
 * always a separate GET of the same address (see write.ts).
 */

export type OscValue = number | string;

export interface DecodedOscMessage {
  address: string;
  args: (number | string)[];
  types: string;
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/** OSC string: UTF-8 bytes, one or more NUL bytes, padded to a 4-byte boundary. */
function encodeString(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  const total = body.length + 1 + pad4(body.length + 1);
  const out = Buffer.alloc(total, 0);
  body.copy(out, 0);
  return out;
}

/** Determine the OSC type tag and 4-byte value block for one argument. */
function encodeArg(value: OscValue, forceFloat: boolean): { tag: string; data: Buffer } {
  if (typeof value === "string") {
    return { tag: "s", data: encodeString(value) };
  }
  if (!Number.isFinite(value)) {
    throw new Error("OSC numeric argument must be finite");
  }
  if (forceFloat) {
    const data = Buffer.alloc(4);
    data.writeFloatBE(value, 0);
    return { tag: "f", data };
  }
  if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
    const data = Buffer.alloc(4);
    data.writeInt32BE(value, 0);
    return { tag: "i", data };
  }
  const data = Buffer.alloc(4);
  data.writeFloatBE(value, 0);
  return { tag: "f", data };
}

export interface EncodeOptions {
  /** Force all numeric arguments to ,f. M32 faders silently ignore ,i. */
  forceFloat?: boolean;
}

export function encodeOscMessage(address: string, args: OscValue[] = [], options: EncodeOptions = {}): Buffer {
  if (!address.startsWith("/")) {
    throw new Error("OSC address must start with /");
  }
  const encoded = args.map((arg) => encodeArg(arg, Boolean(options.forceFloat)));
  const tags = "," + encoded.map((e) => e.tag).join("");
  return Buffer.concat([encodeString(address), encodeString(tags), ...encoded.map((e) => e.data)]);
}

function readString(data: Buffer, offset: number): { value: string; next: number } {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  if (end >= data.length) {
    throw new Error("Truncated OSC string");
  }
  const value = data.subarray(offset, end).toString("utf8");
  const next = offset + 4 * Math.ceil((end - offset + 1) / 4);
  return { value, next };
}

export function decodeOscMessage(data: Buffer): DecodedOscMessage {
  const addressPart = readString(data, 0);
  const tagPart = readString(data, addressPart.next);
  if (!tagPart.value.startsWith(",")) {
    throw new Error("Invalid OSC type tag string");
  }
  let pos = tagPart.next;
  const args: (number | string)[] = [];
  for (const tag of tagPart.value.slice(1)) {
    if (tag === "i") {
      args.push(data.readInt32BE(pos));
      pos += 4;
    } else if (tag === "f") {
      args.push(data.readFloatBE(pos));
      pos += 4;
    } else if (tag === "s") {
      const part = readString(data, pos);
      args.push(part.value);
      pos = part.next;
    } else if (tag === "T" || tag === "F" || tag === "N") {
      // True / False / Null carry no bytes. Map to the closest plain value.
      args.push(tag === "T" ? 1 : 0);
    } else {
      throw new Error("Unsupported OSC type tag: " + tag);
    }
  }
  return { address: addressPart.value, args, types: tagPart.value };
}
