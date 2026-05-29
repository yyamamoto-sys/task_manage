// src/components/okr/OkrDashboardView.tsx
// OKR管理モードのメインビュー。タブ型UI：会議ノート/セッション記録(分析)/レポート作成/なぜなぜ/計画。
// 概要は「OKR」ボタン（履歴の隣）からオーバーレイで開く（作業画面と分離）。

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { formatMD } from "../../lib/date";
import { calcProgressPct } from "../../lib/stats";
import { KrJointSessionFlow } from "../lab/KrJointSessionFlow";
import { KrReportPanel } from "../lab/KrReportPanel";
import { KrWhyPanel } from "../lab/KrWhyPanel";
import { KrQuarterPlanPanel } from "../lab/KrQuarterPlanPanel";
import { KrMeetingNotePanel } from "./KrMeetingNotePanel";
import { OkrKrAnalysisPanel } from "./OkrKrAnalysisPanel";
import { fetchKrSessions, updateKrSession, softDeleteKrSession, fetchKrDeclarations, type KrSession, type KrDeclaration } from "../../lib/supabase/krSessionStore";
import { fetchKrMeetingNote, type KrMeetingNote } from "../../lib/supabase/krMeetingNoteStore";
import { fetchLatestOkrAnalysis, type OkrAnalysis } from "../../lib/supabase/okrAnalysisStore";
import { fetchKrReport, type KrReport } from "../../lib/supabase/krReportStore";
import { HelpButton } from "../guide/HelpButton";
import { CustomSelect } from "../common/CustomSelect";

// 上位タブ「OKR管理」配下のサブツール（①会議ノート→②セッション記録&分析→③レポート作成）
// 概要は OKR ボタン（右上）からオーバーレイで開く。
// （旧「③分析」タブは②に統合済み。"analysis" / "overview" は localStorage 互換のため型に残す）
export type OkrActiveTool = "overview" | "note" | "session" | "analysis" | "report" | "why" | "plan" | null;
const OKR_TOOLS: OkrActiveTool[] = ["note", "session", "analysis", "report"];

interface Props {
  currentUser: Member;
  selectedKrId: string | null;
  onSelectKr: (id: string | null) => void;
  activeTool: OkrActiveTool;
  onSetActiveTool: (tool: OkrActiveTool) => void;
}

const SIGNAL_COLOR: Record<string, string> = {
  green: "#16a34a", yellow: "#ca8a04", red: "#dc2626",
};
const SIGNAL_DOT: Record<string, string> = {
  green: "🟢", yellow: "🟡", red: "🔴",
};
const SESSION_TYPE_LABEL: Record<string, string> = {
  checkin: "チェックイン", win_session: "ウィンセッション", freeform: "OKR議論",
};
const SESSION_TYPE_ICON: Record<string, string> = {
  checkin: "🗓️", win_session: "🏆", freeform: "💬",
};

function getThisMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// 上位タブ（3本）。「OKR管理」配下にサブタブ①〜④＋概要を持つ
const TOP_TABS: { key: "okr" | "why" | "plan"; icon: string; label: string }[] = [
  { key: "okr",  icon: "🎯", label: "OKR管理" },
  { key: "why",  icon: "🔍", label: "なぜなぜ" },
  { key: "plan", icon: "📅", label: "計画（マネージャー向け）" },
];
const OKR_SUB_TABS: { tool: OkrActiveTool; label: string }[] = [
  { tool: "note",     label: "① 会議ノート" },
  { tool: "session",  label: "② セッション記録&分析" },
  { tool: "report",   label: "③ レポート作成" },
];

