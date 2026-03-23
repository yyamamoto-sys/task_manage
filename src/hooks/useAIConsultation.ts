// src/hooks/useAIConsultation.ts
//
// 【設計意図】
// AI相談機能のReact Hook。AIへの問い合わせの唯一の入口。
// このHook以外からAPIを直接呼ばないこと（CLAUDE.md Section 6-12参照）。
//
// CLAUDE.md Section 6-12のexportルール：
// return { callState, session, tokenStatus, loadingMessage, shortIdMap, submit, reset };
// useFollowUpはexportしない（誤用防止）。

import { useState, useCallback } from "react";
import { useAppData } from "../context/AppDataContext";
import type { ConsultationType } from "../lib/localData/types";
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

// ===== 型定義 =====

export type CallState = "idle" | "loading" | "success" | "error";
export type TokenStatus = "ok" | "warning";

export interface SubmitOptions {
  consultation: string;
  consultationType: ConsultationType;
  targetDeadline?: string | null;
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
export function useAIConsultation(projectIds: string[]) {
  const { projects, tasks, members } = useAppData();

  const [callState, setCallState] = useState<CallState>("idle");
  const [session, setSession] = useState<ConsultationSession>(createSession());
  const [loadingMessage, setLoadingMessage] = useState<string>(LOADING_MESSAGES[0]);
  const [shortIdMap, setShortIdMap] = useState<Map<string, string>>(new Map());
  const [proposals, setProposals] = useState<UIProposal[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);

  const tokenStatus: TokenStatus =
    session.turns.length > MAX_TURNS_WARNING ? "warning" : "ok";

  // ===== submit: ユーザー入力を受け取りAPIを呼ぶ =====

  const submit = useCallback(
    async (opts: SubmitOptions) => {
      const { consultation, consultationType, targetDeadline } = opts;

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
        consultationType,
        consultation,
        scope: projectIds.length > 0 ? "related_pj" : "all_pj",
        targetDeadline,
      });

      setShortIdMap(newShortIdMap);

      // ユーザーターンをセッションに追加
      const userTurn = {
        role: "user" as const,
        content: consultation,
        timestamp: new Date().toISOString(),
      };
      let currentSession = addTurn(session, userTurn);

      // トークン上限を超えていた場合は古いターンを削除してから送信
      const historyForApi =
        tokenStatus === "warning"
          ? truncateOldTurns(currentSession).turns.slice(0, -1) // 今回追加したユーザーターンは除く（payloadに含まれる）
          : currentSession.turns.slice(0, -1); // 最後のユーザーターンはpayloadに含めるので除外

      try {
        // APIコール
        const rawResponse = await callAIConsultation(
          payload,
          consultationType,
          historyForApi,
        );

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
        setSession(currentSession);
        setCallState("success");
      } catch (e) {
        const message =
          e instanceof AIError
            ? e.message
            : e instanceof Error
              ? e.message
              : "予期しないエラーが発生しました";
        setErrorMessage(message);
        setCallState("error");
      }
    },
    [session, projects, tasks, members, projectIds, tokenStatus],
  );

  // ===== reset: セッションをリセット =====

  const reset = useCallback(() => {
    setSession(createSession());
    setShortIdMap(new Map());
    setProposals([]);
    setFollowUpSuggestions([]);
    setCallState("idle");
    setErrorMessage("");
  }, []);

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
  };
}
