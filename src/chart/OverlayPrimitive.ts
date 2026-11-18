import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, PrimitivePaneViewZOrder,
  SeriesAttachedParameter, Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/types";
import type { Overlay } from "@/indicators/types";

/**
 * Draws a sealed overlay (boxes, lines, texts, HTF candle sets) onto the candlestick series.
 * Times are mapped through the bar array to logical indices, so shapes can reach past the last
 * bar (session ends, day ends, the HTF sets to the right) where `timeToCoordinate` would give null.
 */
export class OverlayPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private requestUpdate: (() => void) | null = null;
  private overlay: Overlay | null = null;
  private bars: Bar[] = [];
  private tfSec = 60;
  private timer: number | null = null;
  private readonly views: PaneView[] = [new PaneView(this, "bottom"), new PaneView(this, "normal"), new PaneView(this, "top")];

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick">;
    this.requestUpdate = p.requestUpdate;
    this.timer = window.setInterval(() => { if (this.overlay?.htf.some((h) => h.countdown)) this.requestUpdate?.(); }, 1000);
  }
  detached() {
    if (this.timer) clearInterval(this.timer);
    this.chart = null; this.series = null; this.requestUpdate = null;
  }
  setData(overlay: Overlay | null, bars: Bar[], tfSec: number) {
    this.overlay = overlay; this.bars = bars; this.tfSec = tfSec;
    this.requestUpdate?.();
  }
  updateAllViews() {}
  paneViews() { return this.views; }

  // ── coordinate helpers used by the renderer ──
  get data() { return this.overlay; }
  get barCount() { return this.bars.length; }
  logical(t: number): number {
    const b = this.bars;
    const n = b.length;
    if (n === 0) return 0;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / this.tfSec;
    if (t <= b[0].time) return (t - b[0].time) / this.tfSec;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
    return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
  }
  xOfTime(t: number): number | null { return this.chart?.timeScale().logicalToCoordinate(this.logical(t) as Logical) ?? null; }
  xOfLogical(l: number): number | null { return this.chart?.timeScale().logicalToCoordinate(l as Logical) ?? null; }
  y(price: number): number | null { return this.series?.priceToCoordinate(price) ?? null; }
}

class PaneView implements IPrimitivePaneView {
  constructor(private owner: OverlayPrimitive, private order: PrimitivePaneViewZOrder) {}
  zOrder() { return this.order; }
  renderer(): IPrimitivePaneRenderer { return { draw: (target) => draw(target, this.owner, this.order) }; }
}

const DASH: Record<string, number[]> = { solid: [], dashed: [6, 4], dotted: [2, 3] };
const FONT = "11px ui-monospace, Consolas, monospace";
const HTF_W = 2, HTF_HALF = 1, HTF_GAP = 1; // in bars, "Small"
const HTF_BULL = "#4c9a7f", HTF_BEAR = "#d9434f", HTF_LINE = "#efe8da";

