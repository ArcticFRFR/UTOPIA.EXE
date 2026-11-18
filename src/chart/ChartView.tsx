import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
  type IChartApi, type ISeriesApi, type MouseEventParams, type UTCTimestamp,
} from "lightweight-charts";
import { DrawingLayer } from "./DrawingLayer";
import { OverlayPrimitive } from "./OverlayPrimitive";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@/lib/types";
import type { Results } from "@/indicators/engine";
import { byId } from "@/indicators/engine";
import type { IndicatorInstance } from "@/indicators/types";

interface Props {
  bars: React.MutableRefObject<Bar[]>;
  version: number;
  lastBar: Bar | null;
  instances: IndicatorInstance[];
  results: Results;
  tickSize: number;
  tfSec: number;
  symbol: string;
  tf: string;
}

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

const VEC_BULL = "#22c55e", VEC_BEAR = "#ef4444", VEC_BORDER = "#efe8da";
const WATERMARK = { title: "Arctic x Apostles", sub: "Arctic :)" };

export function ChartView({ bars, version, lastBar, instances, results, tickSize, tfSec, symbol, tf }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef(new Map<string, ISeriesApi<"Line">>()); // `${instanceKey}:${plotKey}`
  const overlays = useRef(new Map<string, OverlayPrimitive>()); // instanceKey -> primitive
  const flags = useRef<number[]>([]); // per-bar vector candle flags from the overlay
  const [hover, setHover] = useState<{ bar: Bar; values: Record<string, number | null> } | null>(null);
  const [ready, setReady] = useState<{ chart: IChartApi; series: ISeriesApi<"Candlestick"> } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const precision = useMemo(() => Math.max(0, Math.ceil(-Math.log10(tickSize))), [tickSize]);

  // Create the chart once.
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#07060b" }, textColor: "#8d879a", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, panes: { separatorColor: "rgba(255,255,255,.08)", separatorHoverColor: "rgba(255,138,31,.4)", enableResize: true } },
      grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.04)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(239,232,218,.3)", labelBackgroundColor: "#1e1829" }, horzLine: { color: "rgba(239,232,218,.3)", labelBackgroundColor: "#1e1829" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,.08)", scaleMargins: { top: 0.06, bottom: 0.22 } },
      timeScale: { borderColor: "rgba(255,255,255,.08)", timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      localization: { timeFormatter: (t: UTCTimestamp) => fmtTime(t as number) },
    });
    chart.current = c;
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: "#39d98a", downColor: "#ff4d6a", borderVisible: false, wickUpColor: "#39d98a", wickDownColor: "#ff4d6a",
      priceFormat: { type: "price", precision, minMove: tickSize },
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(141,135,154,.35)", lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const onMove = (p: MouseEventParams) => {
      if (!p.time || !candles.current) { setHover(null); return; }
      const d = p.seriesData.get(candles.current) as Bar | undefined;
      if (!d) { setHover(null); return; }
      const vals: Record<string, number | null> = {};
      for (const [k, s] of lines.current) {
        const v = p.seriesData.get(s) as { value?: number } | undefined;
        vals[k] = v?.value ?? null;
      }
      const vol = p.seriesData.get(volume.current!) as { value?: number } | undefined;
      setHover({ bar: { time: p.time as number, open: d.open, high: d.high, low: d.low, close: d.close, volume: vol?.value ?? 0 }, values: vals });
    };
    c.subscribeCrosshairMove(onMove);
    setReady({ chart: c, series: candles.current });
    return () => {
      setReady(null);
      c.unsubscribeCrosshairMove(onMove);
      for (const prim of overlays.current.values()) prim.detached();
      overlays.current.clear();
      c.remove();
      chart.current = null; candles.current = null; volume.current = null;
      lines.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    candles.current?.applyOptions({ priceFormat: { type: "price", precision, minMove: tickSize } });
  }, [precision, tickSize]);

  // Full data load.
  useEffect(() => {
    const data = bars.current;
    candles.current?.setData(data.map((b, i) => candleItem(b, flags.current[i] ?? 0)));
    volume.current?.setData(data.map((b) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? "rgba(57,217,138,.28)" : "rgba(255,77,106,.28)" })));
    const n = data.length;
    chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 300), to: n + 6 });
  }, [bars, version]);

  // Live bar.
  useEffect(() => {
    if (!lastBar) return;
    candles.current?.update(candleItem(lastBar, flags.current[bars.current.length - 1] ?? 0));
    volume.current?.update({ time: lastBar.time as UTCTimestamp, value: lastBar.volume, color: lastBar.close >= lastBar.open ? "rgba(57,217,138,.28)" : "rgba(255,77,106,.28)" });
  }, [lastBar]);

  // Indicator series: create/remove to match instances, then push values.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const want = new Set<string>();
    let belowPane = 1;
    const paneOf = new Map<string, number>();
    for (const inst of instances) {
      const def = byId(inst.defId);
      if (!def || !inst.enabled) continue;
      if (def.pane === "below") paneOf.set(inst.key, belowPane++);
      for (const plot of def.plots) {
        const k = `${inst.key}:${plot.key}`;
        want.add(k);
        if (!lines.current.has(k)) {
          const s = c.addSeries(LineSeries, {
            color: plot.color, lineWidth: plot.lineWidth ?? 2, priceLineVisible: false, lastValueVisible: def.pane === "below",
            crosshairMarkerVisible: false, title: "",
            lineStyle: plot.lineStyle === "dotted" ? LineStyle.Dotted : plot.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
          }, def.pane === "below" ? paneOf.get(inst.key) : 0);
          lines.current.set(k, s);
          if (def.pane === "below") {
            // Lower panes take a quarter of the main pane's height each.
            const pane = c.panes()[paneOf.get(inst.key)!];
            pane?.setStretchFactor(0.25);
          }
        }
      }
    }
    for (const [k, s] of [...lines.current]) {
      if (!want.has(k)) { c.removeSeries(s); lines.current.delete(k); }
    }
    const data = bars.current;
    // Overlays (sealed drawings): one primitive per instance that returns one.
    let rightOffset = 6;
    let newFlags: number[] = [];
    for (const inst of instances) {
      const ov = inst.enabled ? results.get(inst.key)?.overlay : undefined;
      let prim = overlays.current.get(inst.key);
      if (ov && candles.current) {
        if (!prim) { prim = new OverlayPrimitive(); candles.current.attachPrimitive(prim); overlays.current.set(inst.key, prim); }
        prim.setData(ov, data, tfSec);
        rightOffset = Math.max(rightOffset, ov.rightOffsetBars);
        if (ov.candles.length) newFlags = ov.candles;
      } else if (prim) {
        candles.current?.detachPrimitive(prim); overlays.current.delete(inst.key);
      }
    }
    for (const [k, prim] of [...overlays.current]) if (!instances.some((i) => i.key === k)) { candles.current?.detachPrimitive(prim); overlays.current.delete(k); }
    c.timeScale().applyOptions({ rightOffset: OverlayPrimitive.rightOffsetBars(c, rightOffset) });
    if (flagsChanged(flags.current, newFlags)) {
      flags.current = newFlags;
      candles.current?.setData(data.map((b, i) => candleItem(b, newFlags[i] ?? 0)));
    }
    for (const inst of instances) {
      const plots = results.get(inst.key)?.plots;
      if (!plots) continue;
      for (const [plotKey, values] of Object.entries(plots)) {
        const s = lines.current.get(`${inst.key}:${plotKey}`);
        if (!s) continue;
        const pts: Array<{ time: UTCTimestamp; value: number }> = [];
        for (let i = 0; i < data.length && i < values.length; i++) {
          const v = values[i];
          if (v !== null && Number.isFinite(v)) pts.push({ time: data[i].time as UTCTimestamp, value: v });
        }
        s.setData(pts);
      }
    }
  }, [instances, results, bars, version, tfSec]);

  const info = useMemo(() => {
    for (const inst of instances) { const ov = results.get(inst.key)?.overlay; if (ov) return ov.info; }
    return null;
  }, [instances, results]);

  const shown = hover?.bar ?? lastBar ?? bars.current[bars.current.length - 1];
  const chg = shown ? shown.close - shown.open : 0;

  return (
    <div className="chart-wrap" ref={wrap}>
      <div ref={el} className="lw" />
      <DrawingLayer chart={ready?.chart ?? null} series={ready?.series ?? null} bars={bars} version={version} tfSec={tfSec} symbol={symbol} container={wrap} />
      <div className="wm top"><b>{WATERMARK.title}</b><span>{WATERMARK.sub}</span></div>
      <div className="wm bottom">
        <span>{info?.tradingDate || new Date().toLocaleDateString("en-GB")}</span>
        <span>{symbol} | {tf.toUpperCase()}</span>
        {info && <span>London +{(info.gapMinutes / 60).toString()}h vs New York{info.gapMinutes !== 300 ? "  (UK & US clocks out of step)" : ""}</span>}
      </div>
      <div className="legend">
        {shown && (
          <div className="row">
            <span>O <i>{shown.open.toFixed(precision)}</i></span>
            <span>H <i>{shown.high.toFixed(precision)}</i></span>
            <span>L <i>{shown.low.toFixed(precision)}</i></span>
            <span>C <i>{shown.close.toFixed(precision)}</i></span>
            <span style={{ color: chg >= 0 ? "var(--up)" : "var(--down)" }}>{chg >= 0 ? "+" : ""}{chg.toFixed(precision)}</span>
            <span>V <i>{Math.round(shown.volume).toLocaleString()}</i></span>
          </div>
        )}
        {instances.filter((i) => i.enabled).map((inst) => {
          const def = byId(inst.defId);
          if (!def) return null;
          return def.plots.map((p) => {
            const k = `${inst.key}:${p.key}`;
            const v = hover ? hover.values[k] : lastValue(results.get(inst.key)?.plots[p.key]);
            return (
              <div className="ind" key={k}>
                <span className="sw" style={{ background: p.color }} />
                <span>{def.name}{def.plots.length > 1 ? ` ${p.label}` : ""}{paramSuffix(inst)}</span>
                <b>{v === null || v === undefined ? "–" : v.toFixed(def.pane === "below" ? 2 : precision)}</b>
                {def.sealed && <span className="seal" title="Sealed: computed inside the program">封</span>}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

function candleItem(b: Bar, flag: number) {
  const base = { time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close };
  if (flag === 0) return base;
  const col = flag > 0 ? VEC_BULL : VEC_BEAR;
  return { ...base, color: col, wickColor: col, borderColor: VEC_BORDER };
}
function flagsChanged(a: number[], b: number[]) {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}
function lastValue(arr?: Array<number | null>) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i];
  return null;
}
function paramSuffix(inst: IndicatorInstance) {
  const def = byId(inst.defId);
  if (!def || def.sealed) return "";
  const vals = def.params.filter((p) => p.type !== "bool").map((p) => inst.params[p.key] ?? p.default);
  return vals.length ? ` ${vals.join(" ")}` : "";
}
