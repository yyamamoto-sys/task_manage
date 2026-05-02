// src/lib/ai/krReportClient.ts
//
// 【設計意図】
// KRレポート生成専用のEdge Function呼び出し。
// 既存のai-consult Edge Functionを流用するが、OKR/KR/TFデータを含むシステムプロンプトを使用する
// （ユーザー確認済みポリシー変更：OKR/KR/TFをAIに渡すことが許可された）。

import { invokeAI, buildMessageContent, type FileAttachment } from "./invokeAI";
import type { KrReportContext, KrReportMode } from "./krReportPrompt";
import { KR_REPORT_SYSTEM_PROMPTS, REPORT_HTML_WRAPPER } from "./krReportPrompt";

export interface KrReportResult {
  html: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callKrReportAI(
  context: KrReportContext,
  mode: KrReportMode,
  attachment?: FileAttachment,
): Promise<KrReportResult> {
  const systemPrompt = KR_REPORT_SYSTEM_PROMPTS[mode];

  const userMessage = JSON.stringify(context, null, 2);
  const content = buildMessageContent(userMessage, attachment ?? null);

  const res = await invokeAI(systemPrompt, [{ role: "user", content }], 8192, "kr-report");
  const text = res.content[0].text;

  const modeLabel = context.mode === "checkin" ? "チェックイン分析" : "ウィンセッション分析";
  const title = `KRレポート｜${context.kr_title}｜${context.today}｜${modeLabel}`;
  const html = REPORT_HTML_WRAPPER(text, title);

  return {
    html,
    usage: res.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}
