import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";
import { timeframeSeconds } from "@/lib/types";
import { resample } from "./aggregate";
import { ProviderError, type MarketDataProvider, type ProviderSettings } from "./provider";

/**
 * Tradovate market data.
 *   REST  : https://{demo|live}.tradovateapi.com/v1
 *   MD WS : wss://md{-demo}.tradovateapi.com/v1/websocket
 * The websocket speaks Tradovate's SockJS-style frames: "o" open, "h" heartbeat, "a[...]" arrays.
 * A request is one text frame: `${endpoint}\n${requestId}\n${query}\n${bodyJson}`.
 * API access has to be enabled on the Tradovate account (Settings > API Access) and the app
 * registered for a cid/secret. Nothing is stored except what the user types in Settings.
 */
export class TradovateProvider implements MarketDataProvider {
  readonly id = "tradovate" as const;
  readonly label = "Tradovate";
  private token: string | null = null;
  private mdToken: string | null = null;
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, (d: unknown) => void>();
  private chartHandlers = new Map<number, (bars: Bar[], eoh: boolean) => void>();
  private quoteHandlers = new Map<number, (t: Tick) => void>();
  private heartbeat: number | null = null;

  constructor(private cfg: ProviderSettings["tradovate"]) {}

  private get rest() {
    return `https://${this.cfg.environment}.tradovateapi.com/v1`;
  }
  private get mdUrl() {
    return this.cfg.environment === "demo" ? "wss://md-demo.tradovateapi.com/v1/websocket" : "wss://md.tradovateapi.com/v1/websocket";
  }

