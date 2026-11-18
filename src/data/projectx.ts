import { HubConnectionBuilder, HttpTransportType, LogLevel, type HubConnection } from "@microsoft/signalr";
import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";
import { timeframeSeconds } from "@/lib/types";
import { resample } from "./aggregate";
import { PROJECTX_HOSTS, ProviderError, type MarketDataProvider, type ProviderSettings } from "./provider";

/**
 * ProjectX gateway (TopstepX, Alpha Futures, Bulenox, ...).
 *   Auth    : POST {api}/api/Auth/loginKey { userName, apiKey } -> { token }
 *   Search  : POST {api}/api/Contract/search { live, searchText }
 *   History : POST {api}/api/History/retrieveBars { contractId, live, startTime, endTime, unit, unitNumber, limit, includePartialBar }
 *   Realtime: SignalR hub {rtc}/hubs/market?access_token=...  SubscribeContractTrades(contractId) -> GatewayTrade
 * The API key is created in the firm's dashboard (API access is a paid add-on at most firms).
 */
export class ProjectXProvider implements MarketDataProvider {
  readonly id = "projectx" as const;
  readonly label = "ProjectX";
  private token: string | null = null;
  private hub: HubConnection | null = null;

  constructor(private cfg: ProviderSettings["projectx"], private hosts = PROJECTX_HOSTS[cfg.firm === "custom" ? "topstepx" : cfg.firm]) {}

  get label2() { return this.hosts.label; }

  async connect() {
    if (this.token) return;
    if (!this.cfg.username || !this.cfg.apiKey) throw new ProviderError("ProjectX credentials missing", "Fill username and API key in Settings.");
    const res = await fetch(`${this.hosts.api}/api/Auth/loginKey`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/plain" },
      body: JSON.stringify({ userName: this.cfg.username, apiKey: this.cfg.apiKey }),
    });
    if (!res.ok) throw new ProviderError(`ProjectX auth failed (${res.status})`, await res.text());
    const j = (await res.json()) as { token?: string; success: boolean; errorMessage?: string };
    if (!j.success || !j.token) throw new ProviderError(j.errorMessage ?? "ProjectX auth failed");
    this.token = j.token;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.token) await this.connect();
    const res = await fetch(`${this.hosts.api}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/plain", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { this.token = null; throw new ProviderError("ProjectX session expired", "Reconnect."); }
    if (!res.ok) throw new ProviderError(`ProjectX ${path} failed (${res.status})`, await res.text());
    const j = (await res.json()) as T & { success?: boolean; errorMessage?: string };
    if (j.success === false) throw new ProviderError(j.errorMessage ?? `ProjectX ${path} failed`);
    return j;
  }

  async disconnect() {
    await this.hub?.stop();
    this.hub = null;
    this.token = null;
  }

  async resolve(symbol: string): Promise<ContractInfo> {
    const s = symbol.toUpperCase();
    const j = await this.post<{ contracts: Array<{ id: string; name: string; description: string; tickSize: number; tickValue: number; activeContract: boolean }> }>(
      "/api/Contract/search", { live: false, searchText: s.replace(/[A-Z]\d$/, "") || s },
    );
    const list = j.contracts ?? [];
    const exact = list.find((c) => c.name.toUpperCase() === s);
    const pick = exact ?? list.find((c) => c.activeContract) ?? list[0];
    if (!pick) throw new ProviderError(`Contract ${s} not found on ${this.hosts.label}`);
    return { id: pick.id, symbol: pick.name, description: pick.description, tickSize: pick.tickSize, pointValue: pick.tickValue / pick.tickSize };
  }

  async history(contract: ContractInfo, tf: Timeframe, count: number): Promise<Bar[]> {
    // unit: 1 second, 2 minute, 3 hour, 4 day, 5 week, 6 month
    const minutes = timeframeSeconds(tf) / 60;
    const unit = tf === "1d" ? 4 : minutes >= 60 ? 3 : 2;
    const unitNumber = tf === "1d" ? 1 : minutes >= 60 ? minutes / 60 : minutes;
    const end = new Date();
    const start = new Date(end.getTime() - timeframeSeconds(tf) * 1000 * count * (tf === "1d" ? 1.6 : 2.2));
    const j = await this.post<{ bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> }>("/api/History/retrieveBars", {
      contractId: contract.id, live: false,
      startTime: start.toISOString(), endTime: end.toISOString(),
      unit, unitNumber, limit: Math.min(count, 20000), includePartialBar: true,
    });
    const bars: Bar[] = (j.bars ?? []).map((b) => ({ time: Math.floor(new Date(b.t).getTime() / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
    bars.sort((a, b) => a.time - b.time);
    return tf === "1d" ? resample(bars, "1d") : bars;
  }

  async subscribeTicks(contract: ContractInfo, onTick: (t: Tick) => void): Promise<() => void> {
    if (!this.token) await this.connect();
    if (!this.hub) {
      this.hub = new HubConnectionBuilder()
        .withUrl(`${this.hosts.rtc}/hubs/market?access_token=${encodeURIComponent(this.token!)}`, {
          skipNegotiation: true, transport: HttpTransportType.WebSockets, accessTokenFactory: () => this.token ?? "",
        })
        .withAutomaticReconnect()
        .configureLogging(LogLevel.Warning)
        .build();
      await this.hub.start();
    }
    const hub = this.hub;
    const handler = (contractId: string, trades: Array<{ timestamp: string; price: number; volume: number }>) => {
      if (contractId !== contract.id) return;
      for (const t of trades) onTick({ time: new Date(t.timestamp).getTime(), price: t.price, size: t.volume });
    };
    hub.on("GatewayTrade", handler);
    await hub.invoke("SubscribeContractTrades", contract.id);
    hub.onreconnected(() => void hub.invoke("SubscribeContractTrades", contract.id));
    return () => {
      hub.off("GatewayTrade", handler);
      void hub.invoke("UnsubscribeContractTrades", contract.id).catch(() => {});
    };
  }
}
