// src/components/admin/AdminMessageSection.tsx
//
// 設定 → 部署の管理 →「📣 お知らせを送る」（v3.131・CLAUDE.md Section 68）。部署の管理者と super_admin に出す。
// 送信（件名・本文・宛先・確認ボタン・期限 → プレビュー → 確認ダイアログ → 送信）と送信履歴（宛先ごとの既読・確認）。
// 🔴 宛先の範囲は DB（send_admin_message）が強制する。ここで選べる宛先も DB の admin_message_candidates が返す範囲だけ。
// 送信後に Windows通知の即時送信（push-reminders の mode=admin_message）を呼ぶ。失敗しても cron が代わりに送る。

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Member } from "../../lib/localData/types";
import { useAppStore } from "../../stores/appStore";
import { formatErrorForUser } from "../../lib/errorMessage";
import { confirmDialog } from "../../lib/dialog";
import { showToast } from "../common/Toast";
import { Card } from "../common/Card";
import { ghostBtnStyle, inputStyle, primaryBtnStyle } from "./adminStyles";
import { AdminMessageBody, DueChip } from "../notifications/AdminMessageDialog";
import {
  ADMIN_MESSAGE_BODY_MAX, ADMIN_MESSAGE_MAX_SELECTED, ADMIN_MESSAGE_PER_DAY, ADMIN_MESSAGE_PER_HOUR, ADMIN_MESSAGE_SUBJECT_MAX,
  resolveRecipients, todayJst, validateDraft, type AdminMessageTarget,
} from "../../lib/adminMessages/adminMessages";
import {
  dispatchAdminMessagePush, fetchAdminMessageCandidates, fetchAdminMessageStatus, listSentAdminMessages, sendAdminMessage,
  type AdminMessageCandidate, type AdminMessageRecipientStatus, type SentAdminMessage,
} from "../../lib/supabase/adminMessageStore";

type TargetMode = "all" | "group" | "members";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const labelStyle: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px", display: "block" };
const hintStyle: React.CSSProperties = { fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6 };

