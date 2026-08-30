/**
 * Detect official Tango BA row highlights (rosa / violeta) in Excel-exported
 * score-sheet PDFs. Score-cell tints (dropped high/low) sit on the right and
 * are ignored; qualification is a fill over the couple-id / name columns.
 */

export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Rosa / magenta / violet row fills. Skip yellow (suplentes) and gray/white. */
export function isHighlightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 25) return false;
  if (r > 230 && g > 230 && b < 80) return false;
  const isMagenta = r >= 200 && b >= 180 && g <= 180 && r - g >= 40;
  const isRosa = r >= 220 && g >= 160 && b >= 160 && r >= g && r - b < 80 && r - g >= 15;
  const isViolet = r >= 150 && b >= 180 && g < 190 && b >= g && r + b - 2 * g >= 40;
  return isMagenta || isRosa || isViolet;
}

export interface HighlightRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
}

function asNums(v: unknown): number[] {
  if (!v) return [];
  if (ArrayBuffer.isView(v)) return Array.from(v as ArrayLike<number>);
  if (Array.isArray(v)) return v.length === 1 ? asNums(v[0]) : v.map(Number);
  if (typeof v === "object") return Object.values(v as object).map(Number);
  return [];
}

function transformBBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): HighlightRect {
  const pts = [
    applyMatrix(m, x0, y0),
    applyMatrix(m, x1, y0),
    applyMatrix(m, x0, y1),
    applyMatrix(m, x1, y1),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
    color: "",
  };
}

export interface ExtractOpts {
  /** Path-space x must start left of this (name / couple-id columns). */
  pathLeftMax?: number;
}

/**
 * Collect name-column highlight rects in PDF user space (same as text items).
 */
export function extractNameHighlights(
  opList: { fnArray: number[]; argsArray: unknown[][] },
  ops: Record<string, number>,
  opts: ExtractOpts = {},
): HighlightRect[] {
  const pathLeftMax = opts.pathLeftMax ?? 400;
  const inv = Object.fromEntries(Object.entries(ops).map(([k, v]) => [v, k]));
  let fill = "";
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const rects: HighlightRect[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const name = inv[opList.fnArray[i]!] ?? "";
    const args = opList.argsArray[i] as unknown[];
    if (name === "save") {
      stack.push(ctm);
      continue;
    }
    if (name === "restore") {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (name === "transform") {
      const raw = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args) as number[];
      if (raw.length >= 6) {
        const t: Matrix = [raw[0]!, raw[1]!, raw[2]!, raw[3]!, raw[4]!, raw[5]!];
        ctm = multiply(ctm, t);
      }
      continue;
    }
    if (name === "setFillRGBColor") {
      fill = String(args[0] ?? "").toLowerCase();
      continue;
    }
    if (name !== "constructPath") continue;
    if (!isHighlightColor(fill)) continue;
    const mm = asNums(args[2]);
    if (mm.length < 4) continue;
    const px0 = Math.min(mm[0]!, mm[2]!);
    const px1 = Math.max(mm[0]!, mm[2]!);
    const py0 = Math.min(mm[1]!, mm[3]!);
    const py1 = Math.max(mm[1]!, mm[3]!);
    if (px0 > pathLeftMax) continue;
    const width = px1 - px0;
    const height = py1 - py0;
    if (width < 80 || height < 8) continue;
    const box = transformBBox(ctm, px0, py0, px1, py1);
    box.color = fill;
    if (box.x0 > 280) continue;
    if (box.x1 > 460) continue;
    rects.push(box);
  }
  return rects;
}

export function yOverlapsHighlight(
  y: number,
  rects: HighlightRect[],
  tol = 5,
): boolean {
  for (const r of rects) {
    if (y >= r.y0 - tol && y <= r.y1 + tol) return true;
  }
  return false;
}
