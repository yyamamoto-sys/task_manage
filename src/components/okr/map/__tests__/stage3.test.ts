// 段階3：資料を AI に読ませる（返答の解釈・スキーマ・資料の保存形・Kintone の取り込み・個人OKRの矢印の初期値・境目の幅）。
// AI も Supabase も呼ばない（純粋関数だけ）。s91 91-3。
import { describe, expect, it, vi } from "vitest";
import type { OkrImportAnalysis } from "../../../../lib/ai/okrImportExtractor";
import type { KeyResult, Objective, TaskForce } from "../../../../lib/localData/types";
import {
  BROKEN_READING_MESSAGE,
  buildCheckinUserText,
  CHECKIN_SCHEMA,
  checkReadable,
  NO_KR_MESSAGE,
  orderTasksForAi,
  parseCheckinReading,
  readingOf,
  type CheckinAiContext,
} from "../checkinAi";
import { headDiffs, NEW_TF_PREFIX, planKintoneApply, readingFromImport, writeKintonePlan } from "../kintone";
import { panelNarrowPx } from "../nav";
import { buildRecords, diffUser, isUniqueViolation, type LoadedRows } from "../supabaseRepository";
import { CANDIDATES_SCHEMA, HOW_SCHEMA, parseCandidates, parseHowOptions } from "../suggestAi";
import type { KrDef, OkrItem } from "../types";
import * as U from "../userState";

const def = (b: Partial<Record<60 | 70 | 80 | 90, string>>): KrDef => ({ bands: { 60: b[60] ?? "", 70: b[70] ?? "", 80: b[80] ?? "", ...(b[90] ? { 90: b[90] } : {}) }, evidence: "" });
const ctx: CheckinAiContext = {
  krs: [
    { id: "k1", label: "KR1", text: "新規の取引先", def: def({ 60: "出発", 70: "接点が3社", 80: "契約1社" }), hint: { unit: "社", start: 0, target: 5, direction: "up", value: 1, prev: 0 }, current: 62 },
    { id: "k2", label: "KR2", text: "社内の仕組み", def: def({ 60: "出発", 70: "試行", 80: "定着", 90: "他部署へ" }), hint: null, current: null },
    { id: "k3", label: "KR3", text: "基準文がまだ", def: def({}), hint: null, current: null },
  ],
  tasks: [
    { id: "task-a", title: "展示会の準備", assignee: "山田 太郎", pj: "PJ-A" },
    { id: "task-b", title: "連絡先の整理", assignee: "佐藤 花子", pj: "PJ-B" },
  ],
  members: [
    { id: "m1", name: "山田 太郎" },
    { id: "m2", name: "佐藤 花子" },
  ],
};
const meta = { id: "r1", name: "議事録.txt", kind: "テキスト", checkinId: "c1" };

const reply = (o: unknown) => JSON.stringify(o);
const full = {
  assessments: [
    { kr: "KR1", value: 63, summary: "接点が動き始めた", basis: [{ requirement: "接点3社", status: "一部", quote: "2社と面談" }, { requirement: "提案", status: "まだ", quote: "書いてはいけない" }], page: "p.2" },
    { kr: "kr2", value: 87, summary: "定着した", basis: [], page: "" },
    { kr: "KR3", value: 70, summary: "基準文なし", basis: [], page: "" },
    { kr: "KR9", value: 70, summary: "無いKR", basis: [], page: "" },
  ],
  hint_values: [
    { kr: "KR1", value: 2, page: "p.2" },
    { kr: "KR2", value: 5, page: "" },
  ],
  learnings: [
    { kr: "KR1", kind: "分かったこと", text: "早い連絡が効く", page: "" },
    { kr: "KR1", kind: "変な種類", text: "捨てる", page: "" },
  ],
  outcomes: [{ kr: "KR1", change: "＋1社", excerpt: "A社と面談", page: "p.3", tasks: [{ task: "t1", reason: "展示会で会った" }, { task: "t9", reason: "無い仕事" }, { task: "t1", reason: "重複" }] }],
  decisions: [
    { kind: "宿題", text: "提案書を作る", owner: "佐藤さん", krs: ["KR1", "KR9"], page: "" },
    { kind: "決定", text: "月1回集まる", owner: "", krs: [], page: "" },
    { kind: "その他", text: "捨てる", owner: "", krs: [], page: "" },
  ],
};

