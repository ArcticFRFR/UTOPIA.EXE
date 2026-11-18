import type { Bar } from "@/lib/types";
import type { IndicatorDef, Params, Plots } from "./types";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Arctic's indicator. The maths lives in Rust (src-tauri/src/sealed.rs) and ships compiled in the
 * .exe; this file only describes the parameters and plots and calls across. In a plain browser
 * (vite dev without Tauri) it returns empty plots so the chart still renders.
 */
export const SEALED: IndicatorDef = {
  id: "sealed",
  name: "Apostle",
  description: "Sealed. Computed inside the program, never shipped as script. (Placeholder maths until Arctic's logic is dropped in.)",
  pane: "below",
  sealed: true,
  params: [
    { key: "fast", label: "Fast", default: 9, min: 1, max: 200, step: 1 },
    { key: "slow", label: "Slow", default: 34, min: 1, max: 400, step: 1 },
    { key: "atr", label: "ATR", default: 14, min: 1, max: 200, step: 1 },
  ],
  plots: [{ key: "bias", label: "Bias", color: "#ff2a3c", lineWidth: 2 }],
  async compute(bars: Bar[], params: Params): Promise<Plots> {
    if (!inTauri()) return { bias: bars.map(() => null) };
    const { invoke } = await import("@tauri-apps/api/core");
    const out = await invoke<{ plots: Plots }>("compute_sealed", { bars, params });
    return { bias: out.plots.bias ?? [] };
  },
};
