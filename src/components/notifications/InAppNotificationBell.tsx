// src/components/notifications/InAppNotificationBell.tsx
//
// アプリ内通知のベル（v3.128・v3.129で右上の常設ボタンに変更）。白い丸ボタン＋未読数の赤バッジ（100以上は 99+）。
// 置き場所は呼び出し側（MainLayout）が決める：PC は画面右上に固定、モバイルはヘッダーの右端。
// 取得はマウント時・タブが前面に戻ったとき・パネルを開いたとき・push 受信時・3分おき（Realtime は使わない）。
// パネルはトリガー追従のポップオーバーなので useFloatingPanel に乗せる（Section 51）。
// 管理者向け（super_admin だけが受け取る種類）は 🛡 の印と紫の配色で見分け、super_admin には「すべて／管理者向け」の切替を出す。
// v3.131：管理者からのお知らせ（admin_message／送信者へのまとめ admin_message_ack）は 📣 の印とオレンジ（warning）の配色。
// 確認ボタンありで未確認のお知らせは一覧の上に「未確認の指示」として固定表示し、行から直接「確認しました」を押せる。

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";
import { formatErrorForUser } from "../../lib/errorMessage";
import {
  countUnreadInAppNotifications, fetchInAppNotifications, markInAppNotificationsRead, type InAppNotification,
} from "../../lib/supabase/notificationStore";
import { isPushReceivedMessage } from "../../lib/push/swMessage";
import {
  ADMIN_MESSAGE_ICON, ADMIN_NOTICE_ICON, ADMIN_IN_APP_KINDS, audienceOfInAppKind, formatBadgeCount, isAdminMessageKind,
} from "../../lib/notifications/notificationKinds";
import {
  acknowledgeAdminMessage, fetchPendingAckMessages, fetchReceivedAdminMessages, type ReceivedAdminMessage,
} from "../../lib/supabase/adminMessageStore";
import { DueChip } from "./AdminMessageDialog";

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
  /** 管理者からのお知らせの詳細を開く（v3.131） */
  onOpenMessage: (messageId: number) => void;
  /** 外から未読数の取り直しを求める値（お知らせの詳細で既読・確認したとき MainLayout が増やす） */
  refreshKey?: number;
  /** ボタンの直径（PC 36・モバイル 32） */
  size: number;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InAppNotificationBell({ memberId, isSuperAdmin, onOpenLink, onOpenSettings, onOpenMessage, refreshKey, size }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<ReceivedAdminMessage[]>([]);
  const [received, setReceived] = useState<Map<number, ReceivedAdminMessage>>(new Map());
  const [ackBusy, setAckBusy] = useState<number | null>(null);
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
      const list = await fetchInAppNotifications(memberId, activeFilter === "admin" ? { kinds: ADMIN_IN_APP_KINDS } : {});
      setItems(list);
      setError(null);
      // お知らせの確認ボタン・期限の表示に使う（失敗しても一覧は出す）
      const ids = [...new Set(list.filter(n => n.kind === "admin_message" && n.message_id).map(n => Number(n.message_id)))];
      const [rec, pend] = await Promise.all([
        fetchReceivedAdminMessages(memberId, ids).catch(e => { console.warn("[InAppNotificationBell] お知らせの取得に失敗:", e); return []; }),
        activeFilter === "all"
          ? fetchPendingAckMessages(memberId).catch(e => { console.warn("[InAppNotificationBell] 未確認の指示の取得に失敗:", e); return []; })
          : Promise.resolve([]),
      ]);
      setReceived(new Map(rec.map(r => [r.message_id, r])));
      setPinned(pend);
    } catch (e) {
      setError(formatErrorForUser(t("layout.bell.loadFailed"), e));
      setItems([]);
    }
  }, [memberId, activeFilter, t]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount, refreshKey]);

  useEffect(() => {
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
    setOpen(false);
    // お知らせは詳細の画面が開いたときに既読にする（mark_admin_message_read が宛先行とベルの行を両方既読にする）
    if (n.kind === "admin_message" && n.message_id) {
      onOpenMessage(Number(n.message_id));
      return;
    }
    if (!n.read_at) void markRead([n.id]);
    onOpenLink(n.url);
  };

  const ack = async (messageId: number) => {
    if (ackBusy !== null) return;
    setAckBusy(messageId);
    try {
      await acknowledgeAdminMessage(messageId);
      await refreshList();
      void refreshCount();
    } catch (e) {
      setError(formatErrorForUser(t("layout.adminMessage.ackFailed"), e));
    } finally {
      setAckBusy(null);
    }
  };

  const ackButton = (messageId: number) => (
    <button
      type="button"
      disabled={ackBusy !== null}
      onClick={() => void ack(messageId)}
      style={{
        fontSize: "11px", fontWeight: 600, padding: "2px 10px", borderRadius: "99px", cursor: ackBusy !== null ? "default" : "pointer",
        background: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "1px solid var(--color-border-warning)",
        flexShrink: 0,
      }}
    >{ackBusy === messageId ? "…" : t("layout.bell.ack")}</button>
  );

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
            {pinned.length > 0 && (
              <div style={{ borderBottom: "2px solid var(--color-border-warning)", background: "var(--color-bg-warning)" }}>
                <div style={{ padding: "6px 10px 2px", fontSize: "11px", fontWeight: 700, color: "var(--color-text-warning)" }}>
                  {ADMIN_MESSAGE_ICON} {t("layout.bell.pinnedHeading")}（{pinned.length}）
                </div>
                {pinned.map(m => (
                  <div key={m.message_id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px 6px" }}>
                    <button type="button" onClick={() => { setOpen(false); onOpenMessage(m.message_id); }} style={{
                      flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0,
                    }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</div>
                      {m.due_date && <DueChip dueDate={m.due_date} acknowledged={false} />}
                    </button>
                    {ackButton(m.message_id)}
                  </div>
                ))}
              </div>
            )}
            {items?.map(n => {
              const isAdmin = audienceOfInAppKind(n.kind) === "super_admin";
              const isMessage = isAdminMessageKind(n.kind);
              const rec = n.kind === "admin_message" && n.message_id ? received.get(Number(n.message_id)) : undefined;
              const accentBorder = isAdmin ? "var(--color-border-purple)" : isMessage ? "var(--color-border-warning)" : "transparent";
              const unreadBg = isAdmin ? "var(--color-bg-purple)" : isMessage ? "var(--color-bg-warning)" : "var(--color-bg-info)";
              const dotColor = isAdmin ? "var(--color-text-purple)" : isMessage ? "var(--color-text-warning)" : "var(--color-text-info)";
              return (
                <div key={n.id} style={{
                  borderBottom: "1px solid var(--color-border-primary)", borderLeft: `3px solid ${accentBorder}`,
                  background: n.read_at ? "transparent" : unreadBg,
                }}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "8px 10px", cursor: "pointer",
                      border: "none", background: "transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {!n.read_at && <span aria-hidden style={{ width: "6px", height: "6px", borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", flex: 1 }}>{n.title}</span>
                      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>{formatWhen(n.created_at)}</span>
                    </div>
                    {isAdmin && (
                      <span style={{
                        display: "inline-block", marginTop: "3px", fontSize: "10px", padding: "0 6px", borderRadius: "99px",
                        background: "var(--color-bg-purple)", color: "var(--color-text-purple)", border: "1px solid var(--color-border-purple)",
                      }}>{ADMIN_NOTICE_ICON} {t("layout.bell.adminBadge")}</span>
                    )}
                    {isMessage && (
                      <span style={{ display: "inline-flex", gap: "4px", alignItems: "center", marginTop: "3px", flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: "10px", padding: "0 6px", borderRadius: "99px",
                          background: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "1px solid var(--color-border-warning)",
                        }}>{ADMIN_MESSAGE_ICON} {t("layout.bell.messageBadge")}</span>
                        {rec?.due_date && <DueChip dueDate={rec.due_date} acknowledged={rec.acknowledged_at !== null} />}
                      </span>
                    )}
                    <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px", lineHeight: 1.6, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{n.body}</div>
                  </button>
                  {rec?.requires_ack && (
                    <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 10px 8px" }}>
                      {rec.acknowledged_at
                        ? <span style={{ fontSize: "11px", color: "var(--color-text-success)" }}>✓ {t("layout.bell.acked")}</span>
                        : ackButton(rec.message_id)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
