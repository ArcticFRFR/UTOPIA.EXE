# Utopia desktop — brief for whoever works on this next

## What it is
`Utopia.exe`: the Windows program for Arctic's private NQ (Nasdaq futures) mentorship, sister to the landing site
(GitHub `ArcticFRFR/utopia-repo`, whose `CLAUDE.md` holds the brand, the sealed rules and the Academy backend notes).
Asked for on Nov 18 2026: "a version of TradingView I make myself, copy trader, my own indicator inside, CME data,
a journal, and videos in software where you can't record". Decisions that day: Windows first; brokers Tradovate,
ProjectX (TopstepX etc.) and Rithmic; this repo (`ArcticFRFR/UTOPIA.EXE`); chart + indicator first.

## Stack
Tauri 2 (Rust) + React 19 + TypeScript + Vite 8. Charts: `lightweight-charts` 5 (TradingView's open-source library;
we build the platform around it, nothing is copied from TradingView's product). Realtime for ProjectX: `@microsoft/signalr`.
Settings: `tauri-plugin-store` (`utopia.settings.json` in the app data dir). The .exe is built by GitHub Actions on
`windows-latest` (`.github/workflows/build.yml`); this is why Rust code must stay portable and compile on Linux too.

## Rules carried over from the site
- SEALED: nothing in this repo may describe what Arctic trades or teaches. The indicator ("moneybagg", his Pine v6
  overlay, supplied Nov 18 2026) is ported in `src-tauri/src/sealed.rs` so it ships compiled, not as readable JS.
  Do not move any of it to TypeScript; the web side (`src/indicators/sealed.ts`) only lists switches and draws what
  Rust returns. Outside Tauri it draws a generic dev fixture, never the real thing.
- Education only. Keep the "not advice / not a performance claim" lines.
- Never invent prices, member counts, results.

## How it is put together
- `src/data/provider.ts` is the one interface the chart knows: `connect / resolve / history / subscribeTicks`.
  `databento.ts` + `src-tauri/src/databento.rs` (the licensed CME feed, see below), `demo.ts` (deterministic random
  walk so the app works offline, labelled DEMO), `tradovate.ts` (REST auth +
  SockJS-style market data websocket: `md/getChart`, `md/subscribeQuote`), `projectx.ts` (REST `loginKey`,
  `Contract/search`, `History/retrieveBars`; SignalR market hub `GatewayTrade`), `rithmic.ts` (stub; R|Protocol needs
  Rithmic's kit and conformance). Firm hosts for ProjectX are in `PROJECTX_HOSTS`. The broker adapters were written
  from the public API docs and have NOT been run against live accounts yet (no credentials in the cloud); expect to
  touch field names on first contact.
- **Databento** (Nov 18 2026, verified against the real API): dataset GLBX.MDP3, official `databento` crate on the
  Rust side. `databento_history` pulls ohlcv-1m/1h/1d from the Historical API (pay-as-you-go; a week of NQ minutes
  cost $0.04) up to the dataset range end, and returns that end. `databento_live_start` opens the Live gateway with
  `start` = that end so the intraday gap is replayed, folds replayed trades into 1-minute bars (sent as four
  pseudo-ticks each on the `md:tick` event), then forwards raw trades once within 5s of the clock. Live needs a
  Databento CME plan (Standard, ~$199/mo in 2026); without it history alone works and the chart ends at the range end.
  Continuous front month is `NQ.c.0` ("NQ" in the symbol box); dated symbols are raw.
- One key for every install (Arctic's call, Nov 18 2026: the installs are all his own machines): the CI secret
  `DATABENTO_API_KEY` is compiled into the Windows build (`build.rs` scrambles it into `UTOPIA_DB_KEY_OBF`,
  `databento::builtin_key` unscrambles it); Settings overrides it; a build with a built-in key starts on Databento.
  A key in an exe can be extracted by anyone holding the exe, and a shared key counts every install against one
  account and its live-session limits, so this is for his own machines, not for handing to students.
- Dev fixtures: `public/dev/` (gitignored) may hold `bars-1m.json`, `bars-5m.json`, `ctx-1h.json` of real bars and
  `overlay-<tfSec>.json`; in `npm run dev` the demo provider and the sealed indicator pick them up so the browser shows
  real data with the real overlay. `cargo run --example overlay -- bars.json ctx.json 300 > overlay-300.json`
  (src-tauri/examples/overlay.rs) computes the overlay outside the app. Nothing in it ships.
- `src/data/aggregate.ts`: bar opens, resampling and tick → bar. Daily bars open 22:00 UTC (Globex). Tested.
- `src/indicators/`: `types.ts` (an indicator = params + plots + `compute({bars, ctx, tfSec}, params)` returning
  `{plots, overlay?}`), `builtins.ts`, `sealed.ts` (calls Rust `compute_sealed`), `engine.ts` (`computeAll` + a
  coalescing scheduler so ticks do not pile up). Indicators with `pane: "below"` get their own Lightweight Charts pane.
  `ctx` is 1-hour bars reaching ~10 weeks back (`useMarket` fetches them beside the chart bars and folds ticks into
  both); the sealed overlay builds daily/weekly opens, previous-day levels and the HTF candle sets from it.
- The sealed overlay (`Overlay` in types.ts, mirrored by the Rust struct): boxes, hlines, vlines, texts, per-bar
  vector-candle flags, two plots (weekly/daily open) and the HTF sets, plus `rightOffsetBars` so the chart leaves room
  on the right. `src/chart/OverlayPrimitive.ts` is a Lightweight Charts series primitive that draws it; it maps times
  to logical bar indices itself so shapes can reach past the last bar; the HTF sets use a bar unit floored at 4px so
  they stay readable zoomed out, and the chart's `rightOffset` is derived from that at the current zoom. Time rules inside Rust: everything on New York's
  clock except the London box (London) and the Frankfurt open (Berlin), via `chrono-tz`; CME trading date = NY date of
  (t + 6h); day 18:00→17:00 NY; week = ISO week of the trading date, ending Friday 17:00 NY.
- `src/chart/useMarket.ts` owns the provider and the bar array (a ref mutated by ticks; `version` bumps re-renders).
  `ChartView.tsx` is the only file that talks to Lightweight Charts. `ChartPage.tsx` is the toolbar + indicator panel.
- `src-tauri/src/lib.rs`: `set_content_protection` wraps Tauri's `set_content_protected` (Windows
  `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`): software recorders see black. `App.tsx` forces it on in the
  Vault and follows the Settings toggle elsewhere. It does not stop phone cameras or HDMI capture: the per-student
  forensic watermark (the Apostles watermarking machine, see the site brief) is the backstop for the Vault.
- CSP in `tauri.conf.json` lists the broker hosts; add a host there when adding a provider.

## Drawings (Nov 18 2026)
`src/chart/DrawingLayer.tsx` (toolbar, pointer handling, keys V/T/R/H/B/X, Esc, Del), `DrawingsPrimitive.ts` (render +
hit tests), `drawings.ts` (model), `coords.ts` (time ↔ logical index). Drawings live in time and price, per symbol, in
the local store (`drawings:<symbol>`). Creation tools arm a transparent layer and switch the chart's pan/zoom off;
in cursor mode a capture-phase pointerdown on the chart container grabs drags that start on a drawing. Arctic parked
sign-in and cloud sync ("just a project atm"): every install keeps its own drawings; the sync layer (Discord login via
the mentorship Supabase project, a `chart_drawings` table with per-user rules) can be added later without changing
the local model.

## Next milestones (in the order Arctic chose)
1. Chart + indicator: done as a first cut, moneybagg ported; needs a run against a real Tradovate/ProjectX account and
   a look at the overlay on real NQ data (the Rust tests cover the time rules, not the look).
2. Vault: Discord-role gate (reuse the mentorship repo's Supabase + Discord OAuth), signed streaming URLs, per-student
   watermarked copies, capture block forced on. Consider `tauri-plugin-sql` for a local cache.
3. Journal: SQLite (`tauri-plugin-sql`, sqlite feature), trades, screenshots, tags, daily review, stats, CSV export.
4. Copy trader: leader fills → follower accounts via Tradovate/ProjectX order APIs, scaling, kill switch. Check the
   prop firms' copy-trading rules and whether copying for others needs registration before switching it on.

## Working
- `npm run tauri dev` on a machine with Rust; `npm run dev` for web-only (demo data; the sealed indicator returns
  nothing outside Tauri). `npm run typecheck`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  must stay green; CI runs all three then bundles Windows.
- Linux needs `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev` to compile the Rust side.
- Credentials are stored in plain text in the settings file for now; moving them to Windows Credential Manager
  (DPAPI) is a known todo before students use it.
- Icons in `src-tauri/icons/` are Tauri's placeholders; render the real mark from the site's `components/art/skyline.tsx`.
