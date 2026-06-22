// src/lib/ai/invokeAI.ts
//
// 【設計意図】
// supabase.functions.invoke("ai-consult") の共通ラッパー。AI 呼び出しの唯一のゲート。
// non-2xx時に data に格納されたEdge Function側の詳細エラーを取り出してスローする。
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
// │   "todo-decompose"   — ToDo 分解                                │
// │  新機能を追加するときは AIIntent に新タグを追加し、prompt builder │
// │  に「何のデータを渡しているか」をコメントで明示する。タグ無しは   │
// │  コンパイルエラー。                                              │
// └─────────────────────────────────────────────────────────────┘

import { supabase } from "../supabase/client";
import { logAIUsage } from "./usageLog";

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
  | "todo-decompose";           // ToDo 分解

export interface AIRawResponse {
  content: { type: "text"; text: string }[];
  usage?: { input_tokens: number; output_tokens: number };
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

type EdgeErrorBody = {
  error?: string;
  status?: number;
  detail?: string;
};

function extractEdgeError(data: unknown, fallback: string): string {
  const d = data as EdgeErrorBody | null;
  if (!d) return fallback;
  if (d.error === "ANTHROPIC_ERROR") {
    let msg = d.detail ?? "";
    try { msg = JSON.parse(d.detail ?? "")?.error?.message ?? d.detail ?? ""; } catch { /* ignore */ }
    const statusStr = d.status ? ` (${d.status})` : "";
    return `Anthropic APIエラー${statusStr}: ${msg}`;
  }
  if (d.error === "API key not configured") return "Edge FunctionにAPIキーが設定されていません。Supabaseの環境変数を確認してください。";
  if (d.error === "Unauthorized") return "認証エラー：ログインし直してください。";
  if (d.error) return d.error;
  return fallback;
}

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
 */
export async function invokeAI(
  system: string,
  messages: AIMessageInput[],
  maxTokens: number,
  intent: AIIntent,
): Promise<AIRawResponse> {
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
  const { data, error } = await supabase.functions.invoke("ai-consult", {
    body: { system, messages, max_tokens: maxTokens },
  });

  if (error) {
    throw new Error(extractEdgeError(data, error.message));
  }

  const response = data as AIRawResponse;
  const text: string = response?.content?.[0]?.text ?? "";
  if (!text) throw new Error("AIからの応答が空でした。");

  // 全 AI 呼び出しの使用量を ai_usage_logs に記録（fire-and-forget）
  // intent をそのまま consultation_type 列に保存することで、AdminView の
  // 「AI使用量」タブで全機能の使用量が反映される（CLAUDE.md Section 6-1b 参照）
  logAIUsage(intent, response.usage);

  return response;
}
