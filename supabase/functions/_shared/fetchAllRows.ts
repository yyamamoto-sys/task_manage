// supabase/functions/_shared/fetchAllRows.ts
//
// src/lib/supabase/fetchAllRows.ts と同じ終了条件のページング（CLAUDE.md Section 61）。
// 1ページ目の count:"exact" で総件数を取り、総件数に達したか空ページで止める。
// 「返ってきた件数 < ページサイズ」では止めない（サーバの max_rows が小さいと黙って欠けるため）。
// （旧 notify-deadlines の末尾にあった複製と同じ実装。v3.136 で関数ごと削除）

// deno-lint-ignore no-explicit-any
type QueryBuilder = any;

export async function fetchAllRows<Row>(
  build: (o: { count?: "exact" }) => QueryBuilder,
  keyColumns: string[] = ["id"],
  pageSize = 1000,
): Promise<{ data: Row[]; error: null } | { data: null; error: { message: string } }> {
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
    const batch = (res.data ?? []) as Row[];
    if (batch.length === 0) break;
    for (const row of batch) {
      const r = row as Record<string, unknown>;
      const key = keyColumns.map((c) => String(r[c])).join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    offset += batch.length;
    if (total !== null && offset >= total) break;
  }
  return { data: rows, error: null };
}
