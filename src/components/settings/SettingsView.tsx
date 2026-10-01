// src/components/settings/SettingsView.tsx
//
// 【設計意図・v3.127】
// 設定ボタンから開くページ。左の目次に 個人設定（全員：プロフィール／表示／通知／困ったとき）と
// 管理（管理者のみ：既存の AdminView をそのまま埋め込む）を並べる。
// 「設定で困ったときはここを開けばわかる」を目的にしているため、個人の設定を足すときは
// 必ずこのページのどこかに置く（CLAUDE.md Section 65）。
//
// テーマは useTheme が useState（インスタンスごと）のため、サイドバーと状態を共有するよう
// MainLayout から theme/onToggleTheme を受け取る。言語は zustand（langStore）なので直接使う。

import { useEffect, useId, useMemo, useRef, useState, Suspense, type ReactNode } from "react";
import type { Member } from "../../lib/localData/types";
import { useAppStore } from "../../stores/appStore";
import { useLangStore } from "../../stores/langStore";
import { useT } from "../../hooks/useT";
import { useIsMobile } from "../../hooks/useIsMobile";
import { KEYS } from "../../lib/localData/localStore";
import { confirmDialog } from "../../lib/dialog";
import { showToast } from "../common/Toast";
import { Avatar } from "../auth/UserSelectScreen";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { APP_VERSION } from "../../lib/version";
import {
  registerUnsavedEditor, unregisterUnsavedEditor, confirmDiscardUnsavedEdits,
} from "../../lib/editing/unsavedEditorRegistry";
import { resetDisplaySettings } from "../../lib/settings/displaySettingsReset";
import { buildProfileUpdate, deriveInitials, fallbackShortName, MEMBER_AVATAR_COLORS } from "../../lib/settings/profileUpdate";
import {
  adminsOfGroup, buildSettingsSections, canAccessAdminSection, type SettingsSection,
} from "../../lib/settings/settingsSections";
import { SectionBody, Row, inputStyle, btnStyle, primaryBtnStyle, SegButtons } from "./settingsUi";
import { NotificationSettingsSection } from "./NotificationSettingsSection";

const VersionHistoryModal = lazyWithRetry(() => import("../common/VersionHistoryModal").then(m => ({ default: m.VersionHistoryModal })), "VersionHistoryModal");

interface Props {
  currentUser: Member;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** 管理セクションの中身（MainLayout が lazy＋DLゲート付きの AdminView を渡す） */
  adminSlot: ReactNode;
  onOpenGuide: () => void;
  onRestartTour: () => void;
  onOpenShortcuts: () => void;
  onLogout: () => void;
  /** PC のみ（モバイルにはサイドバー幅が無い） */
  onResetSidebarWidth?: () => void;
  /** 開いたときに表示するセクション（ベル・ダッシュボードの「通知設定」から notify を指定する） */
  initialSection?: SettingsSection;
}

const SECTION_ICON: Record<SettingsSection, string> = {
  profile: "👤", display: "🎨", notify: "🔔", help: "🛟", admin: "🔧",
};

