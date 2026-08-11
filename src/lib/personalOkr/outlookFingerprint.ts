// src/lib/personalOkr/outlookFingerprint.ts
//
// 【設計意図】
// Phase 3後半のAI解析（personal_kr_outlooks）が「前回と入力が一致していたら再解析しない」
// 判定に使うフィンガープリントの計算（docs/dev/okr-redesign-plan.md §5-2）。
// 今回（Phase 3前半）はAI呼び出しを実装しないため、この関数はまだどこからも呼ばれない
// （呼び出し元＝AI解析トリガーはPhase 3後半で追加する）。ここでは純粋関数として先に
// 用意し、安定性（同じ入力→同じ値・要素の順序に依存しない）をテストで固定する。
//
// 含める要素（§5-2）：対象KRに紐づくタスクのupdated_atの最大値／週の目標状態とself_rating／
// 月次計画のimported_at（無ければupdated_at）／メモの最終updated_at／現在の週番号。
//
// 【ハッシュ関数を外部ライブラリで足さない理由】
// 暗号強度は不要（改ざん検知目的ではなく「前回と同じ入力か」の軽量な一致判定のため）。
// 安定した文字列化（要素をソートしてから連結）＋FNV-1a（32bit・JS実装数行）で十分。

import type { WeekSelfRating } from "../localData/types";

export interface OutlookFingerprintWeekInput {
  weekIndex: number;
  goalState: string | null;
  selfRating: WeekSelfRating;
}

export interface OutlookFingerprintInput {
  /** 対象KRに紐づくタスクのupdated_atの最大値（紐づくタスクが無ければnull） */
  maxLinkedTaskUpdatedAt: string | null;
  /** 週の目標状態とself_rating（順序不問。呼び出し側は週配列をそのまま渡してよい） */
  weeks: OutlookFingerprintWeekInput[];
  /** 月次計画のimported_at（無ければupdated_at）。どちらも無ければnull */
  monthPlanTimestamp: string | null;
  /** メモの最終updated_at（メモが無ければnull） */
  lastMemoUpdatedAt: string | null;
  /** 現在の週番号（1〜6） */
  currentWeekNumber: number;
}

/**
 * FNV-1a（32bit）。非暗号用途の軽量ハッシュ。文字列→8桁16進文字列。
 * 標準ライブラリ・外部パッケージ不要で、同一入力に対して常に同一の出力を返す。
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 入力フィンガープリントを計算する。
 * 🔴 週の配列は weekIndex 昇順にソートしてから文字列化するため、呼び出し側の並び順に
 * 依存しない（同じ週集合なら順序を変えても同じ値になる）。
 */
export function computeOutlookInputFingerprint(input: OutlookFingerprintInput): string {
  const weeksCanonical = [...input.weeks]
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map(w => `${w.weekIndex}:${w.goalState ?? ""}:${w.selfRating ?? ""}`)
    .join("|");

  const canonical = [
    `task=${input.maxLinkedTaskUpdatedAt ?? ""}`,
    `weeks=${weeksCanonical}`,
    `month=${input.monthPlanTimestamp ?? ""}`,
    `memo=${input.lastMemoUpdatedAt ?? ""}`,
    `week_no=${input.currentWeekNumber}`,
  ].join("||");

  return fnv1a32(canonical);
}

/** 月次計画のタイムスタンプ解決（imported_atが無ければupdated_at。どちらも無ければnull） */
export function resolveMonthPlanTimestamp(
  importedAt: string | null | undefined,
  updatedAt: string | null | undefined,
): string | null {
  return importedAt ?? updatedAt ?? null;
}
