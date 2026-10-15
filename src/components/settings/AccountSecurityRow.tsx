// src/components/settings/AccountSecurityRow.tsx
//
// 【設計意図】設定ページ「🔑 アカウント」の「パスワードを変更」。新しいパスワードを2回入れて、
// 保存ボタンを押したときだけ updateUser する（明示保存。CLAUDE.md Section 44）。入力途中は
// 未保存編集レジストリ（Section 46・useUnsavedEditor）に登録し、画面を離れる前に確認が出る。
// Supabase の「再認証が必要」設定（Secure password change）で拒否された場合は、そのエラー文を
// 出したうえで「ログアウトして『パスワードをお忘れの方』から再設定」を案内する（Section 79）。
// v3.155：保存ボタンの3状態・永続のエラー帯・Enter／Ctrl+Enter 保存を共通部品（saveUi）に揃えた。
// ファイル名に「password」を含めない：この環境の Read/Write 拒否ルールが *password* に当たるため。
import { useState } from "react";
import { useT } from "../../hooks/useT";
import { useUnsavedEditor } from "../../hooks/useUnsavedEditor";
import { showToast } from "../common/Toast";
import { SaveButton, SaveErrorBand, SaveKeyScope } from "../common/saveUi";
import { updateOwnPassword } from "../../lib/supabase/auth";
import { formatErrorForUser } from "../../lib/errorMessage";
import { validateNewPassword, classifyUpdatePasswordError } from "../../lib/account/recoveryFlow";
import { Row, useFieldStyles } from "./settingsUi";

export function AccountSecurityRow() {
  const t = useT();
  const { input, primaryBtn } = useFieldStyles();
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reauthHint, setReauthHint] = useState(false);

  const dirty = value !== "" || confirm !== "";
  useUnsavedEditor(dirty);

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
      const kind = classifyUpdatePasswordError(err);
      setError(kind === "same_password"
        ? t("layout.settings.account.samePassword")
        : formatErrorForUser(t("layout.settings.account.failed"), err));
      setReauthHint(kind === "reauth" || kind === "session_missing");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Row label={t("layout.settings.account.heading")} hint={t("layout.settings.account.hint")}>
      <SaveKeyScope onSave={() => void save()}>
      <form
        onSubmit={e => { e.preventDefault(); }}
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={t("layout.settings.account.new")}
          aria-label={t("layout.settings.account.new")}
          autoComplete="new-password"
          style={input}
        />
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder={t("layout.settings.account.confirm")}
          aria-label={t("layout.settings.account.confirm")}
          autoComplete="new-password"
          style={input}
        />
        <SaveErrorBand message={error} />
        {reauthHint && (
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            {t("layout.settings.account.reauth")}
          </div>
        )}
        <div>
          <SaveButton dirty={dirty} saving={saving} onClick={() => void save()} buttonStyle={primaryBtn} label={t("layout.settings.account.save")} />
        </div>
      </form>
      </SaveKeyScope>
    </Row>
  );
}
