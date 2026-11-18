/** Chart drawings: stored in time (unix seconds) and price so they survive zoom and timeframe changes. */
export type DrawingType =
  | "trend" | "ray" | "extended" | "info" | "hline" | "hray" | "vline" | "cross" | "channel" | "arrow"
  | "fibret" | "fibext"
  | "long" | "short"
  | "rect" | "ellipse" | "triangle" | "path" | "brush"
  | "text" | "note" | "pricelabel" | "arrowup" | "arrowdown"
  | "measure";

export interface Point { t: number; p: number }

export type LineStyle = "solid" | "dashed" | "dotted";

export interface Drawing {
  id: string;
  type: DrawingType;
  points: Point[];
  color: string;
  width: 1 | 2 | 3 | 4;
  style: LineStyle;
  text?: string;
  extendLeft?: boolean;
  extendRight?: boolean;
  locked?: boolean;
}

export type Tool = "cursor" | DrawingType;

export interface ToolDef { id: Tool; label: string; glyph: string; key?: string }

export const GROUPS: Array<{ id: string; label: string; tools: ToolDef[] }> = [
  { id: "cursor", label: "Cursor", tools: [
    { id: "cursor", label: "Cursor", glyph: "↖", key: "v" },
    { id: "measure", label: "Measure", glyph: "⟺", key: "m" },
  ] },
  { id: "lines", label: "Lines", tools: [
    { id: "trend", label: "Trend line", glyph: "╱", key: "t" },
    { id: "ray", label: "Ray", glyph: "⟶", key: "r" },
    { id: "extended", label: "Extended line", glyph: "⟷" },
    { id: "info", label: "Info line", glyph: "ℹ" },
    { id: "hline", label: "Horizontal line", glyph: "━", key: "h" },
    { id: "hray", label: "Horizontal ray", glyph: "⊢" },
    { id: "vline", label: "Vertical line", glyph: "┃" },
    { id: "cross", label: "Cross line", glyph: "╋" },
    { id: "channel", label: "Parallel channel", glyph: "⫽" },
    { id: "arrow", label: "Arrow", glyph: "➚" },
  ] },
  { id: "fib", label: "Fibonacci", tools: [
    { id: "fibret", label: "Fib retracement", glyph: "F", key: "f" },
    { id: "fibext", label: "Trend-based fib extension", glyph: "F³" },
  ] },
  { id: "pos", label: "Positions", tools: [
    { id: "long", label: "Long position", glyph: "⇧" },
    { id: "short", label: "Short position", glyph: "⇩" },
  ] },
  { id: "shapes", label: "Shapes", tools: [
    { id: "rect", label: "Rectangle", glyph: "▭", key: "b" },
    { id: "ellipse", label: "Ellipse", glyph: "◯" },
    { id: "triangle", label: "Triangle", glyph: "△" },
    { id: "path", label: "Path", glyph: "⌇" },
    { id: "brush", label: "Brush", glyph: "✎" },
  ] },
  { id: "text", label: "Annotations", tools: [
    { id: "text", label: "Text", glyph: "A", key: "x" },
    { id: "note", label: "Note", glyph: "✎A" },
    { id: "pricelabel", label: "Price label", glyph: "⌸" },
    { id: "arrowup", label: "Arrow up", glyph: "▲" },
    { id: "arrowdown", label: "Arrow down", glyph: "▼" },
  ] },
];

export const ALL_TOOLS: ToolDef[] = GROUPS.flatMap((g) => g.tools);
export const toolDef = (id: Tool) => ALL_TOOLS.find((t) => t.id === id);

export const COLORS = ["#efe8da", "#ff8a1f", "#ff2a3c", "#39d98a", "#2962ff", "#d64aa0", "#787b86"];

/** How a tool gathers its points. */
export type Gather = { kind: "clicks"; n: number } | { kind: "multi" } | { kind: "drag" };
export const GATHER: Record<DrawingType, Gather> = {
  trend: { kind: "clicks", n: 2 }, ray: { kind: "clicks", n: 2 }, extended: { kind: "clicks", n: 2 }, info: { kind: "clicks", n: 2 },
  hline: { kind: "clicks", n: 1 }, hray: { kind: "clicks", n: 1 }, vline: { kind: "clicks", n: 1 }, cross: { kind: "clicks", n: 1 },
  channel: { kind: "clicks", n: 3 }, arrow: { kind: "clicks", n: 2 },
  fibret: { kind: "clicks", n: 2 }, fibext: { kind: "clicks", n: 3 },
  long: { kind: "clicks", n: 1 }, short: { kind: "clicks", n: 1 },
  rect: { kind: "clicks", n: 2 }, ellipse: { kind: "clicks", n: 2 }, triangle: { kind: "clicks", n: 3 }, path: { kind: "multi" }, brush: { kind: "drag" },
  text: { kind: "clicks", n: 1 }, note: { kind: "clicks", n: 1 }, pricelabel: { kind: "clicks", n: 1 }, arrowup: { kind: "clicks", n: 1 }, arrowdown: { kind: "clicks", n: 1 },
  measure: { kind: "clicks", n: 2 },
};

export const TEXT_TYPES = new Set<DrawingType>(["text", "note"]);
export const LINE_TYPES = new Set<DrawingType>(["trend", "ray", "extended", "info", "arrow"]);

export const FIB_LEVELS: Array<[number, string]> = [
  [0, "#787b86"], [0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#4caf50"], [0.618, "#089981"], [0.786, "#00bcd4"],
  [1, "#787b86"], [1.272, "#2962ff"], [1.618, "#089981"], [2.618, "#f23645"],
];
export const FIBEXT_LEVELS: Array<[number, string]> = [[0, "#787b86"], [0.382, "#ff9800"], [0.618, "#089981"], [1, "#787b86"], [1.618, "#089981"], [2.618, "#f23645"]];

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Distance from (x, y) to the segment (x0, y0)-(x1, y1). */
export function distToSegment(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
  return Math.hypot(x - (x0 + u * dx), y - (y0 + u * dy));
}

export function hexAlpha(color: string, alpha: number) {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

export const DASH: Record<LineStyle, number[]> = { solid: [], dashed: [8, 5], dotted: [2, 4] };
