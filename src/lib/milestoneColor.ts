// src/lib/milestoneColor.ts
//
// 【設計意図・v3.190】
// マイルストーン（◆）の色まわりの純粋関数。DB の milestones.color は "#RRGGBB" か NULL（既定色）。
// 画面に出す前に必ず normalizeHexColor を通す（不正値・古い形式が混じっても◆が消えない・CSSに素通ししない）。
// ColorPicker（共通部品）のグリッド生成・最近使った色の管理もここに置き、テストで固定する。

import type { Milestone } from "./localData/types";

/** 既定色（color が NULL のときの◆の塗り・枠）。従来のガントの固定色と同じ */
export const DEFAULT_MILESTONE_FILL = "#f59e0b";
export const DEFAULT_MILESTONE_BORDER = "#d97706";

/** "#abc" "abc" "#AABBCC" "aabbcc" → "#aabbcc"。解釈できなければ null */
export function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return `#${h}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 色を暗くする（ratio 0〜1。0.25 で25%黒に寄せる）。不正値は既定の枠色を返す */
export function darkenHex(hex: string, ratio = 0.25): string {
  const n = normalizeHexColor(hex);
  if (!n) return DEFAULT_MILESTONE_BORDER;
  const [r, g, b] = hexToRgb(n);
  const k = 1 - ratio;
  return rgbToHex(r * k, g * k, b * k);
}

/** ◆の塗り色。color 未設定・不正なら既定色 */
export function milestoneFillColor(ms: Pick<Milestone, "color"> | null | undefined): string {
  return normalizeHexColor(ms?.color) ?? DEFAULT_MILESTONE_FILL;
}

/** ◆の枠色。個別色があれば塗りを暗くしたもの（白に近い色でも輪郭が出る）、無ければ既定の枠 */
export function milestoneBorderColor(ms: Pick<Milestone, "color"> | null | undefined): string {
  const n = normalizeHexColor(ms?.color);
  return n ? darkenHex(n, 0.3) : DEFAULT_MILESTONE_BORDER;
}

/** 明るい色か（選択中の✓の色を黒/白で切り替える用。相対輝度の簡易版） */
export function isLightColor(hex: string): boolean {
  const n = normalizeHexColor(hex);
  if (!n) return true;
  const [r, g, b] = hexToRgb(n);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/** ◆を文字として描く場所（カレンダー・スマホ）の色。個別色はそのまま、無ければ従来の濃いアンバー */
export function milestoneGlyphColor(ms: Pick<Milestone, "color"> | null | undefined): string {
  return normalizeHexColor(ms?.color) ?? DEFAULT_MILESTONE_BORDER;
}

/**
 * 保存時に Milestone へ載せる color の差分を作る。
 * 列が未適用の本番（color が常に undefined）でも保存が壊れないよう、
 * 「色を付けない（元も無し）」ときはキー自体を出さない。
 * 元の色を既定に戻すときだけ null を明示する（undefined だと DB の値が変わらない）。
 */
export function milestoneColorPatch(
  original: string | null | undefined,
  next: string | null,
): { color?: string | null } {
  const n = normalizeHexColor(next);
  if (n) return { color: n };
  return normalizeHexColor(original) ? { color: null } : {};
}

// ===== カラーグリッド（Office のパレット風） =====

export const COLOR_GRID_HUES = 12;
/** 色相ごとの明るさの段（上＝薄い → 下＝濃い） */
const GRID_LIGHTNESS = [0.88, 0.76, 0.62, 0.48, 0.34, 0.22] as const;
const GRID_SATURATION = 0.72;

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * グリッド（行の配列）。先頭行は白→黒のグレー12段、続く6行は色相12列×明るさ6段。
 * 色相は赤(0°)から30°刻み。
 */
export function generateColorGrid(): string[][] {
  const grays: string[] = [];
  for (let i = 0; i < COLOR_GRID_HUES; i++) {
    const v = Math.round(255 * (1 - i / (COLOR_GRID_HUES - 1)));
    grays.push(rgbToHex(v, v, v));
  }
  const rows = GRID_LIGHTNESS.map(l =>
    Array.from({ length: COLOR_GRID_HUES }, (_, i) => hslToHex(i * 30, GRID_SATURATION, l)),
  );
  return [grays, ...rows];
}

/** よく使う色の見本（10色）。PJの既定色 #7F77DD と、既定のアンバーを含む */
export const MILESTONE_SWATCHES: readonly string[] = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#7f77dd", "#ec4899", "#78716c", "#64748b",
];

// ===== 最近使ったカスタム色 =====

export const RECENT_COLORS_MAX = 6;

/** 先頭に追加・重複除去・上限まで。不正値は無視して元の配列を返す */
export function pushRecentColor(list: readonly string[], color: string, max = RECENT_COLORS_MAX): string[] {
  const n = normalizeHexColor(color);
  if (!n) return [...list];
  return [n, ...list.filter(c => c !== n)].slice(0, max);
}

/** localStorage の生文字列から復元。壊れていれば空配列 */
export function parseRecentColors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) {
      const n = normalizeHexColor(x);
      if (n && !out.includes(n)) out.push(n);
    }
    return out.slice(0, RECENT_COLORS_MAX);
  } catch {
    return [];
  }
}
