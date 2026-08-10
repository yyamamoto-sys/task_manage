// src/components/okr/OkrModeIntroModal.tsx
//
// 【設計意図】
// OKRモードへ初めて切り替えるときに出す「紹介ポップアップ＋データ読み込みの承認」
// （Human in the loop パターン③「承認して記憶」。CLAUDE.md Section 19・
// src/lib/okr/okrModeGate.ts 参照）。表示判定（shouldShowOkrModeIntro）と承認フラグの
// 読み書きは呼び出し側（MainLayout.tsx）が担い、このコンポーネントは開いている間だけ
// 描画される見た目専用（ChunkDownloadGate.tsxとは逆に、こちらはモーダルなので
// CLAUDE.md Section 21の契約（modalStyles.ts）に従う）。
//
// 紹介文は「実装済みの機能」だけを書く（未実装のAI見立て・Kintone取込等は書かない。
// docs/dev/okr-redesign-plan.md 参照）。

import { useT } from "../../hooks/useT";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";

interface Props {
  onApprove: () => void;
  onCancel: () => void;
}

export function OkrModeIntroModal({ onApprove, onCancel }: Props) {
  const t = useT();

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない（common/ConfirmModal.tsxと同じ流儀）
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      style={{ ...modalOverlayStyle(280), background: "rgba(0,0,0,0.4)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        style={{
          ...modalBoxStyle("min(440px, 100%)"),
          background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "18px 20px 4px", flexShrink: 0 }}>
          <div style={{ fontSize: "20px", marginBottom: "6px" }}>🎯</div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {t("common.okrModeGate.title")}
          </div>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "10px 20px 4px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
            {t("common.okrModeGate.featuresIntro")}
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
            <li>{t("common.okrModeGate.feature1")}</li>
            <li>{t("common.okrModeGate.feature2")}</li>
            <li>{t("common.okrModeGate.feature3")}</li>
            <li>{t("common.okrModeGate.feature4")}</li>
          </ul>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7, marginTop: "14px" }}>
            {t("common.okrModeGate.dataNotice")}
          </p>
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, padding: "12px 20px 16px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px", fontSize: "12px",
              background: "transparent", color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            {t("common.okrModeGate.decline")}
          </button>
          <button
            autoFocus
            onClick={onApprove}
            style={{
              padding: "8px 18px", fontSize: "12px", fontWeight: 600,
              background: "var(--color-brand)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            {t("common.okrModeGate.approve")}
          </button>
        </div>
      </div>
    </div>
  );
}
