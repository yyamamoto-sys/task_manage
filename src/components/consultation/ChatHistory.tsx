// src/components/consultation/ChatHistory.tsx
//
// 【設計意見】
// 会話履歴を表示するコンポーネント。
// - userターン：右寄せのテキストバブル
// - assistantターン：ProposalCardのリスト表示（JSONをパースして表示）

import { parseAIResponse } from "../../lib/ai/responseParser";
import { mapProposalsToUI } from "../../lib/ai/proposalMapper";
import type { ConsultationSession } from "../../lib/ai/sessionManager";
import { ProposalCard } from "./ProposalCard";

interface Props {
  session: ConsultationSession;
  shortIdMap: Map<string, string>;
  currentUserId: string;
  onProposalApplied?: () => void;
  onOpenTask?: (taskId: string) => void;
}

export function ChatHistory({
  session,
  shortIdMap,
  currentUserId,
  onProposalApplied,
  onOpenTask,
}: Props) {
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

        // assistantターン：JSONをパースしてProposalCardを表示
        let proposals = null;
        try {
          const parsed = parseAIResponse(turn.content);
          const uiProposals = mapProposalsToUI(parsed.proposals);
          proposals = uiProposals.length > 0 ? uiProposals : null;
        } catch {
          // パース失敗時はテキストとして表示
        }

        if (!proposals) {
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
              {turn.content}
            </div>
          );
        }

        return (
          <div key={`assistant-proposals-${turn.timestamp}`} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                fontSize: "10px",
                color: "var(--color-text-tertiary)",
                fontWeight: "500",
              }}
            >
              AI の提案
            </div>
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
