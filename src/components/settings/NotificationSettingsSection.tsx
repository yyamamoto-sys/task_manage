// src/components/settings/NotificationSettingsSection.tsx
//
// 設定ページ「🔔 通知」タブ（v3.128）。期限リマインドの知らせ方（アプリ内／Windows）・種類・時刻を
// 本人が選ぶ。正本：docs/dev/web-push-reminder-design.md §4.5（モーダルではなくこのタブに置く）。
// トグルは押した時点で保存する（タスク編集面ではないため Section 44 の明示保存の対象外）。
// 許可ダイアログは「Windows通知」をオンにした瞬間だけ出す。
// v3.129：「通知する内容」を種類×チャネル（アプリ内／Windows）の表にした（レジストリ＝src/lib/notifications/notificationKinds.ts）。
// 管理者向けの種類は super_admin にだけ出す。上の「知らせ方」は各チャネルの全体スイッチのまま。

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Member } from "../../lib/localData/types";
import { useAppStore } from "../../stores/appStore";
import { useNotificationPrefsStore } from "../../stores/notificationPrefsStore";
import { useT } from "../../hooks/useT";
import { showToast } from "../common/Toast";
import { formatErrorForUser } from "../../lib/errorMessage";
import { REMINDER_TIME_OPTIONS, formatReminderTime, type NotificationPrefs } from "../../lib/reminder/notificationPrefs";
import {
  ADMIN_NOTICE_ICON, NOTIFICATION_CHANNELS, NOTIFICATION_KIND_ICON, buildKindChannelPatch, kindChannelSetting, kindsVisibleTo,
  type NotificationChannel, type NotificationKindId,
} from "../../lib/notifications/notificationKinds";
import {
  getCurrentSubscription, getVapidPublicKey, isInIframe, isPushSupported,
  subscribeThisBrowser, unsubscribeThisBrowser,
} from "../../lib/push/pushClient";
import {
  deletePushSubscription, hasPushSubscriptionRow, registerPushSubscription, sendTestPush,
} from "../../lib/supabase/notificationStore";
import { SectionBody, Row, inputStyle, btnStyle } from "./settingsUi";

type PermissionState = NotificationPermission | "unsupported";

function readPermission(): PermissionState {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

function Toggle({ checked, disabled, onChange, label, desc }: {
  checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; desc: string;
}) {
  return (
    <div style={{ opacity: disabled ? 0.6 : 1 }}>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: disabled ? "default" : "pointer", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        {label}
      </label>
      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.7, paddingLeft: "22px" }}>{desc}</div>
    </div>
  );
}

const noteStyle: CSSProperties = {
  fontSize: "11px", lineHeight: 1.7, padding: "6px 10px", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "1px solid var(--color-border-warning)",
};