export function OkrDashboardView({
  currentUser, selectedKrId, onSelectKr, activeTool, onSetActiveTool,
}: Props) {
  const objective  = useAppStore(s => s.objective);
  const keyResults = useAppStore(s => s.keyResults);
  const taskForces = useAppStore(s => s.taskForces);
  const tasks      = useAppStore(s => s.tasks);
  const todos      = useAppStore(s => s.todos);
  const members    = useAppStore(s => s.members);

  const activeKrs = useMemo(
    () => active(keyResults),
    [keyResults],
  );
  const activeTfs = useMemo(
    () => active(taskForces),
    [taskForces],
  );

  // KRごとのタスク統計
  const krStats = useMemo(() => {
    return activeKrs.map(kr => {
      const tfs = activeTfs.filter(tf => tf.kr_id === kr.id);
      const tfIds = new Set(tfs.map(tf => tf.id));
      const todoIds = new Set(
        (todos ?? []).filter(t => !t.is_deleted && tfIds.has(t.tf_id)).map(t => t.id),
      );
      const krTasks = (tasks ?? []).filter(
        t => !t.is_deleted && t.todo_ids?.some(id => todoIds.has(id)),
      );
      const done = krTasks.filter(t => t.status === "done").length;
      return { krId: kr.id, tfs, done, total: krTasks.length };
    });
  }, [activeKrs, activeTfs, todos, tasks]);

  const [historyOpen, setHistoryOpen] = useState(false);
  // 概要オーバーレイ（履歴と同じパターン）
  const [overviewOpen, setOverviewOpen] = useState(false);
  // 旧 activeTool === "overview" は廃止。会議ノートへ自動移行。
  useEffect(() => { if (activeTool === "overview") onSetActiveTool("note"); }, [activeTool, onSetActiveTool]);
  const inOkrGroup = OKR_TOOLS.includes(activeTool);

  // セッション取得（概要・履歴共用）
  const [krSessionsMap, setKrSessionsMap] = useState<Record<string, KrSession[]>>({});
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshSessions = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (activeKrs.length === 0) return;
    setSessionsLoading(true);
    Promise.all(
      activeKrs.map(kr =>
        fetchKrSessions(kr.id)
          .then(ss => [kr.id, ss] as const)
          .catch(() => [kr.id, []] as const),
      ),
    )
      .then(entries => setKrSessionsMap(Object.fromEntries(entries)))
      .finally(() => setSessionsLoading(false));
  }, [activeKrs, refreshKey]);

  const thisMonday = getThisMonday();

  // ===== サイクル進捗（OKR管理の①②③④の状態。選択中KR×今週） =====
  const [cycleNote, setCycleNote] = useState<KrMeetingNote | null>(null);
  const [cycleAnalysis, setCycleAnalysis] = useState<OkrAnalysis | null>(null);
  const [cycleReport, setCycleReport] = useState<KrReport | null>(null);
  useEffect(() => {
    if (!inOkrGroup || !selectedKrId) { setCycleNote(null); setCycleAnalysis(null); setCycleReport(null); return; }
    let cancelled = false;
    Promise.allSettled([
      fetchKrMeetingNote(selectedKrId, thisMonday),
      fetchLatestOkrAnalysis(selectedKrId),
      fetchKrReport(selectedKrId, thisMonday, "checkin"),
    ]).then(([n, a, r]) => {
      if (cancelled) return;
      setCycleNote(n.status === "fulfilled" ? (n.value as KrMeetingNote | null) : null);
      setCycleAnalysis(a.status === "fulfilled" ? (a.value as OkrAnalysis | null) : null);
      setCycleReport(r.status === "fulfilled" ? (r.value as KrReport | null) : null);
    });
    return () => { cancelled = true; };
  }, [inOkrGroup, selectedKrId, thisMonday, activeTool, refreshKey]);

  // M/D 整形は lib/date.ts の formatMD() に一元化済み（import 済み）。
  // ①②③④ それぞれの状態を { label, tone } で返す（tone: "done"=緑 / "wip"=黄 / "none"=灰）
  const cycleSteps = useMemo<{ tool: OkrActiveTool; name: string; label: string; tone: "done" | "wip" | "none" }[]>(() => {
    if (!selectedKrId) return [];
    const ses = krSessionsMap[selectedKrId] ?? [];
    const wkCheckin = ses.find(s => s.week_start === thisMonday && s.session_type === "checkin");
    const wkWin = ses.find(s => s.week_start === thisMonday && s.session_type === "win_session");
    const noteStep = cycleNote
      ? { label: "作成済み", tone: "done" as const }
      : { label: "未作成", tone: "none" as const };
    // ② セッション記録&分析（合体）：記録があれば「記録&分析済」。今週分のKR分析があれば付記。
    const hasAna = cycleAnalysis && cycleAnalysis.created_at.slice(0, 10) >= thisMonday;
    const sesStep = wkCheckin
      ? { label: hasAna ? "記録＆分析済み" : (wkWin ? "チェックイン＋ウィン済" : "チェックイン済"), tone: "done" as const }
      : wkWin ? { label: "ウィン済", tone: "wip" as const } : { label: "未記録", tone: "none" as const };
    const repStep = cycleReport
      ? (cycleReport.status === "finalized" ? { label: "確定済み", tone: "done" as const } : { label: "下書き（要確認）", tone: "wip" as const })
      : { label: "未作成", tone: "none" as const };
    return [
      { tool: "note" as const,    name: "① 会議ノート",          ...noteStep },
      { tool: "session" as const, name: "② セッション記録&分析", ...sesStep },
      { tool: "report" as const,  name: "③ レポート作成",         ...repStep },
    ];
  }, [selectedKrId, krSessionsMap, thisMonday, cycleNote, cycleAnalysis, cycleReport]);
  const CYCLE_TONE_COLOR: Record<string, string> = { done: "#16a34a", wip: "#ca8a04", none: "var(--color-text-tertiary)" };

  // 今週のセッション集計
  const thisWeekStats = useMemo(() => {
    let checkins = 0;
    let winSessions = 0;
    for (const sessions of Object.values(krSessionsMap)) {
      for (const s of sessions) {
        if (s.week_start !== thisMonday) continue;
        if (s.session_type === "checkin") checkins++;
        else winSessions++;
      }
    }
    return { checkins, winSessions };
  }, [krSessionsMap, thisMonday]);

  // 週次ガイダンスバナー（曜日依存なし）
  const guidanceBanner = useMemo((): {
    icon: string; text: string; action: "session" | null; color: string; urgent: boolean;
  } | null => {
    if (activeKrs.length === 0 || sessionsLoading) return null;
    const total = thisWeekStats.checkins + thisWeekStats.winSessions;
    if (total === 0) return {
      icon: "📋",
      text: "今週はまだ記録がありません",
      action: "session", color: "#6366f1", urgent: false,
    };
    return {
      icon: "✅",
      text: `今週の記録　チェックイン ${thisWeekStats.checkins} 件・ウィン ${thisWeekStats.winSessions} 件`,
      action: null, color: "#10b981", urgent: false,
    };
  }, [thisWeekStats, activeKrs.length, sessionsLoading]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* モードヘッダー */}
      <div style={{
        padding: "10px 20px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.04))",
        display: "flex", alignItems: "center", gap: "10px",
        flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", lineHeight: 1.3 }}>
            OKR管理モード
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
            Objective・KR の進捗を週次で記録・振り返るモードです
          </div>
        </div>
        <HelpButton modeKey="okr.cycle" title="OKR週次サイクル全体像のガイドを開く" />
      </div>

      {/* 上位タブバー（OKR管理 / なぜなぜ / 計画） */}
      <div style={{
        display: "flex", alignItems: "stretch",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-secondary)",
        overflowX: "auto", flexShrink: 0, scrollbarWidth: "none",
      } as React.CSSProperties}>
        {TOP_TABS.map(tab => {
          const isActive = tab.key === "okr" ? inOkrGroup : activeTool === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onSetActiveTool(tab.key === "okr" ? (inOkrGroup ? activeTool : "note") : tab.key)}
              style={{
                display: "flex", alignItems: "center", gap: "5px", padding: "10px 18px",
                background: "transparent", border: "none",
                borderBottom: `2px solid ${isActive ? "var(--color-brand)" : "transparent"}`,
                marginBottom: "-1px", fontSize: "13px", fontWeight: isActive ? "700" : "400",
                color: isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
                cursor: "pointer", whiteSpace: "nowrap", transition: "color 0.15s, border-color 0.15s", flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "14px" }}>{tab.icon}</span>{tab.label}
            </button>
          );
        })}
        {/* OKR・履歴ボタン（右端） */}
        <button
          onClick={() => setOverviewOpen(true)}
          title="Objective・KR の概要を開く"
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px", padding: "10px 14px",
            background: "transparent", border: "none", borderBottom: "2px solid transparent", marginBottom: "-1px",
            fontSize: "11px", fontWeight: "400", color: "var(--color-text-tertiary)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "14px" }}>🎯</span><span>OKR</span>
        </button>
        <button
          onClick={() => setHistoryOpen(true)}
          title="セッション履歴を開く"
          style={{
            display: "flex", alignItems: "center", gap: "4px", padding: "10px 14px",
            background: "transparent", border: "none", borderBottom: "2px solid transparent", marginBottom: "-1px",
            fontSize: "11px", fontWeight: "400", color: "var(--color-text-tertiary)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "14px" }}>🕐</span><span>履歴</span>
        </button>
      </div>

      {/* OKR管理のサブタブバー（①会議ノート → ②セッション記録&分析 → ③レポート作成） */}
      {inOkrGroup && (
        <div style={{
          display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-primary)", overflowX: "auto", flexShrink: 0, scrollbarWidth: "none",
          paddingLeft: "8px",
        } as React.CSSProperties}>
          {OKR_SUB_TABS.map(sub => {
            const isActive = activeTool === sub.tool;
            return (
              <button
                key={sub.tool ?? "overview"}
                onClick={() => onSetActiveTool(sub.tool)}
                style={{
                  display: "flex", alignItems: "center", gap: "4px", padding: "8px 14px",
                  background: "transparent", border: "none",
                  borderBottom: `2px solid ${isActive ? "var(--color-brand)" : "transparent"}`,
                  marginBottom: "-1px", fontSize: "12px", fontWeight: isActive ? "600" : "400",
                  color: isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
                  cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                {sub.label}
              </button>
            );
          })}
        </div>
      )}

      {/* サイクル進捗バー（KRが選ばれている時のみ表示。①→②→③のどこまで進んでいるか） */}
      {inOkrGroup && selectedKrId && (
        <div style={{
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
          padding: "8px 14px", borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)", flexShrink: 0,
        }}>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {(activeKrs.find(k => k.id === selectedKrId)?.title ?? "").slice(0, 18)}｜{formatMD(thisMonday)}週
          </span>
          {cycleSteps.map((st, i) => (
            <div key={st.tool ?? i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {i > 0 && <span style={{ color: "var(--color-text-tertiary)", fontSize: "11px" }}>›</span>}
              <button
                onClick={() => onSetActiveTool(st.tool)}
                title={`${st.name}：${st.label}`}
                style={{
                  display: "flex", alignItems: "center", gap: "5px", padding: "3px 9px", borderRadius: "var(--radius-full)",
                  border: `1px solid ${activeTool === st.tool ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                  background: activeTool === st.tool ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                  cursor: "pointer", fontSize: "10px", whiteSpace: "nowrap",
                  color: activeTool === st.tool ? "var(--color-brand)" : "var(--color-text-secondary)", fontWeight: activeTool === st.tool ? 600 : 400,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: CYCLE_TONE_COLOR[st.tone], flexShrink: 0 }} />
                {st.name}
              </button>
            </div>
          ))}
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>↩ 翌週へ</span>
        </div>
      )}

      {/* コンテンツエリア */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* ─── null（未選択）状態 ─── */}
        {activeTool === null && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
            <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px" }}>
              <div style={{ fontSize: "28px", marginBottom: "10px" }}>🎯</div>
              <div>上のタブを選択してください</div>
            </div>
          </div>
        )}

        {/* 概要は右上「🎯 OKR」ボタンからオーバーレイで表示（下部の overviewOpen ブロック参照） */}

        {/* ─── 会議ノートタブ（KR×週、中にTFごとのセクション） ─── */}
        {activeTool === "note" && (
          <KrMeetingNotePanel
            inline
            onClose={() => onSetActiveTool(null)}
            currentUser={currentUser}
            initialKrId={selectedKrId ?? undefined}
            onKrChange={id => onSelectKr(id || null)}
          />
        )}

        {/* ─── ② セッション記録（合同フロー一本：checkin / win_session / freeform） ─── */}
        {activeTool === "session" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <KrJointSessionFlow currentUser={currentUser} initialKrId={selectedKrId ?? undefined} onSaved={refreshSessions} />
          </div>
        )}

        {/* ─── 互換：旧「③ 分析」（タブからは消えたが localStorage 互換のため残置） ─── */}
        {activeTool === "analysis" && (
          <OkrKrAnalysisPanel
            inline
            onClose={() => onSetActiveTool(null)}
            currentUser={currentUser}
            initialKrId={selectedKrId ?? undefined}
          />
        )}

        {/* ─── ④ レポート作成 ─── */}
        {activeTool === "report" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flexShrink: 0, padding: "8px 16px", borderBottom: "1px solid var(--color-border-primary)", background: "var(--color-bg-secondary)", fontSize: "11px", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>💡</span>
              <span style={{ flex: 1 }}>「② セッション記録&分析」で議事メモから分析を生成しておくと、その内容がそのままレポートの素材になります。</span>
              <button onClick={() => onSetActiveTool("session")} style={{ fontSize: "11px", padding: "3px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>② セッションへ</button>
            </div>
            <KrReportPanel
              inline
              onClose={() => onSetActiveTool(null)}
              currentUser={currentUser}
              initialKrId={selectedKrId ?? undefined}
            />
          </div>
        )}

        {/* ─── なぜなぜタブ ─── */}
        {activeTool === "why" && (
          <KrWhyPanel
            inline
            onClose={() => onSetActiveTool(null)}
            currentUser={currentUser}
            initialKrId={selectedKrId ?? undefined}
          />
        )}

        {/* ─── クォーター計画タブ ─── */}
        {activeTool === "plan" && (
          <KrQuarterPlanPanel
            inline
            onClose={() => onSetActiveTool(null)}
            currentUser={currentUser}
            initialKrId={selectedKrId ?? undefined}
          />
        )}

      </div>

      {/* ─── 概要オーバーレイ（右上「🎯 OKR」ボタンから開く） ─── */}
      {overviewOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 300,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "stretch", justifyContent: "flex-end",
          }}
          onClick={e => { if (e.target === e.currentTarget) setOverviewOpen(false); }}
        >
          <div
            className="panel-slide-up"
            style={{
              width: "min(820px, 100vw)",
              background: "var(--color-bg-primary)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--color-border-primary)",
              display: "flex", alignItems: "center", gap: "10px",
              flexShrink: 0,
            }}>
              <span style={{ fontSize: "18px" }}>🎯</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                  OKR概要
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
                  Objective・KR の一覧と週次ガイダンス（KRを選ぶと作業画面のサイクル進捗に反映されます）
                </div>
              </div>
              <button
                onClick={() => setOverviewOpen(false)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1,
                }}
              >✕</button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* 週次ガイダンスバナー */}
              {guidanceBanner && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "12px 16px",
                  background: `${guidanceBanner.color}18`,
                  border: `1px solid ${guidanceBanner.color}40`,
                  borderLeft: `3px solid ${guidanceBanner.color}`,
                  borderRadius: "var(--radius-md)",
                }}>
                  <span style={{ fontSize: "16px" }}>{guidanceBanner.icon}</span>
                  <div style={{
                    flex: 1, fontSize: "13px",
                    fontWeight: guidanceBanner.urgent ? "600" : "400",
                    color: "var(--color-text-primary)",
                  }}>
                    {guidanceBanner.text}
                  </div>
                  {guidanceBanner.action && (
                    <button
                      onClick={() => { onSetActiveTool(guidanceBanner.action!); setOverviewOpen(false); }}
                      style={{
                        padding: "6px 14px", fontSize: "12px", fontWeight: "600",
                        background: guidanceBanner.color, color: "#fff",
                        border: "none", borderRadius: "var(--radius-md)", cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >記録する →</button>
                  )}
                </div>
              )}

              {/* Objective ヘッダー */}
              {objective ? (
                <div style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.06))",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: "var(--radius-lg)", padding: "20px 24px",
                }}>
                  <div style={{ fontSize: "10px", fontWeight: "600", color: "#6366f1", letterSpacing: "0.08em", marginBottom: "6px", textTransform: "uppercase" }}>
                    Objective · {objective.period}
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                    {objective.title}
                  </div>
                  {objective.purpose && (
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px", lineHeight: 1.6 }}>
                      {objective.purpose}
                    </div>
                  )}
                  <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    KR {activeKrs.length}件 · TF {activeTfs.length}件
                  </div>
                </div>
              ) : (
                <div style={{
                  background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-lg)", padding: "20px 24px",
                  fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center",
                }}>
                  Objectiveが設定されていません。設定から登録してください。
                </div>
              )}

              {/* KR カード一覧 */}
              {activeKrs.length > 0 && (
                <div>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.06em", marginBottom: "10px", textTransform: "uppercase" }}>
                    Key Results
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {activeKrs.map(kr => {
                      const stat = krStats.find(s => s.krId === kr.id);
                      const isSelected = kr.id === selectedKrId;
                      const progressPct = calcProgressPct(stat?.done ?? 0, stat?.total ?? 0);
                      const sessions = krSessionsMap[kr.id] ?? [];
                      const latestSession = sessions[0] ?? null;
                      const thisWeekCheckin = sessions.find(s => s.week_start === thisMonday && s.session_type === "checkin");
                      const thisWeekWin = sessions.find(s => s.week_start === thisMonday && s.session_type === "win_session");
                      return (
                        <div
                          key={kr.id}
                          onClick={() => onSelectKr(isSelected ? null : kr.id)}
                          style={{
                            background: isSelected ? "rgba(99,102,241,0.06)" : "var(--color-bg-secondary)",
                            border: `1px solid ${isSelected ? "rgba(99,102,241,0.35)" : "var(--color-border-primary)"}`,
                            borderRadius: "var(--radius-lg)", padding: "14px 16px",
                            cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            {/* 選択インジケーター */}
                            <div style={{
                              width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, marginTop: "2px",
                              background: isSelected ? "#6366f1" : "var(--color-bg-tertiary)",
                              border: `2px solid ${isSelected ? "#6366f1" : "var(--color-border-primary)"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {isSelected && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#fff" }} />}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* KRタイトル + 最新シグナル */}
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                                  {kr.title}
                                </span>
                                {latestSession?.signal && (
                                  <span style={{
                                    fontSize: "11px", padding: "1px 8px",
                                    background: `${SIGNAL_COLOR[latestSession.signal]}14`,
                                    color: SIGNAL_COLOR[latestSession.signal],
                                    border: `1px solid ${SIGNAL_COLOR[latestSession.signal]}40`,
                                    borderRadius: "var(--radius-full)", fontWeight: "600", whiteSpace: "nowrap",
                                  }}>
                                    {SIGNAL_DOT[latestSession.signal]} 最新シグナル
                                  </span>
                                )}
                              </div>

                              {/* 今週の記録状態 */}
                              {(thisWeekCheckin || thisWeekWin) && (
                                <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                                  {thisWeekCheckin?.signal && (
                                    <span style={{
                                      fontSize: "10px", padding: "2px 8px",
                                      background: `${SIGNAL_COLOR[thisWeekCheckin.signal]}12`,
                                      border: `1px solid ${SIGNAL_COLOR[thisWeekCheckin.signal]}40`,
                                      color: SIGNAL_COLOR[thisWeekCheckin.signal],
                                      borderRadius: "var(--radius-full)",
                                    }}>
                                      🗓️ チェックイン済 {SIGNAL_DOT[thisWeekCheckin.signal]}
                                    </span>
                                  )}
                                  {thisWeekWin?.signal && (
                                    <span style={{
                                      fontSize: "10px", padding: "2px 8px",
                                      background: `${SIGNAL_COLOR[thisWeekWin.signal]}12`,
                                      border: `1px solid ${SIGNAL_COLOR[thisWeekWin.signal]}40`,
                                      color: SIGNAL_COLOR[thisWeekWin.signal],
                                      borderRadius: "var(--radius-full)",
                                    }}>
                                      🏆 ウィン済 {SIGNAL_DOT[thisWeekWin.signal]}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* TF チップ */}
                              {stat && stat.tfs.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
                                  {stat.tfs.map(tf => (
                                    <span key={tf.id} style={{
                                      fontSize: "10px", padding: "2px 7px",
                                      background: "var(--color-bg-tertiary)",
                                      border: "1px solid var(--color-border-primary)",
                                      borderRadius: "var(--radius-sm)",
                                      color: "var(--color-text-secondary)",
                                    }}>
                                      TF{tf.tf_number} {tf.name}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* タスク進捗バー */}
                              {stat && stat.total > 0 && (
                                <div style={{ marginTop: "10px" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>タスク進捗</span>
                                    <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", fontWeight: "600" }}>
                                      {stat.done}/{stat.total} ({progressPct}%)
                                    </span>
                                  </div>
                                  <div style={{ height: "3px", background: "var(--color-bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                                    <div style={{
                                      height: "100%", width: `${progressPct}%`,
                                      background: progressPct >= 60 ? "#10b981" : progressPct >= 40 ? "#f59e0b" : "#6366f1",
                                      borderRadius: "2px", transition: "width 0.4s",
                                    }} />
                                  </div>
                                </div>
                              )}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end", flexShrink: 0 }}>
                              {/* なぜなぜ分析ボタン */}
                              <button
                                onClick={e => { e.stopPropagation(); onSelectKr(kr.id); onSetActiveTool("why"); setOverviewOpen(false); }}
                                title="このKRをなぜなぜ分析"
                                style={{
                                  padding: "4px 8px", fontSize: "10px",
                                  background: "transparent",
                                  border: "1px solid var(--color-border-primary)",
                                  borderRadius: "var(--radius-sm)",
                                  color: "var(--color-text-tertiary)", cursor: "pointer", whiteSpace: "nowrap",
                                }}
                              >🔍 分析</button>
                              {/* 最終記録日時 */}
                              {latestSession && (
                                <div style={{ fontSize: "9px", color: "var(--color-text-tertiary)", textAlign: "right", lineHeight: 1.4 }}>
                                  <div>最終記録</div>
                                  <div>{latestSession.week_start}</div>
                                  <div>{SESSION_TYPE_LABEL[latestSession.session_type]}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── 履歴オーバーレイ ─── */}
      {historyOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 300,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "stretch", justifyContent: "flex-end",
          }}
          onClick={e => { if (e.target === e.currentTarget) setHistoryOpen(false); }}
        >
          <div
            className="panel-slide-up"
            style={{
              width: "min(680px, 100vw)",
              background: "var(--color-bg-primary)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--color-border-primary)",
              display: "flex", alignItems: "center", gap: "10px",
              flexShrink: 0,
            }}>
              <span style={{ fontSize: "18px" }}>🕐</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                  セッション履歴
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
                  チェックイン・ウィンセッションの過去記録（編集・削除可）
                </div>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1,
                }}
              >✕</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <KrSessionHistory
                selectedKrId={selectedKrId}
                activeKrs={activeKrs}
                krSessionsMap={krSessionsMap}
                loading={sessionsLoading}
                onSelectKr={onSelectKr}
                onOpenSession={() => { setHistoryOpen(false); onSetActiveTool("session"); }}
                onRefresh={refreshSessions}
                currentUserId={currentUser.id}
                members={members}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== セッション履歴コンポーネント =====

type EditDraft = {
  session_type: "checkin" | "win_session" | "freeform";
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  learnings: string;
};

// セッションの詳細（宣言・学び・外部環境・freeform要素・文字起こし）を展開表示する
function SessionDetailBlock({ session, declarations, loading, memberById }: {
  session: KrSession;
  declarations: KrDeclaration[] | undefined;
  loading: boolean;
  memberById: Map<string, Member>;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const RESULT_LABEL: Record<string, string> = { achieved: "✅ 達成", partial: "🔶 一部達成", not_achieved: "❌ 未達" };
  const decls = declarations ?? [];
  const declTitle = session.session_type === "checkin" ? "今週の宣言（誰が・何を・いつまでに）"
    : session.session_type === "win_session" ? "フォローアップ宣言" : "宣言・フォローアップ";
  const labelStyle: React.CSSProperties = { fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)" };
  const bodyStyle: React.CSSProperties = { fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" };
  return (
    <div style={{ marginTop: "8px", marginLeft: "22px", padding: "10px 12px", background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div>
        <div style={{ ...labelStyle, marginBottom: "6px" }}>{declTitle}</div>
        {loading && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>}
        {!loading && decls.length === 0 && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>宣言の記録はありません</div>}
        {decls.map(d => {
          const m = memberById.get(d.member_id);
          return (
            <div key={d.id} style={{ display: "flex", gap: "7px", marginBottom: "6px", fontSize: "12px", lineHeight: 1.6 }}>
              <span style={{ flexShrink: 0, fontWeight: 600, color: "var(--color-text-primary)" }}>{m?.short_name ?? "（不明）"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--color-text-secondary)" }}>{d.content || "（内容なし）"}</div>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
                  {d.due_date ? `期日: ${d.due_date}` : "期日なし"}
                  {d.result_status && <> ／ 結果: {RESULT_LABEL[d.result_status] ?? d.result_status}{d.result_note ? `（${d.result_note}）` : ""}</>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(session.learnings || session.external_changes) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {session.learnings && <div><span style={labelStyle}>学び：</span><span style={bodyStyle}>{session.learnings}</span></div>}
          {session.external_changes && <div><span style={labelStyle}>外部環境の変化：</span><span style={bodyStyle}>{session.external_changes}</span></div>}
        </div>
      )}

      {session.summary && <div><span style={labelStyle}>議論サマリ：</span><span style={bodyStyle}>{session.summary}</span></div>}
      {session.decisions && <div><span style={labelStyle}>決定事項：</span><span style={bodyStyle}>{session.decisions}</span></div>}
      {session.kr_mentions && <div><span style={labelStyle}>言及されたKR：</span><span style={bodyStyle}>{session.kr_mentions}</span></div>}

      {session.transcript && (
        <div>
          <button onClick={() => setShowTranscript(v => !v)} style={{ fontSize: "10px", background: "transparent", border: "none", color: "var(--color-brand)", cursor: "pointer", padding: 0 }}>
            {showTranscript ? "▲ 文字起こし・議事メモを閉じる" : "▼ 文字起こし・議事メモを見る"}
          </button>
          {showTranscript && (
            <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: "260px", overflow: "auto", background: "var(--color-bg-secondary)", padding: "8px 10px", borderRadius: "var(--radius-sm)" }}>{session.transcript}</div>
          )}
        </div>
      )}
    </div>
  );
}

function KrSessionHistory({
  selectedKrId, activeKrs, krSessionsMap, loading, onSelectKr, onOpenSession, onRefresh, currentUserId, members,
}: {
  selectedKrId: string | null;
  activeKrs: { id: string; title: string }[];
  krSessionsMap: Record<string, KrSession[]>;
  loading: boolean;
  onSelectKr: (id: string | null) => void;
  onOpenSession: () => void;
  onRefresh: () => void;
  currentUserId: string;
  members: Member[];
}) {
  const [filterKrId, setFilterKrId] = useState(selectedKrId ?? "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [declCache, setDeclCache] = useState<Record<string, KrDeclaration[]>>({});
  const [declLoading, setDeclLoading] = useState<Record<string, boolean>>({});

  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  const toggleDetail = useCallback((sessionId: string) => {
    setExpandedId(prev => {
      const next = prev === sessionId ? null : sessionId;
      if (next && declCache[next] === undefined && !declLoading[next]) {
        setDeclLoading(s => ({ ...s, [next]: true }));
        fetchKrDeclarations(next)
          .then(rows => setDeclCache(c => ({ ...c, [next]: rows })))
          .catch((e: unknown) => { console.warn("宣言の取得に失敗:", e); setDeclCache(c => ({ ...c, [next]: [] })); })
          .finally(() => setDeclLoading(s => ({ ...s, [next]: false })));
      }
      return next;
    });
  }, [declCache, declLoading]);

  useEffect(() => {
    setFilterKrId(selectedKrId ?? "");
  }, [selectedKrId]);

  const displayKrs = filterKrId ? activeKrs.filter(kr => kr.id === filterKrId) : activeKrs;

  const weekGroups = useMemo(() => {
    const all: (KrSession & { krTitle: string })[] = [];
    for (const kr of displayKrs) {
      for (const s of krSessionsMap[kr.id] ?? []) {
        all.push({ ...s, krTitle: kr.title });
      }
    }
    all.sort((a, b) => b.week_start.localeCompare(a.week_start) || b.session_type.localeCompare(a.session_type));
    const groups: { weekStart: string; sessions: (KrSession & { krTitle: string })[] }[] = [];
    for (const s of all) {
      const last = groups[groups.length - 1];
      if (!last || last.weekStart !== s.week_start) {
        groups.push({ weekStart: s.week_start, sessions: [s] });
      } else {
        last.sessions.push(s);
      }
    }
    return groups;
  }, [displayKrs, krSessionsMap]);

  const startEdit = (session: KrSession) => {
    setEditingId(session.id);
    setDeleteConfirmId(null);
    setEditDraft({
      session_type: session.session_type,
      signal: session.signal,
      signal_comment: session.signal_comment,
      learnings: session.learnings,
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };

  const handleSave = async (sessionId: string) => {
    if (!editDraft) return;
    setSavingId(sessionId);
    try {
      await updateKrSession(sessionId, {
        session_type: editDraft.session_type,
        signal: editDraft.signal,
        signal_comment: editDraft.signal_comment,
        learnings: editDraft.learnings,
      }, currentUserId);
      setEditingId(null);
      setEditDraft(null);
      onRefresh();
    } catch {
      // error silently — user can retry
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (sessionId: string) => {
    setDeletingId(sessionId);
    try {
      await softDeleteKrSession(sessionId, currentUserId);
      setDeleteConfirmId(null);
      onRefresh();
    } catch {
      // error silently
    } finally {
      setDeletingId(null);
    }
  };

  const SIGNAL_OPTIONS: { value: "green" | "yellow" | "red"; label: string; tip: string }[] = [
    { value: "green",  label: "🟢 順調",   tip: "KR進捗 60% 以上の見込み" },
    { value: "yellow", label: "🟡 注意",   tip: "KR進捗 50〜59% の見込み（テコ入れ検討）" },
    { value: "red",    label: "🔴 要対応", tip: "KR進捗 49% 以下の見込み（即対応）" },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: "12px",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    boxSizing: "border-box",
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>セッション履歴</div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            チェックイン・ウィンセッションの過去記録（編集・削除可）
          </div>
        </div>
        <CustomSelect
          value={filterKrId}
          onChange={value => { setFilterKrId(value); onSelectKr(value || null); }}
          options={[
            { value: "", label: "全KR" },
            ...activeKrs.map(kr => ({ value: kr.id, label: kr.title })),
          ]}
          searchable searchPlaceholder="KRで検索..."
          style={{ width: "200px" }} />
      </div>

      {loading && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>読み込み中...</div>}

      {!loading && weekGroups.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>📋</div>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "6px" }}>記録がまだありません</div>
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginBottom: "16px" }}>チェックインまたはウィンセッションを記録してみましょう</div>
          <button onClick={onOpenSession} style={{ padding: "8px 20px", fontSize: "12px", fontWeight: "600", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}>
            🗓️ セッションを記録する
          </button>
        </div>
      )}

      {weekGroups.map(group => (
        <div key={group.weekStart}>
          <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid var(--color-border-primary)" }}>
            週：{group.weekStart}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {group.sessions.map(session => {
              const isEditing = editingId === session.id;
              const isDeleteConfirm = deleteConfirmId === session.id;

              return (
                <div
                  key={session.id}
                  style={{
                    background: "var(--color-bg-secondary)",
                    border: `1px solid ${isEditing ? "rgba(99,102,241,0.4)" : "var(--color-border-primary)"}`,
                    borderLeft: `3px solid ${session.signal ? SIGNAL_COLOR[session.signal] : "var(--color-border-primary)"}`,
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                  }}
                >
                  {/* 表示モード */}
                  {!isEditing && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: session.signal_comment ? "6px" : "0" }}>
                        <span style={{ fontSize: "14px" }}>{SESSION_TYPE_ICON[session.session_type]}</span>
                        <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>
                          {SESSION_TYPE_LABEL[session.session_type]}
                        </span>
                        {session.signal && (
                          <span style={{ fontSize: "11px", padding: "1px 8px", background: `${SIGNAL_COLOR[session.signal]}14`, color: SIGNAL_COLOR[session.signal], border: `1px solid ${SIGNAL_COLOR[session.signal]}40`, borderRadius: "var(--radius-full)", fontWeight: "600" }}>
                            {SIGNAL_DOT[session.signal]}
                          </span>
                        )}
                        {displayKrs.length > 1 && (
                          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                            {session.krTitle.length > 20 ? session.krTitle.slice(0, 20) + "…" : session.krTitle}
                          </span>
                        )}
                        <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexShrink: 0 }}>
                          <button
                            onClick={() => startEdit(session)}
                            style={{ fontSize: "10px", padding: "3px 8px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                          >編集</button>
                          {isDeleteConfirm ? (
                            <>
                              <button
                                onClick={() => handleDelete(session.id)}
                                disabled={deletingId === session.id}
                                style={{ fontSize: "10px", padding: "3px 8px", background: "#dc2626", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", cursor: "pointer", fontWeight: "600" }}
                              >{deletingId === session.id ? "削除中…" : "本当に削除"}</button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={{ fontSize: "10px", padding: "3px 8px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-tertiary)", cursor: "pointer" }}
                              >キャンセル</button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(session.id)}
                              style={{ fontSize: "10px", padding: "3px 8px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-tertiary)", cursor: "pointer" }}
                            >削除</button>
                          )}
                        </div>
                      </div>
                      {session.signal_comment && (
                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5, paddingLeft: "22px" }}>{session.signal_comment}</div>
                      )}
                      <div style={{ marginTop: "6px", paddingLeft: "22px" }}>
                        <button
                          onClick={() => toggleDetail(session.id)}
                          style={{ fontSize: "10px", background: "transparent", border: "none", color: "var(--color-brand)", cursor: "pointer", padding: 0 }}
                        >
                          {expandedId === session.id ? "▲ 詳細を閉じる" : "▼ 宣言・記録の詳細を見る"}
                        </button>
                      </div>
                      {expandedId === session.id && (
                        <SessionDetailBlock
                          session={session}
                          declarations={declCache[session.id]}
                          loading={!!declLoading[session.id]}
                          memberById={memberById}
                        />
                      )}
                    </>
                  )}

                  {/* 編集モード */}
                  {isEditing && editDraft && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "600", color: "#6366f1", marginBottom: "2px" }}>編集中</div>

                      {/* 種類 */}
                      <div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>種類</div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {(["checkin", "win_session"] as const).map(t => (
                            <label key={t} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", cursor: "pointer" }}>
                              <input type="radio" name={`type-${session.id}`} checked={editDraft.session_type === t} onChange={() => setEditDraft({ ...editDraft, session_type: t })} />
                              {SESSION_TYPE_ICON[t]} {SESSION_TYPE_LABEL[t]}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* シグナル */}
                      <div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                          シグナル <span style={{ fontSize: "10px" }}>（🟢60%以上 / 🟡50〜59% / 🔴49%以下）</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {SIGNAL_OPTIONS.map(opt => (
                            <label key={opt.value} title={opt.tip} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", cursor: "pointer" }}>
                              <input type="radio" name={`signal-${session.id}`} checked={editDraft.signal === opt.value} onChange={() => setEditDraft({ ...editDraft, signal: opt.value })} />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* シグナルコメント */}
                      <div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>シグナルコメント</div>
                        <textarea
                          value={editDraft.signal_comment}
                          onChange={e => setEditDraft({ ...editDraft, signal_comment: e.target.value })}
                          rows={2}
                          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                        />
                      </div>

                      {/* 学び（ウィン時のみ） */}
                      {editDraft.session_type === "win_session" && (
                        <div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>学び・外部環境変化</div>
                          <textarea
                            value={editDraft.learnings}
                            onChange={e => setEditDraft({ ...editDraft, learnings: e.target.value })}
                            rows={3}
                            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                          />
                        </div>
                      )}

                      {/* ボタン */}
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => handleSave(session.id)}
                          disabled={savingId === session.id}
                          style={{ flex: 1, padding: "7px", fontSize: "12px", fontWeight: "600", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}
                        >{savingId === session.id ? "保存中…" : "保存"}</button>
                        <button
                          onClick={cancelEdit}
                          style={{ padding: "7px 14px", fontSize: "12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                        >キャンセル</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

