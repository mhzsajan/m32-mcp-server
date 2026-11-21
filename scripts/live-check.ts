/**
 * Manual live check against the real M32.
 *   npm run live:check                 read-only, safe during a show
 *   npm run live:check -- --write-test cosmetic name round trip + restore
 *
 * The write test only touches /ch/01/config/name and restores its original
 * value. It does not move a fader or change a mute.
 */
import path from "node:path";
import { loadConfig } from "../src/core/config.js";
import { WriteJournal } from "../src/core/journal.js";
import { M32OscClient } from "../src/core/osc-client.js";
import { KNOWN_LEAF_PATHS } from "../src/core/nodes.js";
import { writeAssignments } from "../src/core/write.js";

const args = new Set(process.argv.slice(2));
const doWriteTest = args.has("--write-test");
const configPath = process.env.M32_CONFIG_PATH || path.resolve(process.cwd(), "data", "config.json");
const loaded = loadConfig(configPath);
const client = new M32OscClient({
  host: loaded.config.host,
  port: loaded.config.port,
  requestTimeoutMs: loaded.config.requestTimeoutMs,
  batchTimeoutMs: loaded.config.batchTimeoutMs,
});

function show(label: string, value: unknown): void {
  process.stdout.write(label + ": " + JSON.stringify(value) + "\n");
}

async function main(): Promise<void> {
  show("config", { host: loaded.config.host, port: loaded.config.port, showMode: loaded.config.showMode });
  show("info", (await client.get("/info")).args);
  show("status", (await client.get("/status")).args);

  const samples = ["/ch/01/config/name", "/ch/01/mix/fader", "/ch/01/mix/on", "/ch/01/mix/pan",
    "/bus/13/config/name", "/dca/1/fader", "/main/st/mix/fader"].filter((p) => KNOWN_LEAF_PATHS.includes(p));
  const { values, errors } = await client.getMany(samples);
  for (const p of samples) show(p, values.get(p)?.args ?? "NO REPLY");
  show("readErrors", errors);

  const big = await client.getMany(KNOWN_LEAF_PATHS.slice(0, 120));
  show("bulkRead", { answered: big.values.size, of: 120, errors: Object.keys(big.errors).length });

  if (doWriteTest) {
    const journal = new WriteJournal(loaded.filePath);
    const ctx = { client, config: loaded.config, configPath: loaded.filePath, journal };
    const original = (await client.get("/ch/01/config/name")).args[0] as string;
    const changed = await writeAssignments(ctx, [{ path: "/ch/01/config/name", value: "MCP-TEST" }], { origin: "live-check" });
    show("writeTestChanged", changed.results[0]);
    const restored = await writeAssignments(ctx, [{ path: "/ch/01/config/name", value: original }], { origin: "live-check-restore" });
    show("writeTestRestored", restored.results[0]);
    show("writeTestFinal", (await client.get("/ch/01/config/name")).args[0]);
  } else {
    show("writeTest", "skipped (pass --write-test to run the cosmetic name round trip)");
  }
}

try {
  await main();
} catch (err) {
  process.stderr.write("live-check failed: " + (err as Error).message + "\n");
  process.exitCode = 1;
} finally {
  await client.close();
}
