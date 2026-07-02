// src/components/auth/LoginScreen.tsx
import { useState } from "react";
import { signIn, signUp } from "../../lib/supabase/auth";
import { useT } from "../../hooks/useT";

interface Props {
  onLogin: () => void;
}

type Mode = "login" | "signup" | "signup_done";

export function LoginScreen({ onLogin }: Props) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)" }}>
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

  // ===== ログイン / 新規登録フォーム =====
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)" }}>
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
      </div>
    </div>
  );
}
