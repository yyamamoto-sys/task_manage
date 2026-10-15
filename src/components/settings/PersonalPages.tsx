// src/components/settings/PersonalPages.tsx
//
// 設定画面の個人ページ（プロフィール／アカウント／表示／困ったとき）。v3.155 で SettingsView から分離し、
// 旧「プロフィール」にあったメール・権限・パスワードとログアウトを「アカウント」へ移した。
// 保存の見せ方は src/components/common/saveUi.tsx（設計仕様 §3）：
//  - プロフィール：保存ボタン（表示名・短縮名・色の1フォーム）
//  - 表示：テーマ・言語・一覧の表示密度は即時保存（操作した欄の横に「✓ 保存しました」）
//  - アカウント／困ったとき：設定値を持たない操作は「実行」（確認ダイアログまたは結果のトースト）
// 通知の受け取り方は NotificationSettingsSection.tsx。

import { useMemo, useState, Suspense, type ReactNode } from "react";
import type { Member } from "../../lib/localData/types";
import { useAppStore } from "../../stores/appStore";
import { useLangStore } from "../../stores/langStore";
import { useT } from "../../hooks/useT";
import { useUnsavedEditor } from "../../hooks/useUnsavedEditor";
import { KEYS } from "../../lib/localData/localStore";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { SaveButton, SaveErrorBand, SaveKeyScope, SavedFlash, useSavedFlash } from "../common/saveUi";
import { Avatar } from "../auth/UserSelectScreen";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { APP_VERSION } from "../../lib/version";
import { confirmDiscardUnsavedEdits } from "../../lib/editing/unsavedEditorRegistry";
import { resetDisplaySettings } from "../../lib/settings/displaySettingsReset";
import { buildProfileUpdate, deriveInitials, fallbackShortName, MEMBER_AVATAR_COLORS } from "../../lib/settings/profileUpdate";
import { adminsOfGroup } from "../../lib/settings/settingsSections";
import { SectionBody, Row, SegButtons, useFieldStyles } from "./settingsUi";
import { AccountSecurityRow } from "./AccountSecurityRow";
import { isGuestMode } from "../../lib/guestMode";
import { requestOpenFeedback } from "../../lib/feedback/capture";

const VersionHistoryModal = lazyWithRetry(() => import("../common/VersionHistoryModal").then(m => ({ default: m.VersionHistoryModal })), "VersionHistoryModal");

// ===== 👤 プロフィール =====

