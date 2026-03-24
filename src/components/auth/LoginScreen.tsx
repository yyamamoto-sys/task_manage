// src/components/auth/LoginScreen.tsx
import { useState } from "react";
import { signIn } from "../../lib/supabase/auth";

interface Props {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      onLogin();
    } catch {
      setError("メールアドレスまたはパスワードが正しくありません。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--color-bg-secondary)",
    }}>
      <div style={{
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "40px",
        width: "360px",
        boxShadow: "var(--shadow-md)",
        border: "1px solid var(--color-border-primary)",
      }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px", color: "var(--color-text-primary)" }}>
          チーム計画管理ツール
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "28px" }}>
          Supabaseアカウントでログインしてください
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "6px" }}>
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "6px" }}>
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {error && (
            <p style={{ fontSize: "13px", color: "var(--color-text-danger)", marginBottom: "16px" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px",
              background: loading ? "var(--color-text-tertiary)" : "var(--color-brand)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-md)",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
