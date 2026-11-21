# M32 MCP Server

A small, independent MCP server for the Midas M32 digital mixing console.

It is a **setup and diagnostic tool**. It is not part of the live show signal path. The show must keep working with the console front panel and existing phone canvases even if this server, AI, MCP or the internet are unavailable.

## Why this exists

The show already has a WING MCP server for the Behringer WING at `192.168.1.3`. This repo is a separate server for the Midas M32 at `192.168.1.10`. It does not touch the WING server, AbleBridgePlus, the live Ableton project or any show files.

Design rules, copied from the WING server's good habits:

- Read first, be honest about failures. A path that does not answer is reported as an error, never filled in with a made-up value.
- Verified writes. Every write is read back and reported as `{previous, sent, stored, match}` with an explicit `MISMATCH` status.
- Journal and undo. Every non-dry write is recorded locally; `m32_history` and `m32_undo` restore earlier values.
- `dryRun` on both writing tools. Audible writes are marked.
- Show mode. A persisted safety gate refuses audible writes unless `confirm: true` is passed.
- Local only. No cloud calls, no credentials, no authentication token, no dashboards.

## Requirements

- Node.js 22.6 or newer (tested with v24.19.0).
- Network access from this machine to the M32 at `192.168.1.10`, UDP port `10023`.

The M32 does **not** answer OSC on port 8000. Port 8000 silently ignores requests. Use 10023 (the X32-Edit protocol port). The console replies to the source port of each request, so the server keeps one UDP socket open.

## Install and run

```powershell
cd C:\Users\Admin\Documents\m32-mcp-server
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npm.cmd" run typecheck
& "C:\Program Files\nodejs\npm.cmd" test
```

Run the server manually over stdio:

```powershell
& "C:\Program Files\nodejs\node.exe" dist\cli.js
```

Register it with OpenCode by adding a `m32` entry to the flat `mcp` map in `C:\Users\Admin\.config\opencode\opencode.jsonc`:

```jsonc
"m32": {
  "type": "local",
  "command": [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Users\\Admin\\Documents\\m32-mcp-server\\dist\\cli.js"
  ],
  "enabled": true,
  "timeout": 30000
}
```

A full OpenCode restart is the reliable way to load a new MCP server.

## Configuration

On first boot the server writes `data/config.json`. The `M32_HOST` and `M32_PORT` environment variables seed that file only; later changes go in the JSON file or through `m32_show_mode`. Environment edits after first boot are ignored, matching the WING server's behaviour.

```json
{
  "version": 1,
  "host": "192.168.1.10",
  "port": 10023,
  "showMode": false,
  "requestTimeoutMs": 1000,
  "batchTimeoutMs": 500
}
```

`data/config.json` and `data/journal.json` are gitignored. No secret or password is stored anywhere in this repo.

CLI options: `--help`, `--version`, `--config <path>`, `--host <host>`, `--port <port>`.

## Tools

| Tool | Purpose |
| --- | --- |
| `m32_status` | Live health check: `/info`, `/status`, latency, show mode, journal counts. |
| `m32_get` | Read one OSC leaf, typed value. |
| `m32_get_many` | Read up to 200 leaves in one call; failed paths reported under `errors`. |
| `m32_list_names` | All channel, aux, bus, matrix, DCA and main names. |
| `m32_dump` | Every known leaf under one indexed strip. |
| `m32_set` | Verified single write with `dryRun` and show-mode gate. |
| `m32_bulk_set` | Verified writes to several keys under one strip. |
| `m32_history` | Recent write batches with previous and next values. |
| `m32_undo` | Restore a batch to its previous values. |
| `m32_show_mode` | Read or change the persisted audible-write gate. |
| `m32_console_report` | Read-only snapshot for handoff or diagnosis. |

Full schemas and examples are in [docs/TOOLS.md](docs/TOOLS.md). Verified OSC paths and protocol notes are in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Safety in practice

Before a show:

1. Call `m32_show_mode({on: true})`. Audible writes then require `confirm: true`.
2. Use `m32_set(..., {dryRun: true})` to preview any change.
3. After any audible change, check `m32_history` so you know what to undo.

`m32_undo` restores the values captured before a batch. Undoing an old batch can overwrite changes made since then, so read `m32_history` first.

Cosmetic writes (names, colors) are never blocked by show mode. Audible writes (faders, pan, on/off, input source) are.

## Verified behaviour

Live checks against the real console on 2026-11-21:

- `/info` returned `V2.07, osc-server, M32, 4.13`.
- `/status` returned `active, 192.168.1.10, M32-08-C9-80`.
- A 120-path bulk read answered 120 of 120 with 0 errors.
- A cosmetic name write reported `previous: "", sent: "MCP-TEST", stored: "MCP-TEST", match: true, status: OK`, then was restored to empty with the same verified result. No fader or mute was changed.
- MCP stdio handshake returned 11 tools; `m32_status` and `m32_get` returned real console data.

## Limits and honest gaps

- Scene and snapshot recall paths were not found on this firmware. No scene tool is provided.
- Metering/level tools are not implemented.
- `/fx/NN/...` does not answer. FX are buses 13 to 16, named `Fx 1` to `Fx 4`.
- Only the leaves listed in `docs/PROTOCOL.md` are writable. Unsupported paths are refused before any write.
- The M32 applies a SET asynchronously (around 20 ms), so verification retries a few reads before declaring a mismatch.
- This server has no HTTP interface, no dashboard and no remote access. That is deliberate.

## Development

```powershell
& "C:\Program Files\nodejs\npm.cmd" run typecheck
& "C:\Program Files\nodejs\npm.cmd" test
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\node.exe" scripts\mcp-handshake.mjs
```

`npm run live:check` performs read-only checks against the configured console. Add `-- --write-test` for the cosmetic name round trip and restore.

## Credits and license

The architecture and safety habits were modeled on `bawaaaaah/wing-mcp-server` (MIT). No code was copied from that project. This implementation is independent and MIT licensed; see [LICENSE](LICENSE).
