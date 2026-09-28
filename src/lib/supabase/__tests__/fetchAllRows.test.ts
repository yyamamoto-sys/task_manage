import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllRows, type PageableQuery } from "../fetchAllRows";
import { createFakePostgrest, makeRows } from "./fakePostgrest";

type Row = Record<string, unknown>;

function run(rows: Row[], maxRows: number, pageSize?: number) {
  const fake = createFakePostgrest({ t: rows }, maxRows);
  const promise = fetchAllRows<Row>(
    o => fake.supabase.from("t").select("*", o) as unknown as PageableQuery<Row>,
    { label: "t", pageSize },
  );
  return { promise, requests: fake.requests };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("fetchAllRows：max_rows で打ち切られても全件を返す", () => {
  it.each([0, 1, 999, 1000, 1001, 2500])("%i件", async n => {
    const rows = makeRows(n);
    const { promise } = run(rows, 1000);
    const { data, error } = await promise;
    expect(error).toBeNull();
    expect(data).toHaveLength(n);
    expect(data!.map(r => r.id)).toEqual(rows.map(r => r.id));
  });

  it("🔴 サーバの max_rows(500) が要求ページサイズ(1000)より小さくても全件取れる", async () => {
    const rows = makeRows(2500);
    const { promise, requests } = run(rows, 500, 1000);
    const { data } = await promise;
    expect(data).toHaveLength(2500);
    expect(new Set(data!.map(r => r.id)).size).toBe(2500);
    expect(requests.map(r => r.range![0])).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it("総件数は1ページ目だけで数える", async () => {
    const { promise, requests } = run(makeRows(2500), 1000);
    await promise;
    expect(requests.map(r => r.count)).toEqual(["exact", undefined, undefined]);
  });

  it("既存の並びを保ったまま、最後に主キー昇順を足す", async () => {
    const rows = makeRows(1500, i => ({ grp: i % 3 }));
    const fake = createFakePostgrest({ t: rows }, 1000);
    const { data } = await fetchAllRows<Row>(
      o => fake.supabase.from("t").select("*", o).order("grp", { ascending: false }) as unknown as PageableQuery<Row>,
    );
    expect(fake.requests[0].orders).toEqual([
      { column: "grp", ascending: false },
      { column: "id", ascending: true },
    ]);
    expect(data).toHaveLength(1500);
    expect(data![0].grp).toBe(2);
  });

  it("複合主キーの表は keyColumns で並べ・重複を除く", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ task_id: `t${i % 400}`, project_id: `p${Math.floor(i / 400)}` }));
    const fake = createFakePostgrest({ t: rows }, 1000);
    const { data } = await fetchAllRows<Row>(
      o => fake.supabase.from("t").select("*", o) as unknown as PageableQuery<Row>,
      { keyColumns: ["task_id", "project_id"] },
    );
    expect(fake.requests[0].orders.map(o => o.column)).toEqual(["task_id", "project_id"]);
    expect(data).toHaveLength(1200);
  });

  it("ページ間で行が重複して返っても id で1件にまとめ、件数ずれは warn で残す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pages = [
      { data: makeRows(3).slice(0, 2), error: null, count: 3 },
      { data: makeRows(3).slice(1, 2), error: null, count: null },
      { data: [], error: null, count: null },
    ];
    let i = 0;
    const q: PageableQuery<Row> = {
      order: () => q,
      range: () => Promise.resolve(pages[i++]),
    };
    const { data } = await fetchAllRows<Row>(() => q, { label: "dup" });
    expect(data!.map(r => r.id)).toEqual(["r000000", "r000001"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("dup");
  });

  it("エラーは握りつぶさず返す（途中ページでも）", async () => {
    const err = { message: "boom", details: "", hint: "", code: "X" };
    const pages = [
      { data: makeRows(1000), error: null, count: 2000 },
      { data: null, error: err, count: null },
    ];
    let i = 0;
    const q: PageableQuery<Row> = { order: () => q, range: () => Promise.resolve(pages[i++]) as never };
    const res = await fetchAllRows<Row>(() => q);
    expect(res.data).toBeNull();
    expect(res.error).toBe(err);
  });

  it("総件数が取れない応答でも空ページまで読み進める", async () => {
    const all = makeRows(1300);
    const q: PageableQuery<Row> & { from?: number } = {
      order: () => q,
      range: (from: number, to: number) => Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + 1000)), error: null, count: null }),
    };
    const { data } = await fetchAllRows<Row>(() => q);
    expect(data).toHaveLength(1300);
  });
});
