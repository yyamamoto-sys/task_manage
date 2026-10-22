import { describe, it, expect } from "vitest";
import { mergeFetchedRows } from "../fetchMerge";
import { decideAuthReset } from "../authReset";

describe("mergeFetchedRows", () => {
  const r = (id: string, updated_at: string, v = "") => ({ id, updated_at, v });

  it("手元が無ければ取得結果そのまま", () => {
    const f = [r("a", "2026-01-01T00:00:00Z")];
    expect(mergeFetchedRows(f, undefined, "end")).toBe(f);
    expect(mergeFetchedRows(f, [], "end")).toBe(f);
  });

  it("手元の方が新しい行は手元を採る（保存直後の巻き戻し防止）", () => {
    const merged = mergeFetchedRows(
      [r("a", "2026-01-01T00:00:00Z", "old")],
      [r("a", "2026-01-01T00:00:10Z", "saved")],
      "end",
    );
    expect(merged[0].v).toBe("saved");
  });

  it("取得結果の方が新しい（または同じ）行は取得結果を採る", () => {
    const merged = mergeFetchedRows(
      [r("a", "2026-01-01T00:00:10Z", "remote")],
      [r("a", "2026-01-01T00:00:00Z", "local")],
      "end",
    );
    expect(merged[0].v).toBe("remote");
  });

  it("取得結果に無い手元だけの行（取得中に作った行）は残し、位置は指定どおり", () => {
    const fetched = [r("a", "2026-01-01T00:00:00Z")];
    const local = [r("new", "2026-01-02T00:00:00Z")];
    expect(mergeFetchedRows(fetched, local, "end").map(x => x.id)).toEqual(["a", "new"]);
    expect(mergeFetchedRows(fetched, local, "start").map(x => x.id)).toEqual(["new", "a"]);
  });

  it("書式の違う日時（+09:00とZ）も数値で比べる", () => {
    const merged = mergeFetchedRows(
      [r("a", "2026-01-01T09:00:00+09:00", "remote")],
      [r("a", "2026-01-01T00:00:01Z", "local")],
      "end",
    );
    expect(merged[0].v).toBe("local");
  });
});

describe("decideAuthReset", () => {
  const base = { prevUserId: "u1", event: "SIGNED_IN", userId: "u1", isAnonymous: false, isGuest: false };

  it("サインアウトでリセットし、記憶したユーザーも消す", () => {
    expect(decideAuthReset({ ...base, event: "SIGNED_OUT", userId: null })).toEqual({ reset: true, userId: null });
  });
  it("同じユーザーの再通知ではリセットしない", () => {
    expect(decideAuthReset(base)).toEqual({ reset: false, userId: "u1" });
  });
  it("別のユーザーに変わったらリセットする", () => {
    expect(decideAuthReset({ ...base, userId: "u2" })).toEqual({ reset: true, userId: "u2" });
  });
  it("最初のユーザー確定ではリセットしない", () => {
    expect(decideAuthReset({ ...base, prevUserId: null, event: "INITIAL_SESSION" })).toEqual({ reset: false, userId: "u1" });
  });
  it("ゲスト・匿名セッションのイベントは無視する", () => {
    expect(decideAuthReset({ ...base, event: "SIGNED_OUT", userId: null, isGuest: true }).reset).toBe(false);
    expect(decideAuthReset({ ...base, userId: "anon", isAnonymous: true }).reset).toBe(false);
  });
  it("セッションなしの非サインアウトイベントでは何もしない", () => {
    expect(decideAuthReset({ ...base, event: "INITIAL_SESSION", userId: null })).toEqual({ reset: false, userId: "u1" });
  });
});
