// src/stores/meetingImportDraftStore.ts
//
// 【設計意図・v3.184・M84】
// 資料インプット（会議読み込み）の確認画面の下書き（AI解析の結果＋人が編集した内容）を、
// パネルの外に置くモジュールレベルの in-memory ストア。確認画面に来た時点でAI課金は済んでおり、
// タブ切替（相談↔資料インプット）でパネルがアンマウントされても、戻ってきたら復元する。
//
// 制約（consultSessionStore.ts と同じ）：
// - localStorage に永続化しない（議事録の要約・PJ名・タスク名を含むため。Section 6-7）。
// - コンポーネントはこのストアを購読しない。seed は getState() で1回だけ読み、書き込みは effect／ハンドラから行う。
// - 別のユーザーでログインし直しても前のユーザーの下書きを見せない（userId が違えば破棄する）。
//   ログアウト・再読み込みでメモリごと消える経路は、未保存編集レジストリ（Section 46）の確認で守る。

import { create } from "zustand";
import type { MeetingAnalysis } from "../lib/ai/meetingExtractor";
import type { StatusDraft, TaskDraft } from "../lib/ai/meetingDrafts";

export interface MeetingReviewDraft {
  userId: string;
  analysis: MeetingAnalysis;
  taskDrafts: TaskDraft[];
  statusDrafts: StatusDraft[];
  newProjName: string;
  newProjColor: string;
  /** 前回の登録で作成済みの新規PJ。復元後の再登録で二重に作らない */
  createdProjectId: string | null;
}

interface MeetingImportDraftState {
  draft: MeetingReviewDraft | null;
  saveDraft: (draft: MeetingReviewDraft) => void;
  clearDraft: () => void;
}

export const useMeetingImportDraftStore = create<MeetingImportDraftState>((set) => ({
  draft: null,
  saveDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));

/** 復元してよい下書きを返す。別ユーザーのものは破棄して null */
export function takeRestorableMeetingDraft(userId: string): MeetingReviewDraft | null {
  const { draft, clearDraft } = useMeetingImportDraftStore.getState();
  if (!draft) return null;
  if (draft.userId !== userId) {
    clearDraft();
    return null;
  }
  return draft;
}

/** 確認画面に残す価値のある下書きか（取り込み済みの項目が1つも無ければ、保持も確認も要らない） */
export function hasReviewContent(taskDrafts: readonly unknown[], statusDrafts: readonly unknown[]): boolean {
  return taskDrafts.length > 0 || statusDrafts.length > 0;
}
