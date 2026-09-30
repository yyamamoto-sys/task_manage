// PostgREST の応答打ち切り（max_rows）を再現するテスト用の偽サーバ。
// range 指定があっても max_rows を超える件数は返さず、エラーも出さない（本物と同じ）。
//
// 【M41是正・v3.122】特定テーブルへのクエリをエラーにする errorTables を追加した
// （fetchCriticalData の構造表/周辺表の失敗時挙動をテストするため）。

type Row = Record<string, unknown>;

export interface FakeError {
  code?: string;
  message: string;
}

export interface FakeRequest {
  table: string;
  count?: string;
  orders: Array<{ column: string; ascending: boolean }>;
  range: [number, number] | null;
}

export interface FakeQuery extends PromiseLike<{ data: Row[] | null; error: FakeError | null; count: number | null }> {
  eq(col: string, v: unknown): FakeQuery;
  in(col: string, vs: unknown[]): FakeQuery;
  order(column: string, opts?: { ascending?: boolean }): FakeQuery;
  range(from: number, to: number): FakeQuery;
  limit(n: number): FakeQuery;
}

export function createFakePostgrest(
  tables: Record<string, Row[]>,
  maxRows = 1000,
  errorTables: Record<string, FakeError> = {},
) {
  const requests: FakeRequest[] = [];

  function makeQuery(table: string, selectOptions?: { count?: string }): FakeQuery {
    const req: FakeRequest = { table, count: selectOptions?.count, orders: [], range: null };
    const filters: Array<(r: Row) => boolean> = [];
    let limit: number | null = null;

    const run = () => {
      requests.push(req);
      if (errorTables[table]) {
        return { data: null, error: errorTables[table], count: null };
      }
      const all = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      const sorted = [...all].sort((a, b) => {
        for (const o of req.orders) {
          const av = a[o.column] as string | number;
          const bv = b[o.column] as string | number;
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
        }
        return 0;
      });
      const from = req.range ? req.range[0] : 0;
      const requested = req.range ? req.range[1] - req.range[0] + 1 : (limit ?? Infinity);
      const data = sorted.slice(from, from + Math.min(requested, maxRows));
      return { data, error: null, count: req.count === "exact" ? all.length : null };
    };

    const q: FakeQuery = {
      eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return q; },
      in: (col: string, vs: unknown[]) => { filters.push(r => vs.includes(r[col])); return q; },
      order: (column: string, opts?: { ascending?: boolean }) => {
        req.orders.push({ column, ascending: opts?.ascending ?? true });
        return q;
      },
      range: (from: number, to: number) => { req.range = [from, to]; return q; },
      limit: (n: number) => { limit = n; return q; },
      then: (onF, onR) => Promise.resolve().then(run).then(onF, onR),
    };
    return q;
  }

  const supabase = {
    from: (table: string) => ({
      select: (_cols?: string, opts?: { count?: string }) => makeQuery(table, opts),
    }),
  };
  return { supabase, requests };
}

export function makeRows(n: number, extra: (i: number) => Row = () => ({})): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${String(i).padStart(6, "0")}`,
    is_deleted: false,
    ...extra(i),
  }));
}
