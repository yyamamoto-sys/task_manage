// src/components/auth/AccessDeniedScreen.tsx
//
// 【表示条件】認証済みだが members に自分の行がまだ登録されていないユーザーに表示する画面。
// RLSでmembers/projects/tasksが何も見えないだけで「初回セットアップ」ではないケース
// （is_system_bootstrapped()がtrue、または判定自体に失敗した安全側フォールバック）で
// App.tsx から表示される。ここには絶対に SetupWizard へ進ませない（M25対応）。
import { useEffect, useState } from "react";
import { getAuthEmail, signOut } from "../../lib/supabase/auth";
import { useT } from "../../hooks/useT";
import { LangToggle } from "../common/LangToggle";
import { acceptProjectInvite } from "../../lib/supabase/projectInviteStore";
import { clearPendingProjectInvite } from "../../lib/projectInvite/pendingInvite";
import { initialsFromDisplayName, shortNameFromDisplayName, DEFAULT_INVITE_AVATAR_COLOR } from "../../lib/projectInvite/memberDefaults";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  onLogout: () => void;
}

export function AccessDeniedScreen({ onLogout }: Props) {
  const t = useT();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    void getAuthEmail().then(setEmail);
  }, []);

  const handleLogout = async () => {
    await signOut();
    onLogout();
  };

  // 【設計意図・3-3】既にSupabase Authのセッションがある状態（この画面自体の表示条件）
  // なので、accept_project_invite() を直接呼べる（signUp・メール確認の問題が発生しない、
  // 最も素直な経路。3-2の自動受諾（App.tsx側）が届かなかった場合の手動フォールバックにも
  // なる：別ブラウザで確認した・localStorageが消えた・新しい招待を試したい等）。
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteShortName, setInviteShortName] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setInviteError("");
    if (!inviteCode.trim() || !inviteDisplayName.trim() || !inviteShortName.trim()) {
      setInviteError(t("auth.invite.error.missingFields"));
      return;
    }
    setInviteSubmitting(true);
    try {
      await acceptProjectInvite({
        code: inviteCode.trim(),
        email,
        displayName: inviteDisplayName.trim(),
        shortName: inviteShortName.trim(),
        initials: initialsFromDisplayName(inviteDisplayName),
        colorBg: DEFAULT_INVITE_AVATAR_COLOR.bg,
        colorText: DEFAULT_INVITE_AVATAR_COLOR.text,
      });
      // このメールアドレス宛の保留中の招待（別の招待コード）が残っていた場合、それは
      // 使われずに終わったので消しておく（次回App.tsx起動時に誤って自動受諾されないため）。
      clearPendingProjectInvite();
      // 迷ったらリロードを選ぶ方針（App.tsxのhandleLogoutと同じ判断）。新しいmembers行を
      // RLS越しに確実に反映させるため、ページ全体を再読み込みする。
      window.location.reload();
    } catch (err) {
      setInviteError(formatErrorForUser(t("auth.invite.error.submitFailed"), err));
      setInviteSubmitting(false);
    }
  };

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
      <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
        <LangToggle variant="icon" />
      </div>
      <div style={{
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "40px",
        width: "360px",
        boxShadow: "var(--shadow-md)",
        border: "1px solid var(--color-border-primary)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "8px" }}>
          {t("auth.accessDenied.title")}
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: "16px" }}>
          {t("auth.accessDenied.body1")}
        </p>
        {email && (
          <div style={{
            padding: "10px 12px",
            background: "var(--color-bg-secondary)",
            borderRadius: "var(--radius-md)",
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: "16px",
            wordBreak: "break-all",
          }}>
            {email}
          </div>
        )}
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: "24px" }}>
          {t("auth.accessDenied.body2")}
        </p>
        <button
          onClick={() => void handleLogout()}
          style={{
            width: "100%", padding: "11px",
            background: "var(--color-brand)", color: "#fff",
            border: "none", borderRadius: "var(--radius-md)",
            fontSize: "14px", fontWeight: 600, cursor: "pointer",
          }}
        >
          {t("auth.accessDenied.logoutButton")}
        </button>

        {/* 招待コードを入力する（3-3）：既にAuthセッションがあるためaccept_project_invite()を
            直接呼べる（signUp不要・メール確認の問題が発生しない経路）。 */}
        {!showInviteForm ? (
          <button
            type="button"
            onClick={() => setShowInviteForm(true)}
            style={{
              width: "100%", marginTop: "12px", padding: "6px",
              background: "transparent", border: "none",
              color: "var(--color-text-tertiary)", fontSize: "12px",
              cursor: "pointer", textDecoration: "underline",
            }}
          >
            {t("auth.accessDenied.inviteCta")}
          </button>
        ) : (
          <form onSubmit={e => void handleInviteSubmit(e)} style={{ marginTop: "16px", textAlign: "left" }}>
            <div style={{
              borderTop: "1px solid var(--color-border-primary)",
              paddingTop: "16px",
            }}>
              <h2 style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "4px" }}>
                {t("auth.accessDenied.invite.title")}
              </h2>
              {email && (
                <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
                  {t("auth.accessDenied.invite.subtitle", { email })}
                </p>
              )}

              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                  {t("auth.accessDenied.invite.form.code")}
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  required
                  autoFocus
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                    fontSize: "13px", boxSizing: "border-box", outline: "none",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                  {t("auth.accessDenied.invite.form.displayName")}
                </label>
                <input
                  type="text"
                  value={inviteDisplayName}
                  onChange={e => {
                    const v = e.target.value;
                    setInviteDisplayName(v);
                    if (!inviteShortName) setInviteShortName(shortNameFromDisplayName(v));
                  }}
                  required
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                    fontSize: "13px", boxSizing: "border-box", outline: "none",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                  {t("auth.accessDenied.invite.form.shortName")}
                </label>
                <input
                  type="text"
                  value={inviteShortName}
                  onChange={e => setInviteShortName(e.target.value)}
                  required
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                    fontSize: "13px", boxSizing: "border-box", outline: "none",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                  }}
                />
              </div>

              {inviteError && (
                <p style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "12px" }}>
                  {inviteError}
                </p>
              )}

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="submit"
                  disabled={inviteSubmitting || !email}
                  style={{
                    flex: 1, padding: "9px",
                    background: inviteSubmitting ? "var(--color-text-tertiary)" : "var(--color-brand)",
                    color: "#fff", border: "none", borderRadius: "var(--radius-md)",
                    fontSize: "13px", fontWeight: 600,
                    cursor: inviteSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {inviteSubmitting ? t("auth.accessDenied.invite.submitting") : t("auth.accessDenied.invite.submit")}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInviteForm(false); setInviteError(""); }}
                  disabled={inviteSubmitting}
                  style={{
                    padding: "9px 14px",
                    background: "transparent", border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)",
                    fontSize: "13px", cursor: inviteSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {t("auth.accessDenied.invite.cancel")}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