export function ProfilePage({ currentUser }: { currentUser: Member }) {
  const t = useT();
  const { input, primaryBtn } = useFieldStyles();
  const members = useAppStore(s => s.members);
  const saveMember = useAppStore(s => s.saveMember);
  const self = members.find(m => m.id === currentUser.id) ?? currentUser;
  const [displayName, setDisplayName] = useState(self.display_name);
  const [shortName, setShortName] = useState(self.short_name);
  const [color, setColor] = useState({ bg: self.color_bg, text: self.color_text });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = displayName !== self.display_name || shortName !== self.short_name || color.bg !== self.color_bg;
  useUnsavedEditor(dirty);

  const preview: Member = { ...self, initials: deriveInitials(displayName), color_bg: color.bg, color_text: color.text };
  const canSave = displayName.trim().length > 0;

  const save = async () => {
    if (!dirty || !canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      await saveMember(buildProfileUpdate(self, { display_name: displayName, short_name: shortName, color }, currentUser.id));
      showToast(t("layout.settings.save.toast"), "success");
    } catch (e) {
      setError(formatErrorForUser(t("layout.settings.profile.saveFailed"), e));
    } finally { setSaving(false); }
  };

  return (
    <SaveKeyScope onSave={() => void save()}>
    <SectionBody>
      <Row label={t("layout.settings.profile.displayName")}>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={input} maxLength={40} />
      </Row>
      <Row label={t("layout.settings.profile.shortName")} hint={t("layout.settings.profile.shortNameHint")}>
        <input value={shortName} onChange={e => setShortName(e.target.value)} style={input} maxLength={20} />
      </Row>
      <Row label={t("layout.settings.profile.color")}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {MEMBER_AVATAR_COLORS.map(c => (
            <button
              key={c.bg}
              onClick={() => setColor({ bg: c.bg, text: c.text })}
              aria-pressed={color.bg === c.bg}
              style={{
                width: "32px", height: "32px", borderRadius: "50%", cursor: "pointer",
                background: c.bg, border: color.bg === c.bg ? `2px solid ${c.text}` : "2px solid transparent",
              }}
            />
          ))}
          <span style={{ marginLeft: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            <Avatar member={preview} size={28} />{shortName.trim() || fallbackShortName(displayName)}
          </span>
        </div>
      </Row>
      <div>
        <SaveButton dirty={dirty} saving={saving} blocked={!canSave} onClick={() => void save()} buttonStyle={primaryBtn} />
      </div>
      <SaveErrorBand message={error} />
    </SectionBody>
    </SaveKeyScope>
  );
}

// ===== 🔑 アカウント =====

export function AccountPage({ currentUser, onLogout }: { currentUser: Member; onLogout: () => void }) {
  const t = useT();
  const { btn } = useFieldStyles();
  const members = useAppStore(s => s.members);
  const self = members.find(m => m.id === currentUser.id) ?? currentUser;
  const role = self.is_super_admin ? "superAdmin" : self.is_admin ? "admin" : "member";
  return (
    <SectionBody>
      <Row label={t("layout.settings.account.infoHeading")} hint={t("layout.settings.account.infoHint")}>
        <div style={{ fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: 1.9 }}>
          <div>{t("layout.settings.account.email")}：{self.email || t("layout.settings.account.none")}</div>
          <div>{t("layout.settings.account.role")}：{t(`layout.settings.account.role.${role}`)}</div>
        </div>
      </Row>
      {!isGuestMode() && <AccountSecurityRow />}
      <Row label={t("layout.settings.help.logout")}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "200px", fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            {t("layout.settings.help.logoutDesc")}
          </div>
          <button style={btn} onClick={onLogout}>{t("layout.logout.title")}</button>
        </div>
      </Row>
    </SectionBody>
  );
}

// ===== 🎨 表示 =====

type Density = "simple" | "detailed";

function readDensity(): Density {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.LIST_VIEW_SETTINGS) ?? "{}") as Record<string, unknown>;
    return all.density === "detailed" ? "detailed" : "simple";
  } catch { return "simple"; }
}

/** 保存できたら true。利用不可・容量不足・壊れた値は false（呼び出し側が操作前の値に戻す） */
function writeDensity(v: Density): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.LIST_VIEW_SETTINGS) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(KEYS.LIST_VIEW_SETTINGS, JSON.stringify({ ...all, density: v }));
    return true;
  } catch { return false; }
}

export function DisplayPage({ theme, onToggleTheme, onResetSidebarWidth }: {
  theme: "light" | "dark"; onToggleTheme: () => void; onResetSidebarWidth?: () => void;
}) {
  const t = useT();
  const { btn } = useFieldStyles();
  const lang = useLangStore(s => s.lang);
  const setLang = useLangStore(s => s.setLang);
  const isLoadingEn = useLangStore(s => s.isLoadingEn);
  const [density, setDensity] = useState<Density>(readDensity);
  const [themeSaved, flashTheme] = useSavedFlash();
  const [langSaved, flashLang] = useSavedFlash();
  const [densitySaved, flashDensity] = useSavedFlash();

  const changeDensity = (v: Density) => {
    const prev = density;
    setDensity(v);
    if (writeDensity(v)) flashDensity();
    else {
      setDensity(prev);
      showToast(t("layout.settings.display.saveFailed"), "error");
    }
  };

  return (
    <SectionBody>
      <Row label={t("layout.settings.display.theme")} flash={<SavedFlash visible={themeSaved} />}>
        <SegButtons value={theme} onChange={v => { if (v !== theme) { onToggleTheme(); flashTheme(); } }}
          options={[{ value: "light", label: t("layout.settings.display.themeLight") }, { value: "dark", label: t("layout.settings.display.themeDark") }]} />
      </Row>
      <Row label={t("layout.settings.display.lang")} hint={t("layout.settings.display.langHint")} flash={<SavedFlash visible={langSaved} />}>
        <SegButtons value={lang} onChange={v => { if (!isLoadingEn && v !== lang) { setLang(v); flashLang(); } }}
          options={[{ value: "ja", label: "日本語" }, { value: "en", label: "English" }]} />
      </Row>
      <Row label={t("layout.settings.display.density")} hint={t("layout.settings.display.densityHint")} flash={<SavedFlash visible={densitySaved} />}>
        <SegButtons value={density} onChange={changeDensity}
          options={[{ value: "simple", label: t("layout.settings.display.densitySimple") }, { value: "detailed", label: t("layout.settings.display.densityDetailed") }]} />
      </Row>
      {onResetSidebarWidth && (
        <Row label={t("layout.settings.display.sidebar")} hint={t("layout.settings.display.sidebarHint")}>
          <button style={btn} onClick={() => { onResetSidebarWidth(); showToast(t("layout.settings.display.sidebarDone"), "success"); }}>
            {t("layout.settings.display.sidebarReset")}
          </button>
        </Row>
      )}
    </SectionBody>
  );
}

