# Examples sweep — real device runtime (breadth axis)

- date: 2026-10-10T15:56:44.628Z
- device: 24117RK2CC (Android SDK 36), serial 192.168.3.119:40663
- reps: 3 (cold open each), channel: auto, timeout 7000ms
- method: cold open per rep (force-stop → lynx://open) — open→content includes Explorer cold start + LAN fetch + BG eval + render; primary = logcat milestone when present, else PNG content-score transition; no browser involved
- related: bundle sizes in examples-sweep.md; reference: vue-lynx-vapor examples-sweep (its on-device traces were left as next step — this is that step)
| example | entry | open→content ms | channel | logcat | screencap | lynx gzip | status | errors | notes |
|---|---|---|---|---|---|---|---|---|---|
| 7guis | cells.lynx.bundle | 340 | logcat | 340 | 1235 | 40824 | ok | — | — |
| 7guis | circle-drawer.lynx.bundle | 346 | logcat | 346 | 1189 | 35013 | ok | — | — |
| 7guis | counter.lynx.bundle | 334 | logcat | 334 | 1207 | 31694 | ok | — | — |
| 7guis | crud.lynx.bundle | 356 | logcat | 356 | 1252 | 33906 | ok | — | — |
| 7guis | flight-booker.lynx.bundle | 378 | logcat | 378 | 1164 | 32469 | ok | — | — |
| 7guis | temperature-converter.lynx.bundle | 316 | logcat | 316 | 1163 | 31645 | ok | — | — |
| 7guis | timer.lynx.bundle | 320 | logcat | 320 | 1259 | 32307 | ok | — | — |
| bench-table-react | main.lynx.bundle | 323 | logcat | 323 | 1275 | 40334 | ok | — | — |
| bench-table | main.lynx.bundle | 321 | logcat | 321 | 1260 | 41896 | ok | — | — |
| counter | counter.lynx.bundle | 309 | logcat | 309 | 1252 | 31715 | ok | — | — |
| device-lab | selftest.lynx.bundle | 331 | logcat | 331 | 1227 | 35481 | ok | — | — |
| elk | elk.lynx.bundle | 412 | logcat | 412 | 1210 | 138170 | ok | — | — |
| hackernews | hackernews.lynx.bundle | 410 | logcat | 410 | 1273 | 80424 | ok | — | — |
| main-thread-draggable | main-thread-draggable.lynx.bundle | 355 | logcat | 355 | 1271 | 32310 | ok | — | — |
| mini-pure | mini.lynx.bundle | 313 | logcat | 313 | — | 15079 | ok | — | ⚠ logcat milestone only, no visual confirmation |
| motion | basic.lynx.bundle | 356 | logcat | 356 | 1238 | 83971 | ok | — | — |
| motion | gesture.lynx.bundle | 403 | logcat | 403 | 1209 | 81672 | ok | — | — |
| motion | motion-value.lynx.bundle | 309 | logcat | 309 | 1325 | 81026 | ok | — | — |
| motion | spring.lynx.bundle | 479 | logcat | 479 | 1455 | 83997 | ok | — | — |
| networking | networking.lynx.bundle | 357 | logcat | 357 | 1240 | 35030 | ok | — | — |
| raw-lynx | raw.lynx.bundle | 418 | logcat | 418 | 1244 | 8001 | ok | — | — |
| scrolling | ListBasic.lynx.bundle | 321 | logcat | 321 | 1318 | 33878 | ok | — | — |
| scrolling | ListFilter.lynx.bundle | 475 | logcat | 475 | 1366 | 34477 | ok | — | — |
| scrolling | ListInfinite.lynx.bundle | 393 | logcat | 393 | 1422 | 34653 | ok | — | — |
| scrolling | ListPrepend.lynx.bundle | 358 | logcat | 358 | 1416 | 34916 | ok | — | — |
| scrolling | ListRemove.lynx.bundle | 343 | logcat | 343 | 1314 | 34640 | ok | — | — |
| scrolling | ListReorder.lynx.bundle | 449 | logcat | 449 | 1373 | 34861 | ok | — | — |
| scrolling | ListWaterfall.lynx.bundle | 321 | logcat | 321 | 1288 | 33994 | ok | — | — |
| scrolling | ScrollViewBasic.lynx.bundle | 373 | logcat | 373 | 1265 | 33726 | ok | — | — |
| style-demo | style.lynx.bundle | 344 | logcat | 344 | 1297 | 33182 | ok | — | — |
| tailwind | tailwind.lynx.bundle | 352 | logcat | 352 | 1300 | 36727 | ok | — | — |
| todomvc | todomvc.lynx.bundle | 334 | logcat | 334 | 1279 | 35691 | ok | — | — |
| touch-fx | main.lynx.bundle | 342 | logcat | 342 | 1434 | 37316 | ok | — | — |

## Flagged rows (do not quote these without re-running them)

- **mini-pure/mini.lynx.bundle** — logcat milestone only, no visual confirmation
