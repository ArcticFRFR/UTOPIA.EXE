import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Bar } from "@/lib/types";
import { loadSetting, saveSetting } from "@/lib/store";
import { DrawingsPrimitive, type Hit } from "./DrawingsPrimitive";
import {
  ALL_TOOLS, COLORS, GATHER, GROUPS, LINE_TYPES, newId, TEXT_TYPES, toolDef,
  type Drawing, type DrawingType, type LineStyle, type Point, type Tool,
} from "./drawings";

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  bars: React.MutableRefObject<Bar[]>;
  version: number;
  tfSec: number;
  symbol: string;
  precision: number;
  container: React.RefObject<HTMLDivElement | null>;
}

interface Drag { id: string; part: "body" | number; startX: number; startY: number; orig: Drawing }

const atr = (bars: Bar[], len = 14) => {
  const n = bars.length;
  if (n < 2) return 10;
  let s = 0, c = 0;
  for (let i = Math.max(1, n - len); i < n; i++) { const b = bars[i], pc = bars[i - 1].close; s += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)); c++; }
  return c ? s / c : 10;
};

/**
 * The drawing toolbar (TradingView-style groups with flyouts), the creation flows, selection,
 * dragging, the property bar, undo/redo, magnet, hide-all. Drawings are kept per symbol in the
 * local settings store ("drawings:<symbol>").
 */
