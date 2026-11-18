import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { Bar } from "@/lib/types";
import { logicalOfTime, timeOfLogical } from "./coords";
import { DASH, distToSegment, FIB_LEVELS, FIBEXT_LEVELS, hexAlpha, type Drawing, type Point } from "./drawings";

export type Hit = { id: string; part: "body" | number } | null;
type XY = [number, number];

const FONT = "12px ui-sans-serif, system-ui, sans-serif";
const MONO = "11px ui-monospace, Consolas, monospace";

/** Renders the user's drawings on the candlestick series and answers hit tests for the drawing layer. */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private requestUpdate: (() => void) | null = null;
  private bars: Bar[] = [];
  private tfSec = 60;
  drawings: Drawing[] = [];
  draft: Drawing | null = null;
  selectedId: string | null = null;
  hidden = false;
  magnet = false;
  precision = 2;
  private readonly view: IPrimitivePaneView = { zOrder: () => "top", renderer: () => ({ draw: (t) => this.draw(t) }) };

  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart; this.series = p.series as ISeriesApi<"Candlestick">; this.requestUpdate = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return [this.view]; }

  setBars(bars: Bar[], tfSec: number, precision: number) { this.bars = bars; this.tfSec = tfSec; this.precision = precision; this.requestUpdate?.(); }
  setState(drawings: Drawing[], draft: Drawing | null, selectedId: string | null, hidden: boolean, magnet: boolean) {
    this.drawings = drawings; this.draft = draft; this.selectedId = selectedId; this.hidden = hidden; this.magnet = magnet; this.requestUpdate?.();
  }

  // ── coordinates ──
  x(t: number): number | null { return this.chart?.timeScale().logicalToCoordinate(logicalOfTime(this.bars, this.tfSec, t) as Logical) ?? null; }
  y(p: number): number | null { return this.series?.priceToCoordinate(p) ?? null; }
  /** Pixel → (time, price); with the magnet on, the price snaps to the nearest open/high/low/close within 15px. */
  pointAt(x: number, y: number, snap = this.magnet): Point | null {
    const l = this.chart?.timeScale().coordinateToLogical(x);
    const p = this.series?.coordinateToPrice(y);
    if (l === null || l === undefined || p === null || p === undefined) return null;
    const point: Point = { t: timeOfLogical(this.bars, this.tfSec, l as number), p: p as number };
    if (snap) {
      const bar = this.bars[Math.round(l as number)];
      if (bar) {
        let best: number | null = null, bestD = 15;
        for (const v of [bar.open, bar.high, bar.low, bar.close]) {
          const yy = this.y(v);
          if (yy !== null && Math.abs(yy - y) < bestD) { bestD = Math.abs(yy - y); best = v; }
        }
        if (best !== null) { point.p = best; point.t = bar.time; }
      }
    }
    return point;
  }
  deltaAt(dx: number, dy: number, ref: Point): { dt: number; dp: number } | null {
    const x0 = this.x(ref.t), y0 = this.y(ref.p);
    if (x0 === null || y0 === null) return null;
    const moved = this.pointAt(x0 + dx, y0 + dy, false);
    return moved ? { dt: moved.t - ref.t, dp: moved.p - ref.p } : null;
  }
  barsBetween(t0: number, t1: number) { return Math.round(logicalOfTime(this.bars, this.tfSec, t1) - logicalOfTime(this.bars, this.tfSec, t0)); }

  private px(d: Drawing): Array<XY | null> {
    return d.points.map((pt) => { const x = this.x(pt.t), y = this.y(pt.p); return x === null || y === null ? null : [x, y]; });
  }

  /** Line through a and b clipped to the canvas, extended as asked. */
  private lineEnds(a: XY, b: XY, left: boolean, right: boolean, w: number, h: number): [XY, XY] {
    if (!left && !right) return [a, b];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) < 1e-6) return [[a[0], left ? -10 : Math.min(a[1], b[1])], [a[0], right ? h + 10 : Math.max(a[1], b[1])]];
    const at = (x: number): XY => [x, a[1] + (dy / dx) * (x - a[0])];
    const dir = dx >= 0;
    const start = left ? at(dir ? -10 : w + 10) : a;
    const end = right ? at(dir ? w + 10 : -10) : b;
    return [start, end];
  }

  /** Topmost drawing under the pixel: handles of the selected one first, then bodies. */
  hitDrawing(x: number, y: number, width: number, height: number): Hit {
    if (this.hidden) return null;
    const sel = this.drawings.find((d) => d.id === this.selectedId);
    if (sel && !sel.locked) {
      const pts = this.px(sel);
      for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; if (q && Math.hypot(x - q[0], y - q[1]) <= 8) return { id: sel.id, part: i }; }
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (this.hits(d, x, y, width, height)) return { id: d.id, part: "body" };
    }
    return null;
  }

  private hits(d: Drawing, x: number, y: number, w: number, h: number): boolean {
    const pts = this.px(d);
    const a = pts[0];
    if (!a) return false;
    const b = pts[1] ?? null, c = pts[2] ?? null;
    const near = (p: XY, q: XY) => distToSegment(x, y, p[0], p[1], q[0], q[1]) <= 6;
    const inBox = (p: XY, q: XY, pad = 4) => x >= Math.min(p[0], q[0]) - pad && x <= Math.max(p[0], q[0]) + pad && y >= Math.min(p[1], q[1]) - pad && y <= Math.max(p[1], q[1]) + pad;
    switch (d.type) {
      case "hline": return Math.abs(y - a[1]) <= 6;
      case "hray": return Math.abs(y - a[1]) <= 6 && x >= a[0] - 6;
      case "vline": return Math.abs(x - a[0]) <= 6;
      case "cross": return Math.abs(y - a[1]) <= 6 || Math.abs(x - a[0]) <= 6;
      case "text": case "note": return inBox(a, [a[0] + 8 * ((d.text?.length ?? 2) + 1), a[1] - 18], 4);
      case "pricelabel": return inBox([a[0] - 2, a[1] - 10], [a[0] + 70, a[1] + 10]);
      case "arrowup": return inBox([a[0] - 8, a[1]], [a[0] + 8, a[1] + 22]);
      case "arrowdown": return inBox([a[0] - 8, a[1] - 22], [a[0] + 8, a[1]]);
      case "trend": case "info": case "arrow": case "measure": return !!b && (() => { const [s, e] = this.lineEnds(a, b, !!d.extendLeft, !!d.extendRight, w, h); return near(s, e); })();
      case "ray": return !!b && (() => { const [s, e] = this.lineEnds(a, b, false, true, w, h); return near(s, e); })();
      case "extended": return !!b && (() => { const [s, e] = this.lineEnds(a, b, true, true, w, h); return near(s, e); })();
      case "channel": {
        if (!b || !c) return false;
        const off: XY = [c[0] - a[0], c[1] - a[1]];
        const a2: XY = [a[0] + off[0], a[1] + off[1]], b2: XY = [b[0] + off[0], b[1] + off[1]];
        const [s1, e1] = this.lineEnds(a, b, !!d.extendLeft, !!d.extendRight, w, h), [s2, e2] = this.lineEnds(a2, b2, !!d.extendLeft, !!d.extendRight, w, h);
        return near(s1, e1) || near(s2, e2) || pointInPoly(x, y, [s1, e1, e2, s2]);
      }
      case "fibret": return !!b && inBox(a, b, 6);
      case "fibext": return !!b && !!c && (near(a, b) || near(b, c) || inBox(c, [Math.max(a[0], b[0], c[0]) + 40, c[1] - (b[1] - a[1]) * 1.618], 6));
      case "long": case "short": return !!b && !!c && inBox([a[0], Math.min(b[1], c[1])], [b[0], Math.max(b[1], c[1])]);
      case "rect": return !!b && inBox(a, b);
      case "ellipse": {
        if (!b) return false;
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2 + 4, ry = Math.abs(b[1] - a[1]) / 2 + 4;
        return rx > 0 && ry > 0 && ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1;
      }
      case "triangle": return !!b && !!c && (pointInPoly(x, y, [a, b, c]) || near(a, b) || near(b, c) || near(c, a));
      case "path": case "brush": {
        for (let i = 1; i < pts.length; i++) { const p = pts[i - 1], q = pts[i]; if (p && q && near(p, q)) return true; }
        return pts.length === 1 && Math.hypot(x - a[0], y - a[1]) <= 6;
      }
    }
    return false;
  }

  private draw(target: CanvasRenderingTarget2D) {
    if (this.hidden) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = mediaSize.width, h = mediaSize.height;
      ctx.save();
      const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
      for (const d of all) {
        const pts = this.px(d);
        const a = pts[0];
        if (!a) continue;
        const b = pts[1] ?? null, c = pts[2] ?? null;
        ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = d.width; ctx.setLineDash(DASH[d.style] ?? []);
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.font = FONT; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        const seg = (p: XY, q: XY) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
        const label = (text: string, x: number, y: number, align: CanvasTextAlign = "left", bg = true) => {
          ctx.setLineDash([]); ctx.font = MONO; ctx.textAlign = align; ctx.textBaseline = "middle";
          const tw = ctx.measureText(text).width;
          const x0 = align === "left" ? x : align === "right" ? x - tw : x - tw / 2;
          if (bg) { ctx.fillStyle = "rgba(7,6,11,.8)"; ctx.fillRect(x0 - 3, y - 8, tw + 6, 16); }
          ctx.fillStyle = d.color; ctx.fillText(text, x, y); ctx.font = FONT; ctx.setLineDash(DASH[d.style] ?? []);
        };
        switch (d.type) {
          case "hline": seg([0, a[1]], [w, a[1]]); if (d.text) label(d.text, 8, a[1] - 10, "left", false); break;
          case "hray": seg(a, [w, a[1]]); break;
          case "vline": seg([a[0], 0], [a[0], h]); break;
          case "cross": seg([0, a[1]], [w, a[1]]); seg([a[0], 0], [a[0], h]); break;
          case "trend": case "ray": case "extended": case "info": case "arrow": case "measure": {
            if (!b) break;
            const [s, e] = this.lineEnds(a, b, d.type === "extended" || !!d.extendLeft, d.type === "ray" || d.type === "extended" || !!d.extendRight, w, h);
            seg(s, e);
            if (d.type === "arrow") arrowHead(ctx, a, b, 10);
            if (d.type === "info" || d.type === "measure") {
              const dp = d.points[1].p - d.points[0].p, pct = (dp / d.points[0].p) * 100, nb = this.barsBetween(d.points[0].t, d.points[1].t);
              const dur = fmtDuration(Math.abs(d.points[1].t - d.points[0].t));
              if (d.type === "measure") {
                ctx.fillStyle = hexAlpha(dp >= 0 ? "#39d98a" : "#ff2a3c", 0.12);
                ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
              }
              label(`${dp >= 0 ? "+" : ""}${dp.toFixed(this.precision)} (${pct.toFixed(2)}%)  ${nb} bars · ${dur}`, (a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 14, "center");
            }
            break;
          }
          case "channel": {
            if (!b) break;
            const off: XY = c ? [c[0] - a[0], c[1] - a[1]] : [0, 0];
            const [s1, e1] = this.lineEnds(a, b, !!d.extendLeft, !!d.extendRight, w, h);
            seg(s1, e1);
            if (c) {
              const [s2, e2] = this.lineEnds([a[0] + off[0], a[1] + off[1]], [b[0] + off[0], b[1] + off[1]], !!d.extendLeft, !!d.extendRight, w, h);
              seg(s2, e2);
              ctx.fillStyle = hexAlpha(d.color, 0.1); ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.lineTo(s2[0], s2[1]); ctx.closePath(); ctx.fill();
              ctx.setLineDash([2, 4]); seg([(s1[0] + s2[0]) / 2, (s1[1] + s2[1]) / 2], [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2]);
            }
            break;
          }
          case "fibret": {
            if (!b) break;
            const p0 = d.points[0].p, p1 = d.points[1].p;
            const x0 = Math.min(a[0], b[0]), x1 = d.extendRight ? w : Math.max(a[0], b[0]);
            ctx.setLineDash([2, 4]); seg(a, b); ctx.setLineDash([]);
            let prevY: number | null = null;
            for (const [lv, col] of FIB_LEVELS) {
              const price = p1 - (p1 - p0) * lv;
              const yy = this.y(price);
              if (yy === null) continue;
              if (prevY !== null) { ctx.fillStyle = hexAlpha(col, 0.07); ctx.fillRect(x0, Math.min(prevY, yy), x1 - x0, Math.abs(yy - prevY)); }
              ctx.strokeStyle = col; ctx.lineWidth = 1; seg([x0, yy], [x1, yy]);
              ctx.fillStyle = col; ctx.font = MONO; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(`${lv} (${price.toFixed(this.precision)})`, x0 - 4, yy + 5);
              prevY = yy;
            }
            break;
          }
          case "fibext": {
            if (!b) break;
            ctx.setLineDash([2, 4]); seg(a, b); if (c) seg(b, c); ctx.setLineDash([]);
            if (!c) break;
            const range = d.points[1].p - d.points[0].p, base = d.points[2].p;
            const x0 = c[0], x1 = d.extendRight ? w : c[0] + Math.max(60, Math.abs(b[0] - a[0]));
            for (const [lv, col] of FIBEXT_LEVELS) {
              const price = base + range * lv;
              const yy = this.y(price);
              if (yy === null) continue;
              ctx.strokeStyle = col; ctx.lineWidth = 1; seg([x0, yy], [x1, yy]);
              ctx.fillStyle = col; ctx.font = MONO; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(`${lv} (${price.toFixed(this.precision)})`, x1 + 4, yy + 5);
            }
            break;
          }
          case "long": case "short": {
            if (!b || !c) break;
            const entry = d.points[0].p, tgt = d.points[1].p, stp = d.points[2].p;
            const x0 = a[0], x1 = Math.max(b[0], a[0] + 20);
            const yE = a[1], yT = b[1], yS = c[1];
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(57,217,138,.18)"; ctx.fillRect(x0, Math.min(yE, yT), x1 - x0, Math.abs(yT - yE));
            ctx.fillStyle = "rgba(255,42,60,.18)"; ctx.fillRect(x0, Math.min(yE, yS), x1 - x0, Math.abs(yS - yE));
            ctx.strokeStyle = "rgba(239,232,218,.7)"; ctx.lineWidth = 1; seg([x0, yE], [x1, yE]);
            ctx.strokeStyle = "#39d98a"; seg([x0, yT], [x1, yT]); ctx.strokeStyle = "#ff2a3c"; seg([x0, yS], [x1, yS]);
            const reward = Math.abs(tgt - entry), risk = Math.abs(stp - entry), rr = risk > 0 ? reward / risk : 0;
            ctx.fillStyle = "#39d98a"; ctx.font = MONO; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
            ctx.fillText(`Target ${tgt.toFixed(this.precision)}  +${reward.toFixed(this.precision)}  R/R ${rr.toFixed(2)}`, x0 + 4, yT - 3);
            ctx.fillStyle = "#ff2a3c"; ctx.textBaseline = "top"; ctx.fillText(`Stop ${stp.toFixed(this.precision)}  -${risk.toFixed(this.precision)}`, x0 + 4, yS + 3);
            ctx.fillStyle = "#efe8da"; ctx.textBaseline = "middle"; ctx.fillText(`${d.type === "long" ? "Long" : "Short"} ${entry.toFixed(this.precision)}`, x1 + 6, yE);
            break;
          }
          case "rect": {
            if (!b) break;
            const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), rw = Math.abs(b[0] - a[0]), rh = Math.abs(b[1] - a[1]);
            ctx.fillStyle = hexAlpha(d.color, 0.12); ctx.fillRect(x0, y0, rw, rh); ctx.strokeRect(x0 + 0.5, y0 + 0.5, rw, rh);
            if (d.text) { ctx.fillStyle = d.color; ctx.textBaseline = "top"; ctx.fillText(d.text, x0 + 6, y0 + 4); }
            break;
          }
          case "ellipse": {
            if (!b) break;
            ctx.beginPath(); ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
            ctx.fillStyle = hexAlpha(d.color, 0.12); ctx.fill(); ctx.stroke();
            break;
          }
          case "triangle": {
            if (!b) break;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); if (c) { ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fillStyle = hexAlpha(d.color, 0.12); ctx.fill(); } ctx.stroke();
            break;
          }
          case "path": case "brush": {
            ctx.beginPath(); ctx.moveTo(a[0], a[1]);
            for (let i = 1; i < pts.length; i++) { const q = pts[i]; if (q) ctx.lineTo(q[0], q[1]); }
            ctx.stroke();
            if (d.type === "path" && b) arrowHead(ctx, pts[pts.length - 2] ?? a, pts[pts.length - 1] ?? b, 8);
            break;
          }
          case "text": ctx.fillText(d.text ?? "", a[0], a[1]); break;
          case "note": {
            const text = d.text ?? "";
            ctx.font = FONT; const tw = ctx.measureText(text).width;
            const bx = a[0] + 14, by = a[1] - 34;
            ctx.setLineDash([]); ctx.fillStyle = hexAlpha(d.color, 0.15); ctx.strokeStyle = d.color; ctx.lineWidth = 1;
            ctx.fillRect(bx, by, tw + 12, 22); ctx.strokeRect(bx + 0.5, by + 0.5, tw + 12, 22);
            seg(a, [bx, by + 22]);
            ctx.fillStyle = d.color; ctx.textBaseline = "middle"; ctx.fillText(text, bx + 6, by + 11);
            break;
          }
          case "pricelabel": {
            const text = d.points[0].p.toFixed(this.precision);
            ctx.font = MONO; const tw = ctx.measureText(text).width;
            ctx.setLineDash([]); ctx.fillStyle = d.color;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + 8, a[1] - 9); ctx.lineTo(a[0] + 8 + tw + 10, a[1] - 9); ctx.lineTo(a[0] + 8 + tw + 10, a[1] + 9); ctx.lineTo(a[0] + 8, a[1] + 9); ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#07060b"; ctx.textBaseline = "middle"; ctx.fillText(text, a[0] + 13, a[1]);
            break;
          }
          case "arrowup": case "arrowdown": {
            const up = d.type === "arrowup";
            ctx.setLineDash([]); ctx.fillStyle = d.color; ctx.beginPath();
            const dir = up ? 1 : -1;
            ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] - 7, a[1] + 9 * dir); ctx.lineTo(a[0] - 3, a[1] + 9 * dir); ctx.lineTo(a[0] - 3, a[1] + 20 * dir); ctx.lineTo(a[0] + 3, a[1] + 20 * dir); ctx.lineTo(a[0] + 3, a[1] + 9 * dir); ctx.lineTo(a[0] + 7, a[1] + 9 * dir); ctx.closePath(); ctx.fill();
            if (d.text) { ctx.textAlign = "center"; ctx.textBaseline = up ? "top" : "bottom"; ctx.fillText(d.text, a[0], a[1] + 22 * dir); }
            break;
          }
        }
        if (d.id === this.selectedId) {
          ctx.setLineDash([]);
          for (const q of pts) {
            if (!q) continue;
            ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fillStyle = "#07060b"; ctx.fill(); ctx.strokeStyle = d.locked ? "#787b86" : d.color; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
      }
      ctx.restore();
    });
  }
}

function arrowHead(ctx: CanvasRenderingContext2D, from: XY, to: XY, size: number) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(ang - Math.PI / 6), to[1] - size * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(to[0] - size * Math.cos(ang + Math.PI / 6), to[1] - size * Math.sin(ang + Math.PI / 6));
  ctx.closePath(); ctx.fill();
}

function pointInPoly(x: number, y: number, poly: XY[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fmtDuration(sec: number) {
  if (sec >= 86400) return `${(sec / 86400).toFixed(1)}d`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}h`;
  return `${Math.round(sec / 60)}m`;
}