  async connect() {
    if (this.token && this.ws?.readyState === WebSocket.OPEN) return;
    if (!this.cfg.username || !this.cfg.password || !this.cfg.cid || !this.cfg.secret) {
      throw new ProviderError("Tradovate credentials missing", "Fill username, password, cid and secret in Settings.");
    }
    const res = await fetch(`${this.rest}/auth/accesstokenrequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: this.cfg.username,
        password: this.cfg.password,
        appId: this.cfg.appId || "Utopia",
        appVersion: this.cfg.appVersion || "0.1.0",
        cid: Number(this.cfg.cid),
        sec: this.cfg.secret,
        deviceId: deviceId(),
      }),
    });
    if (!res.ok) throw new ProviderError(`Tradovate auth failed (${res.status})`, await res.text());
    const j = (await res.json()) as { accessToken?: string; mdAccessToken?: string; errorText?: string; "p-ticket"?: string; "p-time"?: number };
    if (!j.accessToken) throw new ProviderError(j.errorText ?? "Tradovate auth: no token", j["p-ticket"] ? `Rate limited, retry in ${j["p-time"]}s` : undefined);
    this.token = j.accessToken;
    this.mdToken = j.mdAccessToken ?? j.accessToken;
    await this.openSocket();
  }

  private openSocket() {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.mdUrl);
      this.ws = ws;
      let authed = false;
      ws.onmessage = (ev) => {
        const raw = String(ev.data);
        if (raw === "o") {
          ws.send(`authorize\n${this.reqId}\n\n${this.mdToken}`);
          this.pending.set(this.reqId++, () => { authed = true; resolve(); });
          this.heartbeat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("[]"), 2500);
          return;
        }
        if (raw === "h") return;
        if (raw[0] !== "a") return;
        const frames = JSON.parse(raw.slice(1)) as Array<Record<string, unknown>>;
        for (const f of frames) this.onFrame(f);
      };
      ws.onerror = () => { if (!authed) reject(new ProviderError("Tradovate market data socket failed")); };
      ws.onclose = () => { if (this.heartbeat) clearInterval(this.heartbeat); this.ws = null; };
    });
  }

  private onFrame(f: Record<string, unknown>) {
    if (typeof f.i === "number" && this.pending.has(f.i)) {
      const cb = this.pending.get(f.i)!;
      this.pending.delete(f.i);
      if ((f.s as number) >= 400) throw new ProviderError(`Tradovate request failed (${f.s})`, JSON.stringify(f.d));
      cb(f.d);
      return;
    }
    if (f.e === "chart") {
      const d = f.d as { charts: Array<{ id: number; eoh?: boolean; bars?: Array<Record<string, number | string>> }> };
      for (const c of d.charts) {
        const h = this.chartHandlers.get(c.id);
        if (!h) continue;
        const bars: Bar[] = (c.bars ?? []).map((b) => ({
          time: Math.floor(new Date(String(b.timestamp)).getTime() / 1000),
          open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close),
          volume: Number(b.upVolume ?? 0) + Number(b.downVolume ?? 0),
        }));
        h(bars, Boolean(c.eoh));
      }
    }
    if (f.e === "md") {
      const d = f.d as { quotes?: Array<{ contractId: number; timestamp: string; entries: { Trade?: { price: number; size: number } } }> };
      for (const q of d.quotes ?? []) {
        const h = this.quoteHandlers.get(q.contractId);
        const tr = q.entries.Trade;
        if (h && tr) h({ time: new Date(q.timestamp).getTime(), price: tr.price, size: tr.size });
      }
    }
  }

  private send<T>(endpoint: string, query = "", body?: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new ProviderError("Tradovate socket not open"));
    const id = this.reqId++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, (d) => resolve(d as T));
      ws.send(`${endpoint}\n${id}\n${query}\n${body === undefined ? "" : JSON.stringify(body)}`);
    });
  }

  async disconnect() {
    this.ws?.close();
    this.ws = null;
    this.token = null;
  }

  async resolve(symbol: string): Promise<ContractInfo> {
    if (!this.token) await this.connect();
    const s = symbol.toUpperCase();
    const headers = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    let res = await fetch(`${this.rest}/contract/find?name=${encodeURIComponent(s)}`, { headers });
    if (res.status === 404 || !res.ok) {
      // Root symbol like "NQ": take the first suggestion (front month).
      res = await fetch(`${this.rest}/contract/suggest?t=${encodeURIComponent(s)}&l=1`, { headers });
      if (!res.ok) throw new ProviderError(`Contract ${s} not found`, "Try the full symbol, e.g. NQZ6");
      const arr = (await res.json()) as Array<{ id: number; name: string }>;
      if (!arr.length) throw new ProviderError(`Contract ${s} not found`);
      return { id: String(arr[0].id), symbol: arr[0].name, tickSize: 0.25, pointValue: 20 };
    }
    const c = (await res.json()) as { id: number; name: string };
    return { id: String(c.id), symbol: c.name, tickSize: 0.25, pointValue: 20 };
  }

  async history(contract: ContractInfo, tf: Timeframe, count: number): Promise<Bar[]> {
    if (!this.ws) await this.connect();
    const base: Timeframe = tf === "1d" ? "1h" : tf; // request fine bars, resample daily locally
    const elementSize = timeframeSeconds(base) / 60;
    const want = tf === "1d" ? count * 24 : count;
    const sub = await this.send<{ historicalId: number; realtimeId: number }>("md/getChart", "", {
      symbol: contract.symbol,
      chartDescription: { underlyingType: "MinuteBar", elementSize, elementSizeUnit: "UnderlyingUnits", withHistogram: false },
      timeRange: { asMuchAsElements: Math.min(want, 20000) },
    });
    const bars = await new Promise<Bar[]>((resolve) => {
      const acc: Bar[] = [];
      this.chartHandlers.set(sub.historicalId, (b, eoh) => { acc.push(...b); if (eoh) resolve(acc); });
    });
    this.chartHandlers.delete(sub.historicalId);
    await this.send("md/cancelChart", "", { subscriptionId: sub.realtimeId }).catch(() => {});
    bars.sort((a, b) => a.time - b.time);
    return tf === "1d" ? resample(bars, "1d") : bars;
  }

  async subscribeTicks(contract: ContractInfo, onTick: (t: Tick) => void): Promise<() => void> {
    if (!this.ws) await this.connect();
    const id = Number(contract.id);
    this.quoteHandlers.set(id, onTick);
    await this.send("md/subscribeQuote", "", { symbol: contract.symbol });
    return () => {
      this.quoteHandlers.delete(id);
      void this.send("md/unsubscribeQuote", "", { symbol: contract.symbol }).catch(() => {});
    };
  }
}

function deviceId() {
  const k = "utopia.deviceId";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
}