// ===== 🛟 困ったとき =====

export function HelpPage({ onOpenGuide, onRestartTour, onOpenShortcuts }: {
  onOpenGuide: () => void; onRestartTour: () => void; onOpenShortcuts: () => void;
}) {
  const t = useT();
  const { btn } = useFieldStyles();
  const members = useAppStore(s => s.members);
  const currentGroupId = useAppStore(s => s.currentGroupId);
  const admins = useMemo(() => adminsOfGroup(members, currentGroupId), [members, currentGroupId]);
  const [isVersionOpen, setIsVersionOpen] = useState(false);

  const reload = async () => {
    if (!(await confirmDiscardUnsavedEdits())) return;
    window.location.reload();
  };

  const resetDisplay = async () => {
    const ok = await confirmDialog(t("layout.settings.help.resetConfirm"), {
      tone: "danger", confirmLabel: t("layout.settings.help.resetConfirmLabel"),
    });
    if (!ok) return;
    resetDisplaySettings(localStorage);
    window.location.reload();
  };

  const item = (label: string, desc: string, button: ReactNode) => (
    <Row label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "200px", fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{desc}</div>
        {button}
      </div>
    </Row>
  );

  return (
    <SectionBody>
      {item(t("layout.settings.help.reload"), t("layout.settings.help.reloadDesc"),
        <button style={btn} onClick={() => void reload()}>{t("layout.settings.help.reloadBtn")}</button>)}
      {item(t("layout.settings.help.reset"), t("layout.settings.help.resetDesc"),
        <button style={{ ...btn, color: "var(--color-text-danger)", borderColor: "var(--color-border-danger)" }} onClick={() => void resetDisplay()}>{t("layout.settings.help.resetBtn")}</button>)}
      {item(t("layout.settings.help.guide"), t("layout.settings.help.guideDesc"),
        <button style={btn} onClick={onOpenGuide}>{t("layout.settings.help.guideBtn")}</button>)}
      {item(t("layout.settings.help.tour"), t("layout.settings.help.tourDesc"),
        <button style={btn} onClick={onRestartTour}>{t("layout.settings.help.tourBtn")}</button>)}
      {item(t("layout.settings.help.shortcuts"), t("layout.settings.help.shortcutsDesc"),
        <button style={btn} onClick={onOpenShortcuts}>{t("layout.settings.help.shortcutsBtn")}</button>)}
      {!isGuestMode() && item(t("layout.settings.help.feedback"), t("layout.settings.help.feedbackDesc"),
        <button data-feedback-ui="" style={btn} onClick={requestOpenFeedback}>{t("layout.settings.help.feedbackBtn")}</button>)}
      {item(t("layout.settings.help.version"), t("layout.settings.help.versionDesc", { version: APP_VERSION }),
        <button style={btn} onClick={() => setIsVersionOpen(true)}>{t("layout.settings.help.versionBtn")}</button>)}
      <Row label={t("layout.settings.help.admins")} hint={t("layout.settings.help.adminsHint")}>
        {admins.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{t("layout.settings.help.adminsNone")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            {admins.map(m => (
              <span key={m.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--color-text-primary)" }}>
                <Avatar member={m} size={24} />{m.display_name}
              </span>
            ))}
          </div>
        )}
      </Row>
      {isVersionOpen && (
        <Suspense fallback={null}>
          <VersionHistoryModal onClose={() => setIsVersionOpen(false)} />
        </Suspense>
      )}
    </SectionBody>
  );
}
