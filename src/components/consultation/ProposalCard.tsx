// src/components/consultation/ProposalCard.tsx
//
// 【設計意図】
// UIProposalを1枚表示するカードコンポーネント。
// - action_label + action_color でバッジ表示
// - date_certainty に応じた警告バッジ
// - is_simulation=true → シミュレーションバナー + 「反映する」非活性
// - canApply=true → 「反映する」ボタン活性
// - onClick で applyProposal を呼ぶ → needs_confirmation の場合は ConfirmationDialogModal を開く
// - 反映成功時は onApplied(snapshot) でUndoSnapshotを親に渡す
// - action_typeがdate_change/assigneeの場合のみ「ガントで比較」ボタンを表示

import { useState } from "react";
import type { UIProposal } from "../../lib/ai/proposalMapper";
import { applyProposal } from "../../lib/ai/applyProposal";
import type { ConfirmationDialog } from "../../lib/ai/applyProposal";
import type { UndoSnapshot } from "../../hooks/useUndoStack";
import { SimulationBanner } from "./SimulationBanner";
import { ConfirmationDialogModal } from "./ConfirmationDialogModal";

interface Props {
  proposal: UIProposal;
  shortIdMap: Map<string, string>;
  currentUserId: string;
  onApplied?: (snapshot: UndoSnapshot) => void;
  /** ガントで比較ボタンクリック時のコールバック */
  onGanttPreview?: (proposal: UIProposal) => void;
}

export function ProposalCard({
  proposal,
  shortIdMap,
  currentUserId,
  onApplied,
  onGanttPreview,
}: Props) {
  const [applying, setApplying] = useState(false);
  const [resultMessage, setResultMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmationDialog | null>(
    null,
  );

  const handleApply = async () => {
    setApplying(true);
    setResultMessage(null);

    const result = await applyProposal(proposal, shortIdMap, currentUserId);
    setApplying(false);

    if (result.type === "success") {
      setResultMessage({ type: "success", text: "反映しました" });
      onApplied?.(result.snapshot);
    } else if (result.type === "needs_confirmation") {
      setConfirmDialog(result.dialog);
    } else {
      setResultMessage({ type: "error", text: result.message });
    }
  };

  return (
    <>
      <div
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {/* シミュレーションバナー */}
        {proposal.is_simulation && <SimulationBanner />}

        {/* ヘッダー行 */}
        <div
          style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}
        >
          {/* action_typeバッジ */}
          <span
            style={{
              fontSize: "10px",
              padding: "2px 7px",
              borderRadius: "var(--radius-full)",
              background: "var(--color-bg-secondary)",
              color: proposal.action_color,
              border: `1px solid ${proposal.action_color}`,
              fontWeight: "500",
              flexShrink: 0,
              lineHeight: 1.6,
            }}
          >
            {proposal.action_label}
          </span>

          {/* date_certaintyバッジ */}
          {proposal.date_certainty === "approximate" && (
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-bg-warning)",
                color: "var(--color-text-warning)",
                flexShrink: 0,
                lineHeight: 1.6,
              }}
            >
              ⚠ 日数は要確認
            </span>
          )}
          {proposal.date_certainty === "unknown" && (
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-bg-tertiary)",
                color: "var(--color-text-tertiary)",
                flexShrink: 0,
                lineHeight: 1.6,
              }}
            >
              ❓ 日数未定
            </span>
          )}
        </div>

        {/* タイトル */}
        <div
          style={{
            fontSize: "12px",
            fontWeight: "600",
            color: "var(--color-text-primary)",
            lineHeight: 1.4,
          }}
        >
          {proposal.title}
        </div>

        {/* 説明 */}
        <div
          style={{
            fontSize: "11px",
            color: "var(--color-text-secondary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {proposal.description}
        </div>

        {/* 提案値（suggested_date / suggested_assignee） */}
        {(proposal.suggested_date || proposal.suggested_assignee) && (
          <div
            style={{
              fontSize: "11px",
              color: "var(--color-text-info)",
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            {proposal.suggested_date && (
              <span>期日：{proposal.suggested_date}</span>
            )}
            {proposal.suggested_assignee && (
              <span>担当：{proposal.suggested_assignee}</span>
            )}
          </div>
        )}

        {/* 結果メッセージ */}
        {resultMessage && (
          <div
            style={{
              fontSize: "11px",
              color:
                resultMessage.type === "success"
                  ? "var(--color-text-success)"
                  : "var(--color-text-danger)",
              padding: "4px 8px",
              background:
                resultMessage.type === "success"
                  ? "var(--color-bg-success)"
                  : "var(--color-bg-danger)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {resultMessage.text}
          </div>
        )}

        {/* ボタン行 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
          {/* ガントで比較ボタン（date_change / assignee のみ表示） */}
          {(proposal.action_type === "date_change" || proposal.action_type === "assignee") &&
            onGanttPreview && (
              <button
                onClick={() => onGanttPreview(proposal)}
                style={{
                  fontSize: "11px",
                  padding: "5px 10px",
                  background: "transparent",
                  border: "1px solid var(--color-border-secondary)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  transition: "opacity 0.15s",
                }}
              >
                ガントで比較
              </button>
            )}
          <button
            onClick={handleApply}
            disabled={!proposal.canApply || applying || resultMessage?.type === "success"}
            title={
              proposal.is_simulation
                ? "シミュレーション中は反映できません"
                : proposal.date_certainty === "unknown"
                  ? "日数未定のため反映できません"
                  : undefined
            }
            style={{
              fontSize: "11px",
              padding: "5px 12px",
              background:
                proposal.canApply && !applying && resultMessage?.type !== "success"
                  ? "var(--color-brand)"
                  : "var(--color-bg-tertiary)",
              border: "none",
              borderRadius: "var(--radius-md)",
              color:
                proposal.canApply && !applying && resultMessage?.type !== "success"
                  ? "#fff"
                  : "var(--color-text-tertiary)",
              cursor:
                proposal.canApply && !applying && resultMessage?.type !== "success"
                  ? "pointer"
                  : "not-allowed",
              transition: "opacity 0.15s",
            }}
          >
            {applying ? "反映中..." : resultMessage?.type === "success" ? "反映済み" : "反映する"}
          </button>
        </div>
      </div>

      {/* 確認ダイアログ */}
      {confirmDialog && (
        <ConfirmationDialogModal
          dialog={confirmDialog}
          currentUserId={currentUserId}
          onClose={() => setConfirmDialog(null)}
          onApplied={(result) => {
            setConfirmDialog(null);
            if (result.type === "success") {
              setResultMessage({ type: "success", text: "反映しました" });
              onApplied?.(result.snapshot);
            } else if (result.type === "error") {
              setResultMessage({ type: "error", text: result.message });
            }
          }}
        />
      )}
    </>
  );
}
