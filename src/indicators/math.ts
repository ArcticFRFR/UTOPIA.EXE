import type { Bar } from "@/lib/types";

export function ema(values: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (len <= 0 || values.length < len) return out;
  const k = 2 / (len + 1);
  let e = values.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = e;
  for (let i = len; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function sma(values: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (len <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= len) sum -= values[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function trueRange(bars: Bar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
}

/** CME Globex session id: the session opens 22:00 UTC. */
export function sessionId(timeSec: number): number {
  return Math.floor((timeSec + 2 * 3600) / 86400);
}

export function sessionVwap(bars: Bar[]): Array<number | null> {
  const out: Array<number | null> = [];
  let pv = 0, v = 0, sid = Number.NaN;
  for (const b of bars) {
    const s = sessionId(b.time);
    if (s !== sid) { sid = s; pv = 0; v = 0; }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume; v += b.volume;
    out.push(v > 0 ? pv / v : null);
  }
  return out;
}
