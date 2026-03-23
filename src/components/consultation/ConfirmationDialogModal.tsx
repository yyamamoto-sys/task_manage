// src/components/consultation/ConfirmationDialogModal.tsx
//
// 【設計意図】
// date_change / assignee 提案の確認ダイアログ。
// ユーザーが値を確認・調整してから applyProposalWithConfirmation を呼ぶ。
// CLAUDE.md Section 6-10参照。

import { useState } from "react";
import type { ConfirmationDialog } from "../../lib/ai/applyProposal";
import { applyProposalWithConfirmation } from "../../lib/ai/applyProposal";
import type { ApplyResult } from "../../lib/ai/applyProposal";
import { useAppData } from "../../context/AppDataContext";

interface Props {
  dialog: ConfirmationDialog;
  currentUserId: string;
  onClose: () => void;
  onApplied: (result: ApplyResult) => void;
}

export function ConfirmationDialogModal({
  dialog,
  currentUserId,
  onClose,
  onApplied,
}: Props) {
  const { members } = useAppData();
  const isDateChange = dialog.action_type === "date_change";
  const isDeleteAction =
    dialog.action_type === "scope_reduce" || dialog.action_type === "pause";

  // 確認値の初期値の設定：
  // - date_change: suggested_value はそのまま日付文字列として使う
  // - assignee: suggested_value は short_name のため、メンバーリストからUUIDを逆引きする
  //   一致するメンバーが見つからない場合は先頭の有効メンバーのUUIDを使う
  // - scope_reduce / pause: 確認のみでユーザー入力は不要
  const activeMembers = members.filter((m) => !m.is_deleted);
  const [confirmedValues, setConfirmedValues] = useState<Record<string, string>>(
    () => {
      if (isDateChange) {
        return Object.fromEntries(
          dialog.items.map((item) => [item.task_id, item.suggested_value]),
        );
      }
      if (isDeleteAction) {
        return {};
      }
      // assignee: short_nameからUUIDを逆引き
      return Object.fromEntries(
        dialog.items.map((item) => {
          const matched = activeMembers.find(
            (m) => m.short_name === item.suggested_value,
          );
          const uuid = matched?.id ?? activeMembers[0]?.id ?? "";
          return [item.task_id, uuid];
        }),
      );
    },
  );
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    setApplying(true);
    const result = await applyProposalWithConfirmation(
      dialog,
      confirmedValues,
      currentUserId,
    );
    setApplying(false);
    onApplied(result);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          width: "100%",
          maxWidth: "480px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--color-border-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontWeight: "600", fontSize: "13px" }}>
            {isDateChange
              ? "日程変更の確認"
              : isDeleteAction
                ? dialog.action_type === "pause"
                  ? "一時停止の確認"
                  : "スコープ縮小の確認"
                : "担当者変更の確認"}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "var(--color-text-tertiary)",
              lineHeight: 1,
            }}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* ボディ */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          <div
            style={{
              fontSize: "11px",
              color: "var(--color-text-tertiary)",
              marginBottom: "12px",
            }}
          >
            {isDeleteAction
              ? "以下の対象を論理削除します。元に戻すには変更履歴から復元が必要です。内容を確認してから「確定して反映」を押してください。"
              : "以下の内容で反映します。値を確認・修正してから「確定して反映」を押してください。"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {dialog.items.map((item) => (
              <div
                key={item.task_id}
                style={{
                  padding: "10px 12px",
                  background: "var(--color-bg-secondary)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${isDeleteAction ? "var(--color-border-warning)" : "var(--color-border-primary)"}`,
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: "500",
                    color: "var(--color-text-primary)",
                    marginBottom: "6px",
                  }}
                >
                  {item.task_name}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "11px",
                  }}
                >
                  <span style={{ color: "var(--color-text-tertiary)" }}>
                    現在：{item.current_value}
                  </span>
                  <span style={{ color: "var(--color-text-tertiary)" }}>→</span>

                  {/* scope_reduce / pause: 変更なし（確認のみ） */}
                  {isDeleteAction ? (
                    <span style={{ color: "var(--color-text-warning)", fontWeight: "500" }}>
                      {item.suggested_value}
                    </span>
                  ) : isDateChange ? (
                    /* 日程変更: date input */
                    <input
                      type="date"
                      value={confirmedValues[item.task_id] ?? ""}
                      onChange={(e) =>
                        setConfirmedValues((prev) => ({
                          ...prev,
                          [item.task_id]: e.target.value,
                        }))
                      }
                      style={{
                        fontSize: "11px",
                        padding: "3px 6px",
                        border: "1px solid var(--color-border-secondary)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)",
                      }}
                    />
                  ) : (
                    /* 担当変更: select（値はUUID） */
                    <select
                      value={confirmedValues[item.task_id] ?? ""}
                      onChange={(e) =>
                        setConfirmedValues((prev) => ({
                          ...prev,
                          [item.task_id]: e.target.value,
                        }))
                      }
                      style={{
                        fontSize: "11px",
                        padding: "3px 6px",
                        border: "1px solid var(--color-border-secondary)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {activeMembers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.short_name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* フッター */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border-primary)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
          }}
        >
          <button
            onClick={onClose}
            disabled={applying}
            style={{
              fontSize: "12px",
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            style={{
              fontSize: "12px",
              padding: "6px 14px",
              background: "var(--color-brand)",
              border: "none",
              borderRadius: "var(--radius-md)",
              color: "#fff",
              cursor: applying ? "not-allowed" : "pointer",
              opacity: applying ? 0.7 : 1,
            }}
          >
            {applying ? "反映中..." : "確定して反映"}
          </button>
        </div>
      </div>
    </div>
  );
}
