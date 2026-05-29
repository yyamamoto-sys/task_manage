// src/components/dashboard/ProjectKarte.tsx
//
// 【設計意図】
// ダッシュボードでサイドバーのPJを選択しているとき、そのPJ専用のサマリー（プロジェクトカルテ）を
// ダッシュボード上部に表示する。進捗・ステータス内訳・期日状況・担当者別負荷・マイルストーン・
// 紐づくKR、そして「✨ AI分析」ボタン（PJ単位のAI健全性分析）を持つ。
//
// AI分析の結果は Supabase（project_analyses テーブル）に保存し、最新のものを全メンバーが見られる。
// 履歴は 1PJ につき最新 2 件まで（projectAnalysisStore が古い分を削除）。
//
// 【AI境界ルール】AI分析に渡すのは PJ/Task/Milestone/メンバー名のみ（projectAnalysisClient 参照）。
// 紐づくKR名は画面表示はするが、AIには渡さない。

import { useMemo, useState, useCallback, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { todayStr, addDaysFromToday, formatMD } from "../../lib/date";
import { calcProgressPct } from "../../lib/stats";
import { isParentTask } from "../../lib/taskHierarchy";
import { KEYS, active } from "../../lib/localData/localStore";
import { Avatar } from "../auth/UserSelectScreen";
import { MarkdownLite } from "../common/MarkdownLite";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { analyzeProject } from "../../lib/ai/projectAnalysisClient";
import { fetchProjectAnalyses, insertProjectAnalysis, type ProjectAnalysisRecord } from "../../lib/supabase/projectAnalysisStore";
import { formatErrorForUser } from "../../lib/errorMessage";
import { getAssigneeIds } from "../../lib/taskMeta";
import { MilestoneAddForm } from "../milestone/MilestoneAddForm";
import { confirmDialog } from "../../lib/dialog";

const ANALYSIS_PHASES = [
  "タスクの状況を読み込んでいます",
  "進捗とペースを評価しています",
  "リスク・ボトルネックを洗い出しています",
  "担当者の負荷を確認しています",
  "次の一手をまとめています",
];

export function ProjectKarte({ project, currentUser }: { project: Project; currentUser: Member }) {
  const rawTasks   = useAppStore(s => s.tasks);
  const rawMembers = useAppStore(s => s.members);
  const rawMs      = useAppStore(s => s.milestones);
  const rawTfs     = useAppStore(s => s.taskForces);
  const rawKrs     = useAppStore(s => s.keyResults);
  const rawPtfs    = useAppStore(s => s.projectTaskForces);
  const rawTpjs    = useAppStore(s => s.taskProjects);
  const saveMilestone   = useAppStore(s => s.saveMilestone);
  const deleteMilestone = useAppStore(s => s.deleteMilestone);
  const [showAddMs, setShowAddMs] = useState(false);

  const stagnantDays = useMemo(() => {
    const saved = localStorage.getItem(KEYS.STAGNANT_DAYS);
    return saved ? Math.max(1, parseInt(saved, 10) || 5) : 5;
  }, []);

  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  // PJ配下のタスク：「主プロジェクト = このPJ」または「task_projects 経由でこのPJと紐づく」のどちらか
  const pjTasks = useMemo(() => {
    const secondaryTaskIds = new Set(rawTpjs.filter(tp => tp.project_id === project.id).map(tp => tp.task_id));
    return rawTasks.filter(t => !t.is_deleted && (t.project_id === project.id || secondaryTaskIds.has(t.id)));
  }, [rawTasks, rawTpjs, project.id]);

  const today = todayStr();
  const weekLater = addDaysFromToday(7);

  const stats = useMemo(() => {
    // 進捗の分母/分子は葉タスク基準（子を持つ親タスクを除外して二重計上を防ぐ）。
    // フラットデータでは葉=全タスクなので従来と完全一致する。
    const leafPjTasks = pjTasks.filter(t => !isParentTask(t, pjTasks));
    let todo = 0, inProg = 0, done = 0, overdue = 0, dueThisWeek = 0, noDue = 0, stagnant = 0;
    for (const t of leafPjTasks) {
      if (t.status === "done") done++;
      else if (t.status === "in_progress") inProg++;
      else todo++;
      if (t.status !== "done") {
        if (t.due_date && t.due_date <= today) overdue++;
        else if (t.due_date && t.due_date <= weekLater) dueThisWeek++;
        else if (!t.due_date) noDue++;
      }
      if (t.status === "in_progress" && t.updated_at) {
        const days = (Date.now() - new Date(t.updated_at).getTime()) / 86400000;
        if (days >= stagnantDays) stagnant++;
      }
    }
    const total = leafPjTasks.length;
    const pct = calcProgressPct(done, total);
    return { todo, inProg, done, total, pct, overdue, dueThisWeek, noDue, stagnant };
  }, [pjTasks, today, weekLater, stagnantDays]);

  // 担当者別の未完了タスク数（多い順）
  const memberLoad = useMemo(() => {
    const map = new Map<string, { active: number; done: number }>();
    for (const t of pjTasks) {
      for (const mid of getAssigneeIds(t)) {
        const e = map.get(mid) ?? { active: 0, done: 0 };
        if (t.status === "done") e.done++; else e.active++;
        map.set(mid, e);
      }
    }
    return [...map.entries()]
      .map(([mid, v]) => ({ member: memberById.get(mid), ...v }))
      .filter(x => x.member)
      .sort((a, b) => (b.active - a.active) || (b.done - a.done));
  }, [pjTasks, memberById]);
  const maxLoad = Math.max(1, ...memberLoad.map(m => m.active + m.done));

  const owners = useMemo(
    () => (project.owner_member_ids?.length ? project.owner_member_ids : [project.owner_member_id])
      .map(id => memberById.get(id)).filter((m): m is Member => !!m),
    [project.owner_member_ids, project.owner_member_id, memberById],
  );

  // PJメンバー（オーナーとは別の関与者）
  const pjMembers = useMemo(
    () => (project.member_ids ?? [])
      .map(id => memberById.get(id))
      .filter((m): m is Member => !!m),
    [project.member_ids, memberById],
  );

  // AI分析に渡す「このPJに関わる全員」＝オーナー＋メンバー＋タスク担当者の和集合
  const pjAllMembers = useMemo(() => {
    const map = new Map<string, Member>();
    for (const o of owners) map.set(o.id, o);
    for (const m of pjMembers) map.set(m.id, m);
    for (const t of pjTasks) {
      for (const aid of getAssigneeIds(t)) {
        const m = memberById.get(aid);
        if (m) map.set(m.id, m);
      }
    }
    return [...map.values()];
  }, [owners, pjMembers, pjTasks, memberById]);

  const milestones = useMemo(
    () => rawMs.filter(m => !m.is_deleted && m.project_id === project.id)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [rawMs, project.id],
  );
  const nextMilestone = useMemo(() => milestones.find(m => m.date >= today), [milestones, today]);

  // 紐づくKR（PJ → ProjectTaskForce → TF → KR）— 表示のみ。AIには渡さない。
  const linkedKrNames = useMemo(() => {
    const tfIds = new Set(rawPtfs.filter(p => p.project_id === project.id).map(p => p.tf_id));
    const krIds = new Set(rawTfs.filter(tf => !tf.is_deleted && tfIds.has(tf.id)).map(tf => tf.kr_id).filter(Boolean));
    return rawKrs.filter(kr => !kr.is_deleted && krIds.has(kr.id)).map(kr => kr.title);
  }, [rawPtfs, rawTfs, rawKrs, project.id]);

  // ===== AI分析（Supabase で全員共有・最新2件） =====
  const [analyses, setAnalyses] = useState<ProjectAnalysisRecord[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState(0); // 0=最新, 1=前回

  // PJが変わったら最新2件を取り直す（取得失敗はカルテ表示を止めない）
  useEffect(() => {
    let cancelled = false;
    setAnalysisError(null);
    setViewIndex(0);
    fetchProjectAnalyses(project.id)
      .then(rows => { if (!cancelled) setAnalyses(rows); })
      .catch((e: unknown) => {
        console.warn("PJ分析の取得に失敗（カルテ表示は継続）:", e);
        if (!cancelled) setAnalyses([]);
      });
    return () => { cancelled = true; };
  }, [project.id]);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    setShowAnalysis(true);
    try {
      const text = await analyzeProject({
        project: {
          name: project.name,
          purpose: project.purpose ?? "",
          status: project.status,
          start_date: project.start_date ?? "",
          end_date: project.end_date ?? "",
          owner_short_names: owners.map(o => o.short_name),
        },
        tasks: pjTasks.map(t => ({
          name: t.name,
          status: t.status,
          priority: t.priority,
          assignee_short_name: getAssigneeIds(t).map(id => memberById.get(id)?.short_name).filter(Boolean).join("・") || "",
          start_date: t.start_date,
          due_date: t.due_date,
          estimated_hours: t.estimated_hours,
          comment: t.comment ?? "",
          created_at: t.created_at,
          updated_at: t.updated_at,
          completed_at: t.completed_at ?? null,
        })),
        milestones: milestones.map(m => ({ name: m.name, date: m.date, description: m.description })),
        members_short_names: pjAllMembers.map(m => m.short_name),
        today,
      });
      await insertProjectAnalysis(project.id, text, currentUser.id);
      const rows = await fetchProjectAnalyses(project.id);
      setAnalyses(rows);
      setViewIndex(0);
    } catch (e) {
      setAnalysisError(formatErrorForUser("AI分析に失敗しました", e));
    } finally {
      setAnalyzing(false);
    }
  }, [project, owners, pjTasks, milestones, pjAllMembers, today, currentUser.id]);

  const latest = analyses[0] ?? null;
  const accent = project.color_tag;
  const whoOf = (rec: ProjectAnalysisRecord) => memberById.get(rec.created_by)?.short_name ?? "メンバー";

  return (
    <div style={{
      border: `1px solid ${accent}44`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: "var(--radius-lg)",
      background: "var(--color-bg-primary)",
      padding: "14px 16px",
      marginBottom: "14px",
    }}>
      {/* 見出し行 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: accent, flexShrink: 0 }} />
            <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>{project.name}</span>
            {project.status !== "active" && (
              <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)" }}>
                {project.status === "completed" ? "完了" : "アーカイブ"}
              </span>
            )}
          </div>
          {project.purpose && (
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>{project.purpose}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
            {owners.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {owners.map(o => <Avatar key={o.id} member={o} size={18} />)}
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>オーナー</span>
              </div>
            )}
            {(project.start_date || project.end_date) && (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                📅 {project.start_date ? formatMD(project.start_date) : "—"} 〜 {project.end_date ? formatMD(project.end_date) : "—"}
              </span>
            )}
          </div>
        </div>

        {/* AI分析ボタン */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
          <button
            onClick={analyzing ? undefined : runAnalysis}
            disabled={analyzing}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", fontSize: "12px", fontWeight: 600,
              border: "none", borderRadius: "var(--radius-full)",
              background: analyzing ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: analyzing ? "var(--color-text-tertiary)" : "#fff",
              cursor: analyzing ? "default" : "pointer",
              boxShadow: analyzing ? "none" : "0 2px 8px rgba(99,102,241,0.3)",
            }}
          >
            <span>✨</span> {analyzing ? "分析中…" : latest ? "AI分析を更新" : "このPJをAI分析"}
          </button>
          {latest && !analyzing && (
            <button
              onClick={() => { setViewIndex(0); setShowAnalysis(true); }}
              style={{ fontSize: "11px", color: "var(--color-brand)", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "right" }}
            >
              最新の分析を見る（{formatMD(latest.created_at.slice(0, 10))}・{whoOf(latest)}）
              {analyses.length > 1 && <span style={{ color: "var(--color-text-tertiary)" }}> ／ 履歴2件</span>}
            </button>
          )}
        </div>
      </div>

      {/* 進捗バー */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <div style={{ flex: 1, height: 7, background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${stats.pct}%`, background: accent, borderRadius: "var(--radius-full)", transition: "width var(--transition-fast)" }} />
        </div>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>
          {stats.done}/{stats.total} 完了（{stats.pct}%）
        </span>
      </div>

      {/* ステータス内訳 + 期日 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
        <Chip label="未着手" value={stats.todo} />
        <Chip label="進行中" value={stats.inProg} color="#2563eb" />
        <Chip label="完了" value={stats.done} color="#16a34a" />
        {stats.stagnant > 0 && <Chip label={`滞留(${stagnantDays}日+)`} value={stats.stagnant} color="#ca8a04" />}
        <div style={{ width: "1px", background: "var(--color-border-primary)", margin: "0 2px" }} />
        {stats.overdue > 0 && <Chip label="期限超過" value={stats.overdue} color="#dc2626" />}
        <Chip label="今週期限" value={stats.dueThisWeek} color={stats.dueThisWeek > 0 ? "#ca8a04" : undefined} />
        {stats.noDue > 0 && <Chip label="期日未設定" value={stats.noDue} />}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        {/* 担当者別負荷 */}
        <div>
          <SectionLabel>担当者別の負荷（未完了 / 完了）</SectionLabel>
          {memberLoad.length === 0 && <Muted>担当者が割り当てられたタスクがありません</Muted>}
          {memberLoad.slice(0, 8).map(({ member, active, done }) => (
            <div key={member!.id} style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px" }}>
              <Avatar member={member!} size={18} />
              <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", width: "70px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{member!.short_name}</span>
              <div style={{ flex: 1, height: 6, background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-full)", overflow: "hidden", display: "flex" }}>
                <div style={{ height: "100%", width: `${(active / maxLoad) * 100}%`, background: "var(--color-brand)" }} />
                <div style={{ height: "100%", width: `${(done / maxLoad) * 100}%`, background: "var(--color-border-primary)" }} />
              </div>
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, width: "38px", textAlign: "right" }}>{active} / {done}</span>
            </div>
          ))}
        </div>

        {/* マイルストーン + 紐づくKR */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <SectionLabel style={{ marginBottom: "6px" }}>マイルストーン</SectionLabel>
            <button
              onClick={() => setShowAddMs(v => !v)}
              style={{
                fontSize: "10px", padding: "2px 8px", marginBottom: "6px",
                borderRadius: "var(--radius-full)", cursor: "pointer",
                border: "1px solid var(--color-border-primary)",
                background: showAddMs ? "var(--color-bg-info)" : "transparent",
                color: showAddMs ? "var(--color-text-info)" : "var(--color-text-secondary)",
                flexShrink: 0,
              }}
            >
              {showAddMs ? "閉じる" : "＋ 追加"}
            </button>
          </div>
          {milestones.length === 0 && !showAddMs && <Muted>設定なし</Muted>}
          {milestones.slice(0, 5).map(m => {
            const isPast = m.date < today;
            const isNext = nextMilestone?.id === m.id;
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", opacity: isPast ? 0.5 : 1 }}>
                <span style={{ fontSize: "11px" }}>{isPast ? "✅" : isNext ? "🎯" : "•"}</span>
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0, width: "44px" }}>{formatMD(m.date)}</span>
                <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.name}</span>
                <button
                  title="このマイルストーンを削除"
                  onClick={async () => {
                    if (await confirmDialog(`マイルストーン「${m.name}」を削除しますか？`)) {
                      await deleteMilestone(m.id, currentUser.id);
                    }
                  }}
                  style={{
                    fontSize: "10px", lineHeight: 1, padding: "2px 5px", flexShrink: 0,
                    border: "none", background: "transparent", cursor: "pointer",
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {showAddMs && (
            <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--color-border-primary)" }}>
              <MilestoneAddForm
                pjId={project.id}
                currentUserId={currentUser.id}
                onAdd={async (ms) => { await saveMilestone(ms); setShowAddMs(false); }}
              />
            </div>
          )}
          {linkedKrNames.length > 0 && (
            <>
              <SectionLabel style={{ marginTop: "10px" }}>紐づくKR</SectionLabel>
              {linkedKrNames.slice(0, 4).map((name, i) => (
                <div key={i} style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "3px", display: "flex", gap: "5px" }}>
                  <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>🎯</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {analysisError && !showAnalysis && (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
          {analysisError}
        </div>
      )}

      {showAnalysis && (
        <AnalysisModal
          projectName={project.name}
          analyzing={analyzing}
          analyses={analyses}
          viewIndex={viewIndex}
          onSelectIndex={setViewIndex}
          whoOf={whoOf}
          error={analysisError}
          onClose={() => setShowAnalysis(false)}
          onRerun={runAnalysis}
        />
      )}
    </div>
  );
}

// ===== 部品 =====

function Chip({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontSize: "11px", padding: "2px 9px", borderRadius: "var(--radius-full)",
      background: color ? `${color}18` : "var(--color-bg-tertiary)",
      color: color ?? "var(--color-text-secondary)",
      fontWeight: 500,
    }}>
      {label} <strong style={{ fontWeight: 700 }}>{value}</strong>
    </span>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em", ...style }}>{children}</div>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "4px 0" }}>{children}</div>;
}

// ===== AI分析モーダル =====

function AnalysisModal({
  projectName, analyzing, analyses, viewIndex, onSelectIndex, whoOf, error, onClose, onRerun,
}: {
  projectName: string;
  analyzing: boolean;
  analyses: ProjectAnalysisRecord[];
  viewIndex: number;
  onSelectIndex: (i: number) => void;
  whoOf: (rec: ProjectAnalysisRecord) => string;
  error: string | null;
  onClose: () => void;
  onRerun: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const current = analyses[viewIndex] ?? analyses[0] ?? null;
  const copy = useCallback(() => {
    if (!current) return;
    navigator.clipboard?.writeText(current.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }, [current]);

  const fmtAt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "min(720px, 100%)", maxHeight: "calc(100vh - 48px)", background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>
        <div className="ai-shimmer" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", padding: "12px 16px", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{ fontSize: "16px" }}>✨</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>AI分析：{projectName}</div>
            {current && !analyzing && (
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.85)", marginTop: "1px" }}>
                {fmtAt(current.created_at)}・{whoOf(current)} が実行{viewIndex > 0 ? "（前回の分析）" : ""}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", fontSize: "16px", color: "#fff", padding: "3px 8px", borderRadius: "var(--radius-sm)", lineHeight: 1 }}>✕</button>
        </div>

        {/* 履歴タブ（2件あるとき） */}
        {!analyzing && analyses.length > 1 && (
          <div style={{ display: "flex", gap: "6px", padding: "8px 16px 0", flexShrink: 0 }}>
            {analyses.map((rec, i) => (
              <button
                key={rec.id}
                onClick={() => onSelectIndex(i)}
                style={{
                  fontSize: "11px", padding: "4px 12px", borderRadius: "var(--radius-full)",
                  border: i === viewIndex ? "1px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                  background: i === viewIndex ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                  color: i === viewIndex ? "var(--color-brand)" : "var(--color-text-secondary)",
                  cursor: "pointer", fontWeight: i === viewIndex ? 600 : 400,
                }}
              >
                {i === 0 ? "最新" : "前回"}（{formatMD(rec.created_at.slice(0, 10))}）
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
          {analyzing && <AIProgressLoader phases={ANALYSIS_PHASES} intervalMs={3800} />}
          {!analyzing && error && (
            <div style={{ fontSize: "13px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "12px 14px", borderRadius: "var(--radius-md)" }}>{error}</div>
          )}
          {!analyzing && !error && current && <MarkdownLite text={current.content} />}
          {!analyzing && !error && !current && <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>分析結果がありません。「再分析」で作成してください。</div>}
        </div>

        <div style={{ flexShrink: 0, borderTop: "1px solid var(--color-border-primary)", padding: "10px 16px", display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>AIの分析は参考情報です。事実は元データで確認してください。最新の分析は全員に共有されます。</span>
          {current && !analyzing && (
            <button onClick={copy} style={ghostBtn}>{copied ? "コピーしました" : "コピー"}</button>
          )}
          <button onClick={analyzing ? undefined : onRerun} disabled={analyzing} style={{ ...ghostBtn, opacity: analyzing ? 0.5 : 1, cursor: analyzing ? "default" : "pointer" }}>
            {analyzing ? "分析中…" : "再分析"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  fontSize: "11px", padding: "5px 12px", background: "transparent",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)", cursor: "pointer",
};
