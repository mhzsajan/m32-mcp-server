# M32 OSC protocol notes

All facts below were verified by live reads against the console at `192.168.1.10`, UDP port `10023`, on 2026-11-21. Anything not observed is marked as unsupported; nothing is guessed.

## Transport

- Console IP: `192.168.1.10`, OSC UDP port `10023`.
- Port 8000 silently ignores requests. Do not use it.
- A GET is an OSC message with the path as address and no arguments.
- The console replies to the **source port of the request**. There is no fixed reply port. The server binds one ephemeral UDP socket and keeps it open.
- The console does not acknowledge SET messages. Writes are verified by a separate GET of the same address.
- The console applies a SET asynchronously, roughly 20 ms. The write layer waits 40 ms and retries up to six reads before reporting `MISMATCH`.
- Large bursts of queries get dropped. `m32_get_many` sends queries in chunks of 10 with a 12 ms gap and matches replies by the echoed address.

## Identity

GET `/info` returns four strings:

```text
V2.07, osc-server, M32, 4.13
```

GET `/status` returns three strings:

```text
active, 192.168.1.10, M32-08-C9-80
```

## Numeric types

| Kind | OSC tag | Range | Notes |
| --- | --- | --- | --- |
| Fader | `,f` float | 0.0 to 1.0 | About 0.75 is 0 dB; 0.0 is minus infinity. Integer arguments are ignored by the console. |
| Pan | `,f` float | 0.0 to 1.0 | 0.5 is center. |
| On / mute flag | `,i` integer | 0 or 1 | 1 is on/unmuted, 0 is off/muted. |
| Color / source | `,i` integer | console enum | Refuse to guess enum ranges; read the current value first. |
| Name | `,s` string | up to 16 UTF-8 bytes | Empty string clears the name. |

## Verified leaf map

Index formatting matters. Channels, aux inputs, buses and matrices use two digits (`/ch/01`, `/bus/13`). DCAs use one digit (`/dca/1`).

| Root | Indexes | Leaves that answer |
| --- | --- | --- |
| `/ch/NN` | 01 to 32 | `config/name`, `config/source`, `config/color`, `mix/fader`, `mix/on`, `mix/pan` |
| `/auxin/NN` | 01 to 08 | `config/name`, `config/source`, `config/color`, `mix/fader`, `mix/on`, `mix/pan` |
| `/bus/NN` | 01 to 16 | `config/name`, `config/color`, `mix/fader`, `mix/on`, `mix/pan` |
| `/mtx/NN` | 01 to 06 | `config/name`, `config/color`, `mix/fader`, `mix/on` |
| `/dca/N` | 1 to 8 | `config/name`, `config/color`, `fader`, `on` |
| `/main/st` | fixed | `config/name`, `config/color`, `mix/fader`, `mix/on`, `mix/pan` |
| `/main/m` | fixed | `config/name`, `mix/fader`, `mix/on` |

Note the unusual DCA paths: `/dca/1/fader` and `/dca/1/on`, not `/dca/1/mix/fader`.

FX are buses 13 to 16, named `Fx 1` to `Fx 4`. `/fx/NN/...` does not respond.

## Paths that did not answer

These were probed and are intentionally not supported:

- `/ch/01/mix/mute`, `/ch/01/mix/solo`, `/ch/01/config/input`.
- `/mtx/01/mix/pan`, `/bus/01/config/source`.
- `/dca/1/mix/fader`, `/dca/1/mix/on`, `/dca/01/fader`.
- All scene and snapshot candidates tried: `/scene/00/name`, `/scene/0/name`, `/snap/00/name`, `/-snap/name/0`, `/-snap/current`, `/$ctl/lib/$active`, `/$ctl/lib/$scenes`, `/$ctl/scene/active`.
- `/xremote`, `/*`, `/meters`, `/grp/01/config/name`.

Because scene and snapshot paths were not found, this server provides no scene recall tool. A read that does not answer always becomes an error entry, never a fabricated value.

## Verification model

`m32_set` and `m32_bulk_set` do the following:

1. Resolve every path against the leaf map and coerce its value to the correct OSC type. A single bad key refuses the whole batch.
2. If show mode is on and any leaf is audible, require `confirm: true`.
3. Read all keys before the write (these are the `previous` values).
4. Send the SET messages. In `dryRun` mode stop here.
5. Read all keys again, with the settle-and-retry described above.
6. Report `{previous, sent, stored, match, audible, type, status}` per key. `status` is `OK`, `MISMATCH` or `DRY_RUN`.
7. Journal the batch unless it was a dry run.

`m32_undo` restores the first `previous` value of each key in a batch. A key whose previous value was unreadable is skipped and reported.
