// src/lib/ai/invokeAI.ts
//
// 【設計意図】
// supabase.functions.invoke("ai-consult") の共通ラッパー。
// non-2xx時に data に格納されたEdge Function側の詳細エラーを取り出してスローする。

import { supabase } from "../supabase/client";

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

export async function invokeAI(
  system: string,
  messages: AIMessageInput[],
  maxTokens: number,
): Promise<AIRawResponse> {
  if (!messages || messages.length === 0) {
    throw new Error("送信するメッセージが空です。操作をやり直してください。");
  }
  if (messages[0].role !== "user") {
    throw new Error("メッセージはuserロールから始まる必要があります。");
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
