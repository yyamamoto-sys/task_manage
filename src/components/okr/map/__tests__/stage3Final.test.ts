// 最終点検（91-6）の画面側：保存失敗の戻し・読み直しの足し込み・Kintone の KR の選択・つなぎ先の読み方・ID の区切り・未保存の確認
import { afterEach, describe, expect, it, vi } from "vitest";

// 確認のダイアログは「切り替える」を押したことにする（押す前に切り替わらないことと、押したら切り替わることを見る）
const confirmMock = vi.fn(async () => true);
vi.mock("../../../../lib/dialog", () => ({ confirmDialog: () => confirmMock() }));
import { _resetUnsavedEditorRegistryForTest, registerUnsavedEditor } from "../../../../lib/editing/unsavedEditorRegistry";
import { krChanges, krCountMismatch, planKintoneApply, type KintoneReading } from "../kintone";
import { addMissingById, guardUnsaved } from "../state";
import { buildRecords, chunk, type LoadedRows } from "../supabaseRepository";
import type { KrDef, OkrItem } from "../types";
import * as U from "../userState";

const rows = (p: Partial<LoadedRows> = {}): LoadedRows => ({
  defs: [],
  checkins: [],
  assessments: [],
  learnings: [],
  decisions: [],
  notes: [],
  claims: [],
  links: [],
  how: [],
  proposals: [],
  personalLinks: [],
  answers: [],
  picks: [],
  lock: null,
  personalKrs: [],
  ...p,
});

describe("C3：本人の状態の保存に失敗した表の分を、保存済みの状態に戻す", () => {
  const saved: U.UserStates = { u1: { ...U.emptyUser(), how: { "t1|k1": "前" }, picks: { w: ["t1"] } }, u2: { ...U.emptyUser(), overrides: { t9: ["k1"] } } };
  const cur: U.UserStates = {
    u1: { ...U.emptyUser(), how: { "t1|k1": "後" }, picks: { w: ["t1", "t2"] }, overrides: { t1: ["k2"] } },
    u2: { ...U.emptyUser() },
  };
  it("表の名前から項目を引く", () => {
    expect(U.fieldsOfLabels(["どう役立つか", "仕事のつなぎ先"])).toEqual(["overrides", "how"]);
  });
  it("失敗した項目だけ戻し、成功した項目はいまのまま。つなぎ先は全員分を戻す", () => {
    const r = U.revertUserFields(cur, saved, ["how", "overrides"], "u1");
    expect(r.u1.how).toEqual({ "t1|k1": "前" });
    expect(r.u1.picks).toEqual({ w: ["t1", "t2"] });
    expect(r.u1.overrides).toEqual({});
    expect(r.u2.overrides).toEqual({ t9: ["k1"] });
    expect(U.revertUserFields(cur, saved, [], "u1")).toBe(cur);
  });
});

describe("C4：読み直した記録は、画面にまだ無い分だけ足し込む", () => {
  it("同じ ID は画面の状態を優先し、無い ID だけを後ろに足す", () => {
    const prev = [{ id: "a", v: "画面" }];
    expect(addMissingById(prev, [{ id: "a", v: "読み直し" }, { id: "b", v: "新" }])).toEqual([{ id: "a", v: "画面" }, { id: "b", v: "新" }]);
    expect(addMissingById(prev, [{ id: "a", v: "読み直し" }])).toBe(prev);
  });
});

describe("C6：Kintone に合わせる KR は、件数が同じときだけ・選んだものだけ", () => {
  const items: OkrItem[] = [
    { id: "o1", kind: "objective", parentId: null, label: "O", text: "O" },
    { id: "k1", kind: "kr", parentId: "o1", label: "KR1", text: "旧1" },
    { id: "k2", kind: "kr", parentId: "o1", label: "KR2", text: "旧2" },
  ];
  const bands = { 60: "出発", 70: "七", 80: "八" };
  const reading = (n: number): KintoneReading => ({
    fileName: "a.pdf",
    objective: { title: "O", purpose: null, background: null },
    krs: Array.from({ length: n }, (_, i) => ({ krId: items[i + 1]?.id ?? null, label: `KR${i + 1}`, title: `新${i + 1}`, bands })),
    rows: [],
    newTfs: {},
    skipped: [],
  });
  const defs: Record<string, KrDef> = { k1: { bands: { 60: "出発", 70: "七", 80: "八" }, evidence: "" } };
  it("件数が違えば止める", () => {
    expect(krCountMismatch(reading(3), items)).toEqual({ kintone: 3, app: 2 });
    expect(krCountMismatch(reading(2), items)).toBeNull();
  });
  it("旧／新を KR ごとに並べる（段の基準文が同じ KR は段の変更なし）", () => {
    const c = krChanges(reading(2), items, defs);
    expect(c.map((k) => [k.krId, k.titleChanged, k.bandsChanged])).toEqual([
      ["k1", true, false],
      ["k2", true, true],
    ]);
  });
  it("選んだ KR の題名・段の基準文だけを書く（未指定は違うものすべて）", () => {
    expect(planKintoneApply(reading(2), items, defs).krTitles.map((k) => k.krId)).toEqual(["k1", "k2"]);
    const p = planKintoneApply(reading(2), items, defs, { titles: ["k2"], bands: [] });
    expect(p.krTitles).toEqual([{ krId: "k2", title: "新2" }]);
    expect(p.bands).toEqual([]);
  });
});

describe("C7：つなぎ先の KR がすべて今の地図に無いときは「選んでいない」扱い", () => {
  const args = { krIds: ["k1"], viewerId: "u1", weekStart: "2026-11-16" };
  it("元が空でない行は読まない（既定のつなぎ先に戻る）。最初から空（つながない）はそのまま", () => {
    const r = buildRecords(
      rows({
        links: [
          { task_id: "t-old", kr_ids: ["k-prev"], updated_by: "u1" },
          { task_id: "t-none", kr_ids: [], updated_by: "u1" },
          { task_id: "t-mix", kr_ids: ["k-prev", "k1"], updated_by: "u1" },
        ],
      }),
      args,
    );
    expect(r.overrides.u1).toEqual({ "t-none": [], "t-mix": ["k1"] });
  });
});

describe("C10：つなぎ先は表示部署の仕事の ID を区切って読む", () => {
  it("区切り", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("C1：詳細・ページの切替は、書きかけがあれば確認を通す", () => {
  afterEach(() => _resetUnsavedEditorRegistryForTest());
  it("書きかけが無ければすぐ切り替える", () => {
    const run = vi.fn();
    guardUnsaved(run);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("書きかけがあれば、確認の前には切り替えず、「切り替える」を選んだら切り替える", async () => {
    registerUnsavedEditor("kr-def", () => true);
    const run = vi.fn();
    guardUnsaved(run);
    expect(run).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
