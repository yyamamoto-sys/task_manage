// src/hooks/useAIConsultation.ts
//
// 【設計意図】
// AI相談機能のReact Hook。AIへの問い合わせの唯一の入口。
// このHook以外からAPIを直接呼ばないこと（CLAUDE.md Section 6-12参照）。
//
// CLAUDE.md Section 6-12のexportルール：
// return { callState, session, tokenStatus, loadingMessage, shortIdMap, submit, reset };
// useFollowUpはexportしない（誤用防止）。
//
// Undo機能（追加）：
// return { ..., undo, canUndo, undoStack }
// useUndoStack内部で使用し、undo/canUndo/undoStackをexportする。

import { useState, useCallback, useRef } from "react";
import { useAppData } from "../context/AppDataContext";
import type { ConsultationType } from "../lib/ai/types";
import { buildPayload } from "../lib/ai/payloadBuilder";
import { callAIConsultation } from "../lib/ai/apiClient";
import { AIError } from "../lib/ai/apiClient";
import { parseAIResponse } from "../lib/ai/responseParser";
import { mapProposalsToUI } from "../lib/ai/proposalMapper";
import type { UIProposal } from "../lib/ai/proposalMapper";
import {
  createSession,
  addTurn,
  truncateOldTurns,
  MAX_TURNS_WARNING,
} from "../lib/ai/sessionManager";
import type { ConsultationSession } from "../lib/ai/sessionManager";
import { useUndoStack } from "./useUndoStack";
import { applyUndo } from "../lib/ai/undoApply";
import { insertAiUsageLog } from "../lib/supabase/store";

// ===== 型定義 =====

export type CallState = "idle" | "loading" | "success" | "error";
export type TokenStatus = "ok" | "warning";

export interface SubmitOptions {
  consultation: string;
  consultationType: ConsultationType;
  targetDeadline?: string | null;
  /** trueの場合、OKR（Objective/KR/TF）情報もペイロードに含める */
  includeOKR?: boolean;
}

// ===== ローディングメッセージ =====

const LOADING_MESSAGES = [
  "AIが考えています...",
  "データを分析中...",
  "提案を生成しています...",
  "スケジュールを確認中...",
  "工数を計算しています...",
  "リスクを洗い出しています...",
];

function getRandomLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

// ===== Hook本体 =====

/**
 * AI相談機能のReact Hook。
 *
 * @param projectIds - 相談対象のプロジェクトIDリスト（空の場合は全プロジェクト）
 */
