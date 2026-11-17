// 段階3の入出力：AI の呼び方（invokeAI・intent・モデル・構造化出力）と、KRの定めの同時作成の競合。
// invokeAI・ファイルの読み込み・Supabase はモックにする（実際の AI・DB は呼ばない）。s91 91-3。
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeAIMock = vi.fn();
vi.mock("../../../../lib/ai/invokeAI", () => ({
  invokeAI: (...a: unknown[]) => invokeAIMock(...a),
  buildMessageContent: (text: string) => text,
}));
const loadMock = vi.fn();
vi.mock("../../../../lib/ai/consultationAttachmentLoader", () => ({
  checkConsultAttachFile: () => ({ ok: true }),
  loadConsultAttachment: (...a: unknown[]) => loadMock(...a),
  CONSULT_ATTACHMENT_ACCEPT: ".txt",
}));
const saveWithLockMock = vi.fn();
vi.mock("../../../../lib/supabase/store", () => {
  class ConflictError extends Error {}
  return { ConflictError, saveWithLock: (...a: unknown[]) => saveWithLockMock(...a) };
});
const freshRow = { id: "d-other", kr_id: "k1", bands: { 60: "他の人の60", 70: "七", 80: "八" }, evidence: "契約書", hint_unit: null, hint_start: null, hint_target: null, hint_direction: null, updated_at: "t2" };
// 表ごとに成功・失敗を決められる小さな Supabase の代わり。書いた表の名前を順に記録する
const mockDb = {
  fail: new Set<string>(),
  claimRows: [{ id: "c1" }] as { id: string }[],
  written: [] as string[],
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({ data: { notes: [{ id: "note-1", note_key: "key1" }] }, error: null as unknown })),
};
vi.mock("../../../../lib/supabase/client", () => {
  const builder = (table: string) => {
    const result = () => (mockDb.fail.has(table) ? { data: null, error: { message: `${table} は拒否されました` } } : { data: table === "okr_outcome_claims" ? mockDb.claimRows : null, error: null });
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order"]) q[m] = () => q;
    q.upsert = () => {
      mockDb.written.push(table);
      return q;
    };
    q.update = () => {
      mockDb.written.push(table);
      return q;
    };
    q.maybeSingle = async () => ({ data: freshRow, error: null });
    q.then = (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ng);
    return q;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: (fn: string, args: unknown) => mockDb.rpc(fn, args) } };
});

import { createOkrMapAi, OKR_MAP_MODEL } from "../aiClient";
import { CHECKIN_SCHEMA, type CheckinAiContext } from "../checkinAi";
import { KrDefConflictError } from "../repository";
import { createSupabaseRepository, SaveUserError } from "../supabaseRepository";
import * as U from "../userState";

const ctx: CheckinAiContext = {
  krs: [{ id: "k1", label: "KR1", text: "KR", def: { bands: { 60: "出発", 70: "七", 80: "八" }, evidence: "" }, hint: null, current: null }],
  tasks: [],
  members: [],
};
const meta = { id: "r1", name: "議事録.txt", kind: "テキスト", checkinId: "c1" };
const file = new File(["x"], "議事録.txt", { type: "text/plain" });

beforeEach(() => {
  invokeAIMock.mockReset();
  loadMock.mockReset();
  saveWithLockMock.mockReset();
});

describe("資料の読み取り：invokeAI の呼び方", () => {
  it("intent=okr-checkin-extract・AI相談と同じモデル・構造化出力・max_tokens 8192 で1回呼ぶ", async () => {
    loadMock.mockResolvedValue({ fileName: "議事録.txt", mediaType: "text/plain", data: "本文", isText: true });
    invokeAIMock.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ assessments: [{ kr: "KR1", value: 65, summary: "s", basis: [], page: "" }], hint_values: [], learnings: [], outcomes: [], decisions: [] }) }], stop_reason: "end_turn" });
    const r = await createOkrMapAi().readResource(file, ctx, meta);
    expect(invokeAIMock).toHaveBeenCalledTimes(1);
    const [, messages, maxTokens, intent, model, options] = invokeAIMock.mock.calls[0];
    expect(intent).toBe("okr-checkin-extract");
    expect(model).toBe(OKR_MAP_MODEL);
    expect(OKR_MAP_MODEL).toBe("claude-sonnet-5-5");
    expect(maxTokens).toBe(8192);
    expect(options).toEqual({ outputSchema: CHECKIN_SCHEMA, effort: "low" });
    expect(JSON.stringify(messages)).toContain("本文");
    expect(r.resource.assessments[0].assessment.value).toBe(65);
    expect(r.notice).toBeNull();
  });

  it("空の資料は AI を呼ばない（課金だけ発生させない）", async () => {
    loadMock.mockResolvedValue({ fileName: "議事録.txt", mediaType: "text/plain", data: "   ", isText: true });
    await expect(createOkrMapAi().readResource(file, ctx, meta)).rejects.toThrow("文字を読み取れませんでした");
    expect(invokeAIMock).not.toHaveBeenCalled();
  });

  it("出力が上限で切れたら、分けて読ませる案内の例外にする", async () => {
    loadMock.mockResolvedValue({ fileName: "議事録.txt", mediaType: "text/plain", data: "本文", isText: true });
    invokeAIMock.mockResolvedValue({ content: [{ type: "text", text: "{\"assess" }], stop_reason: "max_tokens" });
    await expect(createOkrMapAi().readResource(file, ctx, meta)).rejects.toThrow("途中で切れました");
  });

  it("候補・案は intent=okr-map-suggest", async () => {
    invokeAIMock.mockResolvedValue({ content: [{ type: "text", text: "{\"options\":[\"a\"]}" }] });
    await createOkrMapAi().suggestHow({ id: "k1", label: "KR1", text: "KR", def: null }, "PJ", "仕事");
    expect(invokeAIMock.mock.calls[0][3]).toBe("okr-map-suggest");
  });
});

