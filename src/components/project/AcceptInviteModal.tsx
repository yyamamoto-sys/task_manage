// src/components/project/AcceptInviteModal.tsx
//
// 【設計意図】
// ログイン済みの既存メンバーが「招待コードを手入力して参加する」ための入口（Phase 4・
// 山本さんの指摘対応）。既存の AccessDeniedScreen.tsx の招待フォーム（3-3・未登録ユーザー用）
// と役割は似ているが、こちらは「既にmembersに登録済みの人」向けであるため、
// 表示名・略称の入力欄は出さない（サーバー側＝accept_project_invite()の既存メンバー分岐が
// 現在の表示名・色を上書きしないため、入力させても無意味。src/lib/projectInvite/
// loggedInInviteFlow.ts の buildAcceptPayloadForExistingMember() が currentUser の
// 現在値をそのまま渡す）。
//
// 【呼び出し元】
// - サイドバー（MainLayout.tsx）の「🎫 招待コードを入力」ボタン（手入力の入口）。
//   部署管理者かどうかに関わらず全メンバーが開ける必要があるため、AdminView（管理者限定）の
//   タブには置いていない（判断理由はCLAUDE.md Section 25参照）。
//
// 成功したら window.location.reload()（迷ったらリロードを選ぶ方針。App.tsx/
// AccessDeniedScreen.tsx と同じ判断＝新しく追加されたgroup_idsをRLS越しに確実に反映する）。

import { useState } from "react";
import type { Member } from "../../lib/localData/types";
import { getAuthEmail } from "../../lib/supabase/auth";
import { acceptProjectInvite } from "../../lib/supabase/projectInviteStore";
import { buildAcceptPayloadForExistingMember } from "../../lib/projectInvite/loggedInInviteFlow";
import { formatErrorForUser } from "../../lib/errorMessage";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";
import { useT } from "../../hooks/useT";

interface Props {
  currentUser: Member;
  onClose: () => void;
}

export function AcceptInviteModal({ currentUser, onClose }: Props) {
  const t = useT();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t("auth.invite.member.error.missingCode"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const authEmail = await getAuthEmail();
      if (!authEmail) {
        throw new Error(t("auth.invite.member.error.noAuthEmail"));
      }
      await acceptProjectInvite(buildAcceptPayloadForExistingMember(trimmed, authEmail, currentUser));
      // 迷ったらリロードを選ぶ方針（App.tsx/AccessDeniedScreen.tsxと同じ判断）。
      // 新しく追加されたgroup_idsをRLS越しに確実に反映させるため。
      window.location.reload();
    } catch (err) {
      setError(formatErrorForUser(t("auth.invite.member.error.submitFailed"), err));
      setSubmitting(false);
    }
  };

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体はキャンセルボタンで
    // キーボードから可能なため、背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div style={{
        ...modalBoxStyle("min(400px, 100%)"),
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        border: "1px solid var(--color-border-primary)",
      }}>
        <div style={{
          padding: "16px 18px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "18px" }}>🎫</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
              {t("auth.invite.member.title")}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              {t("auth.invite.member.subtitle")}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label={t("common.button.close")}
            style={{
              background: "transparent", border: "none", borderRadius: "6px",
              fontSize: "16px", cursor: submitting ? "not-allowed" : "pointer",
              color: "var(--color-text-tertiary)",
              width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>
        </div>

        <form onSubmit={e => void handleSubmit(e)}>
          <div style={{ ...MODAL_BODY_STYLE, padding: "16px 18px" }}>
            <label style={{
              display: "block", fontSize: "11px", fontWeight: 600,
              color: "var(--color-text-secondary)", marginBottom: "6px",
            }}>
              {t("auth.invite.member.form.code")}
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              autoFocus
              placeholder={t("auth.invite.member.form.codePlaceholder")}
              style={{
                width: "100%", padding: "9px 10px",
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                fontSize: "13px", boxSizing: "border-box", outline: "none",
                background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
              }}
            />
            {error && (
              <p style={{ fontSize: "12px", color: "var(--color-text-danger)", marginTop: "10px" }}>
                {error}
              </p>
            )}
          </div>
          <div style={{
            ...MODAL_FOOTER_STYLE,
            padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)",
            display: "flex", gap: "8px", justifyContent: "flex-end",
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: "8px 14px",
                background: "transparent", border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)",
                fontSize: "13px", cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {t("common.button.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "8px 16px",
                background: submitting ? "var(--color-text-tertiary)" : "var(--color-brand)",
                color: "#fff", border: "none", borderRadius: "var(--radius-md)",
                fontSize: "13px", fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? t("auth.invite.member.submitting") : t("auth.invite.member.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