describe("parseCheckinReading：AIの返答 → 資料1件の読み取り結果", () => {
  const r = parseCheckinReading(reply(full), ctx, meta);

  it("KR・仕事・担当者の番号と名前を本番のIDに直す。一覧に無いものは捨てる", () => {
    expect(r).toMatchObject({ id: "r1", name: "議事録.txt", kind: "テキスト", checkinId: "c1" });
    expect(r.assessments.map((a) => a.krId)).toEqual(["k1", "k2"]);
    expect(r.notes[0].links).toEqual([{ taskId: "task-a", reason: "展示会で会った" }]);
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions[0]).toMatchObject({ kind: "宿題", ownerId: "m2", krIds: ["k1"] });
    expect(r.decisions[1].ownerId).toBeNull();
    expect(r.learnings).toHaveLength(1);
  });

  it("見立て：60〜70 はそのまま、70 以上は満たした段の値。段の基準文が無いKRは出さない。「まだ」の引用は空にする", () => {
    expect(r.assessments[0].assessment.value).toBe(63);
    expect(r.assessments[1].assessment.value).toBe(80);
    expect(r.assessments[0].assessment.basis[1]).toEqual({ requirement: "提案", status: "まだ", quote: "" });
    expect(r.assessments[0].source).toEqual({ doc: "議事録.txt", page: "p.2" });
    const low = parseCheckinReading(reply({ ...full, assessments: [{ kr: "KR1", value: 40, summary: "", basis: [], page: "" }] }), ctx, meta);
    expect(low.assessments[0].assessment.value).toBe(60);
  });

  it("手がかりの数字は、手がかりの定めがあるKRだけ", () => {
    expect(r.drafts).toEqual([{ krId: "k1", value: 2, source: { doc: "議事録.txt", page: "p.2" } }]);
  });

  it("成果の記述の key は資料ごとに別（資料をまたいだ同一視はしない）", () => {
    expect(r.notes[0].key).toBe("r1-n0");
  });

  it("壊れた JSON・JSON でない返答は、分かる言い方の例外にする", () => {
    expect(() => parseCheckinReading("{\"assessments\": [", ctx, meta)).toThrow(BROKEN_READING_MESSAGE);
    expect(() => parseCheckinReading("読み取れませんでした", ctx, meta)).toThrow(BROKEN_READING_MESSAGE);
    expect(() => parseCheckinReading("[1,2]", ctx, meta)).toThrow(BROKEN_READING_MESSAGE);
  });

  it("項目が欠けていても落ちない（空の結果）", () => {
    const e = parseCheckinReading("```json\n{}\n```", ctx, meta);
    expect(e).toMatchObject({ drafts: [], assessments: [], learnings: [], notes: [], decisions: [] });
  });

  it("KR の段の基準文が1つも無いときは、見立ては出ない（他は取り出す）", () => {
    const noDefs: CheckinAiContext = { ...ctx, krs: ctx.krs.map((k) => ({ ...k, def: null })) };
    const x = parseCheckinReading(reply(full), noDefs, meta);
    expect(x.assessments).toEqual([]);
    expect(x.learnings).toHaveLength(1);
    expect(buildCheckinUserText(noDefs, meta, "本文")).toContain("段の基準：未設定");
  });
});

