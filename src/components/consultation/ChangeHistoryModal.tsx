// src/components/consultation/ChangeHistoryModal.tsx
//
// 【設計意図】
// Undo履歴（UndoSnapshot[]）をモーダル形式で一覧表示する。
// 各行に「この時点に戻す」ボタンがあり、クリックすると選択したsnapshotより
// 新しいもの（先頭側）も含めて全て取り消す（複数undo）。
// MAX_STACK(5)を超えた変更履歴からでも任意の時点に戻せる。

import type { UndoSnapshot } from "../../hooks/useUndoStack";

interface Props {
  stack: UndoSnapshot[];
  onClose: () => void;
  /** 指定したsnapshotId以前（含む）を全て取り消すコールバック */
  onUndoUntil: (snapshotId: string) => void;
}

/**
 * ISO8601文字列を「HH:mm」または「M/D HH:mm」のような読みやすい形式に変換する
 */
function formatAppliedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (isToday) {
    return `${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function ChangeHistoryModal({ stack, onClose, onUndoUntil }: Props) {
  if (stack.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 300,
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
          maxWidth: "400px",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "1px solid var(--color-border-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--color-text-primary)" }}>
            変更履歴
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "var(--color-text-tertiary)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* サブテキスト */}
        <div
          style={{
            padding: "10px 16px 6px",
            fontSize: "11px",
            color: "var(--color-text-tertiary)",
            flexShrink: 0,
          }}
        >
          「この時点に戻す」を押すと、それより新しい変更もまとめて取り消されます。
        </div>

        {/* リスト */}
        <div style={{ flex: 1, overflow: "auto", padding: "6px 16px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {stack.map((snapshot, index) => (
              <div
                key={snapshot.id}
                style={{
                  padding: "10px 12px",
                  background: index === 0 ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                  border: `1px solid ${index === 0 ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                {/* インデックスバッジ */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: index === 0 ? "var(--color-brand)" : "var(--color-bg-tertiary)",
                    color: index === 0 ? "#fff" : "var(--color-text-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontWeight: "600",
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </div>

                {/* 情報 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "500",
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {snapshot.label}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "var(--color-text-tertiary)",
                      marginTop: "2px",
                    }}
                  >
                    {formatAppliedAt(snapshot.appliedAt)}
                    {index === 0 && (
                      <span
                        style={{
                          marginLeft: "6px",
                          color: "var(--color-brand)",
                          fontWeight: "500",
                        }}
                      >
                        最新
                      </span>
                    )}
                  </div>
                </div>

                {/* 戻すボタン */}
                <button
                  onClick={() => {
                    onUndoUntil(snapshot.id);
                    onClose();
                  }}
                  style={{
                    fontSize: "11px",
                    padding: "4px 10px",
                    background: "transparent",
                    border: `1px solid ${index === 0 ? "var(--color-brand)" : "var(--color-border-secondary)"}`,
                    borderRadius: "var(--radius-md)",
                    color: index === 0 ? "var(--color-brand)" : "var(--color-text-secondary)",
                    cursor: "pointer",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  この時点に戻す
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
