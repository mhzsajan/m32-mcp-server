import fs from "node:fs";
import path from "node:path";
import { M32Error } from "./errors.js";

export interface M32Config {
  version: 1;
  host: string;
  port: number;
  showMode: boolean;
  requestTimeoutMs: number;
  batchTimeoutMs: number;
}

export interface LoadedConfig {
  config: M32Config;
  filePath: string;
  created: boolean;
}

export function defaultConfigPath(): string {
  return process.env.M32_CONFIG_PATH || path.resolve(process.cwd(), "data", "config.json");
}

function seedFromEnv(): M32Config {
  const rawPort = process.env.M32_PORT || "10023";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new M32Error("M32_PORT must be an integer between 1 and 65535 (got " + rawPort + ")");
  }
  return {
    version: 1,
    host: process.env.M32_HOST || "192.168.1.10",
    port,
    showMode: false,
    requestTimeoutMs: 1000,
    batchTimeoutMs: 500,
  };
}

function coerce(raw: Partial<M32Config>, fallback: M32Config): M32Config {
  const port = Number(raw.port ?? fallback.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new M32Error("Persisted config has an invalid port: " + String(raw.port));
  }
  return {
    version: 1,
    host: typeof raw.host === "string" && raw.host.length > 0 ? raw.host : fallback.host,
    port,
    showMode: Boolean(raw.showMode),
    requestTimeoutMs: Number.isFinite(raw.requestTimeoutMs) ? Number(raw.requestTimeoutMs) : fallback.requestTimeoutMs,
    batchTimeoutMs: Number.isFinite(raw.batchTimeoutMs) ? Number(raw.batchTimeoutMs) : fallback.batchTimeoutMs,
  };
}

/** Load persisted config. Host/port environment variables seed a missing file only. */
export function loadConfig(filePath = defaultConfigPath()): LoadedConfig {
  const resolved = path.resolve(filePath);
  const seeds = seedFromEnv();
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(seeds, null, 2) + "\n", "utf8");
    return { config: seeds, filePath: resolved, created: true };
  }
  let parsed: Partial<M32Config>;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as Partial<M32Config>;
  } catch (err) {
    throw new M32Error("Cannot read config file " + resolved + ": " + (err as Error).message);
  }
  return { config: coerce(parsed, seeds), filePath: resolved, created: false };
}

export function saveConfig(filePath: string, config: M32Config): void {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = resolved + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, resolved);
}
