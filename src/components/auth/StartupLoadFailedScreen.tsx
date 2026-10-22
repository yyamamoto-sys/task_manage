// src/components/auth/StartupLoadFailedScreen.tsx
//
// 初回のデータ取得に失敗したときの画面（アクセス拒否画面と取り違えないため。lib/account/startupLoadFailed.ts）。
import { useT } from "../../hooks/useT";
import { LangToggle } from "../common/LangToggle";

interface Props {
  error: string;
  onRetry: () => void;
  onLogout: () => void;
}

export function StartupLoadFailedScreen({ error, onRetry, onLogout }: Props) {
  const t = useT();
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
      <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
        <LangToggle variant="icon" />
      </div>
      <div style={{
        background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", padding: "40px", width: "360px",
        boxShadow: "var(--shadow-md)", border: "1px solid var(--color-border-primary)", textAlign: "center",
      }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "8px" }}>
          {t("auth.loadFailed.title")}
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: "12px" }}>
          {t("auth.loadFailed.body")}
        </p>
        <div style={{
          padding: "10px 12px", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)",
          fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "20px", wordBreak: "break-all", textAlign: "left",
        }}>
          {error}
        </div>
        <button
          onClick={onRetry}
          style={{
            width: "100%", padding: "11px", background: "var(--color-brand)", color: "#fff",
            border: "none", borderRadius: "var(--radius-md)", fontSize: "14px", fontWeight: 600, cursor: "pointer",
          }}
        >
          {t("layout.app.error.retry")}
        </button>
        <button
          type="button"
          onClick={onLogout}
          style={{
            width: "100%", marginTop: "12px", padding: "6px", background: "transparent", border: "none",
            color: "var(--color-text-tertiary)", fontSize: "12px", cursor: "pointer", textDecoration: "underline",
          }}
        >
          {t("auth.loadFailed.logout")}
        </button>
      </div>
    </div>
  );
}