export function useAIConsultation(projectIds: string[], currentMemberId: string = "") {
  const { projects, tasks, members, todos, objective, keyResults, taskForces, reload } = useAppData();

  const [callState, setCallState] = useState<CallState>("idle");
  const [session, setSession] = useState<ConsultationSession>(createSession());
  // sessionRef: useCallback内でstale closureを避けるための参照
  // （sessionをuseCallbackの依存配列に含めると毎回新しい関数参照が生成されるため）
  const sessionRef = useRef<ConsultationSession>(session);
  const [loadingMessage, setLoadingMessage] = useState<string>(LOADING_MESSAGES[0]);
  const [shortIdMap, setShortIdMap] = useState<Map<string, string>>(new Map());
  const [proposals, setProposals] = useState<UIProposal[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);

  // Undo
  const { stack: undoStack, push: pushUndo, pop: popUndo, popUntil: popUndoUntil, canUndo } = useUndoStack();
  // currentUserIdをundo時に使えるように保持
  const [currentUserId, setCurrentUserId] = useState<string>("");

  const tokenStatus: TokenStatus =
    session.turns.length > MAX_TURNS_WARNING ? "warning" : "ok";

  // ===== submit: ユーザー入力を受け取りAPIを呼ぶ =====

  const submit = useCallback(
    async (opts: SubmitOptions) => {
      const { consultation, consultationType, targetDeadline, includeOKR } = opts;

      if (!consultation.trim()) return;

      setCallState("loading");
      setErrorMessage("");
      setLoadingMessage(getRandomLoadingMessage());

      // 対象プロジェクトを絞り込む
      const targetProjects =
        projectIds.length > 0
          ? projects.filter((p) => projectIds.includes(p.id))
          : projects;

      // ペイロード構築
      const { payload, shortIdMap: newShortIdMap } = buildPayload({
        projects: targetProjects,
        tasks,
        members,
        todos,
        consultationType,
        consultation,
        scope: projectIds.length > 0 ? "related_pj" : "all_pj",
        targetDeadline,
        includeOKR,
        currentObjective: objective,
        keyResults,
        taskForces,
      });

      setShortIdMap(newShortIdMap);

      // sessionRef.currentを使って最新のセッションを取得（stale closureを回避）
      const latestSession = sessionRef.current;
      const tokenStatusNow =
        latestSession.turns.length > MAX_TURNS_WARNING ? "warning" : "ok";

      // ユーザーターンをセッションに追加
      const userTurn = {
        role: "user" as const,
        content: consultation,
        timestamp: new Date().toISOString(),
      };
      let currentSession = addTurn(latestSession, userTurn);

      // トークン上限を超えていた場合は古いターンを削除してから送信
      const historyForApi =
        tokenStatusNow === "warning"
          ? truncateOldTurns(currentSession).turns.slice(0, -1) // 今回追加したユーザーターンは除く（payloadに含まれる）
          : currentSession.turns.slice(0, -1); // 最後のユーザーターンはpayloadに含めるので除外

      try {
        // APIコール
        const { text: rawResponse, usage } = await callAIConsultation(
          payload,
          consultationType,
          historyForApi,
        );

        // トークン使用量をDBに記録（失敗しても相談の処理は止めない）
        insertAiUsageLog({
          member_id: currentMemberId,
          consultation_type: consultationType,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        }).catch(() => {});

        // レスポンスをパース
        const parsed = parseAIResponse(rawResponse);
        const uiProposals = mapProposalsToUI(parsed.proposals);

        setProposals(uiProposals);
        setFollowUpSuggestions(parsed.follow_up_suggestions);

        // アシスタントターンを追加
        const assistantTurn = {
          role: "assistant" as const,
          content: rawResponse,
          timestamp: new Date().toISOString(),
        };
        currentSession = addTurn(currentSession, assistantTurn);
        sessionRef.current = currentSession;
        setSession(currentSession);
        setCallState("success");
      } catch (e) {
        const message =
          e instanceof AIError
            ? e.message
            : e instanceof Error
              ? e.message
              : "予期しないエラーが発生しました";
        // エラー時もuserTurnをセッションに保存する（次回送信時に履歴が欠落しないよう）
        sessionRef.current = currentSession;
        setSession(currentSession);
        setErrorMessage(message);
        setCallState("error");
      }
    },
    [projects, tasks, members, todos, projectIds],
  );

  // ===== reset: セッションをリセット =====

  const reset = useCallback(() => {
    const emptySession = createSession();
    sessionRef.current = emptySession;
    setSession(emptySession);
    setShortIdMap(new Map());
    setProposals([]);
    setFollowUpSuggestions([]);
    setCallState("idle");
    setErrorMessage("");
    // undoStackはリセットしない（パネルを閉じても履歴は維持する）
  }, []);

  // ===== pushUndoSnapshot: ProposalCardから呼ばれる =====
  // applyProposal / applyProposalWithConfirmation の成功時にsnapshotをスタックに積む

  // ===== undo: 最新のsnapshotを1件取り消す =====

  const undo = useCallback(async (userId: string) => {
    const snapshot = popUndo();
    if (!snapshot) return;
    await applyUndo(snapshot, userId);
    // DB復元後にAppDataContextのstateを最新に同期する（画面が古いデータのままにならないよう）
    await reload();
  }, [popUndo, reload]);

  // ===== undoUntil: 指定snapshotまでまとめて取り消す（変更履歴モーダルから呼ばれる） =====

  const undoUntil = useCallback(async (snapshotId: string, userId: string) => {
    const snapshots = popUndoUntil(snapshotId);
    for (const snapshot of snapshots) {
      await applyUndo(snapshot, userId);
    }
    // DB復元後にAppDataContextのstateを最新に同期する（複数undo後も画面に反映されるよう）
    await reload();
  }, [popUndoUntil, reload]);

  return {
    callState,
    session,
    tokenStatus,
    loadingMessage,
    shortIdMap,
    proposals,
    followUpSuggestions,
    errorMessage,
    submit,
    reset,
    // Undo関連
    undoStack,
    canUndo,
    pushUndoSnapshot: pushUndo,
    undo,
    undoUntil,
  };
}