export function DrawingLayer({ chart, series, bars, version, tfSec, symbol, precision, container }: Props) {
  const prim = useRef<DrawingsPrimitive | null>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lastInGroup, setLastInGroup] = useState<Record<string, Tool>>({});
  const [color, setColor] = useState(COLORS[0]);
  const [drawings, setDrawingsRaw] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [measure, setMeasure] = useState<Drawing | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number; point: Point; type: DrawingType } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [magnet, setMagnet] = useState(false);
  const drag = useRef<Drag | null>(null);
  const brushing = useRef(false);
  const loadedFor = useRef<string | null>(null);
  const history = useRef<{ past: Drawing[][]; future: Drawing[][] }>({ past: [], future: [] });
  const drawingsRef = useRef<Drawing[]>([]);
  drawingsRef.current = drawings;

  /** Change the drawings; `record` pushes the previous state onto the undo stack. */
  const setDrawings = useCallback((next: Drawing[] | ((d: Drawing[]) => Drawing[]), record = true) => {
    setDrawingsRaw((prev) => {
      const out = typeof next === "function" ? next(prev) : next;
      if (record && out !== prev) { history.current.past.push(prev); if (history.current.past.length > 100) history.current.past.shift(); history.current.future = []; }
      return out;
    });
  }, []);
  const undo = useCallback(() => { const p = history.current.past.pop(); if (p) { history.current.future.push(drawingsRef.current); setDrawingsRaw(p); setSelectedId(null); } }, []);
  const redo = useCallback(() => { const f = history.current.future.pop(); if (f) { history.current.past.push(drawingsRef.current); setDrawingsRaw(f); setSelectedId(null); } }, []);

  // Attach the primitive once the series exists.
  useEffect(() => {
    if (!series) return;
    const p = new DrawingsPrimitive();
    series.attachPrimitive(p);
    prim.current = p;
    return () => { series.detachPrimitive(p); prim.current = null; };
  }, [series]);
  useEffect(() => { prim.current?.setBars(bars.current, tfSec, precision); }, [bars, version, tfSec, precision]);
  useEffect(() => { prim.current?.setState(drawings, draft ?? measure, selectedId, hidden, magnet); }, [drawings, draft, measure, selectedId, hidden, magnet]);

  // Per-symbol persistence.
  useEffect(() => {
    let alive = true;
    setSelectedId(null); setDraft(null); setMeasure(null);
    history.current = { past: [], future: [] };
    void loadSetting<Drawing[]>(`drawings:${symbol}`, []).then((d) => { if (alive) { loadedFor.current = symbol; setDrawingsRaw(d.map(upgrade)); } });
    return () => { alive = false; };
  }, [symbol]);
  useEffect(() => { if (loadedFor.current === symbol) void saveSetting(`drawings:${symbol}`, drawings); }, [drawings, symbol]);

  const setChartInteraction = useCallback((on: boolean) => chart?.applyOptions({ handleScroll: on, handleScale: on }), [chart]);
  const localXY = (e: { clientX: number; clientY: number }) => {
    const r = container.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  const pick = (t: Tool) => {
    setTool(t); setDraft(null); setOpenGroup(null);
    const g = GROUPS.find((gr) => gr.tools.some((x) => x.id === t));
    if (g) setLastInGroup((m) => ({ ...m, [g.id]: t }));
    if (t !== "measure") setMeasure(null);
  };

  // ── cursor mode: select and drag existing drawings ──
  useEffect(() => {
    const el = container.current;
    if (!el || !chart) return;
    const onDown = (e: PointerEvent) => {
      if (tool !== "cursor" || e.button !== 0 || !prim.current) return;
      const { x, y } = localXY(e);
      const hit: Hit = prim.current.hitDrawing(x, y, el.clientWidth, el.clientHeight);
      if (!hit) { if (selectedId) setSelectedId(null); return; }
      e.stopPropagation(); e.preventDefault();
      setSelectedId(hit.id);
      const orig = drawingsRef.current.find((d) => d.id === hit.id);
      if (!orig || orig.locked) return;
      drag.current = { id: hit.id, part: hit.part, startX: x, startY: y, orig };
      const before = drawingsRef.current;
      setChartInteraction(false);
      const onMove = (ev: PointerEvent) => {
        const d = drag.current; const p = prim.current;
        if (!d || !p) return;
        const { x: mx, y: my } = localXY(ev);
        const dx = mx - d.startX, dy = my - d.startY;
        setDrawings((xs) => xs.map((it) => {
          if (it.id !== d.id) return it;
          const move = (pt: Point) => { const dd = p.deltaAt(dx, dy, pt); return dd ? { t: pt.t + dd.dt, p: pt.p + dd.dp } : pt; };
          let points = d.orig.points.map((pt, i) => (d.part === "body" || d.part === i ? move(pt) : pt));
          if ((it.type === "long" || it.type === "short") && d.part !== "body") {
            // target and stop handles share the right edge; the entry handle moves the whole thing
            if (d.part === 0) points = d.orig.points.map(move);
            else { const t1 = points[d.part as number].t; points = points.map((pt, i) => (i === 0 ? pt : { t: t1, p: pt.p })); }
          }
          return { ...it, points };
        }), false);
      };
      const onUp = () => {
        drag.current = null; setChartInteraction(true);
        window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
        if (drawingsRef.current !== before) { history.current.past.push(before); history.current.future = []; }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    el.addEventListener("pointerdown", onDown, true);
    return () => el.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, chart, selectedId, container, setChartInteraction]);

  // ── creation tools ──
  const commit = (d: Drawing) => { setDrawings((xs) => [...xs, d]); setDraft(null); setSelectedId(d.id); setTool("cursor"); };
  const base = (type: DrawingType, points: Point[]): Drawing => ({ id: newId(), type, points, color, width: type === "brush" ? 2 : 1, style: "solid" });

  const onLayerDown = (e: React.PointerEvent) => {
    if (tool === "cursor" || e.button !== 0 || !prim.current) return;
    e.preventDefault();
    const { x, y } = localXY(e);
    const point = prim.current.pointAt(x, y);
    if (!point) return;
    const type = tool as DrawingType;
    const g = GATHER[type];
    if (TEXT_TYPES.has(type)) { setTextAt({ x, y, point, type }); return; }
    if (type === "measure") {
      if (!measure || measure.points.length === 2 && !draft) { setMeasure(null); setDraft({ ...base("measure", [point, point]), color: "#efe8da" }); }
      else if (draft) { setMeasure({ ...draft, points: [draft.points[0], point] }); setDraft(null); }
      return;
    }
    if (type === "long" || type === "short") {
      const a = atr(bars.current);
      const sign = type === "long" ? 1 : -1;
      const t1 = point.t + tfSec * 20;
      commit(base(type, [point, { t: t1, p: point.p + sign * a * 3 }, { t: t1, p: point.p - sign * a * 1.5 }]));
      return;
    }
    if (g.kind === "drag") {
      brushing.current = true;
      setDraft(base("brush", [point]));
      return;
    }
    if (g.kind === "multi") {
      if (!draft) setDraft(base(type, [point, point]));
      else setDraft({ ...draft, points: [...draft.points.slice(0, -1), point, point] });
      return;
    }
    if (!draft) {
      if (g.n === 1) { commit(base(type, [point])); return; }
      setDraft(base(type, [point, point]));
    } else {
      const fixed = draft.points.slice(0, -1);
      const points = [...fixed, point];
      if (points.length >= g.n) commit({ ...draft, points });
      else setDraft({ ...draft, points: [...points, point] });
    }
  };
  const onLayerMove = (e: React.PointerEvent) => {
    if (!draft || !prim.current) return;
    const { x, y } = localXY(e);
    const point = prim.current.pointAt(x, y);
    if (!point) return;
    if (brushing.current) { setDraft({ ...draft, points: [...draft.points, point] }); return; }
    setDraft({ ...draft, points: [...draft.points.slice(0, -1), point] });
  };
  const onLayerUp = () => {
    if (brushing.current && draft) { brushing.current = false; if (draft.points.length > 1) commit(draft); else setDraft(null); }
  };
  const onLayerDouble = () => {
    if (draft && GATHER[draft.type].kind === "multi") { const pts = draft.points.slice(0, -1); if (pts.length >= 2) commit({ ...draft, points: pts }); else setDraft(null); }
  };

  useEffect(() => { setChartInteraction(tool === "cursor"); return () => setChartInteraction(true); }, [tool, setChartInteraction]);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "Escape") {
        if (draft && GATHER[draft.type].kind === "multi" && draft.points.length > 2) { commit({ ...draft, points: draft.points.slice(0, -1) }); return; }
        setDraft(null); setTextAt(null); setMeasure(null); setTool("cursor"); setSelectedId(null); setOpenGroup(null); return;
      }
      if (e.key === "Enter" && draft && GATHER[draft.type].kind === "multi") { onLayerDouble(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { setDrawings((xs) => xs.filter((d) => d.id !== selectedId)); setSelectedId(null); return; }
      if (mod || e.altKey) return;
      const t = ALL_TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) pick(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draft, undo, redo]);

  const selected = drawings.find((d) => d.id === selectedId) ?? null;
  const patch = (p: Partial<Drawing>) => { if (selectedId) setDrawings((xs) => xs.map((d) => (d.id === selectedId ? { ...d, ...p } : d))); };
  const recolor = (c: string) => { setColor(c); patch({ color: c }); };
  const groupIcon = (gid: string) => { const t = toolDef(lastInGroup[gid] ?? GROUPS.find((g) => g.id === gid)!.tools[0].id)!; return t; };
  const activeGroup = GROUPS.find((g) => g.tools.some((t) => t.id === tool))?.id;

  return (
    <>
      {tool !== "cursor" && (
        <div className="draw-layer" onPointerDown={onLayerDown} onPointerMove={onLayerMove} onPointerUp={onLayerUp} onDoubleClick={onLayerDouble} style={{ cursor: "crosshair" }} />
      )}
      {textAt && (
        <input
          className="draw-text-input" autoFocus style={{ left: textAt.x, top: textAt.y - 22 }} placeholder={textAt.type === "note" ? "note, Enter to place" : "text, Enter to place"}
          onKeyDown={(e) => {
            if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) commit({ ...base(textAt.type, [textAt.point]), text: v }); setTextAt(null); }
            if (e.key === "Escape") { setTextAt(null); setTool("cursor"); }
          }}
          onBlur={() => setTextAt(null)}
        />
      )}
      <div className="draw-tools" role="toolbar" aria-label="Drawing tools" onPointerDown={(e) => e.stopPropagation()}>
        {GROUPS.map((g) => {
          const icon = groupIcon(g.id);
          return (
            <div className="group" key={g.id}>
              <button className={activeGroup === g.id ? "active" : ""} title={g.label} onClick={() => (g.tools.length === 1 ? pick(g.tools[0].id) : setOpenGroup(openGroup === g.id ? null : g.id))}>
                {icon.glyph}
              </button>
              {g.tools.length > 1 && <span className="caret" onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}>›</span>}
              {openGroup === g.id && (
                <div className="flyout">
                  <div className="fly-title">{g.label}</div>
                  {g.tools.map((t) => (
                    <button key={t.id} className={tool === t.id ? "active" : ""} onClick={() => pick(t.id)}>
                      <span className="g">{t.glyph}</span>{t.label}{t.key && <kbd>{t.key.toUpperCase()}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="sep" />
        <button className={magnet ? "active" : ""} title="Magnet: snap to open/high/low/close" onClick={() => setMagnet((m) => !m)}>🧲</button>
        <button className={hidden ? "active" : ""} title="Hide all drawings" onClick={() => setHidden((h) => !h)}>{hidden ? "◌" : "◉"}</button>
        <button title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current.past.length}>↶</button>
        <button title="Redo (Ctrl+Y)" onClick={redo} disabled={!history.current.future.length}>↷</button>
        <button title="Delete all drawings on this symbol" disabled={!drawings.length} onClick={() => { if (window.confirm(`Delete all ${drawings.length} drawings on ${symbol}?`)) { setDrawings([]); setSelectedId(null); } }}>🗑</button>
      </div>
      {selected && (
        <div className="draw-props" onPointerDown={(e) => e.stopPropagation()}>
          <span className="name">{toolDef(selected.type)?.label}</span>
          {COLORS.map((c) => <button key={c} className={`sw ${selected.color === c ? "active" : ""}`} style={{ background: c }} onClick={() => recolor(c)} title={c} />)}
          <span className="sep" />
          {([1, 2, 3, 4] as const).map((w) => <button key={w} className={selected.width === w ? "active" : ""} onClick={() => patch({ width: w })} title={`Width ${w}`}><i style={{ height: w }} /></button>)}
          <span className="sep" />
          {(["solid", "dashed", "dotted"] as LineStyle[]).map((s) => <button key={s} className={selected.style === s ? "active" : ""} onClick={() => patch({ style: s })} title={s}>{s === "solid" ? "—" : s === "dashed" ? "– –" : "· ·"}</button>)}
          {(LINE_TYPES.has(selected.type) || selected.type === "channel" || selected.type === "fibret" || selected.type === "fibext") && (
            <>
              <span className="sep" />
              {selected.type !== "ray" && selected.type !== "extended" && selected.type !== "fibret" && selected.type !== "fibext" && (
                <button className={selected.extendLeft ? "active" : ""} onClick={() => patch({ extendLeft: !selected.extendLeft })} title="Extend left">⇤</button>
              )}
              {selected.type !== "ray" && selected.type !== "extended" && (
                <button className={selected.extendRight ? "active" : ""} onClick={() => patch({ extendRight: !selected.extendRight })} title="Extend right">⇥</button>
              )}
            </>
          )}
          {(TEXT_TYPES.has(selected.type) || selected.type === "rect" || selected.type === "hline" || selected.type === "arrowup" || selected.type === "arrowdown") && (
            <input className="txt" value={selected.text ?? ""} placeholder="text" onChange={(e) => patch({ text: e.target.value })} />
          )}
          <span className="sep" />
          <button className={selected.locked ? "active" : ""} onClick={() => patch({ locked: !selected.locked })} title="Lock">{selected.locked ? "🔒" : "🔓"}</button>
          <button onClick={() => { setDrawings((xs) => xs.filter((d) => d.id !== selectedId)); setSelectedId(null); }} title="Delete (Del)">🗑</button>
        </div>
      )}
    </>
  );
}

/** Older saved drawings lacked style; fill the gaps. */
function upgrade(d: Drawing): Drawing {
  return { ...d, style: d.style ?? "solid", width: (d.width ?? 1) as Drawing["width"] };
}
