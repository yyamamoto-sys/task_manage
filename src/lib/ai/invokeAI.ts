// src/lib/ai/invokeAI.ts
//
// 【設計意図】
// supabase.functions.invoke("ai-consult") の共通ラッパー。AI 呼び出しの唯一のゲート。
// non-2xx時はEdge Function側が返した詳細エラー（{error,message,detail,status}）を
// 取り出してスローする。本文の読み取り・組み立てロジックは edgeFunctionError.ts に
// 集約している（data が null になる非2xx時にresponseの本文を読む必要があるため。詳細は
// そのファイル冒頭コメント参照。CLAUDE.md Section 15）。
//
// 【AI連携（CLAUDE.md Section 6）】
// 全ての AI 呼び出しはこの invokeAI() を経由する（直叩き禁止／APIキーは Edge Function 側のみ）。
//
// 【AI境界ルール（2026-05-13 改定）】
//   OKR関連情報（O/KR/TF/ToDo）も AI に渡してよい（社内確認済み）。かつての「OKRは一切渡さない」制約は撤廃。
//
// ┌─────────────────────────────────────────────────────────────┐
// │ 「AIIntent」: 呼び出しの目的・どんなデータを渡しているかのラベル。│
// │  そのまま ai_usage_logs.consultation_type に保存され、AI使用量  │
// │  タブで機能別集計に使われる。漏洩防止というより記録・可読性のため。│
// │   "task-management"  — payloadBuilder 経由・通常のタスク管理相談  │
// │   "kr-report"        — KR レポート生成                          │
// │   "kr-quarter-plan"  — クォーター計画立案                        │
// │   "kr-session-extract" — 議事録からセッション抽出                │
// │   "kr-why"           — なぜなぜ分析                              │
// │   "okr-analysis"     — KR単位のAI分析（ノート＋セッション＋タスク）│
// │   "meeting-extract"  — 会議メモからタスク抽出                    │
// │   "project-plan"     — AI による PJ 設計                        │
// │   "project-analysis" — 単一PJの健全性分析                       │
// │   "all-projects-analysis" — 全PJ横断ポートフォリオ分析          │
// │   "todo-decompose"   — ToDo 分解                                │
// │   "okr-import"       — Kintone OKR(PDF/テキスト)からO/KR/TF抽出 │
// │   "okr-personal-import" — Kintone個人OKR(PDF/テキスト)から個人KR/月次計画抽出 │
// │   "okr-personal-outlook" — 個人OKR「これから」の見立て・バンドのAI判定 │
// │   "okr-personal-chat"   — 個人OKR用AIパネルの対話（相談） │
// │   "okr-personal-review-draft" — 個人OKR月末の振り返り下書き生成（明示ボタン） │
// │  新機能を追加するときは AIIntent に新タグを追加し、prompt builder │
// │  に「何のデータを渡しているか」をコメントで明示する。タグ無しは   │
// │  コンパイルエラー。                                              │
// └─────────────────────────────────────────────────────────────┘

import { supabase } from "../supabase/client";
import { logAIUsage } from "./usageLog";
import { isGuestMode } from "../guestMode";
import { ensureGuestAiSession } from "../supabase/guestAiAuth";
import { recordGuestAiUse } from "../guestAiQuotaCounter";
import { useLangStore } from "../../stores/langStore";
import { translate } from "../i18n";
import { buildInvokeErrorMessage } from "./edgeFunctionError";

// invokeAI/callAIConsultationはReactコンポーネント外の素の関数のためuseT()が使えない。
// ErrorBoundary.tsx / FileAttachButton.tsxと同じ流儀でuseLangStore.getState()+translate()を直接呼ぶ。
function tOutside(key: string): string {
  return translate(useLangStore.getState().lang, key);
}

export type AIIntent =
  | "task-management"      // payloadBuilder 経由・通常のタスク管理相談（PJ/Task のみ）
  | "kr-report"            // KRレポート生成（KR/TF をAIに渡す）
  | "kr-quarter-plan"      // クォーター計画（KR/TF/セッション履歴をAIに渡す）
  | "kr-session-extract"   // セッション議事録抽出
  | "kr-why"               // なぜなぜ分析
  | "okr-analysis"         // KR単位のAI分析（会議ノート＋KRセッション・宣言＋TFタスクをAIに渡す）
  | "meeting-extract"      // 会議文字起こしからタスク抽出
  | "project-plan"         // AIでPJ設計
  | "project-analysis"          // 単一PJの健全性分析（PJ/Task/Milestone/メンバー名。PJ視点なのでOKRデータは未投入）
  | "all-projects-analysis"     // 全PJ横断ポートフォリオ分析（全PJの概要＋タスク統計を渡す）
  | "todo-decompose"            // ToDo 分解
  | "okr-import"                // Kintone OKR(PDF/テキスト)からObjective/KR/TF構造を抽出
  | "okr-personal-import"       // Kintone個人OKR(PDF/テキスト)から個人KR/月次計画/振り返りを抽出
  | "okr-personal-outlook"      // 個人OKR「これから」の見立て・週ごとの一手・バンドのAI判定（自動トリガー・キャッシュあり）
  | "okr-personal-chat"         // 個人OKR用AIパネルの対話形式の相談（明示操作・ターンごとに発生）
  | "okr-personal-review-draft"; // 個人OKR月末の振り返り下書き生成（明示ボタン・月に1回程度）

