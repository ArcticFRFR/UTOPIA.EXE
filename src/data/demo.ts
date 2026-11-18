import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";
import { timeframeSeconds } from "@/lib/types";
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

  async history(_c: ContractInfo, tf: Timeframe, count: number): Promise<Bar[]> {
    const size = timeframeSeconds(tf);
    const end = Math.floor(Date.now() / 1000 / size) * size;
    const bars: Bar[] = [];
    this.seed = 20261118;
    let price = 21500;
    for (let i = count; i >= 0; i--) {
      const t = end - i * size;
      const v = this.vol(t) * Math.sqrt(size / 60) * 2.5;
      const open = price;
      let hi = open, lo = open, p = open;
      const steps = 8;
      for (let s = 0; s < steps; s++) {
        p += (this.rnd() - 0.5) * v;
        hi = Math.max(hi, p); lo = Math.min(lo, p);
      }
      const q = (x: number) => Math.round(x * 4) / 4;
      bars.push({ time: t, open: q(open), high: q(hi), low: q(lo), close: q(p), volume: Math.round(200 + this.rnd() * 1800 * this.vol(t)) });
      price = p;
    }
    this.last = price;
    return bars;
  }

  async subscribeTicks(_c: ContractInfo, onTick: (t: Tick) => void): Promise<() => void> {
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