describe("読ませる前の確認とプロンプト", () => {
  it("空の資料・KR が無いときは AI を呼ばずに止める", () => {
    expect(() => checkReadable(ctx, { fileName: "a.txt", isText: true, data: "  \n" })).toThrow("文字を読み取れませんでした");
    expect(() => checkReadable({ ...ctx, krs: [] }, { fileName: "a.txt", isText: true, data: "本文" })).toThrow(NO_KR_MESSAGE);
    expect(() => checkReadable(ctx, { fileName: "a.txt", isText: true, data: "本文" })).not.toThrow();
  });

  it("資料の本文と仕事の題名はサニタイズして送る（Section 6-4）", () => {
    const c = { ...ctx, tasks: [{ id: "x", title: "tanaka@example.com に送付", assignee: "", pj: "P" }] };
    const text = buildCheckinUserText(c, meta, String.raw`\\fs02\bumon\a.xlsx を参照`);
    expect(text).not.toContain("tanaka@example.com");
    expect(text).not.toContain("fs02");
    expect(text).toContain("t1｜[メールアドレス省略]");
  });

  it("送る仕事は、終わっていない仕事が先・完了は新しい順", () => {
    const t = (id: string, status: string, updated: string) => ({ id, status, updated });
    expect(orderTasksForAi([t("d1", "完了", "2026-10-01"), t("o1", "進行中", "2026-01-01"), t("d2", "完了", "2026-11-01")]).map((x) => x.id)).toEqual(["o1", "d2", "d1"]);
  });
});

type Node = Record<string, unknown>;
function walk(n: unknown, f: (n: Node) => void) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach((x) => walk(x, f));
  f(n as Node);
  for (const v of Object.values(n as Node)) walk(v, f);
}

describe("構造化出力のスキーマ（Edge Function と Anthropic の制約）", () => {
  it.each([
    ["資料", CHECKIN_SCHEMA],
    ["候補", CANDIDATES_SCHEMA],
    ["どう役立つか", HOW_SCHEMA],
  ])("%s：根は object・全オブジェクトが additionalProperties:false で全項目 required・使えないキーワードなし・2万字以内", (_n, schema) => {
    expect(schema.type).toBe("object");
    expect(JSON.stringify(schema).length).toBeLessThan(20_000);
    walk(schema, (n) => {
      for (const b of ["minLength", "maxLength", "minimum", "maximum", "multipleOf", "maxItems", "$ref", "pattern"]) expect(Object.keys(n)).not.toContain(b);
      if (n.type !== "object") return;
      expect(n.additionalProperties).toBe(false);
      expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as Node).sort());
    });
  });
});

describe("つなぎ先の候補・どう役立つかの解釈", () => {
  const krs = ctx.krs.map((k) => ({ id: k.id, label: k.label, text: k.text, def: k.def }));
  it("候補は一覧にあるKRだけ・重複なし・3件まで", () => {
    const text = reply({ candidates: [{ kr: "KR2", reason: "仕組み" }, { kr: "KR2", reason: "重複" }, { kr: "KR7", reason: "無い" }, { kr: "KR1", reason: "" }] });
    expect(parseCandidates(text, krs)).toEqual([
      { krId: "k2", reason: "仕組み" },
      { krId: "k1", reason: "" },
    ]);
  });
  it("案は空・重複を除いて3件まで。壊れた JSON は例外", () => {
    expect(parseHowOptions(reply({ options: ["a", "", "a", "b", "c", "d"] }))).toEqual(["a", "b", "c"]);
    expect(() => parseHowOptions("{oops")).toThrow(BROKEN_READING_MESSAGE);
    expect(() => parseCandidates("", krs)).toThrow(BROKEN_READING_MESSAGE);
  });
});

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
const args = { krIds: ["k1", "k2"], viewerId: "u1", weekStart: "2026-11-16" };

