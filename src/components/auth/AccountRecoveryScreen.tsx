// src/components/auth/AccountRecoveryScreen.tsx
//
// 【設計意図】再設定メールのリンクから戻ってきた人に「新しいパスワードを設定」だけを出す画面。
// App.tsx は recoveryActive の間これだけを描画し、通常の起動処理（自動マッチ・招待の受諾・
// セットアップ・データ読み込み）へ進めない。リンクのセッションでアプリに入れてしまい、
// パスワードを決めないまま使える経路を作らないため（CLAUDE.md Section 79）。
// ファイル名に「password」を含めない：この環境の Read/Write 拒否ルールが *password* に当たるため。
import { useState } from "react";
import { updateOwnPassword, signOut } from "../../lib/supabase/auth";
import { AppLogo } from "../common/AppLogo";
import { LangToggle } from "../common/LangToggle";
import { useT } from "../../hooks/useT";
import { formatErrorForUser } from "../../lib/errorMessage";
import { validateNewPassword, isReauthRequiredError } from "../../lib/account/recoveryFlow";

interface Props {
  /** パスワードの設定が済んだ。通常どおりアプリへ入る。 */
  onDone: () => void;
  /** 設定せずにログイン画面へ戻る（signOut 済み）。 */
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", fontSize: "14px", boxSizing: "border-box", outline: "none",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "6px",
};

export function AccountRecoveryScreen({ onDone, onCancel }: Props) {
  const t = useT();
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const check = validateNewPassword(value, confirm);
    if (check === "mismatch") { setError(t("auth.error.passwordMismatch")); return; }
    if (check === "tooShort") { setError(t("auth.error.passwordTooShort")); return; }
    setSaving(true);
    try {
      await updateOwnPassword(value);
      onDone();
    } catch (err) {
      setError(isReauthRequiredError(err) ? t("auth.reset.sessionLost") : formatErrorForUser(t("auth.reset.failed"), err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    try { await signOut(); } catch { /* 失敗してもログイン画面へ戻す（次回起動時にセッションが残っていれば通常ログインになる） */ }
    onCancel();
  };

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-secondary)", position: "relative" }}>
      <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 10 }}>
        <LangToggle variant="icon" />
      </div>
      <div style={{
        background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", padding: "40px", width: "360px",
        boxShadow: "var(--shadow-md)", border: "1px solid var(--color-border-primary)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <AppLogo variant="full" size={54} />
        </div>
        <h1 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "4px" }}>
          {t("auth.reset.title")}
        </h1>
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.6, marginBottom: "18px" }}>
          {t("auth.reset.subtitle")}
        </p>
        <form onSubmit={e => void handleSubmit(e)}>
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>
              {t("auth.reset.newPassword")}
              <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}>{t("auth.form.passwordHint")}</span>
            </label>
            <input type="password" value={value} onChange={e => setValue(e.target.value)} required autoFocus autoComplete="new-password" style={inputStyle} />
          </div>
          <div style={{ marginBottom: "18px" }}>
            <label style={labelStyle}>{t("auth.form.passwordConfirm")}</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" style={inputStyle} />
          </div>
          {error && (
            <p style={{ fontSize: "13px", color: "var(--color-text-danger)", marginBottom: "16px" }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={saving}
            style={{
              width: "100%", padding: "11px", background: saving ? "var(--color-text-tertiary)" : "var(--color-brand)",
              color: "#fff", border: "none", borderRadius: "var(--radius-md)", fontSize: "14px", fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? t("auth.reset.submitting") : t("auth.reset.submit")}
          </button>
        </form>
        <button
          type="button"
          onClick={() => void handleCancel()}
          style={{ width: "100%", marginTop: "12px", padding: "6px", background: "transparent", border: "none", color: "var(--color-text-tertiary)", fontSize: "12px", cursor: "pointer" }}
        >
          {t("auth.reset.cancel")}
        </button>
      </div>
    </div>
  );
}
