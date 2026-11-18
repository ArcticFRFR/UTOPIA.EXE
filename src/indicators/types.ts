import type { Bar } from "@/lib/types";

export interface IndicatorParam {
  key: string;
  label: string;
  default: number;
  type?: "number" | "bool";
  min?: number;
  max?: number;
  step?: number;
  /** Group heading in the panel. */
  group?: string;
}

export interface PlotSpec {
  key: string;
  label: string;
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: "solid" | "dotted" | "dashed";
}

export type Params = Record<string, number>;
export type Plots = Record<string, Array<number | null>>;

/** What the sealed overlay sends back to be drawn. Mirrors `Overlay` in src-tauri/src/sealed.rs. */
export interface Overlay {
  boxes: Array<{ t0: number; t1: number; top: number; bottom: number; fill: string; border: string }>;
  hlines: Array<{ t0: number; t1: number; price: number; color: string; style: "solid" | "dashed" | "dotted"; width: number; label: string | null }>;
  vlines: Array<{ t: number; top: number; bottom: number; color: string; style: "solid" | "dashed" | "dotted" }>;
  texts: Array<{ t: number; text: string; position: "top" | "bottom"; color: string }>;
  candles: number[];
  plots: Plots;
  htf: Array<{ name: string; candles: Array<{ o: number; h: number; l: number; c: number }>; closeTime: number; hiTime: number; loTime: number; levels: boolean; countdown: boolean; gap: number }>;
  rightOffsetBars: number;
  info: { gapMinutes: number; tradingDate: string };
}

export interface ComputeInput {
  bars: Bar[];
  /** 1-hour bars reaching weeks back, for higher-timeframe context. */
  ctx: Bar[];
  tfSec: number;
}

export interface IndicatorResult {
  plots: Plots;
  overlay?: Overlay;
}

export interface IndicatorDef {
  id: string;
  name: string;
  description: string;
  /** "price" draws on the candles; "below" gets its own pane. */
  pane: "price" | "below";
  /** True for the indicator compiled into the .exe (Rust side). */
  sealed?: boolean;
  params: IndicatorParam[];
  plots: PlotSpec[];
  compute(input: ComputeInput, params: Params): IndicatorResult | Promise<IndicatorResult>;
}

export interface IndicatorInstance {
  key: string; // unique per instance
  defId: string;
  params: Params;
  enabled: boolean;
}

export function defaultParams(def: IndicatorDef): Params {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}
