import { describe, expect, it } from "vitest";
import { applyTick, barOpen, resample } from "./aggregate";
import type { Bar } from "@/lib/types";

const m = (i: number, o: number, h: number, l: number, c: number, v = 1): Bar => ({ time: i * 60, open: o, high: h, low: l, close: c, volume: v });

describe("barOpen", () => {
  it("floors minutes", () => {
    expect(barOpen(5 * 60 + 17, "5m")).toBe(5 * 60);
    expect(barOpen(14 * 60, "5m")).toBe(10 * 60);
  });
  it("daily bars open at 22:00 UTC", () => {
    const t = Date.UTC(2026, 0, 6, 23, 0) / 1000; // Tue 23:00 -> session opened Tue 22:00
    expect(barOpen(t, "1d")).toBe(Date.UTC(2026, 0, 6, 22, 0) / 1000);
    const u = Date.UTC(2026, 0, 6, 21, 0) / 1000; // Tue 21:00 -> session opened Mon 22:00
    expect(barOpen(u, "1d")).toBe(Date.UTC(2026, 0, 5, 22, 0) / 1000);
  });
});

describe("resample", () => {
  it("builds 5m bars from 1m", () => {
    const bars = [m(0, 10, 12, 9, 11), m(1, 11, 15, 11, 14), m(2, 14, 14, 8, 9), m(5, 9, 10, 9, 10)];
    const out = resample(bars, "5m");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ time: 0, open: 10, high: 15, low: 8, close: 9, volume: 3 });
    expect(out[1].time).toBe(300);
  });
});

describe("applyTick", () => {
  it("updates the live bar and opens a new one on the boundary", () => {
    const bars = [m(0, 10, 10, 10, 10)];
    applyTick(bars, { time: 30_000, price: 12, size: 2 }, "1m");
    expect(bars[0]).toEqual({ time: 0, open: 10, high: 12, low: 10, close: 12, volume: 3 });
    const nb = applyTick(bars, { time: 61_000, price: 11, size: 1 }, "1m");
    expect(bars).toHaveLength(2);
    expect(nb.time).toBe(60);
  });
});
