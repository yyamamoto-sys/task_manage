// src/lib/ai/invokeAI.ts
//
// 【設計意図】
// supabase.functions.invoke("ai-consult") の共通ラッパー。AI 呼び出しの唯一のゲート。
// non-2xx時に data に格納されたEdge Function側の詳細エラーを取り出してスローする。
//
// 【絶対遵守：AI境界ルール（CLAUDE.md Section 6）】
// このアプリでは Anthropic API へ送るペイロードに何を含めてよいか厳格に制限している。
//
// ┌─────────────────────────────────────────────────────────────┐
// │ 「AIIntent」: 呼び出しの目的・性質をタグ付けし、誤った経路で  │
// │ OKR データが送信されないようコードレベルで意図を表明させる。  │
// │                                                              │
// │ 通常運用：                                                    │
// │   "task-management" — payloadBuilder.ts 経由・PJ/Task のみ    │
// │                                                              │
// │ 例外（ユーザー承認済み・KR/TF/O を AI に渡す機能）：           │
// │   "kr-report"          — KR レポート生成                      │
// │   "kr-quarter-plan"    — クォーター計画立案                    │
// │   "kr-session-extract" — 議事録からセッション抽出              │
// │   "kr-why"             — なぜなぜ分析                          │
// │   "meeting-extract"    — 会議メモからタスク抽出                │
// │   "project-plan"       — AI による PJ 設計                     │
// │   "todo-decompose"     — ToDo 分解                            │
// │                                                              │
// │ 新しい AI 機能を追加するときは、AIIntent に新しいタグを追加し、│
// │ 当該 prompt builder にコメントで「KR/TF を渡してよい根拠」を   │
// │ 明示すること。タグなしの呼び出しはコンパイルエラーになる。     │
// └─────────────────────────────────────────────────────────────┘

import { supabase } from "../supabase/client";

export type AIIntent =
  | "task-management"      // payloadBuilder 経由・通常のタスク管理相談（PJ/Task のみ）
  | "kr-report"            // KRレポート生成（KR/TF をAIに渡す）
  | "kr-quarter-plan"      // クォーター計画（KR/TF/セッション履歴をAIに渡す）
  | "kr-session-extract"   // セッション議事録抽出
  | "kr-why"               // なぜなぜ分析
  | "meeting-extract"      // 会議文字起こしからタスク抽出
  | "project-plan"         // AIでPJ設計
  | "todo-decompose";      // ToDo 分解

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

  const text: string = (data as AIRawResponse)?.content?.[0]?.text ?? "";
  if (!text) throw new Error("AIからの応答が空でした。");

  return data as AIRawResponse;
}
