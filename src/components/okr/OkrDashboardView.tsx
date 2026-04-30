// src/components/okr/OkrDashboardView.tsx
// OKR管理モードのメインビュー。タブ型UI：概要/セッション記録/レポート/なぜなぜ/履歴

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";
import { KrSessionPanel } from "../lab/KrSessionPanel";
import { KrReportPanel } from "../lab/KrReportPanel";
import { KrWhyPanel } from "../lab/KrWhyPanel";
import { fetchKrSessions, type KrSession } from "../../lib/supabase/krSessionStore";

export type OkrActiveTool = "session" | "report" | "why" | "history" | null;

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
  checkin: "チェックイン", win_session: "ウィンセッション",
};
const SESSION_TYPE_ICON: Record<string, string> = {
  checkin: "🗓️", win_session: "🏆",
};

function getThisMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const TABS: { tool: OkrActiveTool; icon: string; label: string }[] = [
  { tool: null,      icon: "🎯", label: "概要" },
  { tool: "session", icon: "🗓️", label: "セッション記録" },
  { tool: "report",  icon: "📊", label: "レポート" },
  { tool: "why",     icon: "🔍", label: "なぜなぜ" },
  { tool: "history", icon: "📋", label: "履歴" },
];

export function OkrDashboardView({
  currentUser, selectedKrId, onSelectKr, activeTool, onSetActiveTool,
}: Props) {
  const { objective, keyResults, taskForces, tasks, todos } = useAppData();

  const activeKrs = useMemo(
    () => (keyResults ?? []).filter(kr => !kr.is_deleted),
    [keyResults],
  );
  const activeTfs = useMemo(
    () => (taskForces ?? []).filter(tf => !tf.is_deleted),
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
  const todayDow = new Date().getDay(); // 0=日 1=月 … 5=金

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

  // 週次ガイダンスバナー
  const guidanceBanner = useMemo((): {
    icon: string; text: string; action: "session" | null; color: string; urgent: boolean;
  } | null => {
    if (activeKrs.length === 0 || sessionsLoading) return null;
    if (todayDow === 1) {
      if (thisWeekStats.checkins === 0)
        return { icon: "🗓️", text: "今週のチェックインをまだ記録していません", action: "session", color: "#3b82f6", urgent: true };
      return { icon: "✅", text: `チェックイン記録済み（${thisWeekStats.checkins} / ${activeKrs.length} KR）`, action: null, color: "#16a34a", urgent: false };
    }
    if (todayDow === 5) {
      if (thisWeekStats.winSessions === 0)
        return { icon: "🏆", text: "今週のウィンセッションをまだ記録していません", action: "session", color: "#f59e0b", urgent: true };
      return { icon: "✅", text: `ウィンセッション記録済み（${thisWeekStats.winSessions} / ${activeKrs.length} KR）`, action: null, color: "#16a34a", urgent: false };
    }
    const total = thisWeekStats.checkins + thisWeekStats.winSessions;
    if (total === 0) return null;
    return {
      icon: "📋",
      text: `今週の記録　チェックイン ${thisWeekStats.checkins} 件・ウィン ${thisWeekStats.winSessions} 件`,
      action: null, color: "#6366f1", urgent: false,
    };
  }, [todayDow, thisWeekStats, activeKrs.length, sessionsLoading]);

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
        <span style={{ fontSize: "16px" }}>🎯</span>
        <div>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", lineHeight: 1.3 }}>
            OKR管理モード
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
            Objective・KR の進捗を週次で記録・振り返るモードです
          </div>
        </div>
      </div>

      {/* タブバー */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-secondary)",
        overflowX: "auto", flexShrink: 0,
        scrollbarWidth: "none",
      } as React.CSSProperties}>
        {TABS.map(tab => {
          const isActive = activeTool === tab.tool;
          return (
            <button
              key={tab.tool ?? "overview"}
              onClick={() => onSetActiveTool(tab.tool)}
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                padding: "10px 16px",
                background: "transparent", border: "none",
                borderBottom: `2px solid ${isActive ? "var(--color-brand)" : "transparent"}`,
                marginBottom: "-1px",
                fontSize: "12px", fontWeight: isActive ? "600" : "400",
                color: isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
                cursor: "pointer", whiteSpace: "nowrap",
                transition: "color 0.15s, border-color 0.15s",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "13px" }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* コンテンツエリア */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* ─── 概要タブ ─── */}
        {activeTool === null && (
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
                    onClick={() => onSetActiveTool(guidanceBanner.action!)}
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
                    const progressPct = stat && stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0;
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

                          {/* なぜなぜ分析ボタン */}
                          <button
                            onClick={e => { e.stopPropagation(); onSelectKr(kr.id); onSetActiveTool("why"); }}
                            title="このKRをなぜなぜ分析"
                            style={{
                              flexShrink: 0, padding: "4px 8px", fontSize: "10px",
                              background: "transparent",
                              border: "1px solid var(--color-border-primary)",
                              borderRadius: "var(--radius-sm)",
                              color: "var(--color-text-tertiary)", cursor: "pointer", whiteSpace: "nowrap",
                            }}
                          >🔍 分析</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── セッション記録タブ ─── */}
        {activeTool === "session" && (
          <KrSessionPanel
            inline
            onClose={() => onSetActiveTool(null)}
            currentUser={currentUser}
            initialKrId={selectedKrId ?? undefined}
            onSaved={refreshSessions}
          />
        )}

        {/* ─── レポートタブ ─── */}
        {activeTool === "report" && (
          <KrReportPanel
            inline
            onClose={() => onSetActiveTool(null)}
            currentUser={currentUser}
            initialKrId={selectedKrId ?? undefined}
          />
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

        {/* ─── 履歴タブ ─── */}
        {activeTool === "history" && (
          <KrSessionHistory
            selectedKrId={selectedKrId}
            activeKrs={activeKrs}
            krSessionsMap={krSessionsMap}
            loading={sessionsLoading}
            onSelectKr={onSelectKr}
            onOpenSession={() => onSetActiveTool("session")}
          />
        )}
      </div>
    </div>
  );
}

// ===== セッション履歴コンポーネント =====

function KrSessionHistory({
  selectedKrId, activeKrs, krSessionsMap, loading, onSelectKr, onOpenSession,
}: {
  selectedKrId: string | null;
  activeKrs: { id: string; title: string }[];
  krSessionsMap: Record<string, KrSession[]>;
  loading: boolean;
  onSelectKr: (id: string | null) => void;
  onOpenSession: () => void;
}) {
  const [filterKrId, setFilterKrId] = useState(selectedKrId ?? "");

  useEffect(() => {
    setFilterKrId(selectedKrId ?? "");
  }, [selectedKrId]);

  const displayKrs = filterKrId ? activeKrs.filter(kr => kr.id === filterKrId) : activeKrs;

  // 全セッションを week_start 降順で並べてグループ化
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

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>セッション履歴</div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            チェックイン・ウィンセッションの過去記録
          </div>
        </div>
        <select
          value={filterKrId}
          onChange={e => { setFilterKrId(e.target.value); onSelectKr(e.target.value || null); }}
          style={{
            fontSize: "12px", padding: "6px 10px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
        >
          <option value="">全KR</option>
          {activeKrs.map(kr => (
            <option key={kr.id} value={kr.id}>{kr.title}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>
          読み込み中...
        </div>
      )}

      {!loading && weekGroups.length === 0 && (
        <div style={{
          textAlign: "center", padding: "48px 24px",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)",
        }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>📋</div>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "6px" }}>
            記録がまだありません
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginBottom: "16px" }}>
            チェックインまたはウィンセッションを記録してみましょう
          </div>
          <button
            onClick={onOpenSession}
            style={{
              padding: "8px 20px", fontSize: "12px", fontWeight: "600",
              background: "var(--color-brand)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >🗓️ セッションを記録する</button>
        </div>
      )}

      {weekGroups.map(group => (
        <div key={group.weekStart}>
          <div style={{
            fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)",
            letterSpacing: "0.04em", marginBottom: "8px",
            paddingBottom: "6px",
            borderBottom: "1px solid var(--color-border-primary)",
          }}>
            週：{group.weekStart}（月曜）
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {group.sessions.map(session => (
              <div
                key={session.id}
                style={{
                  background: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-primary)",
                  borderLeft: `3px solid ${session.signal ? SIGNAL_COLOR[session.signal] : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: session.signal_comment ? "6px" : "0" }}>
                  <span style={{ fontSize: "14px" }}>{SESSION_TYPE_ICON[session.session_type]}</span>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>
                    {SESSION_TYPE_LABEL[session.session_type]}
                  </span>
                  {session.signal && (
                    <span style={{
                      fontSize: "11px", padding: "1px 8px",
                      background: `${SIGNAL_COLOR[session.signal]}14`,
                      color: SIGNAL_COLOR[session.signal],
                      border: `1px solid ${SIGNAL_COLOR[session.signal]}40`,
                      borderRadius: "var(--radius-full)", fontWeight: "600",
                    }}>
                      {SIGNAL_DOT[session.signal]}
                    </span>
                  )}
                  {displayKrs.length > 1 && (
                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginLeft: "auto", flexShrink: 0 }}>
                      {session.krTitle.length > 24 ? session.krTitle.slice(0, 24) + "…" : session.krTitle}
                    </span>
                  )}
                </div>
                {session.signal_comment && (
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5, paddingLeft: "22px" }}>
                    {session.signal_comment}
                  </div>
                )}
                {session.learnings && session.session_type === "win_session" && (
                  <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "4px", paddingLeft: "22px", lineHeight: 1.5 }}>
                    学び：{session.learnings.length > 100 ? session.learnings.slice(0, 100) + "…" : session.learnings}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
