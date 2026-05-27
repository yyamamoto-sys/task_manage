// src/stores/consultSessionStore.ts
//
// 【設計意図】
// AI相談（consult）のライブ状態を「モジュールレベルの in-memory ミラー」として保持するストア。
//
// 背景：consult の会話 session・提案 proposals・shortIdMap・followUp・入力中 inputText 等は
// useAIConsultation.ts / ConsultationPanel.tsx の React state にのみ存在し、画面遷移や
// ConsultationPanel の再マウントで失われていた。これを zustand のモジュールレベルストアに
// ミラー（write-through）しておき、再マウント時の useState 初期値に seed することで、
// 「会話・入力中テキストが消えない」を実現する。
//
// 設計上の重要な制約：
// - これは既存ロジック（submit/apply/undo 等）の「後ろに足すミラー」であって、状態遷移の本体ではない。
//   submit/addTurn/API呼び出し/undo 等の挙動は一切変えない。
// - localStorage 永続化はしない（モジュールレベルの in-memory で十分。再マウントは生き残る。
//   会話履歴には PJ・タスクデータが含まれるため、永続化しない設計を崩さない — CLAUDE.md Section 6-7）。
// - Map もそのまま保持できる（zustand は値をそのまま保持するだけ）。
// - コンポーネントはこのストアを **購読（selector で subscribe）しない**こと。
//   seed は getState() で初期値関数として1回だけ読む。mirror は effect 内で getState().saveAi。
//   購読すると余計な再レンダー・無限ループの原因になる。

import { create } from "zustand";
import { createSession } from "../lib/ai/sessionManager";
import type { ConsultationSession } from "../lib/ai/sessionManager";
import type { UIProposal } from "../lib/ai/proposalMapper";

export interface ConsultSessionState {
  /** AI相談の会話セッション（lib/ai/sessionManager） */
  session: ConsultationSession;
  /** payloadBuilder が生成する short id → UUID の対応表 */
  shortIdMap: Map<string, string>;
  /** 最新の提案カード一覧（lib/ai/proposalMapper） */
  proposals: UIProposal[];
  /** フォローアップ候補 */
  followUpSuggestions: string[];
  /** 入力中の下書きテキスト（ConsultationPanel の textarea） */
  inputDraft: string;
  /** 直近に送信した相談文（送信後も画面に表示するため） */
  lastSubmittedText: string;
  /** localStorage 保存用のセッションID（再マウントで維持するため） */
  sessionId: string;

  /** 上記の一部を更新（マージ）する。既存ロジックの後ろから write-through で呼ばれる */
  saveAi: (partial: Partial<Omit<ConsultSessionState, "saveAi" | "resetAi">>) => void;
  /** ミラーを初期状態に戻す（reset 時に呼ばれる） */
  resetAi: () => void;
}

/** ミラーの初期値。session は空セッション・Map は空・配列/文字列は空。 */
function initialAiState(): Omit<ConsultSessionState, "saveAi" | "resetAi"> {
  return {
    session: createSession(),
    shortIdMap: new Map<string, string>(),
    proposals: [],
    followUpSuggestions: [],
    inputDraft: "",
    lastSubmittedText: "",
    sessionId: "",
  };
}

export const useConsultSessionStore = create<ConsultSessionState>((set) => ({
  ...initialAiState(),
  saveAi: (partial) => set(partial),
  resetAi: () => set(initialAiState()),
}));
