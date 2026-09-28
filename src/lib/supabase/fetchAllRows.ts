// src/lib/supabase/fetchAllRows.ts
//
// 【設計意図】（CLAUDE.md Section 61）
// Supabase API（PostgREST）は1回の応答を max_rows（既定1000）で打ち切り、エラーを出さない。
// 一覧を丸ごと読む select を単発で投げると、行数が上限を超えた時点で末尾が黙って欠ける。
// このヘルパーは range でページを回して全件を返す。
//
// 終了判定を「返ってきた件数 < 要求したページサイズ」にしてはいけない。サーバの max_rows が
// ページサイズより小さいと1ページ目で終わったと誤判定し、同じ黙った欠落が起きる。
// そのため1ページ目で総件数（count: "exact"）を取り、「取得済み ≥ 総件数」か「空ページ」で止める。
// 次ページの開始位置も要求サイズではなく実際に返ってきた件数で進める（同じ理由）。

import type { PostgrestError } from "@supabase/supabase-js";

export const FETCH_ALL_PAGE_SIZE = 1000;

export interface PageResponse<Row> {
  data: Row[] | null;
  error: PostgrestError | null;
  count?: number | null;
}

export interface PageableQuery<Row> {
  order(column: string, options?: { ascending?: boolean }): PageableQuery<Row>;
  range(from: number, to: number): PromiseLike<PageResponse<Row>>;
}

export interface FetchAllRowsOptions {
  /** 主キー列。ページ間の並びを安定させる最後の並びキー兼、重複除去のキー。既定 ["id"]。 */
  keyColumns?: string[];
  pageSize?: number;
  /** console.warn に出す識別名（テーブル名など）。 */
  label?: string;
}

export interface FetchAllRowsResult<Row> {
  data: Row[] | null;
  error: PostgrestError | null;
}

/**
 * build は毎ページ新しいクエリを組み立てて返すこと（PostgREST のビルダーは使い回せない）。
 * 受け取った selectOptions をそのまま select() の第2引数に渡す。
 * 並びが必要なら build の中で order() してよい。その後ろに keyColumns の昇順が必ず足される。
 */
export async function fetchAllRows<Row>(
  build: (selectOptions: { count?: "exact" }) => PageableQuery<Row>,
  options: FetchAllRowsOptions = {},
): Promise<FetchAllRowsResult<Row>> {
  const keyColumns = options.keyColumns ?? ["id"];
  const pageSize = options.pageSize ?? FETCH_ALL_PAGE_SIZE;

  const rows: Row[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let offset = 0;

  for (let page = 0; ; page++) {
    let q = build(page === 0 ? { count: "exact" } : {});
    for (const col of keyColumns) q = q.order(col, { ascending: true });
    const res = await q.range(offset, offset + pageSize - 1);
    if (res.error) return { data: null, error: res.error };

    if (page === 0) total = typeof res.count === "number" ? res.count : null;
    const batch = res.data ?? [];
    if (batch.length === 0) break;

    for (const row of batch) {
      const r = row as Record<string, unknown>;
      const key = keyColumns.map(c => String(r[c])).join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    offset += batch.length;
    if (total !== null && offset >= total) break;
  }

  if (total !== null && rows.length !== total) {
    console.warn(
      `[fetchAllRows] ${options.label ?? "query"}: 取得件数 ${rows.length} が総件数 ${total} と一致しません（取得中に行が追加・削除された可能性）`,
    );
  }
  return { data: rows, error: null };
}
