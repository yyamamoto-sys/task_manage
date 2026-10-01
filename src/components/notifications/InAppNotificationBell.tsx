// src/components/notifications/InAppNotificationBell.tsx
//
// アプリ内通知のベル（v3.128・v3.129で右上の常設ボタンに変更）。白い丸ボタン＋未読数の赤バッジ（100以上は 99+）。
// 置き場所は呼び出し側（MainLayout）が決める：PC は画面右上に固定、モバイルはヘッダーの右端。
// 取得はマウント時・タブが前面に戻ったとき・パネルを開いたとき・push 受信時・3分おき（Realtime は使わない）。
// パネルはトリガー追従のポップオーバーなので useFloatingPanel に乗せる（Section 51）。
// 管理者向け（super_admin だけが受け取る種類）は 🛡 の印と紫の配色で見分け、super_admin には「すべて／管理者向け」の切替を出す。

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";
import { formatErrorForUser } from "../../lib/errorMessage";
import {
  countUnreadInAppNotifications, fetchInAppNotifications, markInAppNotificationsRead, type InAppNotification,
} from "../../lib/supabase/notificationStore";
import { isPushReceivedMessage } from "../../lib/push/swMessage";
import { ADMIN_NOTICE_ICON, ADMIN_IN_APP_KINDS, audienceOfInAppKind, formatBadgeCount } from "../../lib/notifications/notificationKinds";

// タブを開いたままでも未読数が追従するよう、postMessageを取りこぼした場合の保険としてこの間隔でも再取得する
const FALLBACK_REFRESH_MS = 3 * 60 * 1000;
const PANEL_WIDTH = 320;

type Filter = "all" | "admin";

