import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIST_SETTINGS, MAX_SAVED_VIEWS, MAX_VIEW_NAME_LENGTH, SAVED_VIEWS_VERSION,
  addView, canAddView, isSameSettings, normalizeViewName, overwriteView, parseSavedViews,
  removeView, renameView, sanitizeListSettings, savedViewsKey, serializeSavedViews,
  type ListViewSettings, type SavedView,
} from "../savedViews";

const members = new Set(["m1", "m2"]);
const custom: ListViewSettings = {
  groupBy: "assignee", filterStatus: "in_progress", filterPriority: "high",
  sortKey: "priority", sortDir: "desc", filterHideDone: true, filterThisWeek: true,
  filterMember: "m1", columns: ["due_date", "status"],
};
const view = (id: string, name = id, settings: ListViewSettings = custom): SavedView => ({ id, name, settings });

describe("savedViewsKey", () => {
  it("部署 id を含む。未確定は none", () => {
    expect(savedViewsKey("k", "g1")).toBe("k:g1");
    expect(savedViewsKey("k", null)).toBe("k:none");
    expect(savedViewsKey("k", "g1")).not.toBe(savedViewsKey("k", "g2"));
  });
});

describe("sanitizeListSettings", () => {
  it("正しい値はそのまま通る", () => {
    expect(sanitizeListSettings(custom, members)).toEqual(custom);
  });
  it("項目単位で既定値に落ちる（他の項目は残る）", () => {
    const s = sanitizeListSettings({ ...custom, groupBy: "bogus", sortDir: 5, filterHideDone: "yes", columns: ["x"] }, members);
    expect(s.groupBy).toBe(DEFAULT_LIST_SETTINGS.groupBy);
    expect(s.sortDir).toBe("asc");
    expect(s.filterHideDone).toBe(false);
    expect(s.columns).toEqual(DEFAULT_LIST_SETTINGS.columns);
    expect(s.filterStatus).toBe("in_progress");
    expect(s.filterMember).toBe("m1");
  });
  it("存在しないメンバー id は all に落ちる。memberIds=null なら検証しない", () => {
    expect(sanitizeListSettings({ ...custom, filterMember: "ghost" }, members).filterMember).toBe("all");
    expect(sanitizeListSettings({ ...custom, filterMember: "ghost" }, null).filterMember).toBe("ghost");
  });
  it("オブジェクトでない入力は全項目が既定", () => {
    expect(sanitizeListSettings(null, members)).toEqual(DEFAULT_LIST_SETTINGS);
    expect(sanitizeListSettings("x", members)).toEqual(DEFAULT_LIST_SETTINGS);
  });
  it("手動並べ替えは PJ別に固定される", () => {
    expect(sanitizeListSettings({ ...custom, sortKey: "manual", groupBy: "tag" }, members).groupBy).toBe("project");
  });
  it("DEFAULT_LIST_SETTINGS を破壊しない（columns は別配列）", () => {
    const s = sanitizeListSettings({}, null);
    s.columns.pop();
    expect(DEFAULT_LIST_SETTINGS.columns).toHaveLength(5);
  });
});

describe("serialize / parse の往復", () => {
  it("往復で一致し、version を持つ", () => {
    const text = serializeSavedViews([view("a", "週次"), view("b", "自分")]);
    expect(JSON.parse(text).version).toBe(SAVED_VIEWS_VERSION);
    expect(parseSavedViews(text, members)).toEqual([view("a", "週次"), view("b", "自分")]);
  });
  it("null・壊れた JSON・未知の version・views が配列でない場合は空", () => {
    expect(parseSavedViews(null, members)).toEqual([]);
    expect(parseSavedViews("{oops", members)).toEqual([]);
    expect(parseSavedViews(JSON.stringify({ version: 99, views: [view("a")] }), members)).toEqual([]);
    expect(parseSavedViews(JSON.stringify({ version: 1, views: {} }), members)).toEqual([]);
    expect(parseSavedViews("123", members)).toEqual([]);
  });
  it("壊れたビュー1件だけ捨て、他は残す。重複 id・空の名前も捨てる", () => {
    const text = JSON.stringify({
      version: 1,
      views: [view("a"), null, { id: "", name: "x", settings: {} }, { id: "c", name: "  ", settings: {} },
        { id: "a", name: "dup", settings: {} }, { id: "d", name: "ok", settings: { groupBy: "zzz" } }],
    });
    const r = parseSavedViews(text, members);
    expect(r.map(v => v.id)).toEqual(["a", "d"]);
    expect(r[1].settings.groupBy).toBe("project");
  });
  it("存在しないメンバーはそのビューの担当者項目だけ all になり、ビューは残る", () => {
    const r = parseSavedViews(serializeSavedViews([view("a", "a", { ...custom, filterMember: "ghost" })]), members);
    expect(r).toHaveLength(1);
    expect(r[0].settings.filterMember).toBe("all");
    expect(r[0].settings.groupBy).toBe("assignee");
  });
  it("上限20件を超えた分は読まない・書かない", () => {
    const many = Array.from({ length: 25 }, (_, i) => view(`v${i}`));
    const text = serializeSavedViews(many);
    expect(JSON.parse(text).views).toHaveLength(MAX_SAVED_VIEWS);
    expect(parseSavedViews(JSON.stringify({ version: 1, views: many }), null)).toHaveLength(MAX_SAVED_VIEWS);
  });
});

describe("isSameSettings（変更ありの判定）", () => {
  it("同じなら true（columns は順序に依存しない）", () => {
    expect(isSameSettings(custom, { ...custom, columns: ["status", "due_date"] })).toBe(true);
  });
  it.each([
    ["groupBy", { groupBy: "tag" }], ["filterStatus", { filterStatus: "done" }],
    ["filterPriority", { filterPriority: "low" }], ["sortKey", { sortKey: "name" }],
    ["sortDir", { sortDir: "asc" }], ["filterHideDone", { filterHideDone: false }],
    ["filterThisWeek", { filterThisWeek: false }], ["filterMember", { filterMember: "m2" }],
    ["columns", { columns: ["due_date"] }],
  ] as const)("%s が違えば false", (_n, patch) => {
    expect(isSameSettings(custom, { ...custom, ...patch } as ListViewSettings)).toBe(false);
  });
});

describe("ビュー一覧の操作", () => {
  it("追加は上限で止まる", () => {
    let vs: SavedView[] = [];
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) vs = addView(vs, view(`v${i}`));
    expect(canAddView(vs)).toBe(false);
    expect(addView(vs, view("extra"))).toHaveLength(MAX_SAVED_VIEWS);
  });
  it("名前変更・上書き・削除", () => {
    const vs = [view("a"), view("b")];
    expect(renameView(vs, "a", "  新名称 ")[0].name).toBe("新名称");
    expect(renameView(vs, "a", "   ")[0].name).toBe("a");
    expect(overwriteView(vs, "b", DEFAULT_LIST_SETTINGS)[1].settings).toEqual(DEFAULT_LIST_SETTINGS);
    expect(overwriteView(vs, "b", DEFAULT_LIST_SETTINGS)[0].settings).toEqual(custom);
    expect(removeView(vs, "a").map(v => v.id)).toEqual(["b"]);
  });
  it("名前は空不可・長すぎは切り詰め", () => {
    expect(normalizeViewName("")).toBeNull();
    expect(normalizeViewName(3)).toBeNull();
    expect(normalizeViewName("あ".repeat(MAX_VIEW_NAME_LENGTH + 5))).toHaveLength(MAX_VIEW_NAME_LENGTH);
  });
});