export interface AIRawResponse {
  content: { type: "text"; text: string }[];
  usage?: { input_tokens: number; output_tokens: number };
  /**
   * Anthropicの終了理由（"end_turn"|"max_tokens"等）。Edge Functionは成功時のレスポンス本文を
   * そのまま素通ししているため、data には元から含まれている（apiClient.ts の
   * AnthropicResponse.stop_reason と同じフィールド）。出力切れの検知に使う
   * （CLAUDE.md Section 6-1b・personalOkrImportExtractor.ts参照）。
   */
  stop_reason?: string;
}

// マルチモーダルコンテンツブロック（PDF・画像・テキストファイル添付用）
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type AIMessageInput = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export interface FileAttachment {
  fileName: string;
  mediaType: string;
  data: string;
  isText: boolean;
}

export function buildMessageContent(
  text: string,
  attachment: FileAttachment | null,
): string | ContentBlock[] {
  if (!attachment) return text;
  if (attachment.isText) {
    return `${text}\n\n【添付ファイル: ${attachment.fileName}】\n${attachment.data}`;
  }
  const blocks: ContentBlock[] = [{ type: "text", text }];
  if (attachment.mediaType.startsWith("image/")) {
    blocks.push({ type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.data } });
  } else {
    blocks.push({ type: "document", source: { type: "base64", media_type: attachment.mediaType, data: attachment.data } });
  }
  return blocks;
}

export function getContentText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map(b => b.text)
    .join("");
}

/**
 * AI を呼び出す唯一のゲート。intent パラメータで呼び出し元が
 * AI 境界ルールを意識していることを表明する（CLAUDE.md Section 6）。
 *
 * model は省略可（未指定はEdge Function側の既定=DEFAULT_MODEL="claude-sonnet-4-6"）。
 * Edge Function の ALLOWED_MODELS に含まれるモデルIDのみ有効（それ以外は無視されて既定に
 * フォールバックする）。546 WORKER_RESOURCE_LIMIT対策等で個別機能だけ軽いモデルに切り替える
 * ための引数（personalOkrImportExtractor.ts参照。CLAUDE.md Section 6-1c）。
 */
export async function invokeAI(
  system: string,
  messages: AIMessageInput[],
  maxTokens: number,
  intent: AIIntent,
  model?: string,
): Promise<AIRawResponse> {
  // ゲスト（サンプル閲覧）は初めてAIを使うときだけ匿名セッションを遅延生成する（Phase 3・
  // CLAUDE.md Section 23）。回数制限・実際のゲスト判定はEdge Function側（JWTの
  // is_anonymousクレーム）で行う。ここでの失敗（匿名サインイン自体が使えない等）だけ
  // 分かりやすいエラーに変換する。
  if (isGuestMode()) {
    try {
      await ensureGuestAiSession();
    } catch {
      throw new Error(tOutside("common.guest.aiBlocked"));
    }
  }
  if (!messages || messages.length === 0) {
    throw new Error("送信するメッセージが空です。操作をやり直してください。");
  }
  if (messages[0].role !== "user") {
    throw new Error("メッセージはuserロールから始まる必要があります。");
  }
  if (!intent) {
    // TS で intent: AIIntent 必須にしているが防御的に runtime でも検査
    throw new Error("invokeAI には AIIntent を指定する必要があります（AI境界ルール）。");
  }
  // intent はゲスト分の利用ログ記録にEdge Function側で使う（Section 23）。
  // 認証済みユーザーは既存どおりクライアント側でlogAIUsage()が記録するため未使用。
  const { data, error, response: httpResponse } = await supabase.functions.invoke("ai-consult", {
    body: { system, messages, max_tokens: maxTokens, intent, ...(model ? { model } : {}) },
  });

  if (error) {
    // 非2xx時、supabase-jsは data を null にし、Edge Functionが返した本文は response
    // （Response）にしか入らない。data だけを見ると原因を全て捨てることになる
    // （edgeFunctionError.ts 冒頭コメント参照）。
    throw new Error(await buildInvokeErrorMessage(data, error, httpResponse));
  }

  const response = data as AIRawResponse;
  const text: string = response?.content?.[0]?.text ?? "";
  if (!text) throw new Error("AIからの応答が空でした。");

  // 全 AI 呼び出しの使用量を ai_usage_logs に記録（fire-and-forget）
  // intent をそのまま consultation_type 列に保存することで、AdminView の
  // 「AI使用量」タブで全機能の使用量が反映される（CLAUDE.md Section 6-1b 参照）
  logAIUsage(intent, response.usage);

  // ゲスト（サンプル閲覧）の回数表示（参考値）を、成功時だけ加算する（v3.31・
  // CLAUDE.md Section 23）。ここに到達するのは非2xxエラーを通過した後なので、
  // 429（GUEST_DAILY_LIMIT_EXCEEDED等）や他のエラー時は加算されない。
  if (isGuestMode()) recordGuestAiUse();

  return response;
}
