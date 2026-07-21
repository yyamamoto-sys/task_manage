// src/components/lab/KrReportPanel.tsx
//
// 【設計意図】
// ラボ機能：KRチェックイン/ウィンセッションの議事メモをAIに渡し、HTMLレポートを生成する。
// OKR/KR/TFデータをAIに渡すことはユーザー確認済みのポリシー変更による許可。
// GraphViewと同じフルスクリーンオーバーレイ形式で表示する。

import { useState, useRef, useMemo, useEffect } from "react";
import { useAppStore, selectScopedTasks, selectScopedMembers } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { buildKrReportContext, type KrReportMode } from "../../lib/ai/krReportPrompt";
import { callKrReportAI } from "../../lib/ai/krReportClient";
import { fetchKrSessions, type KrSession } from "../../lib/supabase/krSessionStore";
import { fetchKrReport, saveKrReportDraft, updateKrReportContent, finalizeKrReport, unfinalizeKrReport, type KrReport } from "../../lib/supabase/krReportStore";
import { fetchLatestOkrAnalysis, type OkrAnalysis } from "../../lib/supabase/okrAnalysisStore";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { FileAttachButton, FileDropZone, type FileAttachment } from "../common/FileAttachButton";
import { HelpButton } from "../guide/HelpButton";

interface Props {
  onClose: () => void;
  currentUser: Member;
  inline?: boolean;
  initialKrId?: string;
}

const MODE_OPTIONS: { value: KrReportMode; label: string; description: string }[] = [
  {
    value: "checkin",
    label: "チェックイン分析",
    description: "今週の宣言・到達可能性・仮説たたき案",
  },
  {
    value: "win_session",
    label: "ウィンセッション分析",
    description: "宣言達成確認・学び・次の一手",
  },
];

const REPORT_PHASES = [
  "議事メモを解析しています...",
  "OKRコンテキストを整理しています...",
  "レポートを構成しています...",
  "文章を生成・整形しています...",
];

function getThisMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

const barBtn: React.CSSProperties = {
  fontSize: "11px", padding: "5px 12px", background: "transparent",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)", cursor: "pointer", whiteSpace: "nowrap",
};

