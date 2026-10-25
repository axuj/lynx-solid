# Device selftest — 24117RK2CC (Android SDK 36)

- date: 2026-10-10T15:59:53.476Z
- label: 2026-10-10T15-59-42
- bundle: `http://192.168.3.91:4200/selftest.lynx.bundle`
- open → content (heartbeat): **415 ms** (explorer cold start + LAN fetch + BG eval + render + IPC apply)
- page-internal rendered mark: 51 ms (BG module eval → mount settled)
- adb input injection: available

| case | result | detail | ms |
|---|---|---|---|
| bg-bare-settimeout | PASS | fired; globalThis.setTimeout=undefined | 10 |
| bg-timer-args-observe | PASS | fired; args(2)=["null","0"] | 11 |
| mt-queue-microtask-guard | PASS | bare before=function, after guard install=function | 0 |
| template-static-render | PASS | mounted in 51.0ms | 1 |
| unmount-oncleanup | PASS | fired | 0 |
| sign-event-bindtap | PASS | tap received, counter=1 | 1212 |

0 failed, 0 skipped, 6 passed.
