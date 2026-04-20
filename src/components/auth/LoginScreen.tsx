// src/components/auth/LoginScreen.tsx
import { useState } from "react";
import { signIn, signUp } from "../../lib/supabase/auth";

interface Props {
  onLogin: () => void;
}

type Mode = "login" | "signup" | "signup_done";

export function LoginScreen({ onLogin }: Props) {
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
      setError("パスワードが一致しません。");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("パスワードは6文字以上で設定してください。");
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
        setError("メールアドレスまたはパスワードが正しくありません。");
      } else if (msg.includes("already registered") || msg.includes("User already registered")) {
        setError("このメールアドレスはすでに登録されています。ログインしてください。");
      } else {
        setError("登録に失敗しました。もう一度お試しください。");
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
              確認メールを送信しました
            </h1>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              <strong>{email}</strong> 宛にメールを送りました。<br />
              メール内のリンクをクリックして登録を完了してください。
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
            確認後、このページに戻ってログインしてください。<br />
            メールが届かない場合は迷惑メールフォルダをご確認ください。
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
            ログイン画面へ戻る
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
            グループ計画管理
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
              {m === "login" ? "ログイン" : "新規登録"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* メールアドレス */}
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="example@company.com"
              style={inputStyle}
            />
          </div>

          {/* パスワード */}
          <div style={{ marginBottom: mode === "signup" ? "16px" : "24px" }}>
            <label style={labelStyle}>パスワード{mode === "signup" && <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}>（6文字以上）</span>}</label>
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
              <label style={labelStyle}>パスワード（確認）</label>
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
            {loading ? (mode === "login" ? "ログイン中..." : "登録中...") : (mode === "login" ? "ログイン" : "アカウントを作成")}
          </button>
        </form>

        {/* パスワードリセット（ログイン時のみ） */}
        {mode === "login" && (
          <p style={{ marginTop: "16px", textAlign: "center", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            パスワードをお忘れの場合は管理者にご連絡ください。
          </p>
        )}
      </div>
    </div>
  );
}
