// src/components/admin/ClientErrorSection.tsx
//
// 設定 →「アプリ設定」→「エラー」タブ（super_admin のみ・v3.129・CLAUDE.md Section 67）。
// 利用者の画面に出たエラー（client_error_logs。同じエラーは1行にまとめて回数を数える）の一覧・詳細・解決済みにする。
// 記録は RPC log_client_error だけが書く。ここは読む・解決済みにするだけ。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { Card, SummaryRow, SummaryTile } from "../common/Card";
import { ghostBtnStyle, primaryBtnStyle } from "./adminStyles";
import { formatJstDateTime } from "../../lib/backup/backupFormat";
import {
  fetchClientErrorLogs, fetchClientErrorReporters, resolveClientErrors,
  type ClientErrorLog, type ClientErrorReporter,
} from "../../lib/supabase/clientErrorStore";

const SOURCE_LABEL: Record<ClientErrorLog["source"], string> = {
  report: "操作のエラー",
  boundary: "画面のクラッシュ",
  window: "スクリプトのエラー",
  promise: "処理の失敗（未処理）",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function ClientErrorSection({ currentUser }: { currentUser: Member }) {
  const members = useAppStore(s => s.members);
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.display_name])), [members]);
  const isSuperAdmin = currentUser.is_super_admin === true;

  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [logs, setLogs] = useState<ClientErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [reporters, setReporters] = useState<ClientErrorReporter[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setLogs(await fetchClientErrorLogs({ unresolvedOnly }));
      setFetchError(null);
    } catch (e) {
      setFetchError(formatErrorForUser("エラーの記録を読み込めませんでした（データベースへの適用がまだの可能性があります）", e));
    } finally {
      setLoading(false);
    }
  }, [unresolvedOnly]);

  useEffect(() => { if (isSuperAdmin) void reload(); }, [isSuperAdmin, reload]);

  useEffect(() => {
    if (openId === null) { setReporters(null); return; }
    let cancelled = false;
    setReporters(null);
    fetchClientErrorReporters(openId)
      .then(r => { if (!cancelled) setReporters(r); })
      .catch(e => { if (!cancelled) { console.warn("[ClientErrorSection] 発生した人の取得に失敗:", e); setReporters([]); } });
    return () => { cancelled = true; };
  }, [openId]);

  const toggleResolved = async (log: ClientErrorLog) => {
    if (busyId !== null) return;
    setBusyId(log.id);
    try {
      await resolveClientErrors([log.id], log.resolved_at === null);
      showToast(log.resolved_at === null ? "解決済みにしました" : "未解決に戻しました", "success");
      await reload();
    } catch (e) {
      showToast(formatErrorForUser("更新できませんでした", e), "error");
    } finally {
      setBusyId(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 2 }}>
        🔒 エラーの記録は全社スーパー管理者のみ確認できます。
      </div>
    );
  }

  const now = Date.now();
  const unresolvedCount = logs.filter(l => l.resolved_at === null).length;
  const last24h = logs.filter(l => now - Date.parse(l.last_seen) < DAY_MS).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>🛡 利用者の画面のエラー</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={unresolvedOnly} onChange={e => { setLoading(true); setUnresolvedOnly(e.target.checked); }} />
            未解決のみ表示
          </label>
          <button style={ghostBtnStyle} onClick={() => { setLoading(true); void reload(); }}>↻ 再読み込み</button>
        </div>
      </div>

      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
        利用者の画面に出たエラー（保存の失敗・画面のクラッシュ・スクリプトのエラー）を記録しています。同じエラーは1件にまとめて回数を数えます。
        新しいエラー・解決済みにしたエラーの再発はベルに届き、Windows通知は30分ごとにまとめて届きます。
        記録にはメッセージ・画面・版・ブラウザだけを残し、入力内容は送りません（メールアドレスらしき文字列は伏せています）。90日で削除されます。
      </div>

      {fetchError && (
        <div role="alert" style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
          {fetchError}
        </div>
      )}

      <SummaryRow>
        <SummaryTile label="未解決" value={`${unresolvedCount}件`} tone={unresolvedCount > 0 ? "danger" : "success"} />
        <SummaryTile label="直近24時間に発生" value={`${last24h}件`} tone="warning" />
        <SummaryTile label="表示中" value={`${logs.length}件`} tone="info" />
      </SummaryRow>

      {loading ? (
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", padding: "20px" }}>読み込み中...</div>
      ) : (
        <Card title="エラーの一覧（最終発生が新しい順）" badge={`${logs.length}件`}>
          {logs.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
              {unresolvedOnly ? "未解決のエラーはありません。" : "記録されたエラーはありません。"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {logs.map(log => {
                const isOpen = openId === log.id;
                const resolved = log.resolved_at !== null;
                return (
                  <div key={log.id} style={{
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", fontSize: "11.5px",
                    opacity: resolved ? 0.7 : 1,
                  }}>
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : log.id)}
                      aria-expanded={isOpen}
                      style={{
                        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", width: "100%", padding: "6px 10px",
                        background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <span style={{
                        fontSize: "10.5px", padding: "1px 8px", borderRadius: "99px", fontWeight: 500,
                        color: `var(--color-text-${resolved ? "success" : "danger"})`, background: `var(--color-bg-${resolved ? "success" : "danger"})`,
                        border: `1px solid var(--color-border-${resolved ? "success" : "danger"})`,
                      }}>{resolved ? "解決済み" : "未解決"}</span>
                      <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{formatJstDateTime(log.last_seen)}</span>
                      <span style={{ color: "var(--color-text-secondary)" }}>{log.count}回・{log.reporter_count}人</span>
                      <span style={{ color: "var(--color-text-tertiary)" }}>{log.screen ?? "—"}・v{log.app_version ?? "?"}</span>
                      <span style={{ flexBasis: "100%", color: "var(--color-text-primary)", wordBreak: "break-word" }}>{log.message}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: "4px 10px 10px", borderTop: "1px solid var(--color-border-primary)", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", margin: 0, fontSize: "11px" }}>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>種類</dt><dd style={{ margin: 0 }}>{SOURCE_LABEL[log.source]}</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>操作</dt><dd style={{ margin: 0, wordBreak: "break-word" }}>{log.context ?? "—"}</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>コード</dt><dd style={{ margin: 0 }}>{log.code ?? "—"}</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>画面</dt><dd style={{ margin: 0 }}>{log.screen ?? "—"}（{log.route ?? "—"}）</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>最初の発生</dt><dd style={{ margin: 0 }}>{formatJstDateTime(log.first_seen)}</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>最後に起きた人</dt><dd style={{ margin: 0 }}>{log.member_id ? (memberNameById.get(log.member_id) ?? log.member_id) : "—"}</dd>
                          <dt style={{ color: "var(--color-text-tertiary)" }}>ブラウザ</dt><dd style={{ margin: 0, wordBreak: "break-word" }}>{log.user_agent ?? "—"}</dd>
                          {resolved && (<>
                            <dt style={{ color: "var(--color-text-tertiary)" }}>解決</dt>
                            <dd style={{ margin: 0 }}>{formatJstDateTime(log.resolved_at)}（{log.resolved_by ? (memberNameById.get(log.resolved_by) ?? log.resolved_by) : "—"}）</dd>
                          </>)}
                        </dl>
                        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          発生した人：{reporters === null ? "…" : reporters.length === 0 ? "—" : reporters.map(r => `${memberNameById.get(r.member_id) ?? r.member_id}（${r.count}回）`).join("、")}
                        </div>
                        {log.stack && (
                          <details>
                            <summary style={{ cursor: "pointer", fontSize: "11px", color: "var(--color-text-secondary)" }}>スタック（技術情報）</summary>
                            <pre style={{
                              margin: "4px 0 0", padding: "6px 8px", fontSize: "10.5px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                              background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            }}>{log.stack}</pre>
                          </details>
                        )}
                        <div>
                          <button
                            style={{ ...primaryBtnStyle, opacity: busyId === log.id ? 0.6 : 1 }}
                            disabled={busyId !== null}
                            onClick={() => void toggleResolved(log)}
                          >{resolved ? "未解決に戻す" : "✓ 解決済みにする"}</button>
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
