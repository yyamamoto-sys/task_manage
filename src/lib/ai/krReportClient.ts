// src/lib/ai/krReportClient.ts
//
// 【設計意図】
// KRレポート生成専用のEdge Function呼び出し。
// 既存のai-consult Edge Functionを流用するが、OKR/KR/TFデータを含むシステムプロンプトを使用する
// （ユーザー確認済みポリシー変更：OKR/KR/TFをAIに渡すことが許可された）。

import { supabase } from "../supabase/client";
import type { KrReportContext, KrReportMode } from "./krReportPrompt";
import { KR_REPORT_SYSTEM_PROMPTS, REPORT_HTML_WRAPPER } from "./krReportPrompt";

export interface KrReportResult {
  html: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callKrReportAI(
  context: KrReportContext,
  mode: KrReportMode,
): Promise<KrReportResult> {
  const systemPrompt = KR_REPORT_SYSTEM_PROMPTS[mode];

  const userMessage = JSON.stringify(context, null, 2);

  const { data, error } = await supabase.functions.invoke("ai-consult", {
    body: {
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 8192,
    },
  });

  if (error) {
    throw new Error(`AIレポート生成エラー: ${error.message}`);
  }

  const text: string = data?.content?.[0]?.text ?? "";
  if (!text) {
    throw new Error("AIからの応答が空でした。");
  }

  const modeLabel = context.mode === "checkin" ? "チェックイン分析" : "ウィンセッション分析";
  const title = `KRレポート｜${context.kr_title}｜${context.today}｜${modeLabel}`;
  const html = REPORT_HTML_WRAPPER(text, title);

  return {
    html,
    usage: data?.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}
