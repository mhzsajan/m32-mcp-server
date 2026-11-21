# Changelog

## 0.1.0 - 2026-11-21

First local build. No release has been published.

- Independent MCP server for the Midas M32 at 192.168.1.10:10023.
- 11 tools: status, get, get many, list names, dump, verified set, verified bulk set, history, undo, show mode and read-only console report.
- Verified writes with previous/sent/stored/match and explicit MISMATCH status.
- Local journal with undo, dry run and a persisted show-mode gate for audible writes.
- In-house OSC codec so fader and pan values are always sent with `,f` tags.
- Live read and cosmetic write verification against the real console.
- ASCII-only English documentation. No credentials in the repo.
