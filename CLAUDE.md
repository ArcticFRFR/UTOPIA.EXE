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
- SEALED: nothing in this repo may describe what Arctic trades or teaches. The indicator's maths lives in
  `src-tauri/src/sealed.rs` so it ships compiled, not as readable JS. Do not move it to TypeScript. What is there now
  is a PLACEHOLDER (EMA bias in ATR units + session VWAP) until Arctic supplies his logic; swap the body of `compute`.
- Education only. Keep the "not advice / not a performance claim" lines.
- Never invent prices, member counts, results.

## How it is put together
- `src/data/provider.ts` is the one interface the chart knows: `connect / resolve / history / subscribeTicks`.
  `demo.ts` (deterministic random walk so the app works offline, labelled DEMO), `tradovate.ts` (REST auth +
  SockJS-style market data websocket: `md/getChart`, `md/subscribeQuote`), `projectx.ts` (REST `loginKey`,
  `Contract/search`, `History/retrieveBars`; SignalR market hub `GatewayTrade`), `rithmic.ts` (stub; R|Protocol needs
  Rithmic's kit and conformance). Firm hosts for ProjectX are in `PROJECTX_HOSTS`. The broker adapters were written
  from the public API docs and have NOT been run against live accounts yet (no credentials in the cloud); expect to
  touch field names on first contact.
- `src/data/aggregate.ts`: bar opens, resampling and tick → bar. Daily bars open 22:00 UTC (Globex). Tested.
- `src/indicators/`: `types.ts` (an indicator = params + plots + `compute(bars, params)`), `builtins.ts`,
  `sealed.ts` (calls Rust `compute_sealed`), `engine.ts` (`computeAll` + a coalescing scheduler so ticks do not pile up).
  Indicators with `pane: "below"` get their own Lightweight Charts pane.
- `src/chart/useMarket.ts` owns the provider and the bar array (a ref mutated by ticks; `version` bumps re-renders).
  `ChartView.tsx` is the only file that talks to Lightweight Charts. `ChartPage.tsx` is the toolbar + indicator panel.
- `src-tauri/src/lib.rs`: `set_content_protection` wraps Tauri's `set_content_protected` (Windows
  `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`): software recorders see black. `App.tsx` forces it on in the
  Vault and follows the Settings toggle elsewhere. It does not stop phone cameras or HDMI capture: the per-student
  forensic watermark (the Apostles watermarking machine, see the site brief) is the backstop for the Vault.
- CSP in `tauri.conf.json` lists the broker hosts; add a host there when adding a provider.

## Next milestones (in the order Arctic chose)
1. Chart + indicator: done as a first cut; needs a run against a real Tradovate/ProjectX account and his indicator.
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