describe("KRの定め：2人がほぼ同時に初めて作ったとき", () => {
  it("一意制約エラーは生のまま出さず、読み直した最新の内容つきの競合にする", async () => {
    saveWithLockMock.mockRejectedValue({ code: "23505", message: "duplicate key value violates unique constraint" });
    const repo = createSupabaseRepository();
    const err = await repo.saveKrDef("k1", { bands: { 60: "自分の60", 70: "", 80: "" }, evidence: "" }, null, "u1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KrDefConflictError);
    const c = err as KrDefConflictError;
    expect(c.def.bands[60]).toBe("他の人の60");
    expect(c.message).not.toContain("duplicate");
    // 次の保存は、読み直した行の ID と updated_at で楽観ロックする
    saveWithLockMock.mockResolvedValue("t3");
    await repo.saveKrDef("k1", c.def, null, "u1");
    expect(saveWithLockMock.mock.calls[1][1]).toMatchObject({ id: "d-other" });
    expect(saveWithLockMock.mock.calls[1][2]).toBe("t2");
  });

  it("その他のエラーはそのまま投げる", async () => {
    saveWithLockMock.mockRejectedValue({ code: "42501", message: "permission denied" });
    await expect(createSupabaseRepository().saveKrDef("k1", { bands: { 60: "", 70: "", 80: "" }, evidence: "" }, null, "u1")).rejects.toMatchObject({ code: "42501" });
  });
});

const confirm = {
  groupId: "g1",
  viewerId: "u1",
  checkin: { id: "ci-1", date: "2026-11-17", title: "回" },
  resourceIds: ["r1"],
  assessments: [],
  hintValues: {},
  learnings: [],
  decisions: [],
  notes: [{ key: "key1", krId: "k1", change: "", excerpt: "", sources: [], links: [] }],
  claims: [{ noteKey: "key1", taskId: "t1", memberId: "u1" }],
};

describe("保存：表ごとの失敗と、確定の RPC", () => {
  beforeEach(() => {
    mockDb.fail.clear();
    mockDb.written = [];
    mockDb.claimRows = [{ id: "c1" }];
    mockDb.rpc.mockClear();
  });

  it("確定は okr_confirm_checkin の RPC 1本で書く（表を個別に書かない）", async () => {
    const repo = createSupabaseRepository();
    await repo.saveConfirm(confirm);
    expect(mockDb.rpc).toHaveBeenCalledTimes(1);
    expect(mockDb.rpc.mock.calls[0][0]).toBe("okr_confirm_checkin");
    expect(mockDb.rpc.mock.calls[0][1]).toMatchObject({ p: { checkin: { id: "ci-1", group_id: "g1" }, claims: [{ kr_id: "k1", note_key: "key1", task_id: "t1", member_id: "u1" }] } });
    expect(mockDb.written).toEqual([]);
  });

  it("RPC が失敗したら例外（画面がトーストで知らせる）", async () => {
    mockDb.rpc.mockResolvedValueOnce({ data: null as unknown as { notes: { id: string; note_key: string }[] }, error: { message: "new row violates row-level security policy" } });
    await expect(createSupabaseRepository().saveConfirm(confirm)).rejects.toMatchObject({ message: expect.stringContaining("row-level security") });
  });

  it("つなぎ先が拒否されても、残りの表は書き、失敗した表の名前を知らせる", async () => {
    mockDb.fail.add("okr_task_kr_links");
    const before = U.emptyUser();
    const after = { ...before, overrides: { t1: ["k1"] }, how: { "t1|k1": "役立つ" }, picks: { "2026-11-16": ["t1"] } };
    const err = await createSupabaseRepository().saveUser("u1", before, after).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SaveUserError);
    expect((err as SaveUserError).failed).toEqual(["仕事のつなぎ先"]);
    expect((err as SaveUserError).message).toContain("仕事のつなぎ先を保存できませんでした");
    expect(mockDb.written).toEqual(["okr_task_kr_links", "okr_task_kr_how", "okr_weekly_picks"]);
  });

  it("結びつきへの答え：成果の記述の行が分からないときは黙って捨てず、失敗にする", async () => {
    const before = { ...U.emptyUser(), claims: { "key1|t1": "pending" as const } };
    const err = await createSupabaseRepository().saveUser("u1", before, { ...before, claims: { "key1|t1": "yes" } }).catch((e: unknown) => e);
    expect((err as SaveUserError).failed).toEqual(["結びつきへの答え"]);
    expect((err as SaveUserError).message).toContain("見つかりません");
  });

  it("結びつきへの答え：更新が0件（本人でない・行が無い）なら失敗。1件なら成功。pending への戻しも書く", async () => {
    const repo = createSupabaseRepository();
    await repo.saveConfirm(confirm);
    const before = { ...U.emptyUser(), claims: { "key1|t1": "pending" as const } };
    mockDb.claimRows = [];
    await expect(repo.saveUser("u1", before, { ...before, claims: { "key1|t1": "yes" } })).rejects.toBeInstanceOf(SaveUserError);
    mockDb.claimRows = [{ id: "c1" }];
    await expect(repo.saveUser("u1", before, { ...before, claims: { "key1|t1": "yes" } })).resolves.toBeUndefined();
    mockDb.written = [];
    await repo.saveUser("u1", { ...before, claims: { "key1|t1": "yes" } }, before);
    expect(mockDb.written).toEqual(["okr_outcome_claims"]);
  });
});
