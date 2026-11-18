import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";
import { timeframeSeconds } from "@/lib/types";
import { resample } from "./aggregate";
import { ProviderError, type MarketDataProvider, type ProviderSettings } from "./provider";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Databento (licensed CME Globex feed, dataset GLBX.MDP3). The Rust side owns the connection
 * (src-tauri/src/databento.rs, official `databento` crate): history comes back from a command,
 * live trades arrive as "md:tick" events. Symbols: "NQ" means the front month (continuous NQ.c.0);
 * a dated symbol like NQZ6 is used as-is.
 */
export class DatabentoProvider implements MarketDataProvider {
  readonly id = "databento" as const;
  readonly label = "Databento";

  /** Exclusive end of Databento's historical range from the last history call: where live replay starts. */
  private historyEnd = 0;

  constructor(private cfg: ProviderSettings["databento"]) {}

  async connect() {
    if (!inTauri()) throw new ProviderError("Databento runs inside the desktop app", "Open Utopia.exe; the browser build cannot reach it.");
    if (!this.cfg.apiKey) {
      const { appInfo } = await import("@/lib/tauri");
      if (!(await appInfo()).databento_builtin) throw new ProviderError("Databento API key missing", "Settings → Databento → API key (databento.com/portal/keys).");
    }
  }
  async disconnect() {
    if (!inTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("databento_live_stop").catch(() => {});
  }

  async resolve(symbol: string): Promise<ContractInfo> {
    const s = symbol.trim().toUpperCase();
    const root = s.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
    const dbSymbol = s === root ? `${root}.c.0` : s;
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ symbol: string; tickSize: number; pointValue: number }>("databento_resolve", { key: this.cfg.apiKey, symbol: dbSymbol });
    return { id: dbSymbol, symbol: info.symbol || s, tickSize: info.tickSize || 0.25, pointValue: info.pointValue || 20 };
  }

  async history(contract: ContractInfo, tf: Timeframe, count: number): Promise<Bar[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    const tfSec = timeframeSeconds(tf);
    const h = await invoke<{ bars: Bar[]; end: number }>("databento_history", { key: this.cfg.apiKey, symbol: contract.id, tfSec, count });
    this.historyEnd = h.end;
    return tf === "1m" || tf === "1h" || tf === "1d" ? h.bars : resample(h.bars, tf);
  }

  async subscribeTicks(contract: ContractInfo, onTick: (t: Tick) => void): Promise<() => void> {
    if (!this.cfg.live) return () => {};
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen<{ symbol: string; time: number; price: number; size: number }>("md:tick", (e) => {
      if (e.payload.symbol === contract.id) onTick({ time: e.payload.time, price: e.payload.price, size: e.payload.size });
    });
    try {
      await invoke("databento_live_start", { key: this.cfg.apiKey, symbol: contract.id, since: this.historyEnd });
    } catch (e) {
      un();
      throw new ProviderError("Databento live stream failed", `${e}. Live CME data needs a Databento subscription; history still works. Turn live off in Settings to silence this.`);
    }
    return () => { un(); void invoke("databento_live_stop").catch(() => {}); };
  }
}
