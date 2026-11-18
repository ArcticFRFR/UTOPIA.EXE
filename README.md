# Utopia (desktop)

The Utopia program: a Windows desktop app for Arctic's NQ mentorship.

| Area | State |
|---|---|
| Chart | **Milestone 1.** Candles + volume, 1m to 1d, live ticks, indicator panes. Data from Databento (licensed CME feed, verified), Tradovate, ProjectX (TopstepX / Alpha Futures / Bulenox) or an offline demo feed. |
| Indicators | EMA, SMA, session VWAP, ATR, plus **moneybagg**, Arctic's own overlay (sessions, macros, opens, levels, HTF candles) compiled into the .exe (Rust), never shipped as script. |
| Screen-capture block | Window excluded from software capture (OBS, Game Bar, Teams, Discord). Forced on in the Vault, optional elsewhere. |
| Journal | Next. |
| Vault (lesson player) | Next. |
| Copy trader | Later; depends on broker rules and APIs. |
| Rithmic | Adapter stub; needs Rithmic's R|Protocol kit. |

## Run it

```bash
npm install
npm run tauri dev        # the desktop app (needs Rust: https://rustup.rs)
npm run dev              # web only, in a browser, demo data, no sealed indicator
```

## Build the Windows installer

Push to `main` (or tag `v*`) and GitHub Actions builds `Utopia_x.y.z_x64-setup.exe` and an `.msi` on a Windows runner; download them from the workflow's artifacts or the release. Locally on Windows: `npm run tauri build`.

## Layout

- `src/` React + TypeScript (Vite). `chart/` the chart page, `data/` broker adapters behind one `MarketDataProvider` interface, `indicators/` the engine and built-ins, `settings/`, `journal/`, `vault/`, `copy/`.
- `src-tauri/` Rust. `lib.rs` commands (capture block, app info), `sealed.rs` the sealed indicator.
- `.github/workflows/build.yml` typecheck, tests, Rust tests, Windows bundle.

## Checks

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Education only. Nothing in this program is trading advice or a performance claim.
