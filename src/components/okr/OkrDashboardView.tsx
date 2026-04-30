// src/components/okr/OkrDashboardView.tsx
// OKR管理モードのメインビュー。Objective・KR・TFの概要と3つのAIツールへのショートカットを表示。

import { useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";

interface Props {
  currentUser: Member;
  selectedKrId: string | null;
  onSelectKr: (id: string | null) => void;
  onOpenKrSession: () => void;
  onOpenKrReport: () => void;
  onOpenKrWhy: () => void;
}

export function OkrDashboardView({
  selectedKrId,
  onSelectKr,
  onOpenKrSession,
  onOpenKrReport,
  onOpenKrWhy,
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

  // KRごとのタスク件数（進行中・完了）
  const krStats = useMemo(() => {
    return activeKrs.map(kr => {
      const tfs = activeTfs.filter(tf => tf.kr_id === kr.id);
      const tfIds = new Set(tfs.map(tf => tf.id));
      const todoIds = new Set(
        (todos ?? []).filter(t => !t.is_deleted && tfIds.has(t.tf_id)).map(t => t.id),
      );
      const krTasks = (tasks ?? []).filter(t => !t.is_deleted && t.todo_ids?.some(id => todoIds.has(id)));
      const done = krTasks.filter(t => t.status === "done").length;
      const total = krTasks.length;
      return { krId: kr.id, tfs, done, total };
    });
  }, [activeKrs, activeTfs, todos, tasks]);

  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;

  const AI_TOOLS = [
    {
      icon: "🗓️",
      label: "KRセッション記録",
      desc: "チェックイン・ウィンセッションの文字起こしを貼り付けて宣言と達成状況を記録",
      color: "#3b82f6",
      onClick: onOpenKrSession,
    },
    {
      icon: "📊",
      label: "KRレポート生成",
      desc: "議事メモからOKR進捗レポートをAIで自動生成",
      color: "#8b5cf6",
      onClick: onOpenKrReport,
    },
    {
      icon: "🔍",
      label: "KRなぜなぜ分析",
      desc: "AIとの対話で課題の根本原因を5Whys形式で掘り下げる",
      color: "#10b981",
      onClick: onOpenKrWhy,
    },
  ];

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: "24px" }}>

      {/* Objective ヘッダー */}
      {objective ? (
        <div style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.06))",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: "var(--radius-lg)",
          padding: "20px 24px",
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
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)",
          padding: "20px 24px",
          fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center",
        }}>
          Objectiveが設定されていません。管理画面から登録してください。
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
              return (
                <div
                  key={kr.id}
                  onClick={() => onSelectKr(isSelected ? null : kr.id)}
                  style={{
                    background: isSelected ? "rgba(99,102,241,0.06)" : "var(--color-bg-secondary)",
                    border: `1px solid ${isSelected ? "rgba(99,102,241,0.35)" : "var(--color-border-primary)"}`,
                    borderRadius: "var(--radius-lg)",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <div style={{
                      width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
                      background: isSelected ? "#6366f1" : "var(--color-bg-tertiary)",
                      border: `2px solid ${isSelected ? "#6366f1" : "var(--color-border-primary)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isSelected && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#fff" }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                        {kr.title}
                      </div>

                      {/* TF一覧 */}
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

                    {/* AI分析ボタン */}
                    <button
                      onClick={e => { e.stopPropagation(); onSelectKr(kr.id); onOpenKrWhy(); }}
                      title="このKRをなぜなぜ分析"
                      style={{
                        flexShrink: 0, padding: "4px 8px", fontSize: "10px",
                        background: "transparent",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--color-text-tertiary)", cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      🔍 分析
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AIツール */}
      <div>
        <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.06em", marginBottom: "10px", textTransform: "uppercase" }}>
          AI ツール {selectedKr ? `— ${selectedKr.title}` : ""}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
          {AI_TOOLS.map(tool => (
            <button
              key={tool.label}
              onClick={tool.onClick}
              style={{
                display: "flex", alignItems: "flex-start", gap: "12px",
                padding: "14px 16px",
                background: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-lg)",
                cursor: "pointer", textAlign: "left",
                transition: "border-color 0.15s, transform 0.1s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = tool.color;
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border-primary)";
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
              }}
            >
              <span style={{ fontSize: "22px", flexShrink: 0, lineHeight: 1 }}>{tool.icon}</span>
              <div>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "4px" }}>
                  {tool.label}
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
                  {tool.desc}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
