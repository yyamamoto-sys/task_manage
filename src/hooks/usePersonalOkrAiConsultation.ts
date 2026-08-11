// src/hooks/usePersonalOkrAiConsultation.ts
//
// 【設計意図】
// 個人OKR用AIパネル（PersonalOkrAiPanel）の対話状態を管理するReact Hook。
// useAIConsultation.ts（計画モードのAI相談）とは別に新設する——proposals・undo・
// Gantt/会議読み込みプレビュー等、タスク管理提案に特化した機構を持たないため
// （このパネルは相談・助言止まりで、DB操作の提案は行わない。CLAUDE.md Section 24 Step H）。
//
// 会話履歴の管理はsessionManager.ts（既存・タスク管理AI相談と共有）をそのまま再利用する
// （新しい会話管理の仕組みを発明しない）。ただしassistantのcontentはJSON文字列ではなく
// 通常の回答文（プレーンテキスト）である点が既存用途と異なる。
//
// 【会話履歴はDBに保存しない】CLAUDE.md Section 6-7の既存方針のとおり、Reactの
// state（このHook内のみ）に保持し、パネルを閉じたら消える。localStorageにも書かない
// （計画モードのConsultationPanelは復元用にlocalStorageへ書くが、OKRパネルは
// 個人の評価に関わる文脈を含むため、より保守的に「閉じたら消える」を徹底する）。

import { useState, useCallback } from "react";
import { sendPersonalOkrChatMessage } from "../lib/ai/personalOkrChatClient";
import { createSession, addTurn, truncateOldTurns, MAX_TURNS_WARNING, type ConsultationSession } from "../lib/ai/sessionManager";
import { formatErrorForUser } from "../lib/errorMessage";

export type OkrChatCallState = "idle" | "loading" | "success" | "error";

export function usePersonalOkrAiConsultation() {
  const [session, setSession] = useState<ConsultationSession>(() => createSession());
  const [callState, setCallState] = useState<OkrChatCallState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const submit = useCallback(async (text: string, systemPrompt: string) => {
    if (!text.trim() || callState === "loading") return;
    setCallState("loading");
    setErrorMessage("");

    const userTurn = { role: "user" as const, content: text, timestamp: new Date().toISOString() };
    const withUser = addTurn(session, userTurn);
    setSession(withUser);

    try {
      const messages = withUser.turns.map(t => ({ role: t.role, content: t.content }));
      const answer = await sendPersonalOkrChatMessage(systemPrompt, messages);
      const assistantTurn = { role: "assistant" as const, content: answer, timestamp: new Date().toISOString() };
      setSession(addTurn(withUser, assistantTurn));
      setCallState("success");
    } catch (e) {
      setErrorMessage(formatErrorForUser("AIへの相談に失敗しました", e));
      setCallState("error");
    }
  }, [session, callState]);

  const reset = useCallback(() => {
    setSession(createSession());
    setCallState("idle");
    setErrorMessage("");
  }, []);

  return {
    session,
    callState,
    errorMessage,
    tokenWarning: session.tokenWarning,
    submit,
    reset,
    truncate: () => setSession(truncateOldTurns(session)),
    MAX_TURNS_WARNING,
  };
}
