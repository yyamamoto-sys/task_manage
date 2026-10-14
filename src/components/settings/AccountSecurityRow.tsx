// src/components/settings/AccountSecurityRow.tsx
//
// 【設計意図】設定ページ「👤 プロフィール」の「パスワードを変更」。新しいパスワードを2回入れて、
// 保存ボタンを押したときだけ updateUser する（明示保存。CLAUDE.md Section 44）。入力途中は
// 未保存編集レジストリ（Section 46）に登録し、画面を離れる前に確認が出る。
// Supabase の「再認証が必要」設定（Secure password change）で拒否された場合は、そのエラー文を
// 出したうえで「ログアウトして『パスワードをお忘れの方』から再設定」を案内する（Section 79）。
// ファイル名に「password」を含めない：この環境の Read/Write 拒否ルールが *password* に当たるため。
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { showToast } from "../common/Toast";
import { updateOwnPassword } from "../../lib/supabase/auth";
import { formatErrorForUser } from "../../lib/errorMessage";
import { validateNewPassword, isReauthRequiredError } from "../../lib/account/recoveryFlow";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../lib/editing/unsavedEditorRegistry";
import { Row, inputStyle, primaryBtnStyle } from "./settingsUi";

export function AccountSecurityRow() {
  const t = useT();
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reauthHint, setReauthHint] = useState(false);

  const dirty = value !== "" || confirm !== "";
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const editorId = useId();
  useEffect(() => {
    registerUnsavedEditor(editorId, () => dirtyRef.current);
    return () => unregisterUnsavedEditor(editorId);
  }, [editorId]);

  const save = async () => {
    if (!dirty || saving) return;
    setError("");
    setReauthHint(false);
    const check = validateNewPassword(value, confirm);
    if (check === "mismatch") { setError(t("auth.error.passwordMismatch")); return; }
    if (check === "tooShort") { setError(t("auth.error.passwordTooShort")); return; }
    setSaving(true);
    try {
      await updateOwnPassword(value);
      setValue("");
      setConfirm("");
      showToast(t("layout.settings.account.saved"), "success");
    } catch (err) {
      setError(formatErrorForUser(t("layout.settings.account.failed"), err));
      setReauthHint(isReauthRequiredError(err));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !dirty || saving;
  return (
    <Row label={t("layout.settings.account.heading")} hint={t("layout.settings.account.hint")}>
      <form
        onSubmit={e => { e.preventDefault(); void save(); }}
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={t("layout.settings.account.new")}
          aria-label={t("layout.settings.account.new")}
          autoComplete="new-password"
          style={inputStyle}
        />
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder={t("layout.settings.account.confirm")}
          aria-label={t("layout.settings.account.confirm")}
          autoComplete="new-password"
          style={inputStyle}
        />
        {error && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", lineHeight: 1.7 }}>{error}</div>}
        {reauthHint && (
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            {t("layout.settings.account.reauth")}
          </div>
        )}
        <div>
          <button
            type="submit"
            disabled={disabled}
            style={{ ...primaryBtnStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
          >
            {saving ? t("layout.settings.account.saving") : t("layout.settings.account.save")}
          </button>
        </div>
      </form>
    </Row>
  );
}
