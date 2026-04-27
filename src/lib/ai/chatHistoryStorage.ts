// src/lib/ai/chatHistoryStorage.ts
//
// 【設計意図】
// AI相談セッション履歴をlocalStorageに保存・取得するユーティリティ。
// CLAUDE.md Section 6-7「会話履歴はDBに保存しない」に準拠し、
// ブラウザのlocalStorageにのみ保存する（サーバーへは送信しない）。
// キーをユーザーID別にすることで、他ユーザーの履歴は参照できない設計。

export interface SavedChatSession {
  id: string;
  savedAt: string;           // ISO8601
  title: string;             // 最初のユーザーメッセージ（60文字まで）
  consultationType: string;  // ConsultationType
  turns: {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }[];
}

const MAX_HISTORY = 10;
const KEY_PREFIX = "consultation_history_v1_";

export function loadChatHistory(userId: string): SavedChatSession[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return [];
    return JSON.parse(raw) as SavedChatSession[];
  } catch { return []; }
}

export function saveChatSession(userId: string, session: SavedChatSession): void {
  try {
    const history = loadChatHistory(userId);
    const idx = history.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      history[idx] = session;
    } else {
      history.unshift(session);
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    }
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(history));
  } catch { /* quota超過などは無視 */ }
}

export function deleteChatSession(userId: string, sessionId: string): void {
  try {
    const history = loadChatHistory(userId).filter(s => s.id !== sessionId);
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(history));
  } catch { /* ignore */ }
}
