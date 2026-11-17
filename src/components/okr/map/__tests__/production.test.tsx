// 本番のデータ（appStore の形）→ 地図の形の変換と、「まだ記録がない」状態の描画。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { buildOkrMapCore, halfOf, localDateOf, mapStatus, type OkrMapSource } from "../adapter";
import type { OkrMapData } from "../dataset";
import { defaultKrIdsOfTask, krIdsOfTask } from "../logic";
import { emptyRecords, fillRecords, memoryRepository } from "../repository";
import type { InitialView } from "../state";
import { G, obj, source } from "./prodSource";

const dataOf = (src: OkrMapSource = source()): OkrMapData => {
  const core = buildOkrMapCore(src);
  const krIds = core.items.filter((i) => i.kind === "kr").map((i) => i.id);
  return { ...core, ...emptyRecords(krIds), nextCheckin: { id: "next", date: src.today, title: "次の回" } };
};

describe("adapter：本番のデータ → 地図の形", () => {
  const core = buildOkrMapCore(source());
  const byId = (id: string) => core.tasks.find((t) => t.id === id);

  it("表示部署のOだけ。KR番号は所属Objective内の順。TFは今期（4Q）だけで、番号は TF{KR番号}-{tf_number}", () => {
    expect(core.items.filter((i) => i.kind === "objective").map((i) => i.text)).toEqual(["地域と一緒に動く"]);
    expect(core.items.filter((i) => i.kind === "kr").map((i) => `${i.label} ${i.text}`)).toEqual(["KR1 パートナーを30社に", "KR2 稼働率を80%に"]);
    expect(core.items.filter((i) => i.kind === "tf").map((i) => `${i.label}:${i.id}`)).toEqual(["TF1-1:tf1-4q", "TF2-1:tf2-4q"]);
    expect(core.prevQuarter?.info.quarter).toBe("3Q");
    expect(core.prevQuarter?.items.filter((i) => i.kind === "tf").map((i) => i.id)).toEqual(["tf1-3q"]);
  });
  it("PJのTFは今期のものだけ持つ（前の四半期のTFは、完了した仕事の記録にだけ使う）", () => {
    expect(core.pjs.find((p) => p.id === "p1")?.tfIds).toEqual(["tf1-4q"]);
    expect(core.pjs.find((p) => p.id === "p3")?.tfIds).toEqual([]);
  });
  it("状態：未着手・進行中・完了。保留は未着手に入れ、中止と削除済みは外す", () => {
    expect(byId("t-open")?.status).toBe("未着手");
    expect(byId("t-doing")?.status).toBe("進行中");
    expect(byId("t-hold")?.status).toBe("未着手");
    expect(byId("t-cancel")).toBeUndefined();
    expect(byId("t-deleted")).toBeUndefined();
    expect(mapStatus("done")).toBe("完了");
  });
  it("親子のあるタスクは末端だけ。表示部署に無いPJのタスクは載せない。PJなしは個人の仕事", () => {
    expect(byId("t-parent")).toBeUndefined();
    expect(byId("t-child")?.due).toBeNull();
    expect(byId("t-elsewhere")).toBeUndefined();
    expect(byId("t-personal")?.pjId).toBe("personal");
  });
  it("完了日は completed_at の日付。完了した仕事は、完了した四半期のTFの KR につながる", () => {
    expect(byId("t-done-3q")?.updated).toBe("2026-08-20");
    expect(byId("t-done-3q")?.doneKrIds).toEqual(["k1"]);
    expect(byId("t-done-4q")?.doneKrIds).toEqual(["k2"]);
    expect(byId("t-open")?.updated).toBe("2026-11-10");
  });
  it("task_task_forces：タスクに直接つけた今期のTFは、PJのTFに足してつなぐ", () => {
    const ctx = { pjs: core.pjs, items: core.items, overrides: {} };
    expect(byId("t-direct")?.tfIds).toEqual(["tf2-4q"]);
    expect(defaultKrIdsOfTask(byId("t-direct")!, ctx)).toEqual(["k2"]);
    expect(krIdsOfTask(byId("t-open")!, ctx)).toEqual(["k1"]);
    expect(krIdsOfTask(byId("t-personal")!, ctx)).toEqual([]);
  });
  it("本人＝ログイン中の人。期は暦年の半期、今週は月曜から", () => {
    expect(core.viewerId).toBe("u1");
    expect(core.periodName).toBe("2026年 下期");
    expect([core.periodStart, core.periodEnd]).toEqual(["2026-07-01", "2026-12-31"]);
    expect(core.weekStart).toBe("2026-11-16");
    expect(halfOf("2026-04-02", "2Q")).toEqual({ name: "2026年 上期", start: "2026-01-01", end: "2026-06-30" });
  });
  it("「なぜこのOか」は Objective の背景（無ければ目的）", () => {
    expect(buildOkrMapCore(source({ objectives: [obj({ background: " 背景の文 ", purpose: "目的の文" })] })).objectiveWhy).toBe("背景の文");
    expect(buildOkrMapCore(source({ objectives: [obj({ purpose: "目的の文" })] })).objectiveWhy).toBe("目的の文");
  });
  it("日付：ISO の日時は端末の日付に。壊れた値は null", () => {
    expect(localDateOf("2026-11-05")).toBe("2026-11-05");
    expect(localDateOf("nope")).toBeNull();
    expect(localDateOf(null)).toBeNull();
  });
  it("Objective が無い部署でも落ちない（O・KR・TFが空）", () => {
    const c = buildOkrMapCore(source({ groupId: "grp-none" }));
    expect(c.items).toEqual([]);
    expect(c.prevQuarter?.items).toEqual([]);
  });
});