export function KrReportPanel({ onClose, inline = false, initialKrId, currentUser }: Props) {
  const keyResults = useAppStore(s => s.keyResults);
  const taskForces = useAppStore(s => s.taskForces);
  const todos      = useAppStore(s => s.todos);
  const tasks      = useAppStore(selectScopedTasks);
  const members    = useAppStore(selectScopedMembers);

  const activeKrs = useMemo(
    () => active(keyResults),
    [keyResults],
  );

  const [selectedKrId, setSelectedKrId] = useState<string>(initialKrId ?? activeKrs[0]?.id ?? "");
  const [mode, setMode] = useState<KrReportMode>("checkin");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [sessions, setSessions] = useState<KrSession[]>([]);
  const [reportRecord, setReportRecord] = useState<KrReport | null>(null);
  const [latestAnalysis, setLatestAnalysis] = useState<OkrAnalysis | null>(null);
  const [editing, setEditing] = useState(false);
  const [editHtml, setEditHtml] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const reportRef = useRef<HTMLIFrameElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const thisMonday = getThisMonday();
  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;
  const memberById = useMemo(() => new Map((members ?? []).map(m => [m.id, m])), [members]);
  const whoName = (id: string | null | undefined) => (id ? (memberById.get(id)?.short_name ?? "メンバー") : "");

  // KR/モード変更時：Supabase から既存レポートを読み込む（localStorage から移行）
  useEffect(() => {
    setReportHtml(null);
    setReportRecord(null);
    setEditing(false);
    setError(null);
    if (!selectedKrId) return;
    let cancelled = false;
    fetchKrReport(selectedKrId, thisMonday, mode)
      .then(rec => { if (!cancelled && rec) { setReportRecord(rec); setReportHtml(rec.content); } })
      .catch((e: unknown) => { console.warn("レポート取得に失敗:", e); });
    return () => { cancelled = true; };
  }, [selectedKrId, mode, thisMonday]);

  // KR変更時：このKRの最新AI分析を取得（②セッション記録&分析で保存されたもの。レポート生成の素材）
  useEffect(() => {
    if (!selectedKrId) { setLatestAnalysis(null); return; }
    let cancelled = false;
    fetchLatestOkrAnalysis(selectedKrId)
      .then(a => { if (!cancelled) setLatestAnalysis(a); })
      .catch(() => { if (!cancelled) setLatestAnalysis(null); });
    return () => { cancelled = true; };
  }, [selectedKrId]);

  // KR選択時にセッション履歴を取得
  useEffect(() => {
    if (!selectedKrId) { setSessions([]); return; }
    fetchKrSessions(selectedKrId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [selectedKrId]);

  const thisWeekSessions = sessions.filter(s => s.week_start === thisMonday);
  const thisWeekCheckin = thisWeekSessions.find(s => s.session_type === "checkin");
  const thisWeekWin = thisWeekSessions.find(s => s.session_type === "win_session");
  const sessionForMode = mode === "checkin" ? thisWeekCheckin : thisWeekWin;

  const handleLoadFromSession = () => {
    if (!sessionForMode) return;
    setMeetingNotes(sessionForMode.transcript);
  };

  const handleGenerate = async () => {
    if (!selectedKr || !meetingNotes.trim()) return;
    setGenerating(true);
    setError(null);
    setReportHtml(null);
    setEditing(false);

    try {
      // ② セッション記録&分析で保存されたこのKRの最新AI分析があれば素材として議事メモに添える
      const notes = latestAnalysis
        ? `${meetingNotes.trim()}\n\n【参考：このKRの最新AI分析（${fmtDateTime(latestAnalysis.created_at)}）】\n${latestAnalysis.content}`
        : meetingNotes.trim();

      const context = buildKrReportContext({
        today,
        kr: selectedKr,
        tfs: taskForces ?? [],
        todos: todos ?? [],
        tasks: tasks ?? [],
        members: members ?? [],
        mode,
        meetingNotes: notes,
      });

      const result = await callKrReportAI(context, mode, attachment ?? undefined);
      setReportHtml(result.html);

      // Supabase に下書きとして保存（既存があれば上書き＝下書きに戻る）
      try {
        const rec = await saveKrReportDraft(selectedKrId, thisMonday, mode, result.html, currentUser.id);
        setReportRecord(rec);
      } catch (e) {
        console.warn("レポート下書き保存に失敗（生成自体は成功）:", e);
        setReportRecord(null);
      }

      setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (e) {
      setError(formatErrorForUser("レポート生成に失敗しました", e));
    } finally {
      setGenerating(false);
    }
  };

  const startEdit = () => { setEditHtml(reportHtml ?? ""); setEditing(true); };
  const handleSaveEdit = async () => {
    setSavingEdit(true);
    try {
      setReportHtml(editHtml);
      if (reportRecord) {
        const rec = await updateKrReportContent(reportRecord.id, editHtml, currentUser.id);
        setReportRecord(rec);
      }
      setEditing(false);
      showToast("レポートを保存しました");
    } catch (e) {
      showToast(formatErrorForUser("保存に失敗しました", e), "error");
    } finally { setSavingEdit(false); }
  };
  const handleFinalize = async () => {
    if (!reportRecord) { showToast("先に保存（生成）してください", "info"); return; }
    setFinalizing(true);
    try {
      const rec = await finalizeKrReport(reportRecord.id, currentUser.id);
      setReportRecord(rec);
      showToast("レポートを確定しました");
    } catch (e) {
      showToast(formatErrorForUser("確定に失敗しました", e), "error");
    } finally { setFinalizing(false); }
  };
  const handleUnfinalize = async () => {
    if (!reportRecord) return;
    setFinalizing(true);
    try {
      const rec = await unfinalizeKrReport(reportRecord.id, currentUser.id);
      setReportRecord(rec);
      showToast("確定を取り消しました", "info");
    } catch (e) {
      showToast(formatErrorForUser("操作に失敗しました", e), "error");
    } finally { setFinalizing(false); }
  };

  const teamsWebhookUrl = import.meta.env.VITE_TEAMS_WEBHOOK_URL as string | undefined;

  const handleCopyText = () => {
    const text = reportRef.current?.contentDocument?.body?.innerText ?? "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast("テキストをコピーしました"));
  };

  const handleCopyHtml = () => {
    if (!reportHtml) return;
    navigator.clipboard.writeText(reportHtml).then(() => showToast("HTMLをコピーしました"));
  };

  const handleDownloadText = () => {
    const text = reportRef.current?.contentDocument?.body?.innerText ?? "";
    if (!text) return;
    const modeLabel = mode === "checkin" ? "チェックイン分析" : "ウィンセッション分析";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `KRレポート_${modeLabel}_${selectedKr?.title ?? ""}_${today}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("ダウンロードしました");
  };

  const [teamsSending, setTeamsSending] = useState(false);

  const handleSendToTeams = async () => {
    if (!reportRef.current || !teamsWebhookUrl) return;
    const text = reportRef.current.contentDocument?.body?.innerText ?? "";
    if (!text.trim()) return;

    setTeamsSending(true);
    try {
      const modeLabel = mode === "checkin" ? "チェックイン分析" : "ウィンセッション分析";
      const body = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "7c3aed",
        summary: `KRレポート：${selectedKr?.title ?? ""}`,
        sections: [{
          activityTitle: `📊 KRレポート｜${modeLabel}`,
          activitySubtitle: `${selectedKr?.title ?? ""}｜${today}`,
          text: text.slice(0, 1000) + (text.length > 1000 ? "…（全文はアプリで確認）" : ""),
        }],
      };
      const res = await fetch(teamsWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Teamsに送信しました");
    } catch (e) {
      showToast(formatErrorForUser("Teams送信に失敗しました", e), "error");
    } finally {
      setTeamsSending(false);
    }
  };

  const panelContent = (
    // クリックしても何も起きないラッパー（inline=false時に背景クリックのバブリングを防止するだけ）
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      className={inline ? "" : "panel-slide-up"}
      style={{
        width: inline ? "100%" : "min(960px, 100vw)",
        height: "100%",
        background: "var(--color-bg-primary)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...(inline ? {} : { boxShadow: "-4px 0 24px rgba(0,0,0,0.18)" }),
      }}
      onClick={inline ? undefined : e => e.stopPropagation()}
    >
      {/* ヘッダー */}
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center", gap: "10px",
        flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
            KRレポート生成
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            チェックイン・ウィンセッションの議事メモからAIがレポートを生成します
          </div>
        </div>
        <HelpButton modeKey="okr.report" title="③ レポート作成の使い方を開く" />
        {!inline && (
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: "20px", color: "var(--color-text-tertiary)",
              padding: "4px", lineHeight: 1,
            }}
          >✕</button>
        )}
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px", display: "flex", flexDirection: "column" }}>

        {/* AI生成中：フルローダー */}
        {generating ? (
          <AIProgressLoader phases={REPORT_PHASES} intervalMs={5000} />
        ) : (
          <>
            {/* 設定エリア */}
            <div style={{
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-lg)",
              padding: "18px 20px",
              marginBottom: "20px",
            }}>
              {/* KR選択 */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "6px" }}>
                  対象KR
                </label>
                {activeKrs.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    KRが登録されていません。管理画面でKRを作成してください。
                  </div>
                ) : (
                  <select
                    value={selectedKrId}
                    onChange={e => setSelectedKrId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      fontSize: "13px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {activeKrs.map(kr => (
                      <option key={kr.id} value={kr.id}>{kr.title}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* モード選択（S4: setMeetingNotes リセット削除） */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "8px" }}>
                  会議の種類
                </label>
                <div style={{ display: "flex", gap: "10px" }}>
                  {MODE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        border: `1.5px solid ${mode === opt.value ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                        borderRadius: "var(--radius-md)",
                        background: mode === opt.value ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{
                        fontSize: "12px",
                        fontWeight: "600",
                        color: mode === opt.value ? "var(--color-brand)" : "var(--color-text-primary)",
                        marginBottom: "3px",
                      }}>
                        {opt.label}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 今週のセッションバナー */}
              {sessionForMode && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  background: "var(--color-bg-success, #f0fdf4)",
                  border: "1px solid var(--color-border-success, #86efac)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 14px",
                  marginBottom: "14px",
                  fontSize: "12px",
                }}>
                  <span style={{ fontSize: "16px" }}>✅</span>
                  <div style={{ flex: 1, color: "var(--color-text-primary)" }}>
                    <span style={{ fontWeight: "600" }}>今週の{mode === "checkin" ? "チェックイン" : "ウィンセッション"}が記録済みです</span>
                    <span style={{ color: "var(--color-text-tertiary)", marginLeft: "6px" }}>({sessionForMode.week_start})</span>
                  </div>
                  <button
                    onClick={handleLoadFromSession}
                    style={{
                      padding: "5px 12px",
                      background: "var(--color-brand)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                      fontSize: "11px",
                      fontWeight: "600",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    議事録を読み込む
                  </button>
                </div>
              )}

              {/* 議事メモ入力 */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>
                    議事メモ / 文字起こし
                  </label>
                  <FileAttachButton
                    attachment={attachment}
                    onAttach={setAttachment}
                    onRemove={() => setAttachment(null)}
                  />
                </div>
                <FileDropZone onAttach={setAttachment}>
                  <textarea
                    value={meetingNotes}
                    onChange={e => setMeetingNotes(e.target.value)}
                    placeholder={attachment ? "添付ファイルがある場合は空欄でも生成できます。補足メモを追加することもできます。" : "チェックインまたはウィンセッションの議事メモや文字起こしをここに貼り付けてください。\nまたはファイルをここにドラッグ＆ドロップ"}
                    rows={10}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: "12px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)",
                      color: "var(--color-text-primary)",
                      resize: "vertical",
                      lineHeight: 1.6,
                      boxSizing: "border-box",
                    }}
                  />
                </FileDropZone>
              </div>

              {/* エラー */}
              {error && (
                <div style={{
                  fontSize: "12px",
                  color: "var(--color-text-danger)",
                  background: "var(--color-bg-danger)",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  marginBottom: "12px",
                }}>
                  {error}
                </div>
              )}

              {/* ② セッション記録&分析からの素材バナー */}
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                background: latestAnalysis ? "var(--color-bg-purple)" : "var(--color-bg-secondary)",
                border: `1px solid ${latestAnalysis ? "var(--color-border-purple)" : "var(--color-border-primary)"}`,
                borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: "12px", fontSize: "11px",
              }}>
                <span>{latestAnalysis ? "📊" : "💡"}</span>
                <span style={{ flex: 1, color: "var(--color-text-secondary)" }}>
                  {latestAnalysis
                    ? `このKRの最新AI分析（${fmtDateTime(latestAnalysis.created_at)}・${whoName(latestAnalysis.created_by)}）を素材としてAIに渡します。`
                    : "このKRのAI分析はまだありません。OKR管理 → ② セッション記録&分析 で記録すると、AI分析がレポートの素材になります。"}
                </span>
              </div>

              {/* 生成ボタン */}
              {(() => {
                const canGenerate = !!selectedKr && (!!meetingNotes.trim() || !!attachment);
                return (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={handleGenerate}
                      disabled={!canGenerate}
                      style={{
                        padding: "11px 24px",
                        background: canGenerate
                          ? "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))"
                          : "var(--color-bg-tertiary)",
                        border: "none",
                        borderRadius: "var(--radius-md)",
                        color: canGenerate ? "#fff" : "var(--color-text-tertiary)",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: canGenerate ? "pointer" : "not-allowed",
                        boxShadow: canGenerate ? "0 2px 8px rgba(124,58,237,0.35)" : "none",
                      }}
                    >
                      ✨ AIでレポートを生成する
                    </button>
                  </div>
                );
              })()}
            </div>

            {/* レポート出力エリア（AI下書き → 人が確認・編集 → 確定） */}
            {reportHtml && (
              <div>
                {/* ステータス＆操作バー */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
                  background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: "10px",
                }}>
                  {reportRecord?.status === "finalized" ? (
                    <span style={{ fontSize: "11px", padding: "2px 9px", borderRadius: "var(--radius-full)", background: "var(--color-bg-success)", color: "var(--color-text-success)", border: "1px solid var(--color-border-success)", fontWeight: 600 }}>
                      ✅ 確定済み（{whoName(reportRecord.finalized_by)}・{reportRecord.finalized_at ? fmtDateTime(reportRecord.finalized_at) : ""}）
                    </span>
                  ) : (
                    <span style={{ fontSize: "11px", padding: "2px 9px", borderRadius: "var(--radius-full)", background: "var(--color-bg-warning)", color: "var(--color-text-warning)", border: "1px solid var(--color-border-warning)", fontWeight: 600 }}>
                      📝 下書き（要確認）
                    </span>
                  )}
                  {reportRecord && <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>更新 {fmtDateTime(reportRecord.updated_at)}</span>}
                  <div style={{ flex: 1 }} />
                  {!editing && (
                    <>
                      <button onClick={startEdit} style={barBtn}>✏️ 内容を編集</button>
                      {reportRecord?.status === "finalized"
                        ? <button onClick={handleUnfinalize} disabled={finalizing} style={barBtn}>{finalizing ? "…" : "確定を取り消す"}</button>
                        : <button onClick={handleFinalize} disabled={finalizing || !reportRecord} title={!reportRecord ? "先に生成して保存してください" : ""} style={{ ...barBtn, background: (finalizing || !reportRecord) ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#16a34a,#15803d)", color: (finalizing || !reportRecord) ? "var(--color-text-tertiary)" : "#fff", border: "none", fontWeight: 600 }}>{finalizing ? "確定中…" : "✅ 内容を確認して確定"}</button>}
                    </>
                  )}
                </div>

                {editing && (
                  <div style={{ marginBottom: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>HTML を直接編集できます（プレビューは下に反映されます）。</div>
                    <textarea value={editHtml} onChange={e => setEditHtml(e.target.value)} rows={16}
                      style={{ width: "100%", padding: "10px 12px", fontSize: "12px", fontFamily: "monospace", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={handleSaveEdit} disabled={savingEdit} style={{ ...barBtn, background: savingEdit ? "var(--color-bg-tertiary)" : "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))", color: savingEdit ? "var(--color-text-tertiary)" : "#fff", border: "none", fontWeight: 600, padding: "7px 16px" }}>{savingEdit ? "保存中…" : "💾 保存"}</button>
                      <button onClick={() => setEditing(false)} style={barBtn}>キャンセル</button>
                    </div>
                  </div>
                )}

                <div style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  marginBottom: "12px",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
                    レポート（プレビュー）
                  </div>
                  <button
                    onClick={handleCopyText}
                    style={{
                      fontSize: "11px", padding: "5px 10px",
                      background: "transparent",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                    }}
                  >テキストコピー</button>
                  <button
                    onClick={handleCopyHtml}
                    style={{
                      fontSize: "11px", padding: "5px 10px",
                      background: "transparent",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                    }}
                  >HTMLコピー</button>
                  <button
                    onClick={handleDownloadText}
                    style={{
                      fontSize: "11px", padding: "5px 10px",
                      background: "transparent",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                    }}
                  >⬇ ダウンロード</button>
                  {teamsWebhookUrl && (
                    <button
                      onClick={handleSendToTeams}
                      disabled={teamsSending}
                      style={{
                        fontSize: "11px", padding: "5px 10px",
                        background: teamsSending ? "var(--color-bg-tertiary)" : "#6264a7",
                        border: "none",
                        borderRadius: "var(--radius-md)",
                        color: teamsSending ? "var(--color-text-tertiary)" : "#fff",
                        cursor: teamsSending ? "not-allowed" : "pointer",
                        fontWeight: "600",
                      }}
                    >
                      {teamsSending ? "送信中..." : "Teams送信"}
                    </button>
                  )}
                </div>
                <iframe
                  ref={reportRef}
                  srcDoc={reportHtml}
                  style={{
                    width: "100%",
                    minHeight: "600px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-lg)",
                    background: "#fff",
                  }}
                  onLoad={e => {
                    const iframe = e.currentTarget;
                    const body = iframe.contentDocument?.body;
                    if (body) {
                      iframe.style.height = `${body.scrollHeight + 32}px`;
                    }
                  }}
                  title="KRレポートプレビュー"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (inline) return panelContent;

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {panelContent}
    </div>
  );
}
