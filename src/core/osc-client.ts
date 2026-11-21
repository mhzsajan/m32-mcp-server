import dgram from "node:dgram";
import type { AddressInfo } from "node:net";
import { M32TimeoutError } from "./errors.js";
import { decodeOscMessage, encodeOscMessage, type DecodedOscMessage, type OscValue } from "./osc.js";
import type { LeafType } from "./nodes.js";

interface Exchange {
  expected: Set<string>;
  results: Map<string, DecodedOscMessage>;
  finish: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface M32OscClientOptions {
  host: string;
  port: number;
  requestTimeoutMs?: number;
  batchTimeoutMs?: number;
}

/**
 * One UDP socket, one request at a time. The M32 replies to the source port of
 * the request (there is no fixed reply port), and it does not ack SET messages,
 * so reads are correlated by the address echoed in the reply.
 */
export class M32OscClient {
  private socket: dgram.Socket;
  private ready: Promise<void>;
  private exchange: Exchange | null = null;
  private lock: Promise<void> = Promise.resolve();
  private lastActivityAt: number | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly requestTimeoutMs: number;
  private readonly batchTimeoutMs: number;

  constructor(options: M32OscClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1000;
    this.batchTimeoutMs = options.batchTimeoutMs ?? 500;
    this.socket = dgram.createSocket("udp4");
    this.socket.on("error", (err) => {
      // Stdout is reserved for the MCP protocol. Diagnostics go to stderr.
      process.stderr.write("m32-mcp-server: UDP socket error: " + err.message + "\n");
    });
    this.socket.on("message", (data) => this.onMessage(data));
    this.ready = new Promise<void>((resolve, reject) => {
      this.socket.once("error", reject);
      this.socket.bind(0, "0.0.0.0", () => {
        this.socket.removeListener("error", reject);
        resolve();
      });
    });
  }

  /** Ephemeral local UDP port the console replies to. */
  async localPort(): Promise<number> {
    await this.ready;
    return (this.socket.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    if (this.exchange) this.exchange.finish();
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }

  getLastActivityAt(): number | null {
    return this.lastActivityAt;
  }

  private onMessage(data: Buffer): void {
    let decoded: DecodedOscMessage;
    try {
      decoded = decodeOscMessage(data);
    } catch {
      return;
    }
    const active = this.exchange;
    if (!active || !active.expected.has(decoded.address) || active.results.has(decoded.address)) return;
    active.results.set(decoded.address, decoded);
    if (active.results.size === active.expected.size) active.finish();
  }

  private sendRaw(address: string, args: OscValue[], forceFloat: boolean): void {
    const buffer = encodeOscMessage(address, args, { forceFloat });
    this.socket.send(buffer, this.port, this.host);
    this.lastActivityAt = Date.now();
  }

  /** Serialize every operation so a reply can only belong to the current exchange. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private runExchange(addresses: string[], send: () => Promise<void>, timeoutMs: number): Promise<Map<string, DecodedOscMessage>> {
    return new Promise<Map<string, DecodedOscMessage>>((resolve, reject) => {
      const results = new Map<string, DecodedOscMessage>();
      let settled = false;
      const timer = setTimeout(() => finish(), timeoutMs);
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket.removeListener("message", onMessage);
        this.exchange = null;
        resolve(results);
      };
      const onMessage = (data: Buffer): void => this.onMessage(data);
      // Replace the persistent handler while an exchange is active so a late
      // reply from a previous request cannot be mistaken for the current one.
      this.socket.removeAllListeners("message");
      this.socket.on("message", onMessage);
      this.exchange = { expected: new Set(addresses), results, finish };
      send().catch((err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.socket.removeListener("message", onMessage);
          this.exchange = null;
          reject(err);
        }
      });
    });
  }

  /** Restore the persistent message handler after an exchange finishes. */
  private afterExchange(): void {
    this.socket.removeAllListeners("message");
    this.socket.on("message", (data) => this.onMessage(data));
  }

  async get(path: string, timeoutMs = this.requestTimeoutMs): Promise<DecodedOscMessage> {
    return this.withLock(async () => {
      await this.ready;
      const results = await this.runExchange([path], async () => this.sendRaw(path, [], false), timeoutMs);
      this.afterExchange();
      const message = results.get(path);
      if (!message) {
        throw new M32TimeoutError("No reply from the M32 for " + path + " within " + timeoutMs + " ms. Unknown paths do not answer.");
      }
      return message;
    });
  }

  /**
   * Read many leaves in one tool call. Queries are sent in small chunks because
   * the console drops packets when a very large burst arrives at once.
   */
  async getMany(paths: string[], timeoutMs = this.batchTimeoutMs): Promise<{ values: Map<string, DecodedOscMessage>; errors: Record<string, string> }> {
    const unique = [...new Set(paths)];
    if (unique.length === 0) return { values: new Map(), errors: {} };
    return this.withLock(async () => {
      await this.ready;
      const chunkSize = 10;
      const gapMs = 12;
      const hardDeadline = timeoutMs + Math.ceil(unique.length / chunkSize) * gapMs + 250;
      const results = await this.runExchange(
        unique,
        async () => {
          for (let i = 0; i < unique.length; i += chunkSize) {
            for (const path of unique.slice(i, i + chunkSize)) this.sendRaw(path, [], false);
            if (i + chunkSize < unique.length) await delay(gapMs);
          }
        },
        hardDeadline,
      );
      this.afterExchange();
      const errors: Record<string, string> = {};
      for (const path of unique) {
        if (!results.has(path)) errors[path] = "No reply within " + hardDeadline + " ms (unknown path or console busy)";
      }
      return { values: results, errors };
    });
  }

  /** Fire-and-forget SET. Callers verify with a separate get(). */
  async set(path: string, value: OscValue, type: LeafType): Promise<void> {
    return this.withLock(async () => {
      await this.ready;
      this.sendRaw(path, [value], type === "float");
    });
  }
}
