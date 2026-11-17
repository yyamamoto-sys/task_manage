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
vi.mock("../../../../lib/supabase/client", () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: freshRow, error: null }) };
  return { supabase: { from: () => q } };
});

import { createOkrMapAi, OKR_MAP_MODEL } from "../aiClient";
import { CHECKIN_SCHEMA, type CheckinAiContext } from "../checkinAi";
import { KrDefConflictError } from "../repository";
import { createSupabaseRepository } from "../supabaseRepository";

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
    expect(r.assessments[0].assessment.value).toBe(65);
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