interface Props {
  memberId: string;
  isSuperAdmin: boolean;
  /** 行をクリックしたときの遷移（/?open=my-tasks 等）。アプリ内で画面を切り替える */
  onOpenLink: (url: string) => void;
  onOpenSettings: () => void;
  /** ボタンの直径（PC 36・モバイル 32） */
  size: number;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InAppNotificationBell({ memberId, isSuperAdmin, onOpenLink, onOpenSettings, size }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeFilter: Filter = isSuperAdmin ? filter : "all";

  const { panelStyle, scrollAreaStyle } = useFloatingPanel({
    open, onRequestClose: () => setOpen(false), triggerRef, panelRef,
    align: "right", width: PANEL_WIDTH, preferredMaxHeight: 460,
  });

  const refreshCount = useCallback(async () => {
    try {
      setUnread(await countUnreadInAppNotifications(memberId));
    } catch (e) {
      // 未適用環境・通信失敗ではバッジを出さないだけにする（画面は壊さない）
      console.warn("[InAppNotificationBell] 未読件数の取得に失敗:", e);
    }
  }, [memberId]);

  const refreshList = useCallback(async () => {
    try {
      setItems(await fetchInAppNotifications(memberId, activeFilter === "admin" ? { kinds: ADMIN_IN_APP_KINDS } : {}));
      setError(null);
    } catch (e) {
      setError(formatErrorForUser(t("layout.bell.loadFailed"), e));
      setItems([]);
    }
  }, [memberId, activeFilter, t]);

  useEffect(() => {
    void refreshCount();
    const onVisible = () => { if (document.visibilityState === "visible") void refreshCount(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCount]);

  useEffect(() => {
    const onSwMessage = (e: MessageEvent) => { if (isPushReceivedMessage(e.data)) void refreshCount(); };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    const interval = setInterval(() => void refreshCount(), FALLBACK_REFRESH_MS);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
      clearInterval(interval);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    void refreshList();
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (ids: number[] | null) => {
    try {
      await markInAppNotificationsRead(ids);
      const now = new Date().toISOString();
      setItems(prev => prev?.map(n => (ids === null || ids.includes(n.id)) && !n.read_at ? { ...n, read_at: now } : n) ?? prev);
      void refreshCount();
    } catch (e) {
      setError(formatErrorForUser(t("layout.bell.loadFailed"), e));
    }
  };

  const openItem = (n: InAppNotification) => {
    if (!n.read_at) void markRead([n.id]);
    setOpen(false);
    onOpenLink(n.url);
  };

  const badge = formatBadgeCount(unread);
  const triggerStyle: CSSProperties = {
    position: "relative", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
    background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
    boxShadow: "var(--shadow-md)", cursor: "pointer", fontSize: `${Math.round(size * 0.45)}px`, lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
  };
  const tabBtn = (f: Filter, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeFilter === f}
      onClick={() => setFilter(f)}
      style={{
        fontSize: "11px", padding: "3px 10px", borderRadius: "99px", cursor: "pointer",
        border: `1px solid ${activeFilter === f ? (f === "admin" ? "var(--color-border-purple)" : "var(--color-border-info)") : "var(--color-border-primary)"}`,
        background: activeFilter === f ? (f === "admin" ? "var(--color-bg-purple)" : "var(--color-bg-info)") : "transparent",
        color: activeFilter === f ? (f === "admin" ? "var(--color-text-purple)" : "var(--color-text-info)") : "var(--color-text-secondary)",
        fontWeight: activeFilter === f ? 600 : 400,
      }}
    >{label}</button>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("layout.bell.aria", { n: unread })}
        title={t("layout.bell.aria", { n: unread })}
        data-tour-id="notification-bell"
        style={triggerStyle}
      >
        <span aria-hidden>🔔</span>
        {badge && (
          <span aria-hidden style={{
            position: "absolute", top: "-3px", right: "-3px", minWidth: "18px", height: "18px", padding: "0 5px",
            borderRadius: "99px", background: "#e5484d", color: "#fff", border: "2px solid var(--color-bg-primary)",
            fontSize: "10px", fontWeight: 700, lineHeight: "14px", textAlign: "center", boxSizing: "border-box",
          }}>{badge}</span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("layout.bell.title")}
          className="animate-dropdown"
          style={{
            ...panelStyle,
            display: "flex", flexDirection: "column",
            background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)",
            pointerEvents: "auto",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px",
            borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0,
          }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>{t("layout.bell.title")}</span>
            <button type="button" onClick={() => void markRead(null)} disabled={unread === 0}
              style={{ fontSize: "11px", background: "transparent", border: "none", cursor: unread === 0 ? "default" : "pointer", color: "var(--color-text-info)", opacity: unread === 0 ? 0.5 : 1, padding: 0 }}>
              {t("layout.bell.markAll")}
            </button>
            <button type="button" onClick={() => { setOpen(false); onOpenSettings(); }}
              style={{ fontSize: "11px", background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: 0 }}>
              {t("layout.bell.settings")}
            </button>
          </div>
          {isSuperAdmin && (
            <div role="tablist" style={{ display: "flex", gap: "6px", padding: "6px 10px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
              {tabBtn("all", t("layout.bell.filterAll"))}
              {tabBtn("admin", `${ADMIN_NOTICE_ICON} ${t("layout.bell.filterAdmin")}`)}
            </div>
          )}
          <div style={{ ...scrollAreaStyle, flex: 1, minHeight: 0 }}>
            {error && <div role="alert" style={{ padding: "8px 10px", fontSize: "11px", color: "var(--color-text-danger)" }}>{error}</div>}
            {items === null && <div style={{ padding: "12px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>…</div>}
            {items !== null && items.length === 0 && !error && (
              <div style={{ padding: "12px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                {activeFilter === "admin" ? t("layout.bell.emptyAdmin") : t("layout.bell.empty")}
              </div>
            )}
            {items?.map(n => {
              const isAdmin = audienceOfInAppKind(n.kind) === "super_admin";
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 10px", cursor: "pointer",
                    border: "none", borderBottom: "1px solid var(--color-border-primary)",
                    borderLeft: `3px solid ${isAdmin ? "var(--color-border-purple)" : "transparent"}`,
                    background: n.read_at ? "transparent" : (isAdmin ? "var(--color-bg-purple)" : "var(--color-bg-info)"),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {!n.read_at && <span aria-hidden style={{ width: "6px", height: "6px", borderRadius: "50%", background: isAdmin ? "var(--color-text-purple)" : "var(--color-text-info)", flexShrink: 0 }} />}
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", flex: 1 }}>{n.title}</span>
                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>{formatWhen(n.created_at)}</span>
                  </div>
                  {isAdmin && (
                    <span style={{
                      display: "inline-block", marginTop: "3px", fontSize: "10px", padding: "0 6px", borderRadius: "99px",
                      background: "var(--color-bg-purple)", color: "var(--color-text-purple)", border: "1px solid var(--color-border-purple)",
                    }}>{ADMIN_NOTICE_ICON} {t("layout.bell.adminBadge")}</span>
                  )}
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px", lineHeight: 1.6, wordBreak: "break-word" }}>{n.body}</div>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
