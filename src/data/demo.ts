import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";
import { resample } from "./aggregate";
import type { MarketDataProvider } from "./provider";

/**
 * Offline feed so the chart works with no broker connected. Deterministic random walk with
 * NQ-like scale (tick 0.25), session volatility (louder at the New York open) and a live tick stream.
 * It is clearly labelled DEMO in the UI; nothing here is market data.
 */
export class DemoProvider implements MarketDataProvider {
  readonly id = "demo" as const;
  readonly label = "Demo (offline)";
  private seed = 20261118;
  private last = 21500;

  async connect() {}
  async disconnect() {}

  async resolve(symbol: string): Promise<ContractInfo> {
    const s = (symbol || "NQ").toUpperCase();
    return { id: `demo:${s}`, symbol: s, description: "Demo random walk", tickSize: 0.25, pointValue: 20 };
  }

  private rnd() {
    // xorshift32
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed % 100000) / 100000;
  }

  private vol(timeSec: number) {
    const h = (Math.floor(timeSec / 3600) % 24 + 24) % 24; // UTC hour
    if (h >= 14 && h < 16) return 2.2; // NY open
    if (h >= 13 && h < 20) return 1.4;
    if (h >= 22 || h < 1) return 0.9;
    return 0.5;
  }

  private base: Bar[] | null = null;

  /** One deterministic 1-minute series covering ~70 days, generated once; every timeframe resamples it. */
  private baseSeries(): Bar[] {
    if (this.base) return this.base;
    const end = Math.floor(Date.now() / 60000) * 60;
    const start = end - 70 * 86400;
    const bars: Bar[] = [];
    this.seed = 20261118;
    let price = 21500;
    const q = (x: number) => Math.round(x * 4) / 4;
    for (let t = start; t <= end; t += 60) {
      const d = new Date(t * 1000);
      const dow = d.getUTCDay(), h = d.getUTCHours();
      // CME hours: closed Fri 22:00 UTC -> Sun 23:00 UTC, and 22:00-23:00 UTC daily
      if (dow === 6 || (dow === 5 && h >= 22) || (dow === 0 && h < 23) || h === 22) continue;
      const v = this.vol(t) * 2.5;
      const open = price;
      let hi = open, lo = open, p = open;
      for (let s = 0; s < 4; s++) { p += (this.rnd() - 0.5) * v; hi = Math.max(hi, p); lo = Math.min(lo, p); }
      bars.push({ time: t, open: q(open), high: q(hi), low: q(lo), close: q(p), volume: Math.round(50 + this.rnd() * 450 * this.vol(t)) });
      price = p;
    }
    this.last = price;
    this.base = bars;
    return bars;
  }

  private devReal: Bar[] | null | undefined; // undefined = not checked yet

  /** Dev only: real bars saved under public/dev (gitignored) stand in for the random walk when present. */
  private async devBase(): Promise<Bar[] | null> {
    if (this.devReal !== undefined) return this.devReal;
    this.devReal = null;
    if (import.meta.env.DEV) {
      try {
        const r = await fetch("/dev/bars-1m.json");
        if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) this.devReal = (await r.json()) as Bar[];
      } catch { /* no fixture */ }
    }
    return this.devReal;
  }

  get usingDevData() { return !!this.devReal; }

  async history(_c: ContractInfo, tf: Timeframe, count: number): Promise<Bar[]> {
    const real = await this.devBase();
    if (real && tf === "1h") {
      try { const r = await fetch("/dev/ctx-1h.json"); if (r.ok) { const ctx = (await r.json()) as Bar[]; return ctx.slice(Math.max(0, ctx.length - count)); } } catch { /* fall through */ }
    }
    const all = resample(real ?? this.baseSeries(), tf);
    return all.slice(Math.max(0, all.length - count));
  }

  async subscribeTicks(_c: ContractInfo, onTick: (t: Tick) => void): Promise<() => void> {
    if (this.usingDevData) return () => {}; // saved real bars stay as saved
    let alive = true;
    const loop = () => {
      if (!alive) return;
      this.last += (this.rnd() - 0.5) * 1.5;
      onTick({ time: Date.now(), price: Math.round(this.last * 4) / 4, size: 1 + Math.floor(this.rnd() * 5) });
      setTimeout(loop, 250 + this.rnd() * 900);
    };
    loop();
    return () => { alive = false; };
  }
}
