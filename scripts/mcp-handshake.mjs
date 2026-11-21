// Raw MCP stdio smoke test: spawn the built CLI, send initialize and tools/list.
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/cli.js"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
});
let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on("data", (c) => process.stderr.write("[server] " + c.toString()));

function request(method, params) {
  const id = Math.floor(Math.random() * 100000);
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => reject(new Error("timeout waiting for " + method)), 8000);
  });
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0" },
  });
  console.log("initialize:", JSON.stringify(init.result?.serverInfo), "protocol", init.result?.protocolVersion);
  const list = await request("tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  console.log("tools:", names.length, names.join(", "));
  for (const name of ["m32_status", "m32_get"]) {
    const args = name === "m32_get" ? { path: "/ch/01/config/name" } : {};
    const call = await request("tools/call", { name, arguments: args });
    console.log(name + ":", JSON.stringify(call.result?.structuredContent ?? call.result?.content));
  }
} catch (err) {
  console.error("handshake failed:", err.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}
