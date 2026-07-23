// src/components/admin/AdminFormModal.tsx
//
// 【設計意図】
// 設定画面（AdminView）の「＋追加」フォームをポップアップ表示するための共通シェル。
// マイルストーン追加モーダル（milestone/MilestoneAddModal.tsx）と同じ演出
// （背景animate-overlay＋本体panel-slide-up）を踏襲する。
// 中身（フィールド・保存/キャンセルボタン・DangerZone等）は呼び出し側が children として渡し、
// バリデーション・保存ロジックはここには一切持たない（あくまで「器」を差し替えるだけ）。

import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** モーダル本体の最大幅（CSS値）。省略時は460px（メンバー/タグ等の小さめフォーム向け） */
  maxWidth?: string;
}

export function AdminFormModal({ title, subtitle, onClose, children, maxWidth = "460px" }: Props) {
  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は✕ボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない（MilestoneAddModalと同じ作法）
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="panel-slide-up" style={{
        width: `min(${maxWidth}, 100%)`, maxHeight: "90vh",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* ヘッダー */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          background: "var(--color-brand)",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", marginTop: "2px" }}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            style={{
              background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "6px",
              fontSize: "16px", cursor: "pointer", color: "#fff",
              width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* 本体（呼び出し側のフィールド＋ボタン） */}
        <div style={{ padding: "16px 18px", overflow: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
