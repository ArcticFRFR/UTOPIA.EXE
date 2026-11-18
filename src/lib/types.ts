/** One OHLCV bar. `time` is UNIX seconds (UTC) at the bar's open. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A last-trade tick. `time` is UNIX milliseconds. */
export interface Tick {
  time: number;
  price: number;
  size: number;
}

export type Timeframe = "1m" | "2m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export const TIMEFRAMES: Timeframe[] = ["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];

export function timeframeSeconds(tf: Timeframe): number {
  const n = parseInt(tf, 10);
  if (tf.endsWith("m")) return n * 60;
  if (tf.endsWith("h")) return n * 3600;
  return n * 86400;
}

export interface ContractInfo {
  /** Provider-specific id (Tradovate contract id, ProjectX "CON.F.US.ENQ.Z25", ...). */
  id: string;
  /** Display symbol, e.g. NQZ6. */
  symbol: string;
  description?: string;
  tickSize: number;
  pointValue?: number;
}

export type FeedState = "idle" | "connecting" | "live" | "demo" | "error";
