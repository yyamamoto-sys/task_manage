// src/lib/ai/sessionManager.ts
//
// 【設計意図】
// AI相談の会話セッションを管理する型と関数。
// セッションはDBに保存しない（React stateのみ）。
// パネルを閉じたら消える設計を崩さないこと（CLAUDE.md Section 6-7参照）。
// 履歴にはPJ・タスクデータが含まれるため、セキュリティ上DBへの保存は禁止。

// ===== 型定義 =====

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;   // assistantはJSON文字列
  timestamp: string; // ISO8601
}

export interface ConsultationSession {
  turns: ChatTurn[];
  tokenWarning: boolean; // 10ターン超過でtrue
}

// ===== 定数 =====

/** この数を超えるとtokenWarning=trueになる */
export const MAX_TURNS_WARNING = 10;

/** truncate時に残すターン数（直近のやりとりを保持） */
export const MAX_TURNS_KEEP = 5;

// ===== 関数 =====

/**
 * 空のセッションを作成する。
 */
export function createSession(): ConsultationSession {
  return {
    turns: [],
    tokenWarning: false,
  };
}

/**
 * ターンをセッションに追加する。
 * 10ターンを超えた場合はtokenWarning=trueにする。
 */
export function addTurn(
  session: ConsultationSession,
  turn: ChatTurn,
): ConsultationSession {
  const newTurns = [...session.turns, turn];
  return {
    turns: newTurns,
    tokenWarning: newTurns.length > MAX_TURNS_WARNING,
  };
}

/**
 * 古いターンを削除して直近MAX_TURNS_KEEP件のみ残す。
 * tokenWarningが立った後にユーザーが続行した場合に呼ぶ。
 */
export function truncateOldTurns(
  session: ConsultationSession,
): ConsultationSession {
  const trimmed = session.turns.slice(-MAX_TURNS_KEEP);
  return {
    turns: trimmed,
    tokenWarning: false,
  };
}
