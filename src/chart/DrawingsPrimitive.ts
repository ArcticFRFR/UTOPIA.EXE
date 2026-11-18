import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { Bar } from "@/lib/types";
import { logicalOfTime, timeOfLogical } from "./coords";
import { distToSegment, hexAlpha, type Drawing, type Point } from "./drawings";

export type Hit = { id: string; part: "body" | 0 | 1 } | null;

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
  private readonly view: IPrimitivePaneView = { zOrder: () => "top", renderer: () => ({ draw: (t) => this.draw(t) }) };

  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart; this.series = p.series as ISeriesApi<"Candlestick">; this.requestUpdate = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return [this.view]; }

  setBars(bars: Bar[], tfSec: number) { this.bars = bars; this.tfSec = tfSec; this.requestUpdate?.(); }
  setState(drawings: Drawing[], draft: Drawing | null, selectedId: string | null) {
    this.drawings = drawings; this.draft = draft; this.selectedId = selectedId; this.requestUpdate?.();
  }

  // ── coordinates ──
  x(t: number): number | null { return this.chart?.timeScale().logicalToCoordinate(logicalOfTime(this.bars, this.tfSec, t) as Logical) ?? null; }
  y(p: number): number | null { return this.series?.priceToCoordinate(p) ?? null; }
  /** Pixel → (time, price); null when off the data area. */
  pointAt(x: number, y: number): Point | null {
    const l = this.chart?.timeScale().coordinateToLogical(x);
    const p = this.series?.coordinateToPrice(y);
    if (l === null || l === undefined || p === null || p === undefined) return null;
    return { t: timeOfLogical(this.bars, this.tfSec, l as number), p: p as number };
  }
  /** Pixel deltas → (time, price) deltas, for dragging. */
  deltaAt(dx: number, dy: number, ref: Point): { dt: number; dp: number } | null {
    const x0 = this.x(ref.t), y0 = this.y(ref.p);
    if (x0 === null || y0 === null) return null;
    const moved = this.pointAt(x0 + dx, y0 + dy);
    return moved ? { dt: moved.t - ref.t, dp: moved.p - ref.p } : null;
  }

  private px(d: Drawing): Array<[number, number] | null> {
    return d.points.map((pt) => { const x = this.x(pt.t), y = this.y(pt.p); return x === null || y === null ? null : [x, y]; });
  }

  /** Topmost drawing under the pixel: handles of the selected one first, then bodies. */
  hitDrawing(x: number, y: number, width: number): Hit {
    const sel = this.drawings.find((d) => d.id === this.selectedId);
    if (sel) {
      const pts = this.px(sel);
      for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; if (q && Math.hypot(x - q[0], y - q[1]) <= 8) return { id: sel.id, part: i as 0 | 1 }; }
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const pts = this.px(d);
      const a = pts[0];
      if (!a) continue;
      switch (d.type) {
        case "hline": if (Math.abs(y - a[1]) <= 6) return { id: d.id, part: "body" }; break;
        case "text": if (x >= a[0] - 4 && x <= a[0] + 8 * (d.text?.length ?? 1) + 8 && y >= a[1] - 16 && y <= a[1] + 4) return { id: d.id, part: "body" }; break;
        case "trend": { const b = pts[1]; if (b && distToSegment(x, y, a[0], a[1], b[0], b[1]) <= 6) return { id: d.id, part: "body" }; break; }
        case "ray": { const b = pts[1]; if (b) { const e = this.rayEnd(a, b, width); if (distToSegment(x, y, a[0], a[1], e[0], e[1]) <= 6) return { id: d.id, part: "body" }; } break; }
        case "rect": { const b = pts[1]; if (b) { const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]; if (x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 4 && y <= y1 + 4) return { id: d.id, part: "body" }; } break; }
      }
    }
    return null;
  }

  private rayEnd(a: [number, number], b: [number, number], width: number): [number, number] {
    if (b[0] === a[0]) return [a[0], b[1] > a[1] ? 100000 : -100000];
    const slope = (b[1] - a[1]) / (b[0] - a[0]);
    const ex = b[0] >= a[0] ? width + 10 : -10;
    return [ex, a[1] + slope * (ex - a[0])];
  }

  private draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
      for (const d of all) {
        const pts = this.px(d);
        const a = pts[0];
        if (!a) continue;
        const selected = d.id === this.selectedId;
        ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = d.width; ctx.setLineDash([]);
        switch (d.type) {
          case "hline":
            ctx.beginPath(); ctx.moveTo(0, a[1] + 0.5); ctx.lineTo(mediaSize.width, a[1] + 0.5); ctx.stroke();
            if (d.text) { ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(d.text, 8, a[1] - 3); }
            break;
          case "text":
            ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(d.text ?? "", a[0], a[1]);
            break;
          case "trend": { const b = pts[1]; if (!b) break; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); break; }
          case "ray": { const b = pts[1]; if (!b) break; const e = this.rayEnd(a, b, mediaSize.width); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); break; }
          case "rect": {
            const b = pts[1]; if (!b) break;
            const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
            ctx.fillStyle = hexAlpha(d.color, 0.12); ctx.fillRect(x0, y0, w, h); ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
            break;
          }
        }
        if (selected) {
          for (const q of pts) {
            if (!q) continue;
            ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fillStyle = "#07060b"; ctx.fill(); ctx.strokeStyle = d.color; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
      }
      ctx.restore();
    });
  }
}
