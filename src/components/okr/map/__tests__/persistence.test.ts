// 段階2：記録の保存と読み込み（行 → 画面の形・本人の状態の差分・確定で保存するもの・副担当）。
// Supabase には触れない（純粋関数だけを確かめる）。RLS の意図は supabase/migrations/20261117_okr_map_records.sql。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmSaveOf } from "../confirm";
import { isAssignee } from "../logic";
import { emptyRecords } from "../repository";
import { buildRecords, diffUser, type LoadedRows } from "../supabaseRepository";
import type { Checkin, OutcomeNote, Resource, Task } from "../types";
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
const args = { krIds: ["k1", "k2"], viewerId: "u1", weekStart: "2026-11-16" };
const task = (id: string, assigneeId: string, assigneeIds?: string[]): Task => ({ id, pjId: "p1", title: id, assigneeId, assigneeIds, due: null, status: "進行中", updated: "2026-11-16" });

describe("buildRecords：読んだ行 → 画面の形", () => {
  it("行が無ければ emptyRecords と同じ形（KRごとの欄はそろう・未確定）", () => {
    const r = buildRecords(rows(), args);
    expect(r.krDefs).toEqual(emptyRecords(args.krIds).krDefs);
    expect(r.records.k2).toEqual({ krId: "k2", updatedAt: "", prevAt: "", source: null });
    expect(r.lock).toEqual({ locked: false, lockedAt: null });
  });

  it("段の基準文・証拠・手がかりの定め。手がかりの値は回の日付順で、最新が value・その前が prev（無ければ期首）", () => {
    const r = buildRecords(
      rows({
        defs: [{ id: "d1", kr_id: "k1", bands: { 60: "出発", 70: "七", 80: "八", 90: "" }, evidence: "契約書", hint_unit: "社", hint_start: "10", hint_target: 30, hint_direction: "up", updated_at: "t" }],
        checkins: [
          { id: "c2", checkin_date: "2026-11-10", title: "2回目", confirmed_by: "u2" },
          { id: "c1", checkin_date: "2026-10-10", title: "1回目", confirmed_by: null },
        ],
        assessments: [
          { id: "a1", checkin_id: "c1", kr_id: "k1", resource_id: null, value: null, summary: "", basis: [], source: { doc: "資料A", page: "p1" }, hint_value: 12 },
          { id: "a2", checkin_id: "c2", kr_id: "k1", resource_id: null, value: null, summary: "", basis: [], source: { doc: "資料B", page: "p2" }, hint_value: "15" },
          { id: "a3", checkin_id: "c2", kr_id: "k1", resource_id: "r1", value: 66, summary: "要約", basis: [{ requirement: "要件", status: "一部", quote: "引用" }, "壊れた値"], source: { doc: "資料B", page: "p3" }, hint_value: null },
          { id: "a4", checkin_id: "c9", kr_id: "k1", resource_id: "r1", value: 70, summary: "", basis: [], source: null, hint_value: null },
          { id: "a5", checkin_id: "c2", kr_id: "kX", resource_id: "r1", value: 70, summary: "", basis: [], source: null, hint_value: null },
        ],
      }),
      args,
    );
    expect(r.checkins.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(r.confirmedBy).toEqual({ c2: "u2" });
    expect(r.krDefs.k1).toEqual({ bands: { 60: "出発", 70: "七", 80: "八" }, evidence: "契約書" });
    expect(r.records.k1).toMatchObject({ updatedAt: "2026-11-10", prevAt: "2026-10-10", source: { doc: "資料B", page: "p2" } });
    expect(r.records.k1.hint).toEqual({ unit: "社", start: 10, target: 30, direction: "up", value: 15, prev: 12 });
    expect(r.history.k1).toEqual([
      { date: "2026-10-10", value: 12 },
      { date: "2026-11-10", value: 15 },
    ]);
    // 見立ては資料のある行だけ。消えた回（c9）・地図にない KR（kX）の行は捨てる。壊れた根拠は落とす
    expect(r.assess.k1).toHaveLength(1);
    expect(r.assess.k1[0]).toMatchObject({ checkinId: "c2", resourceId: "r1", assessment: { value: 66, summary: "要約", basis: [{ requirement: "要件", status: "一部", quote: "引用" }] } });
    expect(r.assess.kX).toBeUndefined();
  });

  it("手がかりの定めがあって値がまだ無いKRは、期首を value・prev にする（画面が NaN を出さない）", () => {
    const r = buildRecords(rows({ defs: [{ id: "d", kr_id: "k2", bands: null, evidence: "", hint_unit: "%", hint_start: 40, hint_target: 80, hint_direction: "up", updated_at: "t" }] }), args);
    expect(r.records.k2.hint).toEqual({ unit: "%", start: 40, target: 80, direction: "up", value: 40, prev: 40 });
    expect(r.krDefs.k2.bands).toEqual({ 60: "", 70: "", 80: "" });
  });

  it("結びつきへの答え：本人の分は全部、他の人の分は yes だけ使う（RLS と同じ。念のため画面側でも絞る）", () => {
    const r = buildRecords(
      rows({
        notes: [{ id: "n1", kr_id: "k1", note_key: "key1", change_text: "+1社", excerpt: "抜粋", sources: [{ doc: "資料", page: "1" }], links: [{ taskId: "t1", reason: "理由" }] }],
        claims: [
          { note_id: "n1", task_id: "t1", member_id: "u1", status: "pending" },
          { note_id: "n1", task_id: "t1", member_id: "u2", status: "yes" },
          { note_id: "n1", task_id: "t1", member_id: "u3", status: "no" },
        ],
      }),
      args,
    );
    expect(r.outcomeNotes).toEqual([{ key: "key1", krId: "k1", change: "+1社", excerpt: "抜粋", sources: [{ doc: "資料", page: "1" }], links: [{ taskId: "t1", reason: "理由" }] }]);
    expect(r.userRecords?.u1?.claims).toEqual({ "key1|t1": "pending" });
    expect(r.userRecords?.u2?.claims).toEqual({ "key1|t1": "yes" });
    expect(r.userRecords?.u3).toBeUndefined();
  });

  it("本人の分：どう役立つか・採否・今週の答え・今週やる。前の週の答えは「過去の週」へ（新しい順）", () => {
    const r = buildRecords(
      rows({
        how: [{ task_id: "t1", kr_id: "k1", body: "一言" }],
        proposals: [{ task_id: "t1", kr_id: "k2", choice: "skipped" }],
        answers: [
          { week_start: "2026-11-16", kr_id: "k1", effect: "役立った", match_answer: null },
          { week_start: "2026-11-09", kr_id: "k1", effect: "少し役立った", match_answer: "そのとおり" },
          { week_start: "2026-11-02", kr_id: "k2", effect: "役立った", match_answer: null },
          { week_start: "2026-10-26", kr_id: "k2", effect: null, match_answer: "違う" },
        ],
        picks: [{ task_id: "t1" }],
        links: [{ task_id: "t1", kr_ids: ["k2", "kX"], updated_by: "u2" }],
        personalLinks: [{ personal_kr_id: "pk1", kr_id: "k1" }],
        personalKrs: [{ id: "pk1", label: "個人KR", member_id: "u1" }],
        lock: { locked_on: "2026-10-03" },
      }),
      args,
    );
    const me = r.userRecords?.u1;
    expect(me?.how).toEqual({ "t1|k1": "一言" });
    expect(me?.proposals).toEqual({ "t1|k2": "skipped" });
    expect(me?.answers).toEqual({ "2026-11-16|k1": { effect: "役立った" } });
    expect(r.pastWeeks.u1.map((w) => w.weekStart)).toEqual(["2026-11-09", "2026-11-02"]);
    expect(r.pastWeeks.u1[0].answers.k1).toEqual({ effect: "少し役立った", match: "そのとおり", view: "" });
    expect(r.picks).toEqual({ u1: ["t1"] });
    // つなぎ先は最後に選び直した人の分に入る（地図にないKRは落とす）
    expect(r.overrides).toEqual({ u2: { t1: ["k2"] } });
    expect(r.personalLinks).toEqual({ u1: [{ personalId: "pk1", krId: "k1" }] });
    expect(r.personalOkrs).toEqual([{ id: "pk1", ownerId: "u1", text: "個人KR" }]);
    expect(r.lock).toEqual({ locked: true, lockedAt: "2026-10-03" });
  });
});

describe("diffUser：本人の状態の変化 → 書く行", () => {
  const base = U.emptyUser();
  it("変化が無ければ何も書かない", () => {
    expect(diffUser(base, { ...base })).toEqual({ links: [], proposals: [], how: [], personalLinks: [], answers: [], picks: [], claims: [] });
  });
  it("つなぎ先：選び直し・並びだけ違う（書かない）・既定に戻す（krIds=null）", () => {
    const a = { ...base, overrides: { t1: ["k1", "k2"] } };
    expect(diffUser(base, a).links).toEqual([{ taskId: "t1", krIds: ["k1", "k2"] }]);
    expect(diffUser(a, { ...base, overrides: { t1: ["k2", "k1"] } }).links).toEqual([]);
    expect(diffUser(a, base).links).toEqual([{ taskId: "t1", krIds: null }]);
    expect(diffUser(base, { ...base, overrides: { t1: [] } }).links).toEqual([{ taskId: "t1", krIds: [] }]);
  });
  it("採否・どう役立つか・個人OKRの矢印・答え・今週やる：付けた／外したを is_deleted で書く", () => {
    const a: U.UserState = {
      ...base,
      proposals: { "t1|k1": "taken" },
      how: { "t1|k1": "一言" },
      personalLinks: [{ personalId: "pk1", krId: "k1" }],
      answers: { "2026-11-16|k1": { effect: "役立った" } },
      picks: { "2026-11-16": ["t1"] },
    };
    const d = diffUser(base, a);
    expect(d.proposals).toEqual([{ taskId: "t1", krId: "k1", choice: "taken", deleted: false }]);
    expect(d.how).toEqual([{ taskId: "t1", krId: "k1", body: "一言", deleted: false }]);
    expect(d.personalLinks).toEqual([{ personalId: "pk1", krId: "k1", deleted: false }]);
    expect(d.answers).toEqual([{ weekStart: "2026-11-16", krId: "k1", effect: "役立った", match: null }]);
    expect(d.picks).toEqual([{ weekStart: "2026-11-16", taskId: "t1", deleted: false }]);
    const back = diffUser(a, base);
    expect(back.proposals).toEqual([{ taskId: "t1", krId: "k1", choice: "taken", deleted: true }]);
    expect(back.how).toEqual([{ taskId: "t1", krId: "k1", body: "", deleted: true }]);
    expect(back.personalLinks).toEqual([{ personalId: "pk1", krId: "k1", deleted: true }]);
    expect(back.picks).toEqual([{ weekStart: "2026-11-16", taskId: "t1", deleted: true }]);
  });
  it("結びつき：答え（yes／no）だけを書く。届いた pending は書かない（確定した人が saveConfirm で作る）", () => {
    const pending = { ...base, claims: { "key|1|t1": "pending" as const } };
    expect(diffUser(base, pending).claims).toEqual([]);
    expect(diffUser(pending, { ...base, claims: { "key|1|t1": "yes" } }).claims).toEqual([{ noteKey: "key|1", taskId: "t1", status: "yes" }]);
  });
});

describe("副担当（主担当以外の担当者）も「わたし」・本人の操作に入る", () => {
  const t = task("t1", "u1", ["u1", "u2"]);
  it("isAssignee は主担当・副担当のどちらでも true", () => {
    expect(isAssignee(t, "u1")).toBe(true);
    expect(isAssignee(t, "u2")).toBe(true);
    expect(isAssignee(t, "u3")).toBe(false);
    expect(isAssignee(task("t2", "u1"), "u1")).toBe(true);
  });
  it("つなぎ先は仕事1件に1つ：副担当が選び直すと主担当の分は外れ、保存の差分にはその仕事が1行で出る", () => {
    let s = U.setOverride({}, "u1", t, ["k1"], []);
    expect(U.mergedOverrides(s)).toEqual({ t1: ["k1"] });
    const prev = s;
    s = U.setOverride(s, "u2", t, ["k2"], []);
    expect(U.userOf(s, "u1").overrides.t1).toBeUndefined();
    expect(U.mergedOverrides(s)).toEqual({ t1: ["k2"] });
    const [b, a] = U.viewerChange(prev, s, "u2");
    expect(diffUser(b, a).links).toEqual([{ taskId: "t1", krIds: ["k2"] }]);
    // 副担当が既定に戻す：自分の分には無くても、主担当の分を外して「既定に戻す」1行を書く
    const s2 = U.setOverride(prev, "u2", t, undefined, []);
    expect(U.mergedOverrides(s2)).toEqual({});
    const [b2, a2] = U.viewerChange(prev, s2, "u2");
    expect(diffUser(b2, a2).links).toEqual([{ taskId: "t1", krIds: null }]);
    // 担当でない人は変えられない
    expect(U.setOverride(s, "u3", t, ["k1"], [])).toBe(s);
  });
  it("結びつきは担当者全員に届き、だれか1人が「そのとおり」と答えれば全員に見える", () => {
    const note: OutcomeNote = { key: "n", krId: "k1", change: "", excerpt: "", sources: [], links: [{ taskId: "t1", reason: "" }] };
    let s = U.deliverClaims({}, [note], [t]);
    expect(U.userOf(s, "u1").claims).toEqual({ "n|t1": "pending" });
    expect(U.userOf(s, "u2").claims).toEqual({ "n|t1": "pending" });
    expect(U.confirmedLinks(s, [note], [t])).toEqual([]);
    s = U.answerClaim(s, "u2", t, "n", "yes");
    expect(U.confirmedLinks(s, [note], [t]).map((c) => c.task.id)).toEqual(["t1"]);
  });
});

describe("confirmSaveOf：確定で保存するもの", () => {
  const ci: Checkin = { id: "c1", date: "2026-11-16", title: "回" };
  const res: Resource = {
    id: "r1",
    name: "資料",
    kind: "pdf",
    checkinId: "c1",
    drafts: [{ krId: "k1", value: 12, source: { doc: "資料", page: "1" } }],
    assessments: [],
    learnings: [],
    notes: [],
    decisions: [],
  };
  it("今回の回×選んだ資料の分だけ。手がかりの値は確定後の記録の値（食い違いの選択・手入力を反映したもの）。結びつきは担当者全員へ", () => {
    const note: OutcomeNote = { key: "n", krId: "k1", change: "", excerpt: "", sources: [], links: [{ taskId: "t1", reason: "" }] };
    const c = confirmSaveOf({
      groupId: "g",
      viewerId: "u1",
      ci,
      selected: [res],
      drafts: res.drafts,
      nextRecords: { k1: { krId: "k1", updatedAt: "2026-11-16", prevAt: "", source: null, hint: { unit: "社", start: 10, target: 30, direction: "up", value: 13, prev: 10 } } },
      nextHist: {
        k1: [
          { checkinId: "c0", date: "2026-10-01", resourceId: "r0", assessment: { value: 60, basis: [], summary: "" }, source: null },
          { checkinId: "c1", date: "2026-11-16", resourceId: "r1", assessment: { value: 66, basis: [], summary: "" }, source: null },
        ],
      },
      nextLearnings: [
        { id: "x", checkinId: "c1", resourceId: "r1", krId: "k1", kind: "分かったこと", text: "今回", source: { doc: "", page: "" } },
        { id: "y", checkinId: "c0", resourceId: "r0", krId: "k1", kind: "分かったこと", text: "前回", source: { doc: "", page: "" } },
      ],
      nextDecisions: [],
      notes: [note],
      nextNotes: [note, { ...note, key: "old" }],
      tasks: [task("t1", "u1", ["u1", "u2"])],
    });
    expect(c.resourceIds).toEqual(["r1"]);
    expect(c.assessments.map((a) => a.entry.checkinId)).toEqual(["c1"]);
    expect(c.hintValues).toEqual({ k1: { value: 13, source: { doc: "資料", page: "1" } } });
    expect(c.learnings.map((l) => l.text)).toEqual(["今回"]);
    expect(c.notes.map((n) => n.key)).toEqual(["n"]);
    expect(c.claims).toEqual([
      { noteKey: "n", taskId: "t1", memberId: "u1" },
      { noteKey: "n", taskId: "t1", memberId: "u2" },
    ]);
  });
});

describe("マイグレーションと schema.sql（Section 39・22）", () => {
  const mig = readFileSync(join(process.cwd(), "supabase", "migrations", "20261117_okr_map_records.sql"), "utf-8");
  const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf-8");
  const tables = [...mig.matchAll(/CREATE TABLE IF NOT EXISTS public\.(okr_[a-z_]+)/g)].map((m) => m[1]);
  it("表は15本。すべて GRANT の配列（マイグレーション・schema.sql の $grant_tables$）にある", () => {
    expect(tables).toHaveLength(15);
    const grantBlock = schema.slice(schema.indexOf("DO $grant_tables$"));
    for (const t of tables) {
      expect(mig.slice(mig.indexOf("DO $okr_grants$")), t).toContain(`'${t}'`);
      expect(grantBlock, t).toContain(`'${t}'`);
      expect(schema, t).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
    }
  });
  it("DELETE のポリシーを作らない（物理削除しない）。SECURITY DEFINER の部署・本人の判定は (SELECT ...) で包む", () => {
    expect(mig).not.toMatch(/FOR DELETE/);
    expect(mig).not.toMatch(/FOR ALL/);
    const unwrapped = (sql: string) =>
      (sql.match(/public\.current_member_(id|group_ids|is_super_admin)\(\)/g) ?? []).length -
      (sql.match(/\(SELECT public\.current_member_(id|group_ids|is_super_admin)\(\)\)/g) ?? []).length;
    expect(unwrapped(mig)).toBe(0);
    // 検査自体が効いている（Section 59）：包んでいない呼び出しは数える
    expect(unwrapped("USING (public.current_member_id() = member_id)")).toBe(1);
    expect(unwrapped("USING (member_id = (SELECT public.current_member_id()))")).toBe(0);
  });
  it("anon には付けない", () => {
    expect(mig).not.toMatch(/GRANT (SELECT|EXECUTE|ALL)[^;']*\bTO\b[^;']*\banon\b/);
    expect(mig).toMatch(/REVOKE ALL ON public\.%I FROM anon/);
  });
});
