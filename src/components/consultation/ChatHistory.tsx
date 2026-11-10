// src/components/consultation/ChatHistory.tsx
//
// 【設計意見】
// 会話履歴を表示するコンポーネント。
// - userターン：右寄せのテキストバブル
// - assistantターン：JSONをパースし、reply（直接の回答）の吹き出し＋ProposalCardのリストを表示

import { parseAIResponse, type AIResponseData } from "../../lib/ai/responseParser";
import { AIReplyBubble } from "./AIReplyBubble";
import { mapProposalsToUI } from "../../lib/ai/proposalMapper";
import type { ConsultationSession } from "../../lib/ai/sessionManager";
import type { UndoSnapshot } from "../../hooks/useUndoStack";
import { ProposalCard } from "./ProposalCard";
import { useTypingEffect } from "../../hooks/useTypingEffect";
import { stripAliasIds } from "../../lib/ai/displayText";
import { useAliasNameResolver } from "../../hooks/useAliasNameResolver";

interface Props {
  session: ConsultationSession;
  shortIdMap: Map<string, string>;
  currentUserId: string;
  latestAssistantTimestamp?: string;
  /** 履歴内の提案を反映した際にUndoスタックへ積む・画面を再読み込みするコールバック */
  onProposalApplied?: (snapshot: UndoSnapshot) => void;
  onOpenTask?: (taskId: string) => void;
}

function AnimatedText({ text }: { text: string }) {
  const { displayed, done } = useTypingEffect(text, 12);
  return <span className={done ? "" : "typing-cursor"}>{displayed}</span>;
}

export function ChatHistory({
  session,
  shortIdMap,
  currentUserId,
  latestAssistantTimestamp,
  onProposalApplied,
  onOpenTask,
}: Props) {
  const resolveAlias = useAliasNameResolver(shortIdMap);
  if (session.turns.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "8px 0",
      }}
    >
      {session.turns.map((turn) => {
        if (turn.role === "user") {
          return (
            <div
              key={`user-${turn.timestamp}`}
              style={{
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "8px 12px",
                  background: "var(--color-brand-light)",
                  border: "1px solid var(--color-brand-border)",
                  borderRadius: "var(--radius-md) var(--radius-sm) var(--radius-md) var(--radius-md)",
                  fontSize: "12px",
                  color: "var(--color-text-primary)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {turn.content}
              </div>
            </div>
          );
        }

        // assistantターン：JSONをパースして reply の吹き出し＋ProposalCardを表示
        let parsed: AIResponseData | null = null;
        try {
          parsed = parseAIResponse(turn.content);
        } catch {
          // パース失敗時はテキストとして表示
        }

        if (!parsed) {
          const isLatest = turn.timestamp === latestAssistantTimestamp;
          return (
            <div
              key={`assistant-text-${turn.timestamp}`}
              style={{
                fontSize: "12px",
                color: "var(--color-text-secondary)",
                lineHeight: 1.6,
                padding: "8px 12px",
                background: "var(--color-bg-secondary)",
                borderRadius: "var(--radius-md)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {isLatest ? <AnimatedText text={stripAliasIds(turn.content, resolveAlias)} /> : stripAliasIds(turn.content, resolveAlias)}
            </div>
          );
        }

        const proposals = mapProposalsToUI(parsed.proposals);
        // 提案も reply も無い返答で生のJSONを見せないための代替文
        const replyText = parsed.reply ?? (proposals.length === 0 ? "（AIからの提案はありませんでした）" : undefined);

        return (
          <div key={`assistant-proposals-${turn.timestamp}`} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {replyText && <AIReplyBubble text={replyText} shortIdMap={shortIdMap} onOpenTask={onOpenTask} />}
            {proposals.length > 0 && (
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--color-text-tertiary)",
                  fontWeight: "500",
                }}
              >
                AI の提案
              </div>
            )}
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.proposal_id}
                proposal={proposal}
                shortIdMap={shortIdMap}
                currentUserId={currentUserId}
                onApplied={onProposalApplied}
                onOpenTask={onOpenTask}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
