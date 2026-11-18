import type { Bar, ContractInfo, Tick, Timeframe } from "@/lib/types";
import { ProviderError, type MarketDataProvider, type ProviderSettings } from "./provider";

/**
 * Rithmic R | Protocol API (websocket + protobuf). Not wired yet: Rithmic requires a signed
 * developer agreement and a conformance test before live credentials work, and the protobuf
 * schemas ship with that kit. The adapter exists so the settings and the chart already know it;
 * `connect()` says exactly what is missing.
 */
export class RithmicProvider implements MarketDataProvider {
  readonly id = "rithmic" as const;
  readonly label = "Rithmic";
  constructor(private cfg: ProviderSettings["rithmic"]) {}
  async connect(): Promise<void> {
    throw new ProviderError(
      "Rithmic is not connected yet",
      `Needs the R|Protocol API kit (developer agreement + conformance). System: ${this.cfg.system || "unset"}. Use Tradovate or ProjectX for now.`,
    );
  }
  async disconnect() {}
  async resolve(): Promise<ContractInfo> { await this.connect(); throw new Error("unreachable"); }
  async history(): Promise<Bar[]> { await this.connect(); return []; }
  async subscribeTicks(_c: ContractInfo, _t: (t: Tick) => void): Promise<() => void> { await this.connect(); return () => {}; }
  // Keep the type import used for when bars are wired.
  protected _tf?: Timeframe;
}
