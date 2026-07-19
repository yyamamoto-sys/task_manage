// src/lib/kanbanWip.ts
//
// 進行中（in_progress）列の WIP（Work In Progress）上限判定。抱えすぎ検知が目的の
// ソフト警告のみで、カード移動はブロックしない（Human-in-the-loop）。上限値は
// ユーザー設定化しやすいよう1箇所に定数化。10名弱の運用を想定した既定値。

export const WIP_LIMIT_DEFAULT = 4;

export function isOverWipLimit(count: number, limit: number = WIP_LIMIT_DEFAULT): boolean {
  return count > limit;
}
