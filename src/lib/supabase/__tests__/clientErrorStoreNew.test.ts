import { describe, expect, it, vi } from "vitest";

// 未読通知50件・エラーログ300件（うち古い未読分を含む）の簡易DB。in / gte / order / limit だけ実装する
const db = vi.hoisted(() => ({ notifs: [] as { created_at: string }[], logs: [] as Record<string, unknown>[] }));

vi.mock("../client", () => {
  const query = (table: string) => {
    let rows: Record<string, unknown>[] = table === "in_app_notifications" ? db.notifs : db.logs;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      is: () => q,
      in: (col: string, vals: string[]) => { const set = new Set(vals.map(v => new Date(v).getTime())); rows = rows.filter(r => set.has(new Date(r[col] as string).getTime())); return q; },
      gte: (col: string, v: string) => { rows = rows.filter(r => new Date(r[col] as string) >= new Date(v)); return q; },
      order: (col: string, o: { ascending: boolean }) => { rows = [...rows].sort((a, b) => (new Date(a[col] as string).getTime() - new Date(b[col] as string).getTime()) * (o.ascending ? 1 : -1)); return q; },
      limit: (n: number) => { rows = rows.slice(0, n); return q; },
      then: (res: (v: unknown) => void) => res({ data: rows, error: null }),
    };
    return q;
  };
  return { supabase: { from: query } };
});

import { fetchNewClientErrors } from "../clientErrorStore";

describe("fetchNewClientErrors（古い未読の後に既読分のエラーが100件を超えても取りこぼさない）", () => {
  it("最古の未読のエラーも返る", () => {
    const iso = (min: number) => new Date(Date.UTC(2026, 9, 14, 0, min)).toISOString();
    // 古い未読の通知1件（分=0）。その後に通知された既読分のエラーが200件（分=1..200）
    db.notifs = [{ created_at: iso(0) }];
    db.logs = [{ id: 1, message: "old unread", last_seen: iso(0), last_notified_at: iso(0) }];
    for (let i = 1; i <= 200; i++) db.logs.push({ id: 1 + i, message: `read ${i}`, last_seen: iso(i), last_notified_at: iso(i) });
    return fetchNewClientErrors("m1").then(rows => {
      expect(rows.map(r => r.id)).toEqual([1]);
    });
  });
});
