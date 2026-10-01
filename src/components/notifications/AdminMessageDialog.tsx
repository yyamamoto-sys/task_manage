// src/components/notifications/AdminMessageDialog.tsx
//
// 管理者からのお知らせの詳細（v3.131・CLAUDE.md Section 68）。ベルの行・Windows通知のクリック
// （/?open=admin-message&mid=…）から MainLayout が開く。開いたら既読にし、確認ボタンありなら
// 「確認しました」を押せる。本文はプレーンテキスト（HTML として解釈しない。http(s) の URL だけリンクにする）。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { formatErrorForUser } from "../../lib/errorMessage";
import { linkifyPlainText } from "../../lib/adminMessages/linkify";
import { daysUntil, formatDueShort, todayJst } from "../../lib/adminMessages/adminMessages";
import { ADMIN_MESSAGE_ICON } from "../../lib/notifications/notificationKinds";
import {
  acknowledgeAdminMessage, fetchReceivedAdminMessages, markAdminMessageRead, type ReceivedAdminMessage,
} from "../../lib/supabase/adminMessageStore";
import { modalBoxStyle, modalOverlayStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";

export function AdminMessageBody({ text }: { text: string }) {
  return (
    <div style={{ fontSize: "13px", lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-primary)" }}>
      {linkifyPlainText(text).map((seg, i) => seg.type === "link"
        ? <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-info)" }}>{seg.text}</a>
        : <span key={i}>{seg.text}</span>)}
    </div>
  );
}

export function DueChip({ dueDate, acknowledged }: { dueDate: string; acknowledged: boolean }) {
  const t = useT();
  const left = daysUntil(dueDate, todayJst());
  const tone = acknowledged ? "secondary" : left < 0 ? "danger" : left <= 1 ? "warning" : "info";
  const label = left < 0 ? t("layout.adminMessage.dueOver") : left === 0 ? t("layout.adminMessage.dueToday") : t("layout.adminMessage.dueIn", { n: left });
  return (
    <span style={{
      display: "inline-block", fontSize: "10px", padding: "0 6px", borderRadius: "99px", whiteSpace: "nowrap",
      background: tone === "secondary" ? "var(--color-bg-secondary)" : `var(--color-bg-${tone})`,
      color: tone === "secondary" ? "var(--color-text-secondary)" : `var(--color-text-${tone})`,
      border: `1px solid ${tone === "secondary" ? "var(--color-border-primary)" : `var(--color-border-${tone})`}`,
    }}>{t("layout.adminMessage.due", { date: formatDueShort(dueDate) })}{acknowledged ? "" : `（${label}）`}</span>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  memberId: string;
  messageId: number;
  onClose: () => void;
  /** 既読・確認で状態が変わったとき（ベルの未読数を取り直す） */
  onChanged?: () => void;
}

export function AdminMessageDialog({ memberId, messageId, onClose, onChanged }: Props) {
  const t = useT();
  const [msg, setMsg] = useState<ReceivedAdminMessage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMsg(undefined);
    fetchReceivedAdminMessages(memberId, [messageId])
      .then(async rows => {
        if (cancelled) return;
        const m = rows[0] ?? null;
        setMsg(m);
        if (m && !m.read_at) {
          await markAdminMessageRead(messageId);
          if (!cancelled) onChanged?.();
        }
      })
      .catch(e => { if (!cancelled) { setError(formatErrorForUser(t("layout.adminMessage.loadFailed"), e)); setMsg(null); } });
    return () => { cancelled = true; };
    // onChanged は呼び出し側で毎回作られるため依存に入れない（開いたときに1回だけ既読にする）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, messageId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ack = async () => {
    if (!msg || busy) return;
    setBusy(true);
    try {
      const at = await acknowledgeAdminMessage(msg.message_id);
      setMsg({ ...msg, acknowledged_at: at, read_at: msg.read_at ?? at });
      onChanged?.();
    } catch (e) {
      setError(formatErrorForUser(t("layout.adminMessage.ackFailed"), e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div style={{ ...modalOverlayStyle(600), background: "rgba(0,0,0,0.45)", pointerEvents: "auto" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={msg?.subject ?? t("layout.adminMessage.title")}
        style={{
          ...modalBoxStyle("min(560px, 100%)"), background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", borderTop: "4px solid var(--color-border-warning)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "14px 16px 10px", flexShrink: 0 }}>
          <span aria-hidden style={{ fontSize: "18px" }}>{ADMIN_MESSAGE_ICON}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-warning)", fontWeight: 600 }}>{t("layout.adminMessage.title")}</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", wordBreak: "break-word" }}>
              {msg?.subject ?? (msg === undefined ? "…" : "")}
            </div>
            {msg && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "4px", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                <span>{t("layout.adminMessage.from", { name: msg.sender_name })}</span>
                <span>{formatWhen(msg.created_at)}</span>
                {msg.due_date && <DueChip dueDate={msg.due_date} acknowledged={msg.acknowledged_at !== null} />}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t("layout.adminMessage.close")}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--color-text-tertiary)", padding: "2px", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ ...MODAL_BODY_STYLE, padding: "4px 16px 14px" }}>
          {error && <div role="alert" style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{error}</div>}
          {msg === null && !error && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>{t("layout.adminMessage.notFound")}</div>}
          {msg && <AdminMessageBody text={msg.body} />}
        </div>
        {msg?.requires_ack && (
          <div style={{
            ...MODAL_FOOTER_STYLE, display: "flex", alignItems: "center", gap: "10px", justifyContent: "flex-end",
            padding: "10px 16px", borderTop: "1px solid var(--color-border-primary)",
          }}>
            {msg.acknowledged_at ? (
              <span style={{ fontSize: "12px", color: "var(--color-text-success)" }}>
                ✓ {t("layout.adminMessage.acked", { when: formatWhen(msg.acknowledged_at) })}
              </span>
            ) : (
              <button type="button" disabled={busy} onClick={() => void ack()} style={{
                fontSize: "13px", fontWeight: 600, padding: "6px 16px", borderRadius: "var(--radius-md)", cursor: busy ? "default" : "pointer",
                background: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "1px solid var(--color-border-warning)",
              }}>{busy ? "…" : t("layout.adminMessage.ack")}</button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
