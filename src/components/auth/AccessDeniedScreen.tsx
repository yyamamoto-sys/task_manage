// src/components/auth/AccessDeniedScreen.tsx
//
// 【表示条件】認証済みだが members に自分の行がまだ登録されていないユーザーに表示する画面。
// RLSでmembers/projects/tasksが何も見えないだけで「初回セットアップ」ではないケース
// （is_system_bootstrapped()がtrue、または判定自体に失敗した安全側フォールバック）で
// App.tsx から表示される。ここには絶対に SetupWizard へ進ませない（M25対応）。
import { useEffect, useState } from "react";
import { getAuthEmail, signOut } from "../../lib/supabase/auth";

interface Props {
  onLogout: () => void;
}

export function AccessDeniedScreen({ onLogout }: Props) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    void getAuthEmail().then(setEmail);
  }, []);

  const handleLogout = async () => {
    await signOut();
    onLogout();
  };

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)" }}>
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
          アクセス権がありません
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: "16px" }}>
          このメールアドレスはまだメンバーとして登録されていません。
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
          管理者に連絡して、上記のメールアドレスでメンバー登録を依頼してください。登録が完了すれば、次回ログイン時に自動的にアクセスできるようになります。
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
          ログアウトして別のアカウントで入り直す
        </button>
      </div>
    </div>
  );
}
