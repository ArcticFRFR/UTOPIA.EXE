import { resample } from "@/data/aggregate";
import type { ComputeInput, IndicatorDef, IndicatorParam, Overlay, Params } from "./types";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const bool = (key: string, label: string, def: boolean, group: string): IndicatorParam => ({ key, label, default: def ? 1 : 0, type: "bool", group });
const num = (key: string, label: string, def: number, group: string, min?: number, max?: number, step?: number): IndicatorParam => ({ key, label, default: def, min, max, step, group });

/**
 * Arctic's overlay ("moneybagg"). The logic lives in Rust (src-tauri/src/sealed.rs) and ships
 * compiled in the .exe; this file only lists the switches and calls across. In a plain browser
 * (vite dev without Tauri) it draws a small generic fixture so the renderer can be checked.
 */
export const SEALED: IndicatorDef = {
  id: "sealed",
  name: "moneybagg",
  description: "Sessions, macros, opens, previous day levels, key opens, day labels, vector candles and HTF candles. Sealed: computed inside the program, never shipped as script.",
  pane: "price",
  sealed: true,
  params: [
    bool("asia", "Asia", true, "Sessions"), bool("london", "London", true, "Sessions"), bool("ny", "New York", true, "Sessions"),
    num("hideAbove", "Hide London & NY above (min)", 59, "Sessions", 15, 120, 1),
    bool("lm1", "London macro 1", true, "Macros"), bool("lm2", "London macro 2", true, "Macros"),
    bool("ny1", "NY AM macro 1", true, "Macros"), bool("ny2", "NY AM macro 2", true, "Macros"), bool("ny3", "NY AM macro 3", true, "Macros"),
    bool("lmLondon", "London macros on London clock", false, "Macros"),
    bool("ffOpen", "Frankfurt open", true, "Opens"), bool("lcClose", "London close", true, "Opens"),
    num("lineReach", "Reach (x ATR)", 0.5, "Opens", 0, 5, 0.1),
    bool("weeklyOpen", "Weekly open", true, "Opens"), bool("dailyOpen", "Daily open", true, "Opens"), bool("doToday", "Daily open today only", false, "Opens"),
    bool("ko18", "6PM", false, "Key opens"), bool("ko22", "10PM", false, "Key opens"), bool("ko02", "2AM", false, "Key opens"),
    bool("ko06", "6AM", false, "Key opens"), bool("ko10", "10AM", true, "Key opens"), bool("ko14", "2PM", false, "Key opens"),
    bool("koLabels", "Labels", false, "Key opens"),
    bool("pd", "Previous day high & low", true, "Levels"),
    bool("dayLabels", "Day labels", true, "Labels"), num("dayHour", "At hour (NY)", 12, "Labels", 0, 23, 1),
    bool("vector", "Vector candles", true, "Vector candles"), num("bodyMult", "Body x", 1.5, "Vector candles", 0.5, 5, 0.1), num("volMult", "Volume x", 1.2, "Vector candles", 0.5, 5, 0.1),
    bool("htf1", "1H candles", true, "HTF candles"), num("htf1Count", "1H count", 3, "HTF candles", 1, 5, 1), bool("htf1Timer", "1H countdown", true, "HTF candles"), bool("htf1Lvls", "1H levels", false, "HTF candles"),
    bool("htf2", "Daily candles", true, "HTF candles"), num("htf2Count", "D count", 3, "HTF candles", 1, 5, 1), bool("htf2Timer", "D countdown", true, "HTF candles"), bool("htf2Lvls", "D levels", true, "HTF candles"),
    bool("htf3", "Weekly candles", true, "HTF candles"), num("htf3Count", "W count", 3, "HTF candles", 1, 5, 1), bool("htf3Timer", "W countdown", true, "HTF candles"), bool("htf3Lvls", "W levels", false, "HTF candles"),
  ],
  plots: [
    { key: "weeklyOpen", label: "Weekly open", color: "#ff9800", lineWidth: 1 },
    { key: "dailyOpen", label: "Daily open", color: "rgba(239,232,218,0.9)", lineWidth: 1, lineStyle: "dotted" },
  ],
  async compute(input: ComputeInput, params: Params) {
    if (!inTauri()) {
      if (import.meta.env.DEV) {
        try {
          const r = await fetch(`/dev/overlay-${input.tfSec}.json`);
          if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) { const overlay = (await r.json()) as Overlay; return { plots: overlay.plots, overlay }; }
        } catch { /* no saved overlay */ }
      }
      return { plots: {}, overlay: devFixture(input) };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const overlay = await invoke<Overlay>("compute_sealed", { bars: input.bars, ctx: input.ctx, tfSec: input.tfSec, params });
    return { plots: overlay.plots, overlay };
  },
};

/** Browser-only stand-in: generic shapes over the last bars so the drawing code can be seen working. Not the indicator. */
function devFixture({ bars, tfSec }: ComputeInput): Overlay {
  const n = bars.length;
  if (n < 60) return { boxes: [], hlines: [], vlines: [], texts: [], candles: [], plots: {}, htf: [], rightOffsetBars: 6, info: { gapMinutes: 300, tradingDate: "" } };
  const last = bars[n - 1];
  const slice = bars.slice(n - 40, n - 20);
  const hi = Math.max(...slice.map((b) => b.high)), lo = Math.min(...slice.map((b) => b.low));
  const hour = resample(bars, "1h").slice(-3);
  return {
    boxes: [{ t0: slice[0].time, t1: slice[slice.length - 1].time + tfSec, top: hi, bottom: lo, fill: "rgba(152,0,255,0.12)", border: "rgba(0,0,0,0)" }],
    hlines: [{ t0: bars[n - 60].time, t1: last.time + tfSec * 12, price: last.close, color: "rgba(239,232,218,0.9)", style: "solid", width: 1, label: "dev fixture" }],
    vlines: [{ t: bars[n - 10].time + tfSec / 2, top: bars[n - 10].high + 5, bottom: bars[n - 10].low - 5, color: "rgba(239,232,218,0.8)", style: "dashed" }],
    texts: [{ t: bars[n - 30].time, text: "D E V", position: "bottom", color: "#787b86" }],
    candles: bars.map((b, i) => (i > n - 15 && Math.abs(b.close - b.open) > 3 ? (b.close > b.open ? 1 : -1) : 0)),
    plots: {},
    htf: [{ name: "1H", candles: hour.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close })), closeTime: (hour[hour.length - 1]?.time ?? 0) + 3600, hiTime: bars[n - 5].time, loTime: bars[n - 8].time, levels: true, countdown: true, gap: 10 }],
    rightOffsetBars: 36,
    info: { gapMinutes: 300, tradingDate: new Date().toLocaleDateString("en-GB") },
  };
}
