import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Bar } from "@/lib/types";
import { loadSetting, saveSetting } from "@/lib/store";
import { DrawingsPrimitive, type Hit } from "./DrawingsPrimitive";
import { COLORS, newId, POINTS_NEEDED, TOOLS, type Drawing, type DrawingType, type Point, type Tool } from "./drawings";

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  bars: React.MutableRefObject<Bar[]>;
  version: number;
  tfSec: number;
  symbol: string;
  container: React.RefObject<HTMLDivElement | null>;
}

interface Drag { id: string; part: "body" | 0 | 1; startX: number; startY: number; orig: Drawing }

/**
 * The drawing toolbar and the pointer handling for drawings. Drawings are kept per symbol in the
 * local settings store ("drawings:<symbol>"). Creation tools capture the pointer on a transparent
 * layer; in cursor mode a capture-phase listener on the chart container grabs drags that start on
 * a drawing and leaves everything else to the chart's own pan and zoom.
 */
export function DrawingLayer({ chart, series, bars, version, tfSec, symbol, container }: Props) {
  const prim = useRef<DrawingsPrimitive | null>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState(COLORS[0]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number; point: Point } | null>(null);
  const drag = useRef<Drag | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Attach the primitive once the series exists.
  useEffect(() => {
    if (!series) return;
    const p = new DrawingsPrimitive();
    series.attachPrimitive(p);
    prim.current = p;
    return () => { series.detachPrimitive(p); prim.current = null; };
  }, [series]);

  useEffect(() => { prim.current?.setBars(bars.current, tfSec); }, [bars, version, tfSec]);
  useEffect(() => { prim.current?.setState(drawings, draft, selectedId); }, [drawings, draft, selectedId]);

  // Per-symbol persistence.
  useEffect(() => {
    let alive = true;
    setSelectedId(null); setDraft(null);
    void loadSetting<Drawing[]>(`drawings:${symbol}`, []).then((d) => { if (alive) { loadedFor.current = symbol; setDrawings(d); } });
    return () => { alive = false; };
  }, [symbol]);
  useEffect(() => { if (loadedFor.current === symbol) void saveSetting(`drawings:${symbol}`, drawings); }, [drawings, symbol]);

  const setChartInteraction = useCallback((on: boolean) => chart?.applyOptions({ handleScroll: on, handleScale: on }), [chart]);

  const localXY = (e: { clientX: number; clientY: number }) => {
    const r = container.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  // ── cursor mode: select and drag existing drawings ──
  useEffect(() => {
    const el = container.current;
    if (!el || !chart) return;
    const onDown = (e: PointerEvent) => {
      if (tool !== "cursor" || e.button !== 0 || !prim.current) return;
      const { x, y } = localXY(e);
      const hit: Hit = prim.current.hitDrawing(x, y, el.clientWidth);
      if (!hit) { if (selectedId) setSelectedId(null); return; }
      e.stopPropagation(); e.preventDefault();
      setSelectedId(hit.id);
      const orig = drawings.find((d) => d.id === hit.id);
      if (!orig) return;
      drag.current = { id: hit.id, part: hit.part, startX: x, startY: y, orig };
      setChartInteraction(false);
      const onMove = (ev: PointerEvent) => {
        const d = drag.current; const p = prim.current;
        if (!d || !p) return;
        const { x: mx, y: my } = localXY(ev);
        const dx = mx - d.startX, dy = my - d.startY;
        setDrawings((xs) => xs.map((it) => {
          if (it.id !== d.id) return it;
          const move = (pt: Point) => { const dd = p.deltaAt(dx, dy, pt); return dd ? { t: pt.t + dd.dt, p: pt.p + dd.dp } : pt; };
          const points = d.orig.points.map((pt, i) => (d.part === "body" || d.part === i ? move(pt) : pt));
          return { ...it, points };
        }));
      };
      const onUp = () => { drag.current = null; setChartInteraction(true); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    el.addEventListener("pointerdown", onDown, true);
    return () => el.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, chart, drawings, selectedId, container, setChartInteraction]);

  // ── creation tools ──
  const onLayerDown = (e: React.PointerEvent) => {
    if (tool === "cursor" || e.button !== 0 || !prim.current) return;
    e.preventDefault(); // keep the browser from moving focus (the text input must keep it)
    const { x, y } = localXY(e);
    const point = prim.current.pointAt(x, y);
    if (!point) return;
    const type = tool as DrawingType;
    if (type === "text") { setTextAt({ x, y, point }); return; }
    if (POINTS_NEEDED[type] === 1) {
      commit({ id: newId(), type, points: [point], color, width: 1 });
      return;
    }
    if (!draft) {
      setDraft({ id: newId(), type, points: [point, point], color, width: 1 });
    } else {
      commit({ ...draft, points: [draft.points[0], point] });
    }
  };
  const onLayerMove = (e: React.PointerEvent) => {
    if (!draft || !prim.current) return;
    const { x, y } = localXY(e);
    const point = prim.current.pointAt(x, y);
    if (point) setDraft({ ...draft, points: [draft.points[0], point] });
  };
  const commit = (d: Drawing) => { setDrawings((xs) => [...xs, d]); setDraft(null); setSelectedId(d.id); setTool("cursor"); };

  // Tool switching turns the chart's own pan/zoom off while a creation tool is armed.
  useEffect(() => { setChartInteraction(tool === "cursor"); return () => setChartInteraction(true); }, [tool, setChartInteraction]);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Escape") { setDraft(null); setTextAt(null); setTool("cursor"); setSelectedId(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { setDrawings((xs) => xs.filter((d) => d.id !== selectedId)); setSelectedId(null); return; }
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) setTool(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const selected = drawings.find((d) => d.id === selectedId) ?? null;
  const recolor = (c: string) => { setColor(c); if (selectedId) setDrawings((xs) => xs.map((d) => (d.id === selectedId ? { ...d, color: c } : d))); };

  return (
    <>
      {tool !== "cursor" && (
        <div className="draw-layer" onPointerDown={onLayerDown} onPointerMove={onLayerMove} style={{ cursor: "crosshair" }} />
      )}
      {textAt && (
        <input
          className="draw-text-input" autoFocus style={{ left: textAt.x, top: textAt.y - 22 }} placeholder="text, Enter to place"
          onKeyDown={(e) => {
            if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) commit({ id: newId(), type: "text", points: [textAt.point], color, width: 1, text: v }); setTextAt(null); }
            if (e.key === "Escape") { setTextAt(null); setTool("cursor"); }
          }}
          onBlur={() => setTextAt(null)}
        />
      )}
      <div className="draw-tools" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? "active" : ""} title={t.label} onClick={() => setTool(t.id)}>{t.glyph}</button>
        ))}
        <div className="sep" />
        {COLORS.map((c) => (
          <button key={c} className={`sw ${color === c ? "active" : ""}`} title={c} onClick={() => recolor(c)} style={{ background: c }} />
        ))}
        <div className="sep" />
        <button title="Delete selected (Del)" disabled={!selected} onClick={() => { if (selectedId) { setDrawings((xs) => xs.filter((d) => d.id !== selectedId)); setSelectedId(null); } }}>🗑</button>
      </div>
    </>
  );
}
