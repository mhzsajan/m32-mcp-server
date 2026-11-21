#!/usr/bin/env node
// Midas M32 MCP Server entry point. stdio is the only transport: this is a setup and
// diagnostic tool, not a show-time dependency. Stdout is reserved for MCP.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const USAGE = `${SERVER_NAME} v${SERVER_VERSION}

Usage
  midas-m32-mcp-server [options]

Options
  -h, --help             Show this help and exit.
  -v, --version          Print the version and exit.
      --config <path>    Config file to use (M32_CONFIG_PATH). Default ./data/config.json.
      --host <host>      Console IP, first boot only (M32_HOST).
      --port <port>      Console OSC port, first boot only (M32_PORT). Default 10023.

Environment
  M32_HOST, M32_PORT, M32_CONFIG_PATH. Host/port seed a missing config file only;
  later the persisted config file is the source of truth.

Notes
  The console answers OSC on UDP 10023 and replies to the request's source port.
  There is no authentication and no secret in this server.
`;

function fail(message: string): never {
  process.stderr.write(SERVER_NAME + ": " + message + "\n");
  process.exit(2);
}

function packageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return SERVER_VERSION;
  }
}

function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        config: { type: "string" },
        host: { type: "string" },
        port: { type: "string" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    fail((err as Error).message);
  }
  const { values } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return Promise.resolve();
  }
  if (values.version) {
    process.stdout.write(packageVersion() + "\n");
    return Promise.resolve();
  }
  if (values.config !== undefined) process.env.M32_CONFIG_PATH = values.config;
  if (values.host !== undefined) process.env.M32_HOST = values.host;
  if (values.port !== undefined) process.env.M32_PORT = values.port;
  return runServer({ configPath: values.config });
}

await main();