export function NotificationSettingsSection({ currentUser }: { currentUser: Member }) {
  const t = useT();
  const members = useAppStore(s => s.members);
  const self = members.find(m => m.id === currentUser.id);
  const prefs = useNotificationPrefsStore(s => s.prefs);
  const status = useNotificationPrefsStore(s => s.status);
  const load = useNotificationPrefsStore(s => s.load);
  const update = useNotificationPrefsStore(s => s.update);
  const [permission, setPermission] = useState<PermissionState>(readPermission);
  const [thisBrowserOn, setThisBrowserOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const vapidKey = getVapidPublicKey();
  const pushBlocked: "unsupported" | "iframe" | "noKey" | null =
    !isPushSupported() ? "unsupported" : isInIframe() ? "iframe" : !vapidKey ? "noKey" : null;
  const unavailable = status === "unavailable";
  const disabled = unavailable || status !== "ready" || busy;

  useEffect(() => {
    if (status === "idle") void load(currentUser.id);
  }, [status, load, currentUser.id]);

  const refreshThisBrowser = useCallback(async () => {
    if (pushBlocked) { setThisBrowserOn(false); return; }
    try {
      const sub = await getCurrentSubscription();
      setThisBrowserOn(sub ? await hasPushSubscriptionRow(sub.endpoint) : false);
    } catch {
      setThisBrowserOn(false);
    }
  }, [pushBlocked]);

  useEffect(() => { void refreshThisBrowser(); }, [refreshThisBrowser]);

  const save = async (patch: Partial<NotificationPrefs>): Promise<boolean> => {
    try {
      await update(patch);
      return true;
    } catch (e) {
      showToast(formatErrorForUser(t("layout.settings.notify.saveFailed"), e), "error");
      return false;
    }
  };

  // このブラウザを購読してDBに登録する。許可が無ければここで初めて聞く
  const subscribeHere = async (): Promise<boolean> => {
    if (pushBlocked || !vapidKey) return false;
    let perm = readPermission();
    if (perm === "default") {
      try { await Notification.requestPermission(); } catch { /* 古いブラウザ */ }
      perm = readPermission();
      setPermission(perm);
    }
    if (perm !== "granted") {
      showToast(t("layout.settings.notify.push.blockedToast"), "error");
      return false;
    }
    const keys = await subscribeThisBrowser(vapidKey);
    await registerPushSubscription(keys.endpoint, keys.p256dh, keys.auth);
    setThisBrowserOn(true);
    return true;
  };

  const togglePush = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        if (!(await subscribeHere())) return;
        if (!(await save({ push_enabled: true }))) return;
        showToast(t("layout.settings.notify.push.enabledToast"), "success");
      } else {
        const endpoint = await unsubscribeThisBrowser();
        if (endpoint) await deletePushSubscription(endpoint);
        setThisBrowserOn(false);
        if (!(await save({ push_enabled: false }))) return;
        showToast(t("layout.settings.notify.push.disabledToast"), "success");
      }
    } catch (e) {
      showToast(formatErrorForUser(t("layout.settings.notify.saveFailed"), e), "error");
    } finally {
      setBusy(false);
    }
  };

  const registerThisBrowser = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await subscribeHere()) showToast(t("layout.settings.notify.push.enabledToast"), "success");
    } catch (e) {
      showToast(formatErrorForUser(t("layout.settings.notify.saveFailed"), e), "error");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const r = await sendTestPush();
      if (r.attempted === 0) showToast(t("layout.settings.notify.testNoSub"), "error");
      else if (r.succeeded > 0) showToast(t("layout.settings.notify.testDone", { n: r.succeeded }), "success");
      else showToast(t("layout.settings.notify.testFailed", { summary: r.errorSummary ?? "-" }), "error");
      void refreshThisBrowser();
    } catch (e) {
      showToast(formatErrorForUser(t("layout.settings.notify.testFailed", { summary: "" }), e), "error");
    } finally {
      setTesting(false);
    }
  };

  const requestPermission = async () => {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
    setPermission(readPermission());
  };

  const permTone = permission === "granted" ? "success" : permission === "denied" ? "danger" : "warning";
  const showLegacyNote = self?.notify_pref === "browser" && !prefs.push_enabled && status === "ready";
  const isSuperAdmin = currentUser.is_super_admin === true || self?.is_super_admin === true;
  const visibleKinds = kindsVisibleTo(isSuperAdmin);
  const channelMasterOn = (ch: NotificationChannel) => (ch === "inapp" ? prefs.inapp_enabled : prefs.push_enabled);
  const setKindChannel = (kindId: string, ch: NotificationChannel, value: boolean) => {
    void save(buildKindChannelPatch(prefs, kindId, ch, value));
  };

  return (
    <SectionBody title={`🔔 ${t("layout.settings.nav.notify")}`} lead={t("layout.settings.notify.lead")}>
      {unavailable && <div role="status" style={noteStyle}>{t("layout.settings.notify.unavailable")}</div>}
      {showLegacyNote && <div role="status" style={noteStyle}>{t("layout.settings.notify.legacy")}</div>}

      <Row label={t("layout.settings.notify.channels")}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Toggle
            checked={prefs.inapp_enabled} disabled={disabled}
            onChange={v => { void save({ inapp_enabled: v }); }}
            label={t("layout.settings.notify.inapp")} desc={t("layout.settings.notify.inappDesc")}
          />
          <Toggle
            checked={prefs.push_enabled} disabled={disabled || (pushBlocked !== null && !prefs.push_enabled)}
            onChange={v => { void togglePush(v); }}
            label={t("layout.settings.notify.push")} desc={t("layout.settings.notify.pushDesc")}
          />
          {pushBlocked && (
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", paddingLeft: "22px" }}>
              {t(`layout.settings.notify.push.${pushBlocked}`)}
            </div>
          )}
          {prefs.push_enabled && !pushBlocked && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingLeft: "22px" }}>
              <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                {thisBrowserOn ? t("layout.settings.notify.push.thisBrowserOn") : t("layout.settings.notify.push.thisBrowserOff")}
              </span>
              {thisBrowserOn === false && (
                <button style={btnStyle} disabled={busy} onClick={() => void registerThisBrowser()}>
                  {t("layout.settings.notify.push.registerThisBrowser")}
                </button>
              )}
              <button style={btnStyle} disabled={testing || !thisBrowserOn || permission !== "granted"} onClick={() => void runTest()}>
                {testing ? t("layout.settings.notify.testing") : t("layout.settings.notify.test")}
              </button>
            </div>
          )}
        </div>
      </Row>

      <Row label={t("layout.settings.notify.kinds")} hint={t("layout.settings.notify.kindsHint")}>
        <table style={{ borderCollapse: "collapse", fontSize: "12px", width: "100%", maxWidth: "520px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600, color: "var(--color-text-secondary)" }}>{t("layout.settings.notify.kindColumn")}</th>
              {NOTIFICATION_CHANNELS.map(ch => (
                <th key={ch} style={{ padding: "4px 6px", fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                  {t(ch === "inapp" ? "layout.settings.notify.inapp" : "layout.settings.notify.push")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleKinds.map(kind => {
              const id = kind.id as NotificationKindId;
              const isAdminKind = kind.audience === "super_admin";
              return (
                <tr key={kind.id} style={{
                  borderTop: "1px solid var(--color-border-primary)",
                  background: isAdminKind ? "var(--color-bg-purple)" : undefined,
                }}>
                  <td style={{ padding: "6px", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {NOTIFICATION_KIND_ICON[id]} {t(`layout.notifyKind.${kind.id}.label`)}
                      {isAdminKind && (
                        <span style={{
                          marginLeft: "6px", fontSize: "10px", padding: "0 6px", borderRadius: "99px", fontWeight: 500,
                          background: "var(--color-bg-primary)", color: "var(--color-text-purple)", border: "1px solid var(--color-border-purple)",
                        }}>{ADMIN_NOTICE_ICON} {t("layout.bell.adminBadge")}</span>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{t(`layout.notifyKind.${kind.id}.desc`)}</div>
                  </td>
                  {NOTIFICATION_CHANNELS.map(ch => (
                    <td key={ch} style={{ padding: "6px", textAlign: "center", verticalAlign: "top" }}>
                      {kind.supported[ch] ? (
                        <input
                          type="checkbox"
                          aria-label={`${t(`layout.notifyKind.${kind.id}.label`)}：${t(ch === "inapp" ? "layout.settings.notify.inapp" : "layout.settings.notify.push")}`}
                          checked={kindChannelSetting(prefs, kind.id, ch)}
                          disabled={disabled || !channelMasterOn(ch)}
                          title={channelMasterOn(ch) ? undefined : t("layout.settings.notify.channelOff")}
                          onChange={e => setKindChannel(kind.id, ch, e.target.checked)}
                        />
                      ) : (
                        <span title={t("layout.settings.notify.unsupported")} style={{ color: "var(--color-text-tertiary)" }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Row>

      <Row label={t("layout.settings.notify.time")} hint={t("layout.settings.notify.timeHint")}>
        <select
          value={prefs.reminder_time} disabled={disabled}
          aria-label={t("layout.settings.notify.time")}
          onChange={e => { void save({ reminder_time: e.target.value }); }}
          style={{ ...inputStyle, width: "auto" }}
        >
          {REMINDER_TIME_OPTIONS.map(o => <option key={o} value={o}>{formatReminderTime(o)}</option>)}
        </select>
      </Row>

      <Row label={t("layout.settings.notify.permission")}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{
            fontSize: "11px", padding: "2px 10px", borderRadius: "99px",
            background: `var(--color-bg-${permTone})`, color: `var(--color-text-${permTone})`,
            border: `1px solid var(--color-border-${permTone})`,
          }}>{t(`layout.settings.notify.perm.${permission}`)}</span>
          {permission === "default" && !pushBlocked && (
            <button style={btnStyle} onClick={() => void requestPermission()}>{t("layout.settings.notify.requestPermission")}</button>
          )}
        </div>
        {permission === "denied" && (
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "6px", lineHeight: 1.7 }}>
            {t("layout.settings.notify.deniedHint")}
          </div>
        )}
      </Row>

      <Row label={t("layout.settings.notify.troubleHeading")}>
        <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.9 }}>
          <li>{t("layout.settings.notify.trouble1")}</li>
          <li>{t("layout.settings.notify.trouble2")}</li>
          <li>{t("layout.settings.notify.trouble3")}</li>
          <li>{t("layout.settings.notify.trouble4")}</li>
          <li>{t("layout.settings.notify.trouble5")}</li>
        </ol>
      </Row>
    </SectionBody>
  );
}
