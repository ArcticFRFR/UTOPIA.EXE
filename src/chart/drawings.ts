/** Chart drawings: stored in time (unix seconds) and price so they survive zoom and timeframe changes. */
export type DrawingType = "trend" | "ray" | "hline" | "rect" | "text";

export interface Point { t: number; p: number }

export interface Drawing {
  id: string;
  type: DrawingType;
  points: Point[]; // trend/ray/rect: 2, hline/text: 1
  color: string;
  width: 1 | 2 | 3;
  text?: string;
}

export type Tool = "cursor" | DrawingType;

export const TOOLS: Array<{ id: Tool; label: string; glyph: string; key: string }> = [
  { id: "cursor", label: "Select (V)", glyph: "↖", key: "v" },
  { id: "trend", label: "Trend line (T)", glyph: "╱", key: "t" },
  { id: "ray", label: "Ray (R)", glyph: "⟶", key: "r" },
  { id: "hline", label: "Horizontal line (H)", glyph: "━", key: "h" },
  { id: "rect", label: "Rectangle (B)", glyph: "▭", key: "b" },
  { id: "text", label: "Text (X)", glyph: "A", key: "x" },
];

export const COLORS = ["#efe8da", "#ff8a1f", "#ff2a3c", "#39d98a", "#2962ff", "#d64aa0"];

export const POINTS_NEEDED: Record<DrawingType, number> = { trend: 2, ray: 2, rect: 2, hline: 1, text: 1 };

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Distance from (x, y) to the segment (x0, y0)-(x1, y1). */
export function distToSegment(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
  const px = x0 + u * dx, py = y0 + u * dy;
  return Math.hypot(x - px, y - py);
}

export function hexAlpha(color: string, alpha: number) {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
