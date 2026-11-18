import type { Bar } from "@/lib/types";

/** Fractional bar index for a time; extrapolates past either end so shapes can live off the data. */
export function logicalOfTime(bars: Bar[], tfSec: number, t: number): number {
  const n = bars.length;
  if (n === 0) return 0;
  if (t >= bars[n - 1].time) return n - 1 + (t - bars[n - 1].time) / tfSec;
  if (t <= bars[0].time) return (t - bars[0].time) / tfSec;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bars[m].time <= t) lo = m; else hi = m; }
  return lo + (t - bars[lo].time) / (bars[hi].time - bars[lo].time);
}

/** Inverse of logicalOfTime. */
export function timeOfLogical(bars: Bar[], tfSec: number, l: number): number {
  const n = bars.length;
  if (n === 0) return 0;
  if (l >= n - 1) return bars[n - 1].time + (l - (n - 1)) * tfSec;
  if (l <= 0) return bars[0].time + l * tfSec;
  const i = Math.floor(l);
  return bars[i].time + (l - i) * (bars[i + 1].time - bars[i].time);
}
