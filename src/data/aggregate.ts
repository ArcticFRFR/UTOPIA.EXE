import type { Bar, Tick, Timeframe } from "@/lib/types";
import { timeframeSeconds } from "@/lib/types";

/** Floor a UNIX-seconds time to the open of its bar for the timeframe. Daily bars open at 22:00 UTC (CME Globex). */
export function barOpen(timeSec: number, tf: Timeframe): number {
  const size = timeframeSeconds(tf);
  if (tf === "1d") {
    const shifted = timeSec + 2 * 3600; // 22:00 UTC -> next calendar day boundary
    return Math.floor(shifted / 86400) * 86400 - 2 * 3600;
  }
  return Math.floor(timeSec / size) * size;
}

/** Resample bars (oldest first, any finer timeframe) into a coarser timeframe. */
export function resample(bars: Bar[], tf: Timeframe): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const open = barOpen(b.time, tf);
    if (!cur || cur.time !== open) {
      if (cur) out.push(cur);
      cur = { time: open, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Apply a tick to the tail of a bar list. Returns the bar that changed (new or updated)
 * so the chart can call `series.update()` with it.
 */
export function applyTick(bars: Bar[], tick: Tick, tf: Timeframe): Bar {
  const open = barOpen(Math.floor(tick.time / 1000), tf);
  const last = bars[bars.length - 1];
  if (last && last.time === open) {
    last.high = Math.max(last.high, tick.price);
    last.low = Math.min(last.low, tick.price);
    last.close = tick.price;
    last.volume += tick.size;
    return last;
  }
  if (last && open < last.time) {
    // Late tick for a closed bar: fold it into the last bar rather than rewriting history.
    last.close = tick.price;
    last.volume += tick.size;
    return last;
  }
  const bar: Bar = { time: open, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.size };
  bars.push(bar);
  return bar;
}