describe("repository：段階1はメモリ上の空実装", () => {
  it("空の記録を返し、KRごとの欄は空の形をそろえる。後から増えたKRにも空の欄を足す", async () => {
    const rec = await memoryRepository.load({ groupId: G, krIds: ["k1"] });
    expect(rec.checkins).toEqual([]);
    expect(rec.kintoneRows).toBeNull();
    expect(rec.lock.locked).toBe(false);
    expect(rec.krDefs.k1.bands[60]).toBe("");
    const filled = fillRecords(rec, ["k1", "k2"]);
    expect(filled.records.k2.krId).toBe("k2");
    expect(filled.krDefs.k2.evidence).toBe("");
  });
});

/** まだ記録が1件もない状態で、出してはいけない言い方（責める・寂しい・壊れた表示） */
const BAD = [/undefined/, /NaN/, /null/, /遅れ/, /できていません/, /足りません/, /0件/, /0／0/];
const textOf = (h: string) => h.replace(/<[^>]+>/g, " ");

describe("まだ記録がない状態の描画（本番のデータ・空の記録）", () => {
  const data = dataOf();
  const html = (initial?: InitialView, embedded = true) => renderToStaticMarkup(createElement(App, { data, initial, embedded, onOpenPersonalOkr: () => {} }));
  const views: [string, InitialView][] = [
    ["チーム", { mode: "team" }],
    ["わたし", { mode: "self" }],
    ["チーム・全体", { mode: "team", flowAll: { team: true } }],
    ["わたし・全体", { mode: "self", flowAll: { self: true } }],
    ["KR1 の詳細", { sel: { type: "kr", id: "k1" } }],
    ["KR2 の詳細（わたし）", { mode: "self", sel: { type: "kr", id: "k2" } }],
    ["TF の詳細", { sel: { type: "tf", id: "tf1-4q" } }],
    ["PJ の詳細", { sel: { type: "pj", id: "p1" } }],
    ["仕事の詳細", { mode: "self", sel: { type: "task", id: "t-open" } }],
    ["資料を読ませる", { drawerOpen: true }],
  ];
  it.each(views)("%s：落ちない・責める言い方や壊れた値が出ない", (_n, initial) => {
    const h = html(initial);
    const text = textOf(h);
    for (const re of BAD) expect(text, `${re}`).not.toMatch(re);
  });
  it("本番の中では見本のサイドバー・デモ用の切替を出さない。「わたし」に個人OKRの記録の入口がある", () => {
    const team = html({ mode: "team" });
    expect(team).not.toContain("mk-sidebar");
    expect(team).not.toContain("見ている人");
    expect(team).not.toContain("利用の広がり");
    expect(team).not.toContain("モック");
    expect(html({ mode: "self" })).toContain("個人OKRの記録を開く");
    expect(team).not.toContain("個人OKRの記録を開く");
  });
  it("O と KR はそのまま出る。見立てが無いKRは「—」や「なし」で穏やかに出す", () => {
    const h = html({ mode: "team" });
    expect(h).toContain("地域と一緒に動く");
    expect(h).toContain("パートナーを30社に");
  });
  it("Objective が無い部署でも落ちない", () => {
    const empty = dataOf(source({ groupId: "grp-none" }));
    expect(() => renderToStaticMarkup(createElement(App, { data: empty, embedded: true }))).not.toThrow();
    expect(() => renderToStaticMarkup(createElement(App, { data: empty, embedded: true, initial: { mode: "self" } }))).not.toThrow();
  });
});
