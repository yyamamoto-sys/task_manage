// src/lib/kanbanWip.ts
//
// 進行中（in_progress）列の WIP（Work In Progress）上限判定。抱えすぎ検知が目的の
// ソフト警告のみで、カード移動はブロックしない（Human-in-the-loop）。
// 上限値は利用者が変更できる（v3.201・localStorage＝個人設定。null＝上限なし）。

export const WIP_LIMIT_DEFAULT = 4;
export const WIP_LIMIT_MIN = 1;
export const WIP_LIMIT_MAX = 99;
/** localStorage に「上限なし」を保存するときの値（キー未保存＝既定値と区別するため） */
export const WIP_LIMIT_NONE_TOKEN = "none";

export function isOverWipLimit(count: number, limit: number | null = WIP_LIMIT_DEFAULT): boolean {
  return limit !== null && count > limit;
}

/** 保存値 → 上限。未保存・壊れた値は既定値、"none" は上限なし(null)、範囲外は範囲内へ丸める。 */
export function parseStoredWipLimit(raw: string | null): number | null {
  if (raw === null) return WIP_LIMIT_DEFAULT;
  if (raw === WIP_LIMIT_NONE_TOKEN) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return WIP_LIMIT_DEFAULT;
  return clampWipLimit(n);
}

export function clampWipLimit(n: number): number {
  return Math.min(WIP_LIMIT_MAX, Math.max(WIP_LIMIT_MIN, Math.round(n)));
}

/** 入力欄の文字列 → 上限。空欄＝上限なし(null)。数値でなければ undefined（入力を無視する）。 */
export function parseWipLimitInput(input: string): number | null | undefined {
  const s = input.trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return clampWipLimit(n);
}

export function serializeWipLimit(limit: number | null): string {
  return limit === null ? WIP_LIMIT_NONE_TOKEN : String(limit);
}
