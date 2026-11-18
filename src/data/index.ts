import { DemoProvider } from "./demo";
import { ProjectXProvider } from "./projectx";
import type { MarketDataProvider, ProviderSettings } from "./provider";
import { RithmicProvider } from "./rithmic";
import { TradovateProvider } from "./tradovate";

export function createProvider(s: ProviderSettings): MarketDataProvider {
  switch (s.provider) {
    case "tradovate": return new TradovateProvider(s.tradovate);
    case "projectx": return new ProjectXProvider(s.projectx);
    case "rithmic": return new RithmicProvider(s.rithmic);
    default: return new DemoProvider();
  }
}
