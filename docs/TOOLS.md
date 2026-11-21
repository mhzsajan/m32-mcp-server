# Midas M32 MCP Server - Tool Reference

All tools return a plain-text summary in `content` and a machine-readable object in `structuredContent`. Failures from the console are returned as tool results with `isError: true`, not as transport errors.

## m32_status

No arguments. Reads `/info` and `/status`, reports `reachable`, `host`, `port`, `localUdpPort`, `latencyMs`, `console` (protocol, server, model, firmware, state, ip, serial), `showMode`, `configPath`, `journalPath` and `writesThisSession`. If the console does not answer, `reachable` is false and `console` is null; no values are invented.

## m32_get

```json
{ "path": "/ch/01/mix/fader" }
```

Returns `value`, `args`, `types` (the OSC type tag string) and `valueType`. Any path starting with `/` is accepted; an unknown path produces a timeout error naming the path.

## m32_get_many

```json
{ "paths": ["/ch/01/config/name", "/ch/01/mix/fader", "/bus/13/config/name"] }
```

Accepts 1 to 200 paths. Replies are matched by address. Successful paths appear in `values` as `path -> value`; unanswered paths appear in `errors` with a reason. One bad path never fails the whole call.

## m32_list_names

```json
{ "includeEmpty": false }
```

Reads all 32 channels, 8 aux inputs, 16 buses, 6 matrices, 8 DCAs and main stereo name. Returns grouped arrays of `{index, path, name}` plus `errors`. `name` is null when the console did not answer.

## m32_dump

```json
{ "path": "/ch/01" }
```

Accepts one indexed strip root: `/ch/NN`, `/auxin/NN`, `/bus/NN`, `/mtx/NN`, `/dca/N`, `/main/st` or `/main/m`. Returns every known leaf under that strip as `suffix -> value` plus `errors`. Whole-namespace dumps (`/`, `/ch`) are refused.

## m32_set

```json
{ "path": "/ch/01/config/name", "value": "Lead Vox", "dryRun": false, "confirm": false }
```

Writes one leaf and reads it back. `value` is a number or string. Faders and pan must be floats between 0.0 and 1.0. On/off flags must be 0 or 1. Names are strings up to 16 UTF-8 bytes.

Returns `{path, results, status, ok, dryRun, batchId}` where each result is `{path, previous, sent, stored, match, audible, type, status}`. `status: "MISMATCH"` means the console stored something else. `isError` is set on a real failure or mismatch, not on a dry run.

## m32_bulk_set

```json
{
  "baseNode": "/ch/01",
  "assignments": { "config/name": "Lead Vox", "mix/fader": 0.75, "mix.on": 1 },
  "dryRun": false,
  "confirm": false
}
```

All keys must resolve under one strip. Keys may use `/` or `.` as separator. Every key is validated before any write; one invalid key refuses the batch. Returns the same verified result shape as `m32_set`, with `baseNode` included.

## m32_history

```json
{ "limit": 20 }
```

Lists recent write batches, newest first. Each batch has `batchId`, `startedAt`, `origin`, `session`, `entries` (with `previous`, `next`, `audible`), optional `undoneAt` and `undoOf`, plus a `thisSession` flag. Also reports `writesThisSession`.

## m32_undo

```json
{ "batchId": "b-...", "dryRun": false, "confirm": false }
```

`batchId` is optional; without it the most recent undone batch from this session is used. Restores every key to the value it held before that batch. Returns `undone`, `skipped` (keys whose previous value was unknown) and the verified write result. `dryRun` shows the plan without writing. The undo itself is journaled.

## m32_show_mode

```json
{ "on": true }
```

`on` is optional. With it, sets the persisted show mode and saves `data/config.json`. Without it, only reports the current value. When show mode is ON, audible writes (faders, pan, on/off, source) are refused unless the write passes `confirm: true`. Cosmetic writes (names, colors) remain allowed.

## m32_console_report

No arguments. Read-only snapshot: generated timestamp, host, port, `/info` and `/status` fields, show mode, `writesThisSession`, every strip's name/fader/on grouped by strip type, and `readErrors`. Nothing is written.
