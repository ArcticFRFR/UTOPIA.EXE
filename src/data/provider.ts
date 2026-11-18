import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";

/**
 * Every market data source (demo, Tradovate, ProjectX, Rithmic) implements this.
 * The chart only ever talks to this interface, so switching broker is a settings change.
 */
export interface MarketDataProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Connect / authenticate. Must be idempotent. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Resolve a typed symbol (e.g. "NQZ6", "NQ") to the provider's contract. */
  resolve(symbol: string): Promise<ContractInfo>;
  /** Historical bars, oldest first. `count` is a hint for how many bars the chart wants. */
  history(contract: ContractInfo, timeframe: Timeframe, count: number): Promise<Bar[]>;
  /** Live trades. Returns an unsubscribe function. */
  subscribeTicks(contract: ContractInfo, onTick: (t: Tick) => void): Promise<() => void>;
}

export type ProviderId = "demo" | "databento" | "tradovate" | "projectx" | "rithmic";

export interface ProviderSettings {
  provider: ProviderId;
  databento: {
    apiKey: string;
    /** Live streaming needs a Databento CME subscription; historical bars work on pay-as-you-go. */
    live: boolean;
  };
  tradovate: {
    environment: "demo" | "live";
    username: string;
    password: string;
    appId: string;
    appVersion: string;
    cid: string;
    secret: string;
  };
  projectx: {
    /** Firm preset decides the API and RTC hosts. */
    firm: ProjectXFirm;
    username: string;
    apiKey: string;
  };
  rithmic: {
    system: string;
    username: string;
    password: string;
  };
}

export type ProjectXFirm = "topstepx" | "alphaticks" | "bulenox" | "custom";

export const PROJECTX_HOSTS: Record<Exclude<ProjectXFirm, "custom">, { api: string; rtc: string; label: string }> = {
  topstepx: { api: "https://api.topstepx.com", rtc: "https://rtc.topstepx.com", label: "TopstepX" },
  alphaticks: { api: "https://api.alphaticks.projectx.com", rtc: "https://rtc.alphaticks.projectx.com", label: "Alpha Futures" },
  bulenox: { api: "https://api.bulenox.projectx.com", rtc: "https://rtc.bulenox.projectx.com", label: "Bulenox" },
};

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "demo",
  databento: { apiKey: "", live: true },
  tradovate: { environment: "demo", username: "", password: "", appId: "Utopia", appVersion: "0.1.0", cid: "", secret: "" },
  projectx: { firm: "topstepx", username: "", apiKey: "" },
  rithmic: { system: "Rithmic Paper Trading", username: "", password: "" },
};

export class ProviderError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "ProviderError";
  }
}