export function AdminMessageSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange: (dirty: boolean) => void }) {
  const isSuperAdmin = currentUser.is_super_admin === true;
  const canSend = isSuperAdmin || currentUser.is_admin === true;
  const groups = useAppStore(s => s.groups);
  const groupName = useMemo(() => new Map(groups.map(g => [g.id, g.name])), [groups]);

  const [candidates, setCandidates] = useState<AdminMessageCandidate[] | null>(null);
  const [candError, setCandError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<TargetMode>(isSuperAdmin ? "all" : "group");
  const [groupId, setGroupId] = useState<string>(currentUser.group_id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);

  const [sent, setSent] = useState<SentAdminMessage[] | null>(null);
  const [sentError, setSentError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [status, setStatus] = useState<AdminMessageRecipientStatus[] | null>(null);

  useEffect(() => { onDirtyChange(subject.trim() !== "" || body.trim() !== ""); }, [subject, body, onDirtyChange]);

  useEffect(() => {
    if (!canSend) return;
    fetchAdminMessageCandidates()
      .then(c => { setCandidates(c); setCandError(null); })
      .catch(e => { setCandidates([]); setCandError(formatErrorForUser("宛先を読み込めませんでした（データベースへの適用がまだの可能性があります）", e)); });
  }, [canSend]);

  const reloadSent = useCallback(async () => {
    try {
      setSent(await listSentAdminMessages());
      setSentError(null);
    } catch (e) {
      setSent([]);
      setSentError(formatErrorForUser("送信履歴を読み込めませんでした", e));
    }
  }, []);
  useEffect(() => { if (canSend) void reloadSent(); }, [canSend, reloadSent]);

  useEffect(() => {
    if (openId === null) { setStatus(null); return; }
    let cancelled = false;
    setStatus(null);
    fetchAdminMessageStatus(openId)
      .then(r => { if (!cancelled) setStatus(r); })
      .catch(e => { if (!cancelled) { console.warn("[AdminMessageSection] 宛先の状況の取得に失敗:", e); setStatus([]); } });
    return () => { cancelled = true; };
  }, [openId]);

  const candidateGroups = useMemo(() => {
    const ids = new Set<string>();
    for (const c of candidates ?? []) {
      if (c.group_id) ids.add(c.group_id);
      for (const g of c.group_ids ?? []) ids.add(g);
    }
    return [...ids].map(id => ({ id, name: groupName.get(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [candidates, groupName]);

  const homeGroupId = currentUser.group_id ?? null;
  const target = useMemo((): AdminMessageTarget => mode === "all" ? { kind: "all" }
    : mode === "group" ? { kind: "group", groupId: isSuperAdmin ? groupId : (homeGroupId ?? "") }
    : { kind: "members", memberIds: [...selected] }, [mode, groupId, selected, isSuperAdmin, homeGroupId]);
  const scope = useMemo(() => resolveRecipients(
    { id: currentUser.id, isSuperAdmin, isAdmin: currentUser.is_admin === true, homeGroupId },
    target,
    (candidates ?? []).map(c => ({ id: c.member_id, group_id: c.group_id, group_ids: c.group_ids })),
  ), [candidates, target, isSuperAdmin, currentUser.id, currentUser.is_admin, homeGroupId]);
  const draftError = validateDraft({ subject, body, requiresAck, dueDate: requiresAck && dueDate ? dueDate : null }, todayJst());
  const nameById = useMemo(() => new Map((candidates ?? []).map(c => [c.member_id, c.display_name + (c.member_id === currentUser.id ? "（自分）" : "")])), [candidates, currentUser.id]);

  const visibleCandidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (candidates ?? []).filter(c => !q || c.display_name.toLowerCase().includes(q) || (c.group_name ?? "").toLowerCase().includes(q));
  }, [candidates, filter]);

  const toggleMember = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const targetSummary = (): string => {
    if (mode === "all") return "全員";
    if (mode === "group") return `部署：${groupName.get(target.kind === "group" ? target.groupId : "") ?? "（未選択）"}の全員`;
    return "選んだメンバー";
  };

  const send = async () => {
    if (sending || draftError || !scope.ok) return;
    const ok = await confirmDialog(
      `「${subject.trim()}」を${targetSummary()}（${scope.recipientIds.length}人）に送ります。\n送信後は取り消せません。送信しますか？`,
      { tone: "neutral", confirmLabel: "送信する" },
    );
    if (!ok) return;
    setSending(true);
    try {
      const r = await sendAdminMessage({ subject, body, target, requiresAck, dueDate: requiresAck && dueDate ? dueDate : null });
      showToast(`お知らせを${r.recipientCount}人に送りました`, "success");
      try {
        await dispatchAdminMessagePush(r.messageId);
      } catch (e) {
        // アプリ内には届いている。Windows通知は次の定期実行（平日30分ごと）が代わりに送る
        console.warn("[AdminMessageSection] Windows通知の即時送信に失敗:", e);
      }
      setSubject(""); setBody(""); setSelected(new Set()); setRequiresAck(false); setDueDate(""); setPreview(false);
      await reloadSent();
    } catch (e) {
      showToast(formatErrorForUser("お知らせを送れませんでした", e), "error");
    } finally {
      setSending(false);
    }
  };

  if (!canSend) {
    return <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>お知らせを送れるのは部署の管理者と全社スーパー管理者だけです。</div>;
  }

  const counter = (n: number, max: number) => (
    <span style={{ fontSize: "10px", color: n > max ? "var(--color-text-danger)" : "var(--color-text-tertiary)" }}>{n}/{max}</span>
  );
  const radio = (m: TargetMode, label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
      <input type="radio" name="admin-message-target" checked={mode === m} onChange={() => setMode(m)} />{label}
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "760px" }}>
      <Card title="📣 お知らせを送る">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={hintStyle}>
            {isSuperAdmin ? "全員・部署・個人を選んで送れます。" : "自分の部署（ホーム部署）のメンバーに送れます。"}
            受け取った人のベル（右上）に必ず届き、Windows通知をオンにしている人には Windows にも届きます。
            1時間に{ADMIN_MESSAGE_PER_HOUR}通・1日{ADMIN_MESSAGE_PER_DAY}通まで。
            「全員」「部署全員」を選ぶと自分も宛先に含まれます（候補一覧では自分に「（自分）」と表示されます）。
          </div>
          {candError && <div role="alert" style={{ fontSize: "12px", color: "var(--color-text-danger)" }}>{candError}</div>}

          <div>
            <label style={labelStyle} htmlFor="admin-message-subject">件名 {counter([...subject.trim()].length, ADMIN_MESSAGE_SUBJECT_MAX)}</label>
            <input id="admin-message-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={ADMIN_MESSAGE_SUBJECT_MAX}
              placeholder="例：アップデートを実施しました" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="admin-message-body">本文 {counter([...body.trim()].length, ADMIN_MESSAGE_BODY_MAX)}</label>
            <textarea id="admin-message-body" value={body} onChange={e => setBody(e.target.value)} rows={6} maxLength={ADMIN_MESSAGE_BODY_MAX}
              placeholder="例：Ctrl+Shift+R でスーパーリロードを行い、更新を適用してください。"
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
            <div style={hintStyle}>文字だけのお知らせです（太字などの装飾は使えません）。http:// か https:// で始まるURLはリンクになります。</div>
          </div>

          <div>
            <span style={labelStyle}>宛先</span>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "6px" }}>
              {isSuperAdmin && radio("all", "全員")}
              {radio("group", isSuperAdmin ? "部署を指定" : "部署の全員")}
              {radio("members", "メンバーを選ぶ")}
            </div>
            {mode === "group" && isSuperAdmin && (
              <select value={groupId} onChange={e => setGroupId(e.target.value)} style={{ ...inputStyle, width: "auto" }} aria-label="部署">
                <option value="">部署を選んでください</option>
                {candidateGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            {mode === "members" && (
              <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "6px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                  <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="名前・部署で絞り込み" style={{ ...inputStyle, flex: 1 }} aria-label="宛先の絞り込み" />
                  <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{selected.size}人選択（{ADMIN_MESSAGE_MAX_SELECTED}人まで）</span>
                  <button type="button" style={ghostBtnStyle} onClick={() => setSelected(new Set(visibleCandidates.map(c => c.member_id).slice(0, ADMIN_MESSAGE_MAX_SELECTED)))}>表示中を全選択</button>
                  <button type="button" style={ghostBtnStyle} onClick={() => setSelected(new Set())}>解除</button>
                </div>
                <div style={{ maxHeight: "200px", overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "2px 10px" }}>
                  {visibleCandidates.map(c => (
                    <label key={c.member_id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                      <input type="checkbox" checked={selected.has(c.member_id)} onChange={() => toggleMember(c.member_id)} />
                      <span>{c.display_name}{c.member_id === currentUser.id && "（自分）"}</span>
                      {isSuperAdmin && c.group_name && <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{c.group_name}</span>}
                    </label>
                  ))}
                  {candidates !== null && visibleCandidates.length === 0 && <span style={hintStyle}>該当するメンバーがいません</span>}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
              <input type="checkbox" checked={requiresAck} onChange={e => { setRequiresAck(e.target.checked); if (!e.target.checked) setDueDate(""); }} />
              「確認しました」ボタンを付ける
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: requiresAck ? 1 : 0.5 }}>
              期限（任意）
              <input type="date" value={dueDate} min={todayJst()} disabled={!requiresAck} onChange={e => setDueDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
            </label>
          </div>
          {requiresAck && (
            <div style={hintStyle}>
              受け取った人が押すと、あなたのベルに「◯人が確認しました（残り◯人）」がまとめて届きます（お知らせごとに1件）。
              期限を付けると、期限の前の平日の朝に、まだ押していない人へ1回だけ再通知します。
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={ghostBtnStyle} onClick={() => setPreview(v => !v)} disabled={!subject.trim() && !body.trim()}>
              {preview ? "プレビューを閉じる" : "プレビュー"}
            </button>
            <button type="button" style={{ ...primaryBtnStyle, opacity: sending || draftError || !scope.ok ? 0.5 : 1 }}
              disabled={sending || draftError !== null || !scope.ok} onClick={() => void send()}>
              {sending ? "送信中…" : "送信する"}
            </button>
            <span style={{ fontSize: "11px", color: draftError || !scope.ok ? "var(--color-text-danger)" : "var(--color-text-secondary)" }}>
              {draftError ?? (scope.ok ? `宛先：${scope.recipientIds.length}人` : scope.reason)}
            </span>
          </div>

          {preview && (
            <div style={{ border: "1px solid var(--color-border-warning)", borderTop: "4px solid var(--color-border-warning)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-warning)", fontWeight: 600 }}>📣 管理者からのお知らせ（受け取る人にはこう見えます）</div>
              <div style={{ fontSize: "14px", fontWeight: 700, margin: "2px 0 4px", wordBreak: "break-word" }}>{subject.trim() || "（件名）"}</div>
              <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span>送信：{currentUser.display_name}</span>
                {requiresAck && dueDate && <DueChip dueDate={dueDate} acknowledged={false} />}
              </div>
              <AdminMessageBody text={body.trim() || "（本文）"} />
              {requiresAck && (
                <div style={{ marginTop: "8px", textAlign: "right" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "var(--radius-md)", background: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "1px solid var(--color-border-warning)" }}>確認しました</span>
                </div>
              )}
              {scope.ok && (
                <div style={{ ...hintStyle, marginTop: "8px" }}>
                  宛先（{scope.recipientIds.length}人）：{scope.recipientIds.slice(0, 20).map(id => nameById.get(id) ?? id).join("、")}
                  {scope.recipientIds.length > 20 ? ` ほか${scope.recipientIds.length - 20}人` : ""}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title={isSuperAdmin ? "送信履歴（全員の送信分）" : "送信履歴（自分が送ったもの）"}>
        {sentError && <div role="alert" style={{ fontSize: "12px", color: "var(--color-text-danger)" }}>{sentError}</div>}
        {sent === null && <div style={hintStyle}>…</div>}
        {sent !== null && sent.length === 0 && !sentError && <div style={hintStyle}>まだ送ったお知らせはありません。</div>}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {sent?.map(m => (
            <div key={m.id} style={{ borderTop: "1px solid var(--color-border-primary)", padding: "8px 0" }}>
              <button type="button" onClick={() => setOpenId(openId === m.id ? null : m.id)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", flex: 1, minWidth: "160px" }}>{openId === m.id ? "▾" : "▸"} {m.subject}</span>
                  {m.due_date && <DueChip dueDate={m.due_date} acknowledged={m.ack_count >= m.recipient_count} />}
                  <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>既読 {m.read_count}/{m.recipient_count}</span>
                  {m.requires_ack && <span style={{ fontSize: "11px", color: m.ack_count >= m.recipient_count ? "var(--color-text-success)" : "var(--color-text-warning)" }}>確認 {m.ack_count}/{m.recipient_count}</span>}
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{formatWhen(m.created_at)}</span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  {isSuperAdmin && `送信：${m.sender_name}・`}
                  宛先：{m.target_kind === "all" ? "全員" : m.target_kind === "group" ? `部署 ${groupName.get(m.target_group_id ?? "") ?? m.target_group_id}` : "選んだメンバー"}
                  {m.push_succeeded !== null && `・Windows通知 ${m.push_succeeded}件`}
                </div>
              </button>
              {openId === m.id && (
                <div style={{ marginTop: "8px", paddingLeft: "12px" }}>
                  <div style={{ background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", padding: "8px 10px", marginBottom: "8px" }}>
                    <AdminMessageBody text={m.body} />
                  </div>
                  {status === null && <div style={hintStyle}>…</div>}
                  {status !== null && (
                    <table style={{ borderCollapse: "collapse", fontSize: "11px", width: "100%" }}>
                      <thead>
                        <tr style={{ color: "var(--color-text-secondary)", textAlign: "left" }}>
                          <th style={{ padding: "3px 6px" }}>宛先</th>
                          {isSuperAdmin && <th style={{ padding: "3px 6px" }}>部署</th>}
                          <th style={{ padding: "3px 6px" }}>既読</th>
                          {m.requires_ack && <th style={{ padding: "3px 6px" }}>確認</th>}
                          {m.due_date && <th style={{ padding: "3px 6px" }}>再通知</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {status.map(r => (
                          <tr key={r.member_id} style={{ borderTop: "1px solid var(--color-border-primary)" }}>
                            <td style={{ padding: "3px 6px" }}>{r.display_name}</td>
                            {isSuperAdmin && <td style={{ padding: "3px 6px", color: "var(--color-text-tertiary)" }}>{r.group_name ?? "—"}</td>}
                            <td style={{ padding: "3px 6px", color: r.read_at ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>{r.read_at ? formatWhen(r.read_at) : "未読"}</td>
                            {m.requires_ack && <td style={{ padding: "3px 6px", color: r.acknowledged_at ? "var(--color-text-success)" : "var(--color-text-warning)" }}>{r.acknowledged_at ? `✓ ${formatWhen(r.acknowledged_at)}` : "未確認"}</td>}
                            {m.due_date && <td style={{ padding: "3px 6px", color: "var(--color-text-tertiary)" }}>{r.reminded_at ? formatWhen(r.reminded_at) : "—"}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {sent !== null && sent.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <button type="button" style={ghostBtnStyle} onClick={() => void reloadSent()}>最新の状態にする</button>
          </div>
        )}
      </Card>
    </div>
  );
}
