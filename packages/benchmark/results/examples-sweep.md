# Examples sweep — bundle size (breadth axis)

- date: 2026-10-09T08:46:51.114Z
- node: v26.8.1
- method: offline static scan of built dist (no browser, no runtime) — lynx bundle = shipped artifact; web bundle = dev/docs-preview cost
- related: real-device runtime breadth in examples-sweep-device.md; reference format: vue-lynx-vapor examples-sweep

| example | entry | web raw | web gzip | lynx raw | lynx gzip |
|---|---|---|---|---|---|
| 7guis | cells.web.bundle | 100512 | 34677 | 103116 | 40824 |
| 7guis | circle-drawer.web.bundle | 83632 | 29214 | 85751 | 35013 |
| 7guis | counter.web.bundle | 71364 | 25939 | 74478 | 31694 |
| 7guis | crud.web.bundle | 80178 | 28245 | 82700 | 33906 |
| 7guis | flight-booker.web.bundle | 74883 | 26887 | 77721 | 32469 |
| 7guis | temperature-converter.web.bundle | 71503 | 25846 | 74541 | 31645 |
| 7guis | timer.web.bundle | 74543 | 26588 | 77313 | 32307 |
| bench-table-react | main.web.bundle | 94750 | 32178 | 96071 | 40334 |
| bench-table | main.web.bundle | 104379 | 36000 | 106647 | 41896 |
| counter | counter.web.bundle | 71483 | 25971 | 74570 | 31715 |
| device-lab | selftest.web.bundle | 84095 | 30160 | 86301 | 35481 |
| elk | elk.web.bundle | 472119 | 136108 | 440522 | 138170 |
| hackernews | hackernews.web.bundle | 222648 | 74868 | 219025 | 80424 |
| main-thread-draggable | main-thread-draggable.web.bundle | 74503 | 26660 | 77386 | 32310 |
| mini-pure | mini.web.bundle | 26037 | 9376 | 28415 | 15079 |
| motion | basic.web.bundle | 171176 | 56772 | 190923 | 83971 |
| motion | gesture.web.bundle | 160347 | 54992 | 183013 | 81672 |
| motion | motion-value.web.bundle | 166872 | 55311 | 185024 | 81026 |
| motion | spring.web.bundle | 171347 | 56817 | 191086 | 83997 |
| networking | networking.web.bundle | 82689 | 29368 | 85603 | 35030 |
| scrolling | ListBasic.web.bundle | 83340 | 29206 | 83058 | 33878 |
| scrolling | ListFilter.web.bundle | 85265 | 29727 | 85061 | 34477 |
| scrolling | ListInfinite.web.bundle | 85412 | 29900 | 85144 | 34653 |
| scrolling | ListPrepend.web.bundle | 86875 | 30102 | 86604 | 34916 |
| scrolling | ListRemove.web.bundle | 85964 | 29856 | 85717 | 34640 |
| scrolling | ListReorder.web.bundle | 87550 | 30053 | 87036 | 34861 |
| scrolling | ListWaterfall.web.bundle | 83648 | 29327 | 83408 | 33994 |
| scrolling | ScrollViewBasic.web.bundle | 82560 | 28993 | 82364 | 33726 |
| style-demo | style.web.bundle | 78727 | 27977 | 80610 | 33182 |
| tailwind | tailwind.web.bundle | 100374 | 32178 | 96125 | 36727 |
| todomvc | todomvc.web.bundle | 90733 | 31379 | 88869 | 35691 |
| touch-fx | main.web.bundle | 89362 | 31546 | 89790 | 37316 |

## Lynx-only bundles (no web entry — size only)

| example | entry | raw | gzip |
|---|---|---|---|
| raw-lynx | raw.lynx.bundle | 15143 | 8001 |
