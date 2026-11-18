import { describe, expect, it } from "vitest";
import { ema, sessionId, sessionVwap, sma } from "./math";

describe("moving averages", () => {
  it("sma", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("ema seeds with sma and warms", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });
});

describe("session", () => {
  it("resets at 22:00 UTC", () => {
    const d = Date.UTC(2026, 2, 3, 21, 59) / 1000;
    expect(sessionId(d)).not.toBe(sessionId(d + 60));
    expect(sessionId(d)).toBe(sessionId(d - 3600 * 10));
  });
  it("vwap restarts each session", () => {
    const t0 = Date.UTC(2026, 2, 3, 21, 59) / 1000;
    const bars = [
      { time: t0, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: t0 + 60, open: 20, high: 20, low: 20, close: 20, volume: 1 },
      { time: t0 + 120, open: 30, high: 30, low: 30, close: 30, volume: 1 },
    ];
    expect(sessionVwap(bars)).toEqual([10, 20, 25]);
  });
});
