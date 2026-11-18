import type { Bar } from "@/lib/types";

export interface IndicatorParam {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface PlotSpec {
  key: string;
  label: string;
  color: string;
  kind?: "line" | "histogram";
  lineWidth?: 1 | 2 | 3 | 4;
}

export type Params = Record<string, number>;
export type Plots = Record<string, Array<number | null>>;

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
  compute(bars: Bar[], params: Params): Plots | Promise<Plots>;
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