function countdown(closeTime: number) {
  const ms = closeTime * 1000 - Date.now();
  if (ms <= 0) return "Closed";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function draw(target: CanvasRenderingTarget2D, o: OverlayPrimitive, order: PrimitivePaneViewZOrder) {
  const data = o.data;
  if (!data || o.barCount === 0) return;
  target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
    ctx.save();
    ctx.font = FONT;
    if (order === "bottom") {
      for (const b of data.boxes) {
        const x0 = o.xOfTime(b.t0), x1 = o.xOfTime(b.t1), y0 = o.y(b.top), y1 = o.y(b.bottom);
        if (x0 === null || x1 === null || y0 === null || y1 === null) continue;
        ctx.fillStyle = b.fill;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        if (b.border && b.border !== "rgba(0,0,0,0)") { ctx.strokeStyle = b.border; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1); }
      }
    } else if (order === "normal") {
      for (const l of data.hlines) {
        const x0 = o.xOfTime(l.t0), x1 = o.xOfTime(l.t1), y = o.y(l.price);
        if (x0 === null || x1 === null || y === null) continue;
        ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1; ctx.setLineDash(DASH[l.style] ?? []);
        ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke();
        if (l.label) { ctx.setLineDash([]); ctx.fillStyle = l.color; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(l.label, x1 + 4, y - 2); }
      }
      for (const v of data.vlines) {
        const x = o.xOfTime(v.t), y0 = o.y(v.top), y1 = o.y(v.bottom);
        if (x === null || y0 === null || y1 === null) continue;
        ctx.strokeStyle = v.color; ctx.lineWidth = 1; ctx.setLineDash(DASH[v.style] ?? []);
        ctx.beginPath(); ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const t of data.texts) {
        const x = o.xOfTime(t.t);
        if (x === null) continue;
        ctx.fillStyle = t.color; ctx.textAlign = "center"; ctx.textBaseline = t.position === "bottom" ? "bottom" : "top";
        ctx.fillText(t.text, x, t.position === "bottom" ? mediaSize.height - 6 : 6);
      }
    } else {
      // HTF candle sets to the right of the last bar
      const last = o.barCount - 1;
      const lastX = o.xOfLogical(last);
      for (const set of data.htf) {
        let x = last + set.gap;
        const startX = x;
        let top: number | null = null, topY: number | null = null;
        const n = set.candles.length;
        set.candles.forEach((c, i) => {
          const xl = o.xOfLogical(x), xr = o.xOfLogical(x + HTF_W), xm = o.xOfLogical(x + HTF_HALF);
          const yo = o.y(c.o), yc = o.y(c.c), yh = o.y(c.h), yl = o.y(c.l);
          if (xl !== null && xr !== null && xm !== null && yo !== null && yc !== null && yh !== null && yl !== null) {
            const bodyTop = Math.min(yo, yc), bodyBot = Math.max(yo, yc);
            ctx.fillStyle = c.c >= c.o ? HTF_BULL : HTF_BEAR;
            ctx.fillRect(xl, bodyTop, xr - xl, Math.max(1, bodyBot - bodyTop));
            ctx.strokeStyle = HTF_LINE; ctx.lineWidth = 1; ctx.setLineDash([]);
            ctx.strokeRect(xl + 0.5, bodyTop + 0.5, xr - xl - 1, Math.max(1, bodyBot - bodyTop) - 1);
            ctx.beginPath(); ctx.moveTo(xm + 0.5, yh); ctx.lineTo(xm + 0.5, bodyTop); ctx.moveTo(xm + 0.5, bodyBot); ctx.lineTo(xm + 0.5, yl); ctx.stroke();
            if (top === null || c.h > top) { top = c.h; topY = yh; }
            if (i === n - 1 && set.levels && lastX !== null) {
              // dotted lines back to where the live candle's high and low were made, and its prices
              ctx.setLineDash(DASH.dotted); ctx.strokeStyle = HTF_LINE;
              for (const [tt, price] of [[set.hiTime, c.h], [set.loTime, c.l]] as const) {
                const xs = o.xOfTime(tt), yy = o.y(price);
                if (xs === null || yy === null) continue;
                ctx.beginPath(); ctx.moveTo(xs, yy + 0.5); ctx.lineTo(xm, yy + 0.5); ctx.stroke();
              }
              ctx.setLineDash([]);
              ctx.fillStyle = HTF_LINE; ctx.textAlign = "left"; ctx.textBaseline = "middle";
              const px = xr + 4;
              for (const [price, yy] of [[c.h, yh], [c.o, yo], [c.c, yc], [c.l, yl]] as const) ctx.fillText(fmt(price), px, yy);
            }
          }
          x += HTF_W + HTF_GAP;
        });
        const endX = x - HTF_GAP;
        if (top !== null && topY !== null) {
          const cx = o.xOfLogical((startX + endX) / 2);
          if (cx !== null) {
            ctx.fillStyle = HTF_LINE; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
            const lines = set.countdown ? [set.name, countdown(set.closeTime)] : [set.name];
            lines.forEach((ln, i) => ctx.fillText(ln, cx, topY! - 8 - (lines.length - 1 - i) * 13));
          }
        }
      }
    }
    ctx.restore();
  });
}

function fmt(p: number) { return (Math.round(p * 4) / 4).toFixed(2); }
