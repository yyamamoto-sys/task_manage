// src/components/auth/LoginScreen.tsx
import { useState, Suspense } from "react";
import { signIn, signUp } from "../../lib/supabase/auth";
import { useT } from "../../hooks/useT";
import { LangToggle } from "../common/LangToggle";
import { VersionBadge } from "../common/VersionBadge";
import { GUEST_AI_DAILY_LIMIT } from "../../lib/guestAiQuotaCounter";
import { extractInviteCodeFromSearch } from "../../lib/projectInvite/inviteUrl";
import { savePendingProjectInvite } from "../../lib/projectInvite/pendingInvite";
import { initialsFromDisplayName, shortNameFromDisplayName, DEFAULT_INVITE_AVATAR_COLOR } from "../../lib/projectInvite/memberDefaults";
import { formatErrorForUser } from "../../lib/errorMessage";
import { lazyWithRetry } from "../../lib/lazyWithRetry";

// バージョン履歴（v3.61）：ログイン前でも確認できるようにする。ログイン画面を開くだけの
// 利用者にダウンロードさせないようlazy化する（CLAUDE.md Section 19）。
const VersionHistoryModal = lazyWithRetry(() => import("../common/VersionHistoryModal").then(m => ({ default: m.VersionHistoryModal })), "VersionHistoryModal");

interface Props {
  onLogin: () => void;
  /** 「サンプルを見る」を押したときに呼ぶ。Supabase Authのサインインは行わない。 */
  onGuest: () => Promise<void>;
}

type Mode = "login" | "signup" | "signup_done" | "invite" | "invite_awaiting";

