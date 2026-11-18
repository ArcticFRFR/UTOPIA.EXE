import { ema, sessionVwap, sma, trueRange } from "./math";
import type { IndicatorDef } from "./types";

export const EMA: IndicatorDef = {
  id: "ema",
  name: "EMA",
  description: "Exponential moving average of the close.",
  pane: "price",
  params: [{ key: "len", label: "Length", default: 21, min: 1, max: 500, step: 1 }],
  plots: [{ key: "ema", label: "EMA", color: "#ff8a1f", lineWidth: 2 }],
  compute: (bars, p) => ({ ema: ema(bars.map((b) => b.close), Math.round(p.len)) }),
};

export const SMA: IndicatorDef = {
  id: "sma",
  name: "SMA",
  description: "Simple moving average of the close.",
  pane: "price",
  params: [{ key: "len", label: "Length", default: 50, min: 1, max: 500, step: 1 }],
  plots: [{ key: "sma", label: "SMA", color: "#d64aa0", lineWidth: 2 }],
  compute: (bars, p) => ({ sma: sma(bars.map((b) => b.close), Math.round(p.len)) }),
};

export const VWAP: IndicatorDef = {
  id: "vwap",
  name: "Session VWAP",
  description: "Volume-weighted average price, anchored to the Globex open (22:00 UTC).",
  pane: "price",
  params: [],
  plots: [{ key: "vwap", label: "VWAP", color: "#efe8da", lineWidth: 1 }],
  compute: (bars) => ({ vwap: sessionVwap(bars) }),
};

export const ATR: IndicatorDef = {
  id: "atr",
  name: "ATR",
  description: "Average true range (Wilder smoothing via EMA). Own pane.",
  pane: "below",
  params: [{ key: "len", label: "Length", default: 14, min: 1, max: 200, step: 1 }],
  plots: [{ key: "atr", label: "ATR", color: "#8d879a", lineWidth: 1 }],
  compute: (bars, p) => ({ atr: ema(trueRange(bars), Math.round(p.len)) }),
};

export const BUILTINS: IndicatorDef[] = [EMA, SMA, VWAP, ATR];
