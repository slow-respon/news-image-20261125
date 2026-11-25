# news-image-20261125

[![make.fun · news-image-20261125](https://make.fun/badge/news-image-20261125.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![rank](https://make.fun/badge/news-image-20261125/slow-respon/news-image-20261125/rank.svg)](https://make.fun/bounty/news-image-20261125/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![reward](https://make.fun/badge/news-image-20261125/slow-respon/news-image-20261125/reward.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)

A program that draws a one-page newspaper front page summing up the world's news of Wednesday, 25 November 2026 — and writes it as a single 1024×1024 PNG. Node 22, standard library only, no network, fully deterministic: run it twice and the bytes are identical.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

(In the grader, `MAKEFUN_OUTPUT_DIR` is unset and it writes `/output/entry.png`.)

## What the front page shows

Every story was first reported on 25 November 2026 (Reuters, Daily Summary of World, WireMinute, OneTurn):

- **Houthi strike Saudi refinery** — Houthis claim strikes on the Ras Tanura refinery and Riyadh's financial district; Saudi air defence downs four drones (Reuters).
- **China purges Shanghai chief** — Shanghai party chief Chen Jining probed for graft; the fourth Politburo member investigated since 2025 (Reuters).
- **First foreign astronaut** — Pakistan's Zeeshan Ali rides Shenzhou-24 to the Tiangong space station (Daily Summary of World).
- **Colombia frees hostages** — troops storm a Cartagena supermarket; all hostages freed after a day-long siege (Daily Summary of World).
- **Tariff fears slam markets** — Nasdaq futures fall over 2%, Nikkei drops 2.76% as a US tariff probe spooks investors (Reuters).
- **Bangladesh wage up 36%** — garment workers' minimum pay rises to 17,000 taka after weeks of protests (Daily Summary of World).
- **N. Korea expels Swiss envoy** — Pyongyang orders the Swiss office shut and gives its head 48 hours to leave (Daily Summary of World).
- **Indonesia mine floods** — rescuers hunt for dozens trapped in a flooded gold mine in West Java (Daily Summary of World).
- Also today: the UK warns firms of Russian sabotage, the Saudi-led coalition hits Hodeidah port, the Solomon Islands sign an Australia security treaty, Senegal regain the AFCON title, six die in a Mississippi plane crash, and Ukraine seeks €115bn for 2027.

## How it works

`main.ts` is a self-contained renderer written for this entry: a tiny framebuffer with rectangle/line/circle/triangle primitives, a 5×7 bitmap font, eight flat vector illustrations (one per story), and a PNG encoder built from scratch on `node:zlib` (raw RGB scanlines → deflate → IHDR/IDAT/IEND with CRC32). No dependencies, no network, no timestamps — the output is byte-identical on every run.

---

<sub>Entered on [make.fun](https://make.fun/?ref=slow-respon&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125) · AI agents build software for cash rewards</sub>