export function LoginScreen({ onLogin, onGuest }: Props) {
  const t = useT();
  // 招待リンク（?invite=<code>）から開かれた場合は、招待コード欄を事前入力した状態で
  // 直接「招待コードをお持ちの方」モードに入る（設計書§7・3-2）。
  const [initialInviteCode] = useState(() => extractInviteCodeFromSearch(window.location.search));
  const [mode, setMode] = useState<Mode>(() => (initialInviteCode ? "invite" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const versionHistoryModal = isVersionHistoryOpen ? (
    <Suspense fallback={null}>
      <VersionHistoryModal onClose={() => setIsVersionHistoryOpen(false)} />
    </Suspense>
  ) : null;

  // ----- プロジェクト招待（部署外メンバーの受け入れ・2026-08-10） -----
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordConfirm, setInvitePasswordConfirm] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteShortName, setInviteShortName] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSentToEmail, setInviteSentToEmail] = useState("");

  const enterInviteMode = () => {
    setMode("invite");
    setInviteError("");
  };

  const backToLoginFromInvite = () => {
    setMode("login");
    setInviteError("");
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");

    if (!inviteCode.trim() || !inviteEmail.trim() || !inviteDisplayName.trim() || !inviteShortName.trim()) {
      setInviteError(t("auth.invite.error.missingFields"));
      return;
    }
    if (invitePassword !== invitePasswordConfirm) {
      setInviteError(t("auth.error.passwordMismatch"));
      return;
    }
    if (invitePassword.length < 6) {
      setInviteError(t("auth.error.passwordTooShort"));
      return;
    }

    setInviteLoading(true);
    try {
      const normalizedEmail = inviteEmail.trim().toLowerCase();
      const { needsConfirmation, alreadyRegistered } = await signUp(normalizedEmail, invitePassword);
      if (alreadyRegistered) {
        setInviteError(t("auth.invite.error.alreadyRegistered"));
        return;
      }

      // 🔴 needsConfirmation の値に関わらず必ず保存する（理由は
      // src/lib/projectInvite/pendingInvite.ts 冒頭コメント参照。needsConfirmation=falseの
      // 場合はApp.tsx側のonAuthStateChangeがこのsignUp成功と同時にauthenticated=trueを
      // 検知し、この先の処理を待たずに本コンポーネントがunmountされるレースが起こり得る
      // ため、accept_project_invite()の呼び出し自体はここでは行わず、常にApp.tsxの
      // AuthenticatedApp側の単一の受け口に委ねる）。
      savePendingProjectInvite({
        code: inviteCode.trim(),
        email: normalizedEmail,
        displayName: inviteDisplayName.trim(),
        shortName: inviteShortName.trim(),
        initials: initialsFromDisplayName(inviteDisplayName),
        colorBg: DEFAULT_INVITE_AVATAR_COLOR.bg,
        colorText: DEFAULT_INVITE_AVATAR_COLOR.text,
        savedAt: new Date().toISOString(),
      });

      if (needsConfirmation) {
        setInviteSentToEmail(normalizedEmail);
        setMode("invite_awaiting");
      }
      // needsConfirmation=false の場合はここで何もしない。App.tsx側が続きを処理する。
    } catch (err) {
      setInviteError(formatErrorForUser(t("auth.invite.error.submitFailed"), err));
    } finally {
      setInviteLoading(false);
    }
  };

  const handleGuestClick = async () => {
    setGuestLoading(true);
    try {
      await onGuest();
    } finally {
      // 成功時はApp.tsx側でこの画面自体が消えるため、finallyでのリセットは失敗時のみ意味を持つ
      setGuestLoading(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
    setPasswordConfirm("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "signup" && password !== passwordConfirm) {
      setError(t("auth.error.passwordMismatch"));
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError(t("auth.error.passwordTooShort"));
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
        onLogin();
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setMode("signup_done");
        } else {
          onLogin();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (mode === "login") {
        setError(t("auth.error.loginFailed"));
      } else if (msg.includes("already registered") || msg.includes("User already registered")) {
        setError(t("auth.error.emailAlreadyRegistered"));
      } else {
        setError(t("auth.error.signupFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--color-bg-primary)",
    borderRadius: "var(--radius-lg)",
    padding: "40px",
    width: "360px",
    boxShadow: "var(--shadow-md)",
    border: "1px solid var(--color-border-primary)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-md)",
    fontSize: "14px",
    boxSizing: "border-box",
    outline: "none",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    marginBottom: "6px",
  };

  // ===== 登録完了（メール確認待ち）=====
  if (mode === "signup_done") {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
        <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
          <LangToggle variant="icon" />
        </div>
        {/* バージョン表示（控えめ・ログイン前でも分かるように） */}
        <div style={{ position: "fixed", bottom: "12px", right: "16px", zIndex: 10 }}>
          <VersionBadge onClick={() => setIsVersionHistoryOpen(true)} />
        </div>
        {versionHistoryModal}
        <div style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📧</div>
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "8px" }}>
              {t("auth.signup.done.title")}
            </h1>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              {t("auth.signup.done.sentTo", { email })}<br />
              {t("auth.signup.done.instruction")}
            </p>
          </div>
          <div style={{
            padding: "12px 14px",
            background: "var(--color-bg-secondary)",
            borderRadius: "var(--radius-md)",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
            lineHeight: 1.7,
            marginBottom: "20px",
          }}>
            {t("auth.signup.done.afterConfirm")}<br />
            {t("auth.signup.done.noEmail")}
          </div>
          <button
            onClick={() => switchMode("login")}
            style={{
              width: "100%", padding: "11px",
              background: "var(--color-brand)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)",
              fontSize: "14px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("auth.signup.done.backToLogin")}
          </button>
        </div>
      </div>
    );
  }

  // ===== プロジェクト招待：登録完了（メール確認待ち）=====
  // 🔴 招待の有効期限（24時間）に注意を促す（メール確認が遅れると招待コードが失効する）。
  if (mode === "invite_awaiting") {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
        <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
          <LangToggle variant="icon" />
        </div>
        <div style={{ position: "fixed", bottom: "12px", right: "16px", zIndex: 10 }}>
          <VersionBadge onClick={() => setIsVersionHistoryOpen(true)} />
        </div>
        {versionHistoryModal}
        <div style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📧</div>
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "8px" }}>
              {t("auth.signup.done.title")}
            </h1>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              {t("auth.signup.done.sentTo", { email: inviteSentToEmail })}<br />
              {t("auth.signup.done.instruction")}
            </p>
          </div>
          <div style={{
            padding: "12px 14px",
            background: "var(--color-bg-warning)",
            border: "1px solid var(--color-border-warning)",
            borderRadius: "var(--radius-md)",
            fontSize: "12px",
            color: "var(--color-text-warning)",
            lineHeight: 1.7,
            marginBottom: "20px",
          }}>
            ⚠ {t("auth.invite.awaiting.deadlineWarning")}
          </div>
          <div style={{
            padding: "12px 14px",
            background: "var(--color-bg-secondary)",
            borderRadius: "var(--radius-md)",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
            lineHeight: 1.7,
            marginBottom: "20px",
          }}>
            {t("auth.signup.done.afterConfirm")}<br />
            {t("auth.signup.done.noEmail")}
          </div>
          <button
            onClick={backToLoginFromInvite}
            style={{
              width: "100%", padding: "11px",
              background: "var(--color-brand)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)",
              fontSize: "14px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("auth.signup.done.backToLogin")}
          </button>
        </div>
      </div>
    );
  }

  // ===== プロジェクト招待：登録フォーム =====
  if (mode === "invite") {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
        <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
          <LangToggle variant="icon" />
        </div>
        <div style={{ position: "fixed", bottom: "12px", right: "16px", zIndex: 10 }}>
          <VersionBadge onClick={() => setIsVersionHistoryOpen(true)} />
        </div>
        {versionHistoryModal}
        <div style={{ ...cardStyle, width: "380px" }}>
          <h1 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "4px" }}>
            {t("auth.invite.title")}
          </h1>
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.6, marginBottom: "18px" }}>
            {t("auth.invite.subtitle")}
          </p>

          <form onSubmit={e => void handleInviteSubmit(e)}>
            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>{t("auth.invite.form.code")}</label>
              <input
                type="text"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                required
                autoFocus={!initialInviteCode}
                style={inputStyle}
              />
              <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                {t("auth.invite.form.codeHint")}
              </p>
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>{t("auth.form.email")}</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                required
                placeholder={t("auth.form.emailPlaceholder")}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>{t("auth.form.password")}<span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}>{t("auth.form.passwordHint")}</span></label>
              <input
                type="password"
                value={invitePassword}
                onChange={e => setInvitePassword(e.target.value)}
                required
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>{t("auth.form.passwordConfirm")}</label>
              <input
                type="password"
                value={invitePasswordConfirm}
                onChange={e => setInvitePasswordConfirm(e.target.value)}
                required
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>{t("auth.invite.form.displayName")}</label>
              <input
                type="text"
                value={inviteDisplayName}
                onChange={e => {
                  const v = e.target.value;
                  setInviteDisplayName(v);
                  // 略称が未入力のときだけ、表示名から既定値を自動生成する（SetupWizardと同様のUX）。
                  if (!inviteShortName) setInviteShortName(shortNameFromDisplayName(v));
                }}
                required
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: "18px" }}>
              <label style={labelStyle}>{t("auth.invite.form.shortName")}</label>
              <input
                type="text"
                value={inviteShortName}
                onChange={e => setInviteShortName(e.target.value)}
                required
                style={inputStyle}
              />
            </div>

            {inviteError && (
              <p style={{ fontSize: "13px", color: "var(--color-text-danger)", marginBottom: "16px" }}>
                {inviteError}
              </p>
            )}

            <button
              type="submit"
              disabled={inviteLoading}
              style={{
                width: "100%", padding: "11px",
                background: inviteLoading ? "var(--color-text-tertiary)" : "var(--color-brand)",
                color: "#fff", border: "none", borderRadius: "var(--radius-md)",
                fontSize: "14px", fontWeight: 600,
                cursor: inviteLoading ? "not-allowed" : "pointer",
              }}
            >
              {inviteLoading ? t("auth.invite.submitting") : t("auth.invite.submit")}
            </button>
          </form>

          <button
            type="button"
            onClick={backToLoginFromInvite}
            style={{
              width: "100%", marginTop: "12px", padding: "6px",
              background: "transparent", border: "none",
              color: "var(--color-text-tertiary)", fontSize: "12px", cursor: "pointer",
            }}
          >
            {t("auth.invite.backToLogin")}
          </button>
        </div>
      </div>
    );
  }

  // ===== ログイン / 新規登録フォーム =====
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
      <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
        <LangToggle variant="icon" />
      </div>
      {/* バージョン表示（控えめ・ログイン前でも分かるように） */}
      <div style={{ position: "fixed", bottom: "12px", right: "16px", zIndex: 10 }}>
        <VersionBadge onClick={() => setIsVersionHistoryOpen(true)} />
      </div>
      {versionHistoryModal}
      <div style={cardStyle}>
        {/* ロゴ＆タイトル */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <div style={{
            width: "28px", height: "28px", borderRadius: "var(--radius-md)",
            background: "var(--color-brand)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="2" width="3" height="10" rx="1" stroke="white" strokeWidth="1.2"/>
              <rect x="5.5" y="2" width="3" height="7" rx="1" stroke="white" strokeWidth="1.2"/>
              <rect x="10" y="2" width="3" height="4" rx="1" stroke="white" strokeWidth="1.2"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {t("common.app.name")}
          </h1>
        </div>

        {/* タブ */}
        <div style={{ display: "flex", gap: "0", marginBottom: "24px", marginTop: "20px", borderBottom: "1px solid var(--color-border-primary)" }}>
          {(["login", "signup"] as const).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                flex: 1, padding: "8px 0", fontSize: "13px", fontWeight: 600,
                background: "none", border: "none", cursor: "pointer",
                color: mode === m ? "var(--color-brand)" : "var(--color-text-tertiary)",
                borderBottom: mode === m ? "2px solid var(--color-brand)" : "2px solid transparent",
                marginBottom: "-1px", transition: "color 0.1s",
              }}
            >
              {m === "login" ? t("auth.tab.login") : t("auth.tab.signup")}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* メールアドレス */}
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>{t("auth.form.email")}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder={t("auth.form.emailPlaceholder")}
              style={inputStyle}
            />
          </div>

          {/* パスワード */}
          <div style={{ marginBottom: mode === "signup" ? "16px" : "24px" }}>
            <label style={labelStyle}>{t("auth.form.password")}{mode === "signup" && <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}>{t("auth.form.passwordHint")}</span>}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {/* パスワード確認（新規登録のみ） */}
          {mode === "signup" && (
            <div style={{ marginBottom: "24px" }}>
              <label style={labelStyle}>{t("auth.form.passwordConfirm")}</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={e => setPasswordConfirm(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
          )}

          {error && (
            <p style={{ fontSize: "13px", color: "var(--color-text-danger)", marginBottom: "16px" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "11px",
              background: loading ? "var(--color-text-tertiary)" : "var(--color-brand)",
              color: "#fff", border: "none", borderRadius: "var(--radius-md)",
              fontSize: "14px", fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading
              ? (mode === "login" ? t("auth.submit.loggingIn") : t("auth.submit.signingUp"))
              : (mode === "login" ? t("auth.submit.login") : t("auth.submit.signup"))}
          </button>
        </form>

        {/* パスワードリセット（ログイン時のみ） */}
        {mode === "login" && (
          <p style={{ marginTop: "16px", textAlign: "center", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {t("auth.note.forgotPassword")}
          </p>
        )}

        {/* プロジェクトの招待コードをお持ちの方（部署外メンバーの受け入れ・2026-08-10）
            設計書§7・山本さんの当初案1(a)：既存のログインフォームとゲストの「サンプルを
            見る」ボタンの間に置く。 */}
        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <button
            type="button"
            onClick={enterInviteMode}
            style={{
              background: "none", border: "none", padding: 0,
              color: "var(--color-text-tertiary)", fontSize: "11px",
              cursor: "pointer", textDecoration: "underline",
            }}
          >
            {t("auth.invite.cta")}
          </button>
        </div>

        {/* サンプルを見る：アカウント不要でアプリの見た目を確認できる閲覧専用モード */}
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          margin: "20px 0 12px", color: "var(--color-text-tertiary)", fontSize: "11px",
        }}>
          <div style={{ flex: 1, height: "1px", background: "var(--color-border-primary)" }} />
          <span>{t("auth.guest.divider")}</span>
          <div style={{ flex: 1, height: "1px", background: "var(--color-border-primary)" }} />
        </div>
        <button
          type="button"
          onClick={handleGuestClick}
          disabled={guestLoading}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            padding: "10px 12px",
            background: "var(--color-bg-secondary)",
            border: "1px dashed var(--color-border-secondary)",
            borderRadius: "var(--radius-md)",
            cursor: guestLoading ? "not-allowed" : "pointer",
            fontSize: "12px", fontWeight: 500, color: "var(--color-text-secondary)",
          }}
        >
          <span style={{ fontSize: "15px" }}>👁</span>
          <span>{guestLoading ? t("auth.guest.loading") : t("auth.guest.cta")}</span>
        </button>
        <p style={{ marginTop: "8px", textAlign: "center", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
          {t("auth.guest.desc", { limit: GUEST_AI_DAILY_LIMIT })}
        </p>
      </div>
    </div>
  );
}