export function SettingsView(props: Props) {
  const { currentUser } = props;
  const t = useT();
  const isMobile = useIsMobile();
  const members = useAppStore(s => s.members);
  const showAdmin = canAccessAdminSection(currentUser, members);
  const sections = useMemo(() => buildSettingsSections(showAdmin), [showAdmin]);
  const [section, setSection] = useState<SettingsSection>(props.initialSection ?? "profile");
  // 管理は一度開いたらマウントしたまま隠す（個人設定へ移っても AdminView の入力途中の状態を失わない）
  const [adminMounted, setAdminMounted] = useState(props.initialSection === "admin");
  const current: SettingsSection = sections.includes(section) ? section : "profile";

  const changeSection = async (next: SettingsSection) => {
    if (next === current) return;
    if (!(await confirmDiscardUnsavedEdits())) return;
    if (next === "admin") setAdminMounted(true);
    setSection(next);
  };

  const navBtn = (s: SettingsSection) => {
    const isActive = s === current;
    return (
      <button
        key={s}
        onClick={() => void changeSection(s)}
        style={{
          display: "flex", alignItems: "center", gap: "8px",
          width: isMobile ? "auto" : "100%", whiteSpace: "nowrap",
          padding: "7px 10px", marginBottom: isMobile ? 0 : "2px", fontSize: "12px", textAlign: "left",
          borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
          background: isActive ? "var(--color-bg-info)" : "transparent",
          color: isActive ? "var(--color-text-info)" : "var(--color-text-secondary)",
          fontWeight: isActive ? 600 : 400,
        }}
      >
        <span>{SECTION_ICON[s]}</span>
        <span>{t(`layout.settings.nav.${s}`)}</span>
      </button>
    );
  };

  const groupLabel = (key: string) => (
    <div style={{
      fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)",
      padding: isMobile ? "0 4px" : "10px 10px 4px", whiteSpace: "nowrap",
    }}>{t(key)}</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", height: "100%", overflow: "hidden" }}>
      <nav style={isMobile ? {
        display: "flex", alignItems: "center", gap: "4px", overflowX: "auto",
        padding: "6px 8px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0,
      } : {
        width: "170px", flexShrink: 0, padding: "6px 8px", overflowY: "auto",
        borderRight: "1px solid var(--color-border-primary)", background: "var(--color-bg-secondary)",
      }}>
        {groupLabel("layout.settings.group.personal")}
        {sections.filter(s => s !== "admin").map(navBtn)}
        {showAdmin && groupLabel("layout.settings.group.admin")}
        {showAdmin && navBtn("admin")}
      </nav>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", position: "relative" }}>
        {current === "profile" && <ProfileSection currentUser={currentUser} />}
        {current === "display" && <DisplaySection {...props} />}
        {current === "notify" && <NotificationSettingsSection currentUser={currentUser} />}
        {current === "help" && <HelpSection {...props} />}
        {showAdmin && adminMounted && (
          <div style={{ display: current === "admin" ? "block" : "none", height: "100%" }}>
            {props.adminSlot}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 👤 プロフィール =====

function ProfileSection({ currentUser }: { currentUser: Member }) {
  const t = useT();
  const members = useAppStore(s => s.members);
  const saveMember = useAppStore(s => s.saveMember);
  const self = members.find(m => m.id === currentUser.id) ?? currentUser;
  const [displayName, setDisplayName] = useState(self.display_name);
  const [shortName, setShortName] = useState(self.short_name);
  const [color, setColor] = useState({ bg: self.color_bg, text: self.color_text });
  const [saving, setSaving] = useState(false);

  const dirty = displayName !== self.display_name || shortName !== self.short_name || color.bg !== self.color_bg;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const editorId = useId();
  useEffect(() => {
    registerUnsavedEditor(editorId, () => dirtyRef.current);
    return () => unregisterUnsavedEditor(editorId);
  }, [editorId]);

  const preview: Member = { ...self, initials: deriveInitials(displayName), color_bg: color.bg, color_text: color.text };
  const role = self.is_super_admin ? "superAdmin" : self.is_admin ? "admin" : "member";

  const save = async () => {
    if (!displayName.trim() || saving) return;
    setSaving(true);
    try {
      await saveMember(buildProfileUpdate(self, { display_name: displayName, short_name: shortName, color }, currentUser.id));
      showToast(t("layout.settings.profile.saved"), "success");
    } catch { /* saveMember 側でエラーをトースト処理 */ }
    finally { setSaving(false); }
  };

  return (
    <SectionBody title={`👤 ${t("layout.settings.nav.profile")}`} lead={t("layout.settings.profile.lead")}>
      <Row label={t("layout.settings.profile.displayName")}>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} maxLength={40} />
      </Row>
      <Row label={t("layout.settings.profile.shortName")} hint={t("layout.settings.profile.shortNameHint")}>
        <input value={shortName} onChange={e => setShortName(e.target.value)} style={inputStyle} maxLength={20} />
      </Row>
      <Row label={t("layout.settings.profile.color")}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {MEMBER_AVATAR_COLORS.map(c => (
            <button
              key={c.bg}
              onClick={() => setColor({ bg: c.bg, text: c.text })}
              aria-pressed={color.bg === c.bg}
              style={{
                width: "28px", height: "28px", borderRadius: "50%", cursor: "pointer",
                background: c.bg, border: color.bg === c.bg ? `2px solid ${c.text}` : "2px solid transparent",
              }}
            />
          ))}
          <span style={{ marginLeft: "8px", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            <Avatar member={preview} size={28} />{shortName.trim() || fallbackShortName(displayName)}
          </span>
        </div>
      </Row>
      <Row label={t("layout.settings.profile.readonlyHeading")} hint={t("layout.settings.profile.readonlyHint")}>
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.9 }}>
          <div>{t("layout.settings.profile.email")}：{self.email || t("layout.settings.profile.none")}</div>
          <div>{t("layout.settings.profile.role")}：{t(`layout.settings.profile.role.${role}`)}</div>
        </div>
      </Row>
      <div>
        <button onClick={() => void save()} disabled={!dirty || !displayName.trim() || saving}
          style={{ ...primaryBtnStyle, opacity: (!dirty || !displayName.trim() || saving) ? 0.5 : 1, cursor: (!dirty || !displayName.trim() || saving) ? "default" : "pointer" }}>
          {saving ? t("layout.settings.profile.saving") : t("layout.settings.profile.save")}
        </button>
      </div>
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

function writeDensity(v: Density) {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.LIST_VIEW_SETTINGS) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(KEYS.LIST_VIEW_SETTINGS, JSON.stringify({ ...all, density: v }));
  } catch { /* 利用不可・容量不足は無視 */ }
}

function DisplaySection({ theme, onToggleTheme, onResetSidebarWidth }: Props) {
  const t = useT();
  const lang = useLangStore(s => s.lang);
  const setLang = useLangStore(s => s.setLang);
  const isLoadingEn = useLangStore(s => s.isLoadingEn);
  const [density, setDensity] = useState<Density>(readDensity);

  return (
    <SectionBody title={`🎨 ${t("layout.settings.nav.display")}`} lead={t("layout.settings.display.lead")}>
      <Row label={t("layout.settings.display.theme")}>
        <SegButtons value={theme} onChange={v => { if (v !== theme) onToggleTheme(); }}
          options={[{ value: "light", label: t("layout.settings.display.themeLight") }, { value: "dark", label: t("layout.settings.display.themeDark") }]} />
      </Row>
      <Row label={t("layout.settings.display.lang")} hint={t("layout.settings.display.langHint")}>
        <SegButtons value={lang} onChange={v => { if (!isLoadingEn) setLang(v); }}
          options={[{ value: "ja", label: "日本語" }, { value: "en", label: "English" }]} />
      </Row>
      <Row label={t("layout.settings.display.density")} hint={t("layout.settings.display.densityHint")}>
        <SegButtons value={density} onChange={v => { setDensity(v); writeDensity(v); }}
          options={[{ value: "simple", label: t("layout.settings.display.densitySimple") }, { value: "detailed", label: t("layout.settings.display.densityDetailed") }]} />
      </Row>
      {onResetSidebarWidth && (
        <Row label={t("layout.settings.display.sidebar")} hint={t("layout.settings.display.sidebarHint")}>
          <button style={btnStyle} onClick={() => { onResetSidebarWidth(); showToast(t("layout.settings.display.sidebarDone"), "success"); }}>
            {t("layout.settings.display.sidebarReset")}
          </button>
        </Row>
      )}
    </SectionBody>
  );
}

// ===== 🛟 困ったとき =====

function HelpSection({ onOpenGuide, onRestartTour, onOpenShortcuts, onLogout }: Props) {
  const t = useT();
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
        <div style={{ flex: 1, minWidth: "200px", fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{desc}</div>
        {button}
      </div>
    </Row>
  );

  return (
    <SectionBody title={`🛟 ${t("layout.settings.nav.help")}`} lead={t("layout.settings.help.lead")}>
      {item(t("layout.settings.help.reload"), t("layout.settings.help.reloadDesc"),
        <button style={btnStyle} onClick={() => void reload()}>{t("layout.settings.help.reloadBtn")}</button>)}
      {item(t("layout.settings.help.reset"), t("layout.settings.help.resetDesc"),
        <button style={{ ...btnStyle, color: "var(--color-text-danger)", borderColor: "var(--color-border-danger)" }} onClick={() => void resetDisplay()}>{t("layout.settings.help.resetBtn")}</button>)}
      {item(t("layout.settings.help.guide"), t("layout.settings.help.guideDesc"),
        <button style={btnStyle} onClick={onOpenGuide}>{t("layout.settings.help.guideBtn")}</button>)}
      {item(t("layout.settings.help.tour"), t("layout.settings.help.tourDesc"),
        <button style={btnStyle} onClick={onRestartTour}>{t("layout.settings.help.tourBtn")}</button>)}
      {item(t("layout.settings.help.shortcuts"), t("layout.settings.help.shortcutsDesc"),
        <button style={btnStyle} onClick={onOpenShortcuts}>{t("layout.settings.help.shortcutsBtn")}</button>)}
      {item(t("layout.settings.help.version"), t("layout.settings.help.versionDesc", { version: APP_VERSION }),
        <button style={btnStyle} onClick={() => setIsVersionOpen(true)}>{t("layout.settings.help.versionBtn")}</button>)}
      <Row label={t("layout.settings.help.admins")} hint={t("layout.settings.help.adminsHint")}>
        {admins.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{t("layout.settings.help.adminsNone")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {admins.map(m => (
              <span key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-text-primary)" }}>
                <Avatar member={m} size={22} />{m.display_name}
              </span>
            ))}
          </div>
        )}
      </Row>
      {item(t("layout.settings.help.logout"), t("layout.settings.help.logoutDesc"),
        <button style={btnStyle} onClick={onLogout}>{t("layout.logout.title")}</button>)}
      {isVersionOpen && (
        <Suspense fallback={null}>
          <VersionHistoryModal onClose={() => setIsVersionOpen(false)} />
        </Suspense>
      )}
    </SectionBody>
  );
}
