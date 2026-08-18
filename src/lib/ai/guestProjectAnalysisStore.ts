// src/lib/ai/guestProjectAnalysisStore.ts
//
// 【設計意図・v3.77】
// ゲスト（サンプル閲覧）の「このPJをAI分析」の保存先。project_analyses テーブルは
// client.ts の choke point（assertGuestBlocked）でゲストの insert/select が常にブロック
// されるため（CLAUDE.md Section 23）、AI呼び出し自体は成功しているのに結果を一度も
// 表示できないまま、全体のAI利用枠（10回/日）だけを消費してしまうバグがあった。
//
// 修正方針はv3.69の「ゲストの日常編集の開放」・v3.67の個人OKR AI解析結果保持と同じ：
// choke point（client.ts の Proxy）は一切緩めず、書き込み先をこのモジュール内メモリ
// （プロジェクトIDごとに最新2件・project_analyses と同じ MAX_HISTORY）に切り替える。
// localStorage/sessionStorageには書かない＝リロードで消える（他のゲスト編集内容と同じ扱い）。

import type { ProjectAnalysisRecord } from "../supabase/projectAnalysisStore";

const MAX_HISTORY = 2;

const store = new Map<string, ProjectAnalysisRecord[]>();

/** 指定PJのゲスト分析結果を新しい順に返す（無ければ空配列）。 */
export function getGuestProjectAnalyses(projectId: string): ProjectAnalysisRecord[] {
  return store.get(projectId) ?? [];
}

/** 新しい分析結果をこのブラウザのメモリに積み、そのPJの履歴を最新2件に整える。 */
export function addGuestProjectAnalysis(
  projectId: string,
  content: string,
  createdBy: string,
): ProjectAnalysisRecord {
  const record: ProjectAnalysisRecord = {
    id: `guest-analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    project_id: projectId,
    content,
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };
  const next = [record, ...(store.get(projectId) ?? [])].slice(0, MAX_HISTORY);
  store.set(projectId, next);
  return record;
}
