// src/components/common/DangerZone.tsx
//
// 【設計意図】
// 削除など取り消しのつかない操作を、通常の編集・保存ボタンから視覚的に隔離するための共通部品
// （GitHubのリポジトリ設定にある赤枠の別ブロック方式）。削除ロジック自体（softDelete・権限ゲート等）は
// 変更せず、呼び出し元が渡す onConfirm をそのまま呼ぶだけ。ここが担うのは見た目の隔離と、
// 任意で付けられる「対象名の再入力」ガードのみ。

import { useState, type ReactNode, type CSSProperties } from "react";
import { isNameConfirmed } from "../../lib/dangerZoneConfirm";

interface DangerZoneProps {
  children: ReactNode;
  style?: CSSProperties;
}

/** 赤枠の「⚠ 危険な操作」ブロック。中に DangerAction を1つ以上並べて使う。 */
export function DangerZone({ children, style }: DangerZoneProps) {
  return (
    <div style={{
      border: "1px solid var(--color-border-danger)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      ...style,
    }}>
      <div style={{
        padding: "7px 14px",
        background: "var(--color-bg-danger)",
        borderBottom: "1px solid var(--color-border-danger)",
        fontSize: "11px", fontWeight: 600, color: "var(--color-text-danger)",
      }}>
        ⚠ 危険な操作
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {children}
      </div>
    </div>
  );
}

interface DangerActionProps {
  label: string;
  description?: string;
  buttonLabel?: string;
  onConfirm: () => void | Promise<void>;
  /**
   * 指定すると、この文字列と完全一致する入力がない限り削除ボタンを無効化する
   * （不可逆・影響が大きい操作専用。既存の confirmDialog より一段強い確認として使う）
   */
  requireNameMatch?: string;
  disabled?: boolean;
}

/** DangerZone の中に置く個々の削除アクション。 */
export function DangerAction({
  label, description, buttonLabel = "削除する", onConfirm, requireNameMatch, disabled,
}: DangerActionProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const nameOk = requireNameMatch == null || isNameConfirmed(typed, requireNameMatch);
  const canClick = nameOk && !disabled && !busy;

  const handleClick = async () => {
    if (!canClick) return;
    setBusy(true);
    try {
      await onConfirm();
      setTyped("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>{label}</div>
      {description && (
        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{description}</div>
      )}
      {requireNameMatch != null && (
        <div>
          <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "3px" }}>
            続行するには「{requireNameMatch}」と入力してください
          </div>
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={requireNameMatch}
            style={{
              width: "100%", padding: "6px 9px", fontSize: "12px", boxSizing: "border-box",
              border: "1px solid var(--color-border-danger)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </div>
      )}
      <div>
        <button
          onClick={() => { void handleClick(); }}
          disabled={!canClick}
          style={{
            padding: "6px 14px", fontSize: "11px", fontWeight: 500,
            background: "var(--color-bg-danger)",
            color: "var(--color-text-danger)",
            border: "1px solid var(--color-border-danger)",
            borderRadius: "var(--radius-md)",
            cursor: canClick ? "pointer" : "not-allowed",
            opacity: canClick ? 1 : 0.5,
          }}
        >
          {busy ? "処理中…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}
