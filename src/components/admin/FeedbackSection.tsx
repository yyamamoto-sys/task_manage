// src/components/admin/FeedbackSection.tsx
//
// 設定 →「アプリの管理」→「ご意見・不具合」ページ（super_admin のみ・v3.157・CLAUDE.md Section 82）。
// 利用者がベル／「困ったとき」から送ったご意見（app_feedback）の一覧・詳細・状態・メモ・Claude 用コピー。
// 読むのは RLS で super_admin だけ。状態・メモの更新は RPC（super_admin 以外は例外）。
//
// 🔴 送信者名はこの画面にだけ表示する。Claude 用コピー（copyText.ts）には名前・メールを載せない。
// 🔴 状態の切替は即時保存（途中状態が生まれない）。メモは保存ボタン方式（useFormSave・Section 65）。
// 🔴 未適用（表・RPC が無い）のときは「適用がまだです」を出し、一覧は空のままにする（Section 24 Step Q の W2 と同じ）。
// 一覧はスナップショットを持たない（1件最大16KBで重いため）。詳細を開いたとき・コピーするときに必要な分だけ取る。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { confirmDiscardUnsavedEdits } from "../../lib/editing/unsavedEditorRegistry";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatJstDateTime } from "../../lib/backup/backupFormat";
import { APP_VERSION } from "../../lib/version";
import {
  FEEDBACK_ADMIN_MEMO_MAX, FEEDBACK_ALL_KINDS, FEEDBACK_COPY_LIMIT, FEEDBACK_OPEN_STATUSES, FEEDBACK_STATUSES,
  type FeedbackKind, type FeedbackStatus,
} from "../../lib/feedback/constants";
import { buildFeedbackCopyText, KIND_LABEL_JA, STATUS_LABEL_JA, type FeedbackCopyInput } from "../../lib/feedback/copyText";
import { isFeedbackNotAppliedError } from "../../lib/feedback/errors";
import { SNAPSHOT_SUMMARY_LABEL_JA, summarizeSnapshot, type FeedbackSnapshot } from "../../lib/feedback/snapshot";
import { firstLine } from "../../lib/errors/errorCopyText";
import {
  fetchAdminFeedback, fetchFeedbackSnapshots, updateFeedbackMemo, updateFeedbackStatus, type AdminFeedbackRow,
} from "../../lib/supabase/feedbackStore";
import { showToast } from "../common/Toast";
import { Card, SummaryRow, SummaryTile } from "../common/Card";
import { SaveButton, SaveErrorBand, SavedFlash, useFormSave, useSavedFlashKey } from "../common/saveUi";
import { ghostBtnStyle, inputStyle, primaryBtnStyle } from "./adminStyles";

type StatusFilter = "open" | "all" | FeedbackStatus;

const STATUS_TONE: Record<FeedbackStatus, "info" | "warning" | "success" | "secondary"> = {
  new: "info", in_progress: "warning", done: "success", wontfix: "secondary",
};

function toneStyle(tone: "info" | "warning" | "success" | "secondary") {
  return tone === "secondary"
    ? { color: "var(--color-text-secondary)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)" }
    : { color: `var(--color-text-${tone})`, background: `var(--color-bg-${tone})`, border: `1px solid var(--color-border-${tone})` };
}

function statusesFor(filter: StatusFilter): readonly FeedbackStatus[] | null {
  if (filter === "all") return null;
  if (filter === "open") return FEEDBACK_OPEN_STATUSES;
  return [filter];
}

function toCopyInput(row: AdminFeedbackRow, snapshot: FeedbackSnapshot | null): FeedbackCopyInput {
  // 🔴 member_id・admin_memo は渡さない（コピーに送信者・管理者メモを載せない）
  return {
    id: row.id, kind: row.kind, comment: row.comment, screen: row.screen, route: row.route, app_version: row.app_version,
    status: row.status, created_at: row.created_at, snapshot, snapshot_state: row.snapshot_state,
  };
}