describe("okr_resources の保存形と読み込み", () => {
  it("readingOf で保存した形を、読み込みで同じ読み取り結果に戻す（地図に無いKRの分は捨てる）", () => {
    const res = parseCheckinReading(reply(full), ctx, meta);
    const r = buildRecords(
      rows({
        checkins: [{ id: "c1", checkin_date: "2026-11-17", title: "回", confirmed_by: null }],
        resources: [{ id: "r1", checkin_id: "c1", file_name: "議事録.txt", kind: "テキスト", reading: JSON.parse(JSON.stringify(readingOf(res))) }],
      }),
      args,
    );
    expect(r.resources).toHaveLength(1);
    expect(r.resources[0]).toEqual(res);
  });

  it("壊れた reading は空の結果として読む。消えた回の資料は読まない", () => {
    const r = buildRecords(
      rows({
        checkins: [{ id: "c1", checkin_date: "2026-11-17", title: "回", confirmed_by: null }],
        resources: [
          { id: "r1", checkin_id: "c1", file_name: "a.pdf", kind: "PDF", reading: { assessments: [{ krId: "k1" }, "x"], decisions: [{ kind: "決定" }] } },
          { id: "r2", checkin_id: "c9", file_name: "b.pdf", kind: "PDF", reading: {} },
        ],
      }),
      args,
    );
    expect(r.resources.map((x) => x.id)).toEqual(["r1"]);
    expect(r.resources[0]).toMatchObject({ assessments: [], decisions: [], drafts: [], learnings: [], notes: [] });
  });

  it("資料を読ませただけの回は「回」に数えず、未確定の回として別に返す（最新の回の日付を動かさない）", () => {
    const r = buildRecords(
      rows({
        checkins: [
          { id: "c1", checkin_date: "2026-11-10", title: "確定済み", confirmed_by: "u2" },
          { id: "c2", checkin_date: "2026-11-17", title: "読ませただけ", confirmed_by: null },
        ],
      }),
      args,
    );
    expect(r.checkins.map((c) => c.id)).toEqual(["c1"]);
    expect(r.openCheckins?.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("個人OKRの矢印：personal_krs.key_result_id を初期値に使う（表示だけ）", () => {
  const pk = (id: string, key_result_id: string | null) => ({ id, label: id, member_id: "u1", key_result_id });
  it("矢印の行が無い個人OKRは key_result_id を矢印にする。地図に無いKRは使わない", () => {
    const r = buildRecords(rows({ personalKrs: [pk("p1", "k1"), pk("p2", "kX"), pk("p3", null)] }), args);
    expect(r.personalLinks.u1).toEqual([{ personalId: "p1", krId: "k1" }]);
  });
  it("外した行（is_deleted）も含めて行があれば、初期値は使わない", () => {
    const r = buildRecords(rows({ personalKrs: [pk("p1", "k1")], personalLinks: [{ personal_kr_id: "p1", kr_id: "k1", is_deleted: true }] }), args);
    expect(r.personalLinks.u1).toEqual([]);
    const r2 = buildRecords(rows({ personalKrs: [pk("p1", "k1")], personalLinks: [{ personal_kr_id: "p1", kr_id: "k2", is_deleted: false }] }), args);
    expect(r2.personalLinks.u1).toEqual([{ personalId: "p1", krId: "k2" }]);
  });
  it("初期値の個人OKRに矢印を足すと、初期値の矢印も一緒に書く（書かないと開き直したときに消える）", () => {
    const before = { ...U.emptyUser(), personalLinks: [{ personalId: "p1", krId: "k1" }] };
    const after = { ...before, personalLinks: [...before.personalLinks, { personalId: "p1", krId: "k2" }] };
    expect(diffUser(before, after).personalLinks).toEqual([
      { personalId: "p1", krId: "k2", deleted: false },
      { personalId: "p1", krId: "k1", deleted: false },
    ]);
    const removed = { ...before, personalLinks: [] };
    expect(diffUser(before, removed).personalLinks).toEqual([{ personalId: "p1", krId: "k1", deleted: true }]);
  });
});

describe("Kintone の取り込み", () => {
  const items: OkrItem[] = [
    { id: "o1", kind: "objective", parentId: null, label: "O", text: "めざす姿" },
    { id: "k1", kind: "kr", parentId: "o1", label: "KR1", text: "KR一" },
    { id: "k2", kind: "kr", parentId: "o1", label: "KR2", text: "KR二" },
    { id: "tf1", kind: "tf", parentId: "k1", label: "TF1-1", text: "取り組みA", quarters: ["4Q"] },
    { id: "tf2", kind: "tf", parentId: "k2", label: "TF2-1", text: "取り組みB", quarters: ["4Q"] },
  ];
  const tf = (n: string | null, name: string) => ({ tf_number: n, name, description: "説明", background: null, leader_name_hint: null, source_quote: "" });
  const analysis: OkrImportAnalysis = {
    objective: { title: "めざす姿（改）", purpose: "目的", background: null, period: null },
    key_results: [
      { title: "KR一", task_forces: [tf("1", "取り組みA（改）"), tf("2", "新しい取り組み")], bands: { "60": "出発", "70": "七", "80": "八" } },
      { title: "KR二（改）", task_forces: [], bands: null },
      { title: "KR三", task_forces: [tf("1", "置き場が無い")] },
    ],
  };
  const reading = readingFromImport(analysis, items, "okr.pdf");

  it("KR は並び順、TF は番号で対応づける。アプリに無いTFは新しい行・KRが無いTFは取り込めない", () => {
    expect(reading.rows).toEqual([
      { id: "tf1", label: "TF1-1", text: "取り組みA（改）", parentId: "k1" },
      { id: `${NEW_TF_PREFIX}TF1-2`, label: "TF1-2", text: "新しい取り組み", parentId: "k1" },
    ]);
    expect(reading.skipped).toEqual(["TF3-1 置き場が無い"]);
    expect(reading.krs[0].bands).toEqual({ 60: "出発", 70: "七", 80: "八" });
    expect(reading.krs[2].krId).toBeNull();
    expect(headDiffs(reading, items).map((h) => h.label)).toEqual(["O", "KR2", "KR3"]);
  });

  it("合わせる計画：違うものだけ書く。アプリにだけあるTF（tf2）は消さない。段の基準文は同じなら書かない", () => {
    const plan = planKintoneApply(reading, items, { k1: def({ 60: "出発", 70: "七", 80: "八" }) });
    expect(plan.krTitles).toEqual([{ krId: "k2", title: "KR二（改）" }]);
    expect(plan.tfRenames).toEqual([{ tfId: "tf1", name: "取り組みA（改）" }]);
    expect(plan.tfCreates).toEqual([{ krId: "k1", tfNumber: "2", name: "新しい取り組み", description: "説明", background: null }]);
    expect(plan.bands).toEqual([]);
    expect(planKintoneApply(reading, items, { k1: def({}) }).bands).toEqual([{ krId: "k1", bands: { 60: "出発", 70: "七", 80: "八" } }]);
  });

  it("書き込みは既存の保存関数を通す（O は違うときだけ・新しいTFは今期で作る）", async () => {
    const plan = planKintoneApply(reading, items, {});
    const saveObjective = vi.fn(async (_o: Objective) => {});
    const saveKeyResult = vi.fn(async (_k: KeyResult) => {});
    const saveTaskForce = vi.fn(async (_t: TaskForce) => {});
    await writeKintonePlan(plan, {
      objective: { id: "o1", title: "めざす姿", period: "", is_current: true },
      keyResults: [{ id: "k1", objective_id: "o1", title: "KR一", is_deleted: false }, { id: "k2", objective_id: "o1", title: "KR二", is_deleted: false }],
      taskForces: [{ id: "tf1", kr_id: "k1", tf_number: "1", quarter: "4Q", name: "取り組みA", leader_member_id: "m1", is_deleted: false }],
      saveObjective,
      saveKeyResult,
      saveTaskForce,
      viewerId: "u1",
      quarter: "4Q",
      now: "2026-11-17T00:00:00Z",
      newId: () => "new-tf",
    });
    expect(saveObjective).toHaveBeenCalledWith(expect.objectContaining({ id: "o1", title: "めざす姿（改）", purpose: "目的", updated_by: "u1" }));
    expect(saveKeyResult).toHaveBeenCalledTimes(1);
    expect(saveKeyResult.mock.calls[0][0]).toMatchObject({ id: "k2", title: "KR二（改）" });
    expect(saveTaskForce.mock.calls.map((c) => c[0].id)).toEqual(["tf1", "new-tf"]);
    expect(saveTaskForce.mock.calls[0][0]).toMatchObject({ name: "取り組みA（改）", leader_member_id: "m1" });
    expect(saveTaskForce.mock.calls[1][0]).toMatchObject({ kr_id: "k1", tf_number: "2", quarter: "4Q", leader_member_id: null, is_deleted: false });
  });
});

describe("詳細の列の境目・一意制約の判定", () => {
  it("右の AI 相談パネルを開くと、その幅だけ境目が広がる", () => {
    expect(panelNarrowPx(160, 400) - panelNarrowPx(160)).toBe(400);
    expect(panelNarrowPx(160)).toBe(1373);
  });
  it("23505 だけを一意制約違反とみなす", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "42501" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
