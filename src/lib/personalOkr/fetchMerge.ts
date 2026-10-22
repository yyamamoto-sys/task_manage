// src/lib/personalOkr/fetchMerge.ts
//
// 【設計意図】
// personalOkrUiStore の KR 詳細取得（月・週・メモ）が返ってきた時点で、取得開始後に
// 同じ行へ保存（saveMonth 等）が入っていると、取得結果（保存前の内容）でそのまま
// 置き換えると保存直後の値と updated_at が巻き戻る（次の保存が楽観ロック競合になる）。
// 取得結果を基準にしつつ、手元の行の方が新しい（updated_at が大きい）ものは手元を採り、
// 取得結果に無い手元だけの行（取得中に新規作成した行）は残す。

interface Row {
  id: string;
  updated_at?: string | null;
}

function ts(v: string | null | undefined): number {
  const n = v ? Date.parse(v) : NaN;
  return Number.isNaN(n) ? -Infinity : n;
}

/**
 * @param localOnly 取得結果に無い手元だけの行を置く位置。メモのように新しい順で並ぶ一覧は "start"。
 */
export function mergeFetchedRows<T extends Row>(
  fetched: T[],
  local: T[] | undefined,
  localOnly: "start" | "end",
): T[] {
  if (!local || local.length === 0) return fetched;
  const localById = new Map(local.map(r => [r.id, r]));
  const fetchedIds = new Set(fetched.map(r => r.id));
  const merged = fetched.map(f => {
    const l = localById.get(f.id);
    return l && ts(l.updated_at) > ts(f.updated_at) ? l : f;
  });
  const localOnlyRows = local.filter(r => !fetchedIds.has(r.id));
  return localOnly === "start" ? [...localOnlyRows, ...merged] : [...merged, ...localOnlyRows];
}
