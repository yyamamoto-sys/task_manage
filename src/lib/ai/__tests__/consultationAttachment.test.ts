import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileAttachment } from "../invokeAI";

const mockInvoke = vi.fn();
vi.mock("../../supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

import {
  applyAttachmentTextBudget, buildConsultationContent, buildUserTurnContent, describeAttachmentOverflow,
  MAX_CONSULT_ATTACHMENT_CHARS, MAX_CONSULT_PDF_BYTES, CONSULT_ATTACHMENT_NOTICE,
} from "../consultationAttachment";
import { checkConsultAttachFile, checkCanAddAttachment } from "../consultationAttachmentLoader";
import { PDF_BASE64_FALLBACK_MAX_BYTES } from "../../pdfTextFormat";
import { callAIConsultation } from "../apiClient";
import { buildSystemPrompt } from "../systemPrompt";
import type { AIConsultationPayload } from "../payloadBuilder";

const txt = (name: string, n: number): FileAttachment => ({ fileName: name, mediaType: "text/plain", data: "あ".repeat(n), isText: true });
const pdf = (name: string, bytes: number): FileAttachment => ({ fileName: name, mediaType: "application/pdf", data: "A".repeat(Math.ceil((bytes * 4) / 3)), isText: false });

describe("上限（合計30,000字・添付順に詰める）", () => {
  it("上限内はそのまま", () => {
    const r = applyAttachmentTextBudget([txt("a", 100), txt("b", 200)]);
    expect(r.map(x => x.sentChars)).toEqual([100, 200]);
    expect(describeAttachmentOverflow([txt("a", 100)])).toBeNull();
  });
  it("超えた分は添付順に切り捨て、枠が尽きた後は0字", () => {
    const r = applyAttachmentTextBudget([txt("a", 20000), txt("b", 20000), txt("c", 5)]);
    expect(r.map(x => x.sentChars)).toEqual([20000, 10000, 0]);
    expect(r[1].truncated).toBe(true);
    expect(r[1].attachment.data.length).toBe(10000);
    expect(describeAttachmentOverflow([txt("a", 20000), txt("b", 20000)])).toBe("40,000字中 30,000字まで送ります（以降は切り捨て）");
  });
  it("PDFのまま送る添付は字数に数えない", () => {
    const r = applyAttachmentTextBudget([pdf("p", 1000), txt("a", MAX_CONSULT_ATTACHMENT_CHARS)]);
    expect(r[1].sentChars).toBe(MAX_CONSULT_ATTACHMENT_CHARS);
  });
  it("PDF上限は既存の200KBと同じ値", () => {
    expect(MAX_CONSULT_PDF_BYTES).toBe(PDF_BASE64_FALLBACK_MAX_BYTES);
  });
  it("PDFのまま送る合計が200KBを超えたら追加を断る", () => {
    expect(checkCanAddAttachment([pdf("p1", 150 * 1024)], pdf("p2", 100 * 1024))).toMatch(/200KB/);
    expect(checkCanAddAttachment([pdf("p1", 100 * 1024)], pdf("p2", 100 * 1024))).toBeNull();
    expect(checkCanAddAttachment([], txt("a", 99999))).toBeNull();
  });
});

describe("送信文の組み立て", () => {
  it("添付なしはそのまま文字列", () => {
    expect(buildConsultationContent("相談", [])).toBe("相談");
  });
  it("【添付資料：ファイル名】で区切ってテキストとして添える", () => {
    const c = buildConsultationContent("相談", [txt("a.docx", 2), txt("b.xlsx", 1)]);
    expect(c).toBe("相談\n\n【添付資料：a.docx】\nああ\n\n【添付資料：b.xlsx】\nあ");
  });
  it("切り捨てた添付には注記が付き、0字の添付は含めない", () => {
    const c = buildConsultationContent("q", [txt("a", 30000), txt("b", 10)]) as string;
    expect(c).not.toContain("【添付資料：b】");
    const c2 = buildConsultationContent("q", [txt("a", 29990), txt("b", 100)]) as string;
    expect(c2).toContain("切り捨て");
  });
  it("PDFのまま送る添付は document ブロックになる", () => {
    const c = buildConsultationContent("q", [pdf("s.pdf", 10)]);
    expect(Array.isArray(c)).toBe(true);
    expect((c as { type: string }[]).map(b => b.type)).toEqual(["text", "document"]);
  });
});

describe("履歴に本文を残さない", () => {
  it("マーカー行だけが残る（📎 ファイル名（◯字））", () => {
    const t = buildUserTurnContent("相談", [txt("議事録.docx", 1234), pdf("scan.pdf", 10)]);
    expect(t).toBe("相談\n\n📎 議事録.docx（1234字）\n📎 scan.pdf（PDFのまま）");
    expect(t).not.toContain("あああ");
  });
  it("添付なしは相談文のまま", () => {
    expect(buildUserTurnContent("相談", [])).toBe("相談");
  });
});

describe("形式の受付", () => {
  const f = (name: string, type = "") => checkConsultAttachFile({ name, type });
  it("対応形式", () => {
    for (const n of ["a.docx", "a.xlsx", "a.pptx", "a.pdf", "a.html", "a.txt", "a.md", "a.csv"]) expect(f(n).ok).toBe(true);
  });
  it("画像は理由つきで拒否", () => {
    const r = f("a.png", "image/png");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("画像");
  });
  it("旧形式は新形式で保存し直すよう案内", () => {
    for (const n of ["a.doc", "a.xls", "a.ppt"]) {
      const r = f(n);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("新しい形式");
    }
  });
  it("その他は拒否", () => { expect(f("a.zip").ok).toBe(false); });
});

describe("AIへの経路（callAIConsultation）", () => {
  beforeEach(() => mockInvoke.mockReset());
  const ok = { data: { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }, error: null };
  const PAYLOAD = { consultation: "q" } as unknown as AIConsultationPayload;

  it("添付が最後のuserメッセージに載り、systemに注意書きが付く／履歴は文字列のまま", async () => {
    mockInvoke.mockResolvedValue(ok);
    await callAIConsultation(PAYLOAD, "change", [{ role: "user", content: "前回\n\n📎 x（3字）", timestamp: "" }], undefined, undefined, undefined, [txt("a.docx", 3)]);
    const body = mockInvoke.mock.calls[0][1].body as { system: string; messages: { content: unknown }[] };
    expect(body.system).toContain(CONSULT_ATTACHMENT_NOTICE.trim());
    expect(body.messages[0].content).toBe("前回\n\n📎 x（3字）");
    expect(String(body.messages[1].content)).toContain("【添付資料：a.docx】\nあああ");
  });

  it("添付なしならsystemは従来どおり", async () => {
    mockInvoke.mockResolvedValue(ok);
    await callAIConsultation(PAYLOAD, "change", []);
    const body = mockInvoke.mock.calls[0][1].body as { system: string };
    expect(body.system).toBe(buildSystemPrompt("change", "normal"));
    expect(body.system).not.toContain("添付資料の扱い");
  });
});