export function FeedbackSection({ currentUser, onDirtyChange }: { currentUser: Member; onDirtyChange?: (dirty: boolean) => void }) {
  const members = useAppStore(s => s.members);
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.display_name])), [members]);
  const isSuperAdmin = currentUser.is_super_admin === true;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [kindFilter, setKindFilter] = useState<"all" | FeedbackKind>("all");
  const [rows, setRows] = useState<AdminFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notApplied, setNotApplied] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<Map<number, FeedbackSnapshot | null>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busyStatusId, setBusyStatusId] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [statusFlashKey, flashStatus] = useSavedFlashKey();
  const memoSave = useFormSave();
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const openRow = openId === null ? null : rows.find(r => r.id === openId) ?? null;
  const memoDirty = openRow !== null && memoDraft !== (openRow.admin_memo ?? "");
  useEffect(() => { onDirtyChange?.(memoDirty); }, [memoDirty, onDirtyChange]);

  const reload = useCallback(async () => {
    try {
      setRows(await fetchAdminFeedback({ statuses: statusesFor(statusFilter), kind: kindFilter === "all" ? null : kindFilter }));
      setFetchError(null);
      setNotApplied(false);
    } catch (e) {
      if (isFeedbackNotAppliedError(e)) {
        setNotApplied(true);
        setFetchError(null);
      } else {
        setNotApplied(false);
        setFetchError(formatErrorForUser("ご意見を読み込めませんでした", e));
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter]);

  useEffect(() => { if (isSuperAdmin) void reload(); }, [isSuperAdmin, reload]);

  // 詳細を開いたとき：メモの下書きを初期化し、スナップショットを取る（取得済みなら再取得しない）
  useEffect(() => {
    if (openId === null) return;
    setMemoDraft(rowsRef.current.find(r => r.id === openId)?.admin_memo ?? "");
    memoSave.setError("");
    if (snapshots.has(openId)) return;
    let cancelled = false;
    fetchFeedbackSnapshots([openId])
      .then(list => { if (!cancelled) setSnapshots(prev => new Map(prev).set(openId, list[0]?.snapshot ?? null)); })
      .catch(e => { if (!cancelled) console.warn("[FeedbackSection] スナップショットの取得に失敗:", e); });
    return () => { cancelled = true; };
    // snapshots・memoSave は意図的に依存に入れない（開いた項目が変わったときだけ初期化する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const guarded = async (action: () => void) => {
    if (memoDirty && !(await confirmDiscardUnsavedEdits())) return;
    action();
  };

  const toggleOpen = (id: number) => void guarded(() => setOpenId(openId === id ? null : id));

  const patchRow = (id: number, patch: Partial<AdminFeedbackRow>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const changeStatus = async (row: AdminFeedbackRow, next: FeedbackStatus) => {
    if (busyStatusId !== null || row.status === next) return;
    setBusyStatusId(row.id);
    try {
      await updateFeedbackStatus(row.id, next);
      patchRow(row.id, { status: next, status_changed_at: new Date().toISOString() });
      flashStatus(String(row.id));
    } catch (e) {
      showToast(formatErrorForUser("状態を更新できませんでした", e), "error");
    } finally {
      setBusyStatusId(null);
    }
  };

  const saveMemo = async (row: AdminFeedbackRow) => {
    const next = memoDraft.trim();
    const ok = await memoSave.run(() => updateFeedbackMemo(row.id, next === "" ? null : next), "メモを保存できませんでした");
    if (ok) {
      patchRow(row.id, { admin_memo: next === "" ? null : next });
      setMemoDraft(next);
    }
  };

  const copyIds = async (ids: number[]) => {
    if (ids.length === 0 || copying) return;
    setCopying(true);
    try {
      const targets = rows.filter(r => ids.includes(r.id)).slice(0, FEEDBACK_COPY_LIMIT);
      const snaps = new Map(snapshots);
      const missing = targets.map(r => r.id).filter(id => !snaps.has(id));
      if (missing.length > 0) {
        for (const s of await fetchFeedbackSnapshots(missing)) snaps.set(s.id, s.snapshot);
        setSnapshots(snaps);
      }
      const text = buildFeedbackCopyText(targets.map(r => toCopyInput(r, snaps.get(r.id) ?? null)), { now: new Date(), appVersion: APP_VERSION });
      if (await copyTextToClipboard(text)) {
        setFallbackText(null);
        showToast(`${targets.length}件を Claude 用にコピーしました`, "success");
      } else {
        setFallbackText(text);
        showToast("コピーに失敗しました。下に表示した内容を選択してコピーしてください", "error");
        requestAnimationFrame(() => { fallbackRef.current?.focus(); fallbackRef.current?.select(); });
      }
    } catch (e) {
      showToast(formatErrorForUser("コピーする内容を取得できませんでした", e), "error");
    } finally {
      setCopying(false);
    }
  };

  const toggleSelected = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!isSuperAdmin) {
    return (
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 2 }}>
        🔒 ご意見・不具合は全社スーパー管理者のみ確認できます。
      </div>
    );
  }

  const visibleIds = rows.map(r => r.id);
  const selectedVisible = visibleIds.filter(id => selected.has(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const countNew = rows.filter(r => r.status === "new").length;
  const countProgress = rows.filter(r => r.status === "in_progress").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>💬 ご意見・不具合</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            状態
            <select value={statusFilter} onChange={e => { setLoading(true); setStatusFilter(e.target.value as StatusFilter); }} style={{ ...inputStyle, width: "auto" }}>
              <option value="open">新規＋対応中</option>
              <option value="all">すべて</option>
              {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL_JA[s]}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            種類
            <select value={kindFilter} onChange={e => { setLoading(true); setKindFilter(e.target.value as "all" | FeedbackKind); }} style={{ ...inputStyle, width: "auto" }}>
              <option value="all">すべて</option>
              {FEEDBACK_ALL_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL_JA[k]}</option>)}
            </select>
          </label>
          <button style={ghostBtnStyle} onClick={() => { setLoading(true); void reload(); }}>↻ 再読み込み</button>
        </div>
      </div>

      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
        利用者が「💬 ご意見を送る」から送ったご意見・不具合です。新しく届くとベルに通知が出ます（読めるのは全社スーパー管理者だけ）。
        送信者名はこの画面にだけ表示します。Claude 用にコピーする内容には、名前・メールアドレス・管理者メモを載せません。
        貼り先は Claude だけにしてください（本文・画面の状況には利用者の入力が含まれることがあります）。画面の状況は90日で消え、
        対応済み・見送りは状態を変えてから180日で削除されます。
      </div>

      {notApplied && (
        <div role="alert" style={{ fontSize: "13px", color: "var(--color-text-warning)", background: "var(--color-bg-warning)", padding: "8px 12px", borderRadius: "var(--radius-md)", lineHeight: 1.7 }}>
          この機能のデータベース適用がまだです（20261015b_app_feedback.sql）。適用するまで、ご意見は届かず、この一覧は空のままです。
        </div>
      )}
      {fetchError && (
        <div role="alert" style={{ fontSize: "13px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
          {fetchError}
        </div>
      )}

      <SummaryRow>
        <SummaryTile label="新規" value={`${countNew}件`} tone={countNew > 0 ? "warning" : "success"} />
        <SummaryTile label="対応中" value={`${countProgress}件`} tone="info" />
        <SummaryTile label="表示中" value={`${rows.length}件`} tone="accent" />
      </SummaryRow>

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", padding: "20px" }}>読み込み中...</div>
      ) : (
        <Card
          title="ご意見の一覧（新しい順）"
          badge={`${rows.length}件`}
          headerExtra={(
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button style={ghostBtnStyle} disabled={rows.length === 0}
                onClick={() => setSelected(allSelected ? new Set() : new Set(visibleIds))}>
                {allSelected ? "選択を解除" : "すべて選択"}
              </button>
              <button style={{ ...primaryBtnStyle, opacity: selectedVisible.length === 0 || copying ? 0.5 : 1, cursor: selectedVisible.length === 0 || copying ? "default" : "pointer" }}
                disabled={selectedVisible.length === 0 || copying}
                onClick={() => void copyIds(selectedVisible)}>
                📋 選んだ{selectedVisible.length}件を Claude 用にコピー
              </button>
            </span>
          )}
        >
          {fallbackText !== null && (
            <textarea ref={fallbackRef} readOnly value={fallbackText} onFocus={e => e.currentTarget.select()}
              style={{ width: "100%", height: "120px", fontSize: "12px", fontFamily: "monospace", boxSizing: "border-box", marginBottom: "8px" }} />
          )}
          {rows.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
              {notApplied ? "データベースの適用後に表示されます。" : statusFilter === "open" ? "新規・対応中のご意見はありません。" : "該当するご意見はありません。"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {rows.map(row => {
                const isOpen = openId === row.id;
                const snap = snapshots.get(row.id);
                return (
                  <div key={row.id} style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", fontSize: "12px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "6px 10px" }}>
                      <input type="checkbox" aria-label="コピーの対象に選ぶ" checked={selected.has(row.id)} onChange={() => toggleSelected(row.id)} style={{ marginTop: "4px", flexShrink: 0 }} />
                      <button
                        type="button"
                        onClick={() => toggleOpen(row.id)}
                        aria-expanded={isOpen}
                        style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                      >
                        <span style={{ fontSize: "12px", padding: "1px 8px", borderRadius: "99px", fontWeight: 500, ...toneStyle(STATUS_TONE[row.status]) }}>{STATUS_LABEL_JA[row.status]}</span>
                        <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{formatJstDateTime(row.created_at)}</span>
                        <span style={{ color: "var(--color-text-secondary)" }}>{KIND_LABEL_JA[row.kind]}</span>
                        <span style={{ color: "var(--color-text-tertiary)" }}>{row.screen ?? "—"}・v{row.app_version ?? "?"}</span>
                        {row.admin_memo && <span title="管理者メモあり" aria-label="管理者メモあり">📝</span>}
                        <span style={{ flexBasis: "100%", color: "var(--color-text-primary)", wordBreak: "break-word" }}>{firstLine(row.comment)}</span>
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--color-border-primary)", display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ fontSize: "13px", lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-primary)" }}>{row.comment}</div>
                        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", margin: 0, fontSize: "12px" }}>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>送信者</dt>
                          <dd style={{ margin: 0 }}>{memberNameById.get(row.member_id) ?? "（不明なメンバー）"}（管理画面にだけ表示）</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>画面</dt>
                          <dd style={{ margin: 0 }}>{row.screen ?? "—"}（{row.route ?? "—"}）</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>表示部署ID</dt><dd style={{ margin: 0 }}>{row.group_id ?? "—"}</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>状態の変更</dt>
                          <dd style={{ margin: 0 }}>{row.status_changed_at ? formatJstDateTime(row.status_changed_at) : "—"}</dd>
                        </dl>

                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>画面の状況</div>
                          {snap === undefined && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>…</div>}
                          {snap === null && (
                            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                              {row.snapshot_state === "off" ? "本人が付けませんでした。" : row.snapshot_state === "too_large" ? "大きすぎて付けられませんでした。" : row.snapshot_state === "purged" ? "90日を過ぎたため消えました。" : "ありません。"}
                            </div>
                          )}
                          {snap && (
                            <>
                              <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", margin: 0, fontSize: "12px" }}>
                                {summarizeSnapshot(snap).map(line => (
                                  <div key={line.id} style={{ display: "contents" }}>
                                    <dt style={{ color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{SNAPSHOT_SUMMARY_LABEL_JA[line.id]}</dt>
                                    <dd style={{ margin: 0, wordBreak: "break-word" }}>{line.value}</dd>
                                  </div>
                                ))}
                              </dl>
                              <details style={{ marginTop: "4px" }}>
                                <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--color-text-secondary)" }}>JSON（技術情報）</summary>
                                <pre style={{
                                  margin: "4px 0 0", padding: "6px 8px", fontSize: "12px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                  background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", maxHeight: "260px", overflowY: "auto",
                                }}>{JSON.stringify(snap, null, 2)}</pre>
                              </details>
                            </>
                          )}
                        </div>

                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>状態</span>
                            <SavedFlash visible={statusFlashKey === String(row.id)} />
                          </div>
                          <div style={{ display: "inline-flex", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                            {FEEDBACK_STATUSES.map((s, i) => (
                              <button key={s} type="button" aria-pressed={row.status === s} disabled={busyStatusId !== null}
                                onClick={() => void changeStatus(row, s)}
                                style={{
                                  padding: "5px 14px", fontSize: "12px", border: "none", cursor: busyStatusId !== null ? "wait" : "pointer",
                                  borderLeft: i > 0 ? "1px solid var(--color-border-primary)" : "none",
                                  background: row.status === s ? "var(--color-bg-info)" : "transparent",
                                  color: row.status === s ? "var(--color-text-info)" : "var(--color-text-secondary)",
                                  fontWeight: row.status === s ? 600 : 400,
                                }}>{STATUS_LABEL_JA[s]}</button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label htmlFor={`feedback-memo-${row.id}`} style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                            管理者メモ（利用者には見えません・Claude 用コピーにも載せません）
                          </label>
                          <textarea
                            id={`feedback-memo-${row.id}`}
                            value={memoDraft}
                            maxLength={FEEDBACK_ADMIN_MEMO_MAX}
                            rows={3}
                            onChange={e => setMemoDraft(e.target.value)}
                            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" }}
                          />
                          <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                            <SaveButton dirty={memoDirty} saving={memoSave.saving} onClick={() => void saveMemo(row)} buttonStyle={primaryBtnStyle} />
                            <button style={ghostBtnStyle} disabled={copying} onClick={() => void copyIds([row.id])}>📋 この1件を Claude 用にコピー</button>
                          </div>
                          <div style={{ marginTop: "6px" }}><SaveErrorBand message={memoSave.error} /></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
