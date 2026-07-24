// src/hooks/useAIConsultation.ts
//
// 【設計意図】
// AI相談機能のReact Hook。AIへの問い合わせの唯一の入口。
// このHook以外からAPIを直接呼ばないこと（CLAUDE.md Section 6-12参照）。
//
// CLAUDE.md Section 6-12のexportルール：
// return { callState, session, tokenStatus, shortIdMap, submit, reset };
// useFollowUpはexportしない（誤用防止）。
//
// Undo機能（追加）：
// return { ..., undo, canUndo, undoStack }
// useUndoStack内部で使用し、undo/canUndo/undoStackをexportする。

import { useState, useCallback, useRef, useEffect } from "react";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedMembers } from "../stores/appStore";
import { useConsultSessionStore } from "../stores/consultSessionStore";
import type { ConsultationType, ResponseVolume } from "../lib/ai/types";
import { buildPayload } from "../lib/ai/payloadBuilder";
import { AIError } from "../lib/ai/apiClient";
import { runAIConsultation } from "../lib/ai/consultationRunner";
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
  /** OKR（Objective/KR/TF）情報をペイロードに含めるか。未指定（既定）は true で常に含める */
  includeOKR?: boolean;
  /** 回答ボリューム設定（short=簡潔 / normal=普通・既定 / detailed=詳細） */
  responseVolume?: ResponseVolume;
}

const THINKING_MODEL = "claude-sonnet-4-6";

// ===== Hook本体 =====

/**
 * AI相談機能のReact Hook。
 *
 * @param projectIds - 相談対象のプロジェクトIDリスト（空の場合は全プロジェクト）
 */
export function useAIConsultation(projectIds: string[], currentMemberId: string = "") {
  const projects          = useAppStore(selectScopedProjects);
  const tasks             = useAppStore(selectScopedTasks);
  const members           = useAppStore(selectScopedMembers);
  const objective         = useAppStore(s => s.objective);
  const keyResults        = useAppStore(s => s.keyResults);
  const taskForces        = useAppStore(s => s.taskForces);
  const taskProjects      = useAppStore(s => s.taskProjects);
  const projectTaskForces = useAppStore(s => s.projectTaskForces);
  const reload            = useAppStore(s => s.reload);

  const [callState, setCallState] = useState<CallState>("idle");
  // 【seed】再マウントで会話が消えないよう、各 state の初期値をミラーストアの現在値で seed する。
  //   seed は getState() で初期値関数として1回だけ読む（ストアを購読しない）。
  const [session, setSession] = useState<ConsultationSession>(() => useConsultSessionStore.getState().session);
  // sessionRef: useCallback内でstale closureを避けるための参照
  // （sessionをuseCallbackの依存配列に含めると毎回新しい関数参照が生成されるため）
  const sessionRef = useRef<ConsultationSession>(session);
  const [shortIdMap, setShortIdMap] = useState<Map<string, string>>(() => useConsultSessionStore.getState().shortIdMap);
  const [proposals, setProposals] = useState<UIProposal[]>(() => useConsultSessionStore.getState().proposals);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>(() => useConsultSessionStore.getState().followUpSuggestions);

  // 【mirror】上記が変化したらミラーストアへ write-through する（再マウント時の seed 元になる）。
  //   getState().saveAi 経由でストアを更新するだけ（このフックはストアを購読しないので無限ループしない）。
  //   callState/errorMessage は transient なのでミラーしない（ローカルのまま）。
  useEffect(() => {
    useConsultSessionStore.getState().saveAi({ session, shortIdMap, proposals, followUpSuggestions });
  }, [session, shortIdMap, proposals, followUpSuggestions]);

  // Undo
  const { stack: undoStack, push: pushUndo, pop: popUndo, popUntil: popUndoUntil, canUndo } = useUndoStack();

  const tokenStatus: TokenStatus =
    session.turns.length > MAX_TURNS_WARNING ? "warning" : "ok";

  // ===== submit: ユーザー入力を受け取りAPIを呼ぶ =====

  const submit = useCallback(
    async (opts: SubmitOptions) => {
      const { consultation, consultationType, targetDeadline, responseVolume } = opts;
      // OKR情報のチェックボックスは廃止。明示指定が無ければ常にOKR情報を含める（既定 true）。
      const includeOKR = opts.includeOKR ?? true;

      if (!consultation.trim()) return;

      const model = THINKING_MODEL;

      setCallState("loading");
      setErrorMessage("");

      // 対象プロジェクトを絞り込む
      const targetProjects =
        projectIds.length > 0
          ? projects.filter((p) => projectIds.includes(p.id))
          : projects;

      // 相談実行者本人（「私／自分」の参照先）を members から解決する
      const me = members.find((m) => m.id === currentMemberId);

      // ペイロード構築
      const { payload, shortIdMap: newShortIdMap } = buildPayload({
        projects: targetProjects,
        tasks,
        members,
        taskProjects,
        projectTaskForces,
        consultationType,
        consultation,
        scope: projectIds.length > 0 ? "related_pj" : "all_pj",
        targetDeadline,
        includeOKR,
        currentObjective: objective,
        keyResults,
        taskForces,
        currentMember: me ? { id: me.id, short_name: me.short_name } : null,
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
        // APIコール＋パース（パース失敗時は1回だけ自己修正リトライ。consultationRunner.ts参照）
        const result = await runAIConsultation(
          payload,
          consultationType,
          historyForApi,
          model,
          responseVolume,
        );

        // トークン使用量をDBに記録（失敗しても相談の処理は止めない・コンソールには記録）
        // リトライが発生した場合は実際に消費した2回分をそれぞれ記録する
        insertAiUsageLog({
          member_id: currentMemberId,
          consultation_type: consultationType,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        }).catch((err: unknown) => {
          console.warn("AI使用量ログの記録に失敗（相談は継続）:", err);
        });
        if (result.retryUsage) {
          insertAiUsageLog({
            member_id: currentMemberId,
            consultation_type: consultationType,
            input_tokens: result.retryUsage.input_tokens,
            output_tokens: result.retryUsage.output_tokens,
          }).catch((err: unknown) => {
            console.warn("AI使用量ログ（リトライ分）の記録に失敗（相談は継続）:", err);
          });
        }

        const uiProposals = mapProposalsToUI(result.proposals);

        setProposals(uiProposals);
        setFollowUpSuggestions(result.follow_up_suggestions);

        // アシスタントターンを追加（リトライ成功時は最終的な正しいJSONを履歴に残す）
        const assistantTurn = {
          role: "assistant" as const,
          content: result.rawResponse,
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
    [projects, tasks, members, projectIds, currentMemberId,
      objective, keyResults, taskForces, taskProjects, projectTaskForces],
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
    // ミラーストアも初期状態に戻す（session/shortIdMap/proposals/followUp/inputDraft/lastSubmitted を空に）
    useConsultSessionStore.getState().resetAi();
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
