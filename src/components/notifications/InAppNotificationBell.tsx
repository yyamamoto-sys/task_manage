// src/components/notifications/InAppNotificationBell.tsx
//
// アプリ内通知のベル（v3.128・設計書 §5.3）。未読件数のバッジと、直近30件のパネル。
// 取得はマウント時・タブが前面に戻ったとき・パネルを開いたとき（1日1回しか増えないため Realtime は使わない）。
// パネルはトリガー追従のポップオーバーなので useFloatingPanel に乗せる（Section 51）。

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";
import { formatErrorForUser } from "../../lib/errorMessage";
import {
  countUnreadInAppNotifications, fetchInAppNotifications, markInAppNotificationsRead, type InAppNotification,
} from "../../lib/supabase/notificationStore";
import { isPushReceivedMessage } from "../../lib/push/swMessage";

// タブを開いたままでも未読数が追従するよう、postMessageを取りこぼした場合の保険として
// この間隔でも再取得する（負荷は小さい＝1日1回しか増えないカウントのGETのみ）
const FALLBACK_REFRESH_MS = 3 * 60 * 1000;

interface Props {
  memberId: string;
  /** 行をクリックしたときの遷移（/?open=my-tasks 等）。アプリ内で画面を切り替える */
  onOpenLink: (url: string) => void;
  onOpenSettings: () => void;
  /** トリガーの見た目（サイドバー下部の行／モバイルヘッダー） */
  variant: "sidebar" | "header";
}

const PANEL_WIDTH = 300;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InAppNotificationBell({ memberId, onOpenLink, onOpenSettings, variant }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { panelStyle, scrollAreaStyle } = useFloatingPanel({
    open, onRequestClose: () => setOpen(false), triggerRef, panelRef,
    align: variant === "header" ? "right" : "left", width: PANEL_WIDTH, preferredMaxHeight: 420,
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
      setItems(await fetchInAppNotifications(memberId));
      setError(null);
    } catch (e) {
      setError(formatErrorForUser(t("layout.bell.loadFailed"), e));
      setItems([]);
    }
  }, [memberId, t]);

  useEffect(() => {
    void refreshCount();
    const onVisible = () => { if (document.visibilityState === "visible") void refreshCount(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCount]);

  // sw.js が push を受けたらこのタブへ知らせる（開いたままでも未読バッジが追従する）。
  // 取りこぼし（SW未制御・メッセージ到達前のタイミング等）に備えて定期再取得も保険で持つ。
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
    if (open) void refreshList();
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

  const triggerStyle: CSSProperties = variant === "header" ? {
    position: "relative", width: "32px", height: "32px", borderRadius: "var(--radius-md)",
    background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
    cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  } : {
    position: "relative", background: "transparent", border: "none", cursor: "pointer",
    padding: "2px 4px", fontSize: "13px", lineHeight: 1, flexShrink: 0,
    color: open ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
  };

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
        style={triggerStyle}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: "absolute", top: "-3px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px",
            borderRadius: "99px", background: "var(--color-text-danger)", color: "#fff",
            fontSize: "9px", fontWeight: 700, lineHeight: "15px", textAlign: "center", boxSizing: "border-box",
          }}>{unread > 99 ? "99+" : unread}</span>
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
          <div style={{ ...scrollAreaStyle, flex: 1, minHeight: 0 }}>
            {error && <div role="alert" style={{ padding: "8px 10px", fontSize: "11px", color: "var(--color-text-danger)" }}>{error}</div>}
            {items === null && <div style={{ padding: "12px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>…</div>}
            {items !== null && items.length === 0 && !error && (
              <div style={{ padding: "12px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>{t("layout.bell.empty")}</div>
            )}
            {items?.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "8px 10px", cursor: "pointer",
                  border: "none", borderBottom: "1px solid var(--color-border-primary)",
                  background: n.read_at ? "transparent" : "var(--color-bg-info)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {!n.read_at && <span aria-hidden style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--color-text-info)", flexShrink: 0 }} />}
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", flex: 1 }}>{n.title}</span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>{formatWhen(n.created_at)}</span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px", lineHeight: 1.6, wordBreak: "break-word" }}>{n.body}</div>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
