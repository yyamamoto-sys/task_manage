// src/components/dashboard/DashboardView.tsx
//
// 【設計意図】
// ダッシュボード。4つのセクションで構成。
// 1. OKRサマリー：KRごとのタスク完了率バー（KR進捗率の暫定実装）
// 2. 今週のタスク：今日〜7日以内に期限のタスク一覧
// 3. 期限アラート：期限超過・本日期限のタスク（赤バッジ）
// 4. PJ進捗一覧：全PJのタスク完了率
//
// フィルター：「自分のみ/全員」トグル＋PJチップ（複数選択）。
// サイドバーでPJを選択中はそのPJに絞り込まれ、ヘッダーに絞り込みバナーを表示する（PJチップは隠れる）。
//
// KR進捗率の計算方針（未決定論点Aの暫定解）：
// 「そのKRに紐づくTF→PJ→タスクの完了率の平均」で計算する。
// 手動入力方式はPhase 5以降で検討。

import { useState, useMemo, useCallback, useEffect } from "react";
import { useAppStore, selectScopedTasks } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  Member, Project, Task, ToDo, NotifyPref,
} from "../../lib/localData/types";
import { todayStr, addDaysFromToday, diffDaysFromToday, formatMD } from "../../lib/date";
import { calcProgressPct } from "../../lib/stats";
import { isParentTask } from "../../lib/taskHierarchy";
import { tfsForKr } from "../../lib/okr/tfQuarter";
import { KEYS, active } from "../../lib/localData/localStore";
import { InlineEditAssignee } from "../common/InlineEditAssignee";
import { fetchKrSessions, type KrSession } from "../../lib/supabase/krSessionStore";
import { ProjectKarte } from "./ProjectKarte";
import { HelpButton } from "../guide/HelpButton";
import { isAssignedTo, getAssigneeIds } from "../../lib/taskMeta";
import { OnboardingHome } from "./OnboardingHome";
import { showToast } from "../common/Toast";
import { analyzeAllProjects, type AllProjectsPjSummary } from "../../lib/ai/allProjectsAnalysisClient";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { MarkdownLite } from "../common/MarkdownLite";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  currentUser: Member;
  projects: Project[];
  /** サイドバーで選択中のPJ。指定時はダッシュボード全体がそのPJに絞り込まれる */
  selectedProject?: Project | null;
  /** 絞り込みバナーの ✕ で呼ぶ。サイドバーのPJ選択を解除する */
  onClearProjectFilter?: () => void;
  onOpenAiProject?: () => void;
  /** オンボーディングから OKR/PJ 設定画面（管理パネル）を開く */
  onOpenAdmin?: () => void;
  /** オンボーディングからクイックタスク追加モーダルを開く */
  onOpenQuickAdd?: () => void;
  /** サイドバーの「自分」トグルが ON のとき true。自分が担当のタスクのみ表示 */
  mineOnly?: boolean;
  /** Dashboard 内チップから mineOnly を切り替える（サイドバーと同じ state を共有） */
  onToggleMineOnly?: () => void;
  /** タスク行クリックで詳細（TaskEditModal）を開く。MainLayout の setAiEditTaskId に橋渡し */
  onOpenTask?: (taskId: string) => void;
}

// ===== メインコンポーネント =====

export function DashboardView({ currentUser, projects, selectedProject = null, onClearProjectFilter, onOpenAiProject, onOpenAdmin, onOpenQuickAdd, mineOnly = false, onToggleMineOnly, onOpenTask }: Props) {
  // 【Phase 2 移行済み】個別 selector で必要な state のみを購読する。
  // 他の state（loading, milestones, taskTaskForces 等）変更では Dashboard は再レンダーされない。
  const rawTasks   = useAppStore(selectScopedTasks);
  const rawMembers = useAppStore(s => s.members);
  const rawKrs     = useAppStore(s => s.keyResults);
  const rawTfs     = useAppStore(s => s.taskForces);
  const rawPtfs    = useAppStore(s => s.projectTaskForces);
  const rawTodos   = useAppStore(s => s.todos);
  const rawMs      = useAppStore(s => s.milestones);
  const saveMember = useAppStore(s => s.saveMember);
  const saveTask   = useAppStore(s => s.saveTask);
  const isMobile = useIsMobile();

  // ===== 全PJ AI分析 =====
  const [showAllAnalysis, setShowAllAnalysis] = useState(false);
  const [allAnalyzing, setAllAnalyzing] = useState(false);
  const [allAnalysisResult, setAllAnalysisResult] = useState<string | null>(null);
  const [allAnalysisError, setAllAnalysisError] = useState<string | null>(null);
  const [allAnalysisCopied, setAllAnalysisCopied] = useState(false);

  const [selectedPjIds, setSelectedPjIds] = useState<string[]>([]);
  const [activeKrId, setActiveKrId] = useState<string | null>(null);
  const [krSessionsMap, setKrSessionsMap] = useState<Record<string, KrSession[]>>({});

  const [stagnantDays] = useState<number>(() => {
    const saved = localStorage.getItem(KEYS.STAGNANT_DAYS);
    return saved ? Math.max(1, parseInt(saved, 10) || 5) : 5;
  });

  // リマインダー設定（localStorage で永続化）
  const [reminderDays, setReminderDaysState] = useState<number>(() => {
    const saved = localStorage.getItem(KEYS.REMINDER_DAYS);
    return saved ? Math.max(1, parseInt(saved, 10) || 7) : 7;
  });

  const allTasks = useMemo(() => active(rawTasks), [rawTasks]);
  const members  = useMemo(() => active(rawMembers), [rawMembers]);
  const krs      = useMemo(() => active(rawKrs), [rawKrs]);
  const tfs      = useMemo(() => active(rawTfs), [rawTfs]);
  const todos      = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const milestones = useMemo(() => (rawMs ?? []).filter(m => !m.is_deleted), [rawMs]);
  const projectTaskForces = rawPtfs;

  // KRごとのシグナル履歴をフェッチ（最大4週分）
  useEffect(() => {
    if (krs.length === 0) return;
    Promise.all(
      krs.map(kr => fetchKrSessions(kr.id).then(sessions => ({ krId: kr.id, sessions })))
    ).then(results => {
      const map: Record<string, KrSession[]> = {};
      for (const { krId, sessions } of results) {
        map[krId] = sessions.slice(0, 8); // 最新8セッション（チェックイン+ウィン計4週分）
      }
      setKrSessionsMap(map);
    }).catch((e: unknown) => {
      // ダッシュボードのKRシグナル表示は補助情報なので失敗時は console 警告のみで継続
      console.warn("KRセッション取得失敗（ダッシュボード表示は継続）:", e);
    });
  }, [krs]);

  // 実効PJフィルター：サイドバーでPJ選択中ならそれを優先。未選択時はダッシュボード内チップ／KRクリックで選んだPJ。
  const effectivePjIds = useMemo(
    () => selectedProject ? [selectedProject.id] : selectedPjIds,
    [selectedProject, selectedPjIds],
  );

  // フィルター適用後のタスク
  // 「自分」フィルタは mineOnly（サイドバートグル）に一元化。Dashboard 内のチップも
  // 同じ state を操作するので、表示と挙動が常に一致する
  const filteredTasks = useMemo(() => {
    let tasks = allTasks;
    if (mineOnly) tasks = tasks.filter(t => isAssignedTo(t, currentUser.id));
    // PJフィルター選択時は、選択PJに紐づくタスク OR project_id=nullのタスク（ToDo系）を含める
    if (effectivePjIds.length > 0) tasks = tasks.filter(t =>
      (t.project_id && effectivePjIds.includes(t.project_id)) || t.project_id == null
    );
    return tasks;
  }, [allTasks, mineOnly, effectivePjIds, currentUser.id]);

  const todayS = todayStr();
  const weekLater = addDaysFromToday(7);
  const reminderDeadline = addDaysFromToday(reminderDays);

  // 自分のリマインダータスク（期限切れ + N日以内）
  const reminderTasks = useMemo(
    () => allTasks.filter(t =>
      isAssignedTo(t, currentUser.id) &&
      t.status !== "done" &&
      t.due_date != null &&
      t.due_date <= reminderDeadline
    ).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [allTasks, currentUser.id, reminderDeadline]
  );

  // 期限通知の受け取り方（ユーザーごと）。リマインダーカードのセレクタで切替。
  const selfMember = members.find(m => m.id === currentUser.id);
  const notifyPref: NotifyPref = selfMember?.notify_pref ?? "none";
  const handleNotifyPrefChange = async (pref: NotifyPref) => {
    if (!selfMember) return;
    if (pref === "browser" && "Notification" in window) {
      if (Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      if (Notification.permission === "denied") {
        showToast("ブラウザ通知がブロックされています。ブラウザの設定で許可してください。", "error");
      }
    }
    try {
      await saveMember({ ...selfMember, notify_pref: pref, updated_by: currentUser.id });
    } catch { /* saveMember 側で ConflictError をトースト処理 */ }
  };

  // 自分がメンションされているタスク（未完了・@short_name がコメントに含まれる）
  const mentionedTasks = useMemo(() => {
    const token = `@${currentUser.short_name}`;
    return allTasks.filter(t => t.status !== "done" && (t.comment ?? "").includes(token));
  }, [allTasks, currentUser.short_name]);

  // 今週のタスク
  const thisWeekTasks = useMemo(
    () => filteredTasks.filter(t =>
      t.due_date &&
      t.due_date >= todayS &&
      t.due_date <= weekLater &&
      t.status !== "done"
    ).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [filteredTasks, todayS, weekLater]
  );

  // 期限超過・本日期限
  const alertTasks = useMemo(
    () => filteredTasks.filter(t =>
      t.due_date &&
      t.due_date <= todayS &&
      t.status !== "done"
    ).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [filteredTasks, todayS]
  );

  // 滞留タスク（進行中のまま N 日以上 updated_at が動いていない）
  const stagnantTasks = useMemo(
    () => filteredTasks.filter(t => {
      if (t.status !== "in_progress" || t.is_deleted || !t.updated_at) return false;
      const diffMs = Date.now() - new Date(t.updated_at).getTime();
      return diffMs / (1000 * 60 * 60 * 24) >= stagnantDays;
    }).sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? "")),
    [filteredTasks, stagnantDays]
  );

  // PJ進捗
  // 【葉タスク基準】進捗の分母/分子は「子を持つ親タスク」を除いた葉タスクだけで数える
  // （親を二重計上しない）。フラットデータでは葉=全タスクなので従来と完全一致する。
  const pjProgress = useMemo(() =>
    projects.map(pj => {
      const pjTasks = allTasks.filter(t => t.project_id === pj.id && !isParentTask(t, allTasks));
      const done = pjTasks.filter(t => t.status === "done").length;
      const total = pjTasks.length;
      const pct = calcProgressPct(done, total);
      return { pj, done, total, pct };
    }),
    [projects, allTasks]
  );

  // KR進捗（タスク完了率ベース）
  // 経路A: KR → TF → ToDo → Task (Task.todo_id)
  // 経路B: KR → TF → ProjectTaskForce → PJ → Task (Task.project_id)
  // 両経路のタスクをSetで重複排除して完了率を計算する
  // あるTFに紐づくタスク（経路A: TF→ToDo→Task / 経路B: TF→PJ→Task）の完了状況を集計
  const tfTaskStats = useCallback((tfId: string) => {
    const tfTodoIds = new Set(todos.filter(td => td.tf_id === tfId).map(td => td.id));
    const tfPjIds = new Set(projectTaskForces.filter(ptf => ptf.tf_id === tfId).map(ptf => ptf.project_id));
    const ids = new Set<string>();
    allTasks.filter(t => (t.todo_ids ?? []).some(id => tfTodoIds.has(id))).forEach(t => ids.add(t.id));
    allTasks.filter(t => t.project_id !== null && tfPjIds.has(t.project_id!)).forEach(t => ids.add(t.id));
    // 葉タスク基準：親（子持ち）を除外して二重計上を防ぐ。フラットでは全タスクが葉。
    const rel = allTasks.filter(t => ids.has(t.id) && !isParentTask(t, allTasks));
    const done = rel.filter(t => t.status === "done").length;
    const total = rel.length;
    return { done, total, pct: calcProgressPct(done, total) };
  }, [todos, projectTaskForces, allTasks]);

  const krProgress = useMemo(() =>
    krs.map(kr => {
      // 今期のTFのみ（tf.quarter基準。未設定legacyは今期扱い）
      const krTfs = tfsForKr(tfs, kr.id);
      const krTfIds = new Set(krTfs.map(tf => tf.id));

      const relatedTaskIds = new Set<string>();

      // 経路A: TF → ToDo → Task
      const krTodoIds = new Set(todos.filter(td => krTfIds.has(td.tf_id)).map(td => td.id));
      allTasks.filter(t => (t.todo_ids ?? []).some(id => krTodoIds.has(id)))
        .forEach(t => relatedTaskIds.add(t.id));

      // 経路B: TF → ProjectTaskForce → Task
      const krPjIds = new Set(
        projectTaskForces.filter(ptf => krTfIds.has(ptf.tf_id)).map(ptf => ptf.project_id)
      );
      allTasks.filter(t => t.project_id !== null && krPjIds.has(t.project_id!))
        .forEach(t => relatedTaskIds.add(t.id));

      // 葉タスク基準：親（子持ち）を除外して二重計上を防ぐ。フラットでは全タスクが葉。
      const relatedTasks = allTasks.filter(t => relatedTaskIds.has(t.id) && !isParentTask(t, allTasks));
      const done = relatedTasks.filter(t => t.status === "done").length;
      const total = relatedTasks.length;
      const pct = calcProgressPct(done, total);

      // 今期のTFごとのサマリー（TF番号順）
      const tfSummaries = [...krTfs]
        .sort((a, b) => (a.tf_number ?? "").localeCompare(b.tf_number ?? "", undefined, { numeric: true }))
        .map(tf => ({ tf, ...tfTaskStats(tf.id) }));

      return { kr, pct, tfCount: krTfIds.size, tfSummaries };
    }),
    [krs, tfs, todos, allTasks, projectTaskForces, tfTaskStats]
  );

  // ToDo進捗（TF > ToDo > Task の完了状況）
  const todoProgress = useMemo(() =>
    tfs.map(tf => {
      const tfTodos = todos.filter(td => td.tf_id === tf.id);
      const todoItems = tfTodos.map(td => {
        // 葉タスク基準：親（子持ち）を除外。フラットでは全タスクが葉。
        const tdTasks = allTasks.filter(t => (t.todo_ids ?? []).includes(td.id) && !isParentTask(t, allTasks));
        const done = tdTasks.filter(t => t.status === "done").length;
        const total = tdTasks.length;
        const pct = calcProgressPct(done, total);
        return { todo: td, done, total, pct };
      });
      return { tf, todoItems: todoItems.filter(t => t.total > 0) };
    }).filter(item => item.todoItems.length > 0),
    [tfs, todos, allTasks]
  );

  const runAllProjectsAnalysis = useCallback(async () => {
    setAllAnalyzing(true);
    setAllAnalysisError(null);
    setAllAnalysisResult(null);
    setShowAllAnalysis(true);
    try {
      const activePjs = projects.filter(pj => pj.status === "active");
      const pjSummaries: AllProjectsPjSummary[] = activePjs.map(pj => {
        const pjTasks = allTasks.filter(t => t.project_id === pj.id && !isParentTask(t, allTasks));
        const pjMs = milestones
          .filter(m => m.project_id === pj.id)
          .sort((a, b) => a.date.localeCompare(b.date));
        const nextMs = pjMs.find(m => m.date >= todayS);
        const loadMap = new Map<string, number>();
        for (const t of pjTasks) {
          if (t.status === "done") continue;
          for (const id of getAssigneeIds(t)) loadMap.set(id, (loadMap.get(id) ?? 0) + 1);
        }
        const ownerIds = pj.owner_member_ids?.length
          ? pj.owner_member_ids
          : pj.owner_member_id ? [pj.owner_member_id] : [];
        return {
          name: pj.name,
          purpose: pj.purpose ?? "",
          status: pj.status,
          start_date: pj.start_date ?? "",
          end_date: pj.end_date ?? "",
          owner_short_names: ownerIds.map(id => members.find(m => m.id === id)?.short_name).filter((s): s is string => !!s),
          task_stats: {
            total: pjTasks.length,
            todo: pjTasks.filter(t => t.status === "todo").length,
            in_progress: pjTasks.filter(t => t.status === "in_progress").length,
            done: pjTasks.filter(t => t.status === "done").length,
            overdue: pjTasks.filter(t => t.status !== "done" && t.due_date != null && t.due_date <= todayS).length,
            no_due: pjTasks.filter(t => t.status !== "done" && !t.due_date).length,
            stagnant: pjTasks.filter(t =>
              t.status === "in_progress" && t.updated_at &&
              (Date.now() - new Date(t.updated_at).getTime()) / 86400000 >= stagnantDays
            ).length,
          },
          assignee_loads: [...loadMap.entries()]
            .map(([id, active]) => ({ short_name: members.find(m => m.id === id)?.short_name ?? "", active }))
            .filter(l => l.short_name)
            .sort((a, b) => b.active - a.active),
          next_milestone: nextMs ? { name: nextMs.name, date: nextMs.date } : undefined,
        };
      });
      const result = await analyzeAllProjects({
        projects: pjSummaries,
        members_short_names: members.map(m => m.short_name),
        today: todayS,
      });
      setAllAnalysisResult(result);
    } catch (e) {
      setAllAnalysisError(formatErrorForUser("AI分析に失敗しました", e));
    } finally {
      setAllAnalyzing(false);
    }
  }, [projects, allTasks, milestones, members, todayS, stagnantDays]);

  const togglePj = (id: string) => {
    setActiveKrId(null);
    setSelectedPjIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  // KRバークリック：そのKRに紐づくPJでフィルター
  const handleKrClick = (krId: string) => {
    if (activeKrId === krId) {
      // 同じKRを再クリック → 解除
      setActiveKrId(null);
      setSelectedPjIds([]);
      return;
    }
    const krTfIds = tfsForKr(tfs, krId).map(tf => tf.id);
    const pjIds = projectTaskForces
      .filter(ptf => krTfIds.includes(ptf.tf_id))
      .map(ptf => ptf.project_id);
    setActiveKrId(krId);
    setSelectedPjIds(pjIds.length > 0 ? [...new Set(pjIds)] : []);
  };

  if (projects.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 20px" }}>
        <div style={{ textAlign: "center", maxWidth: "400px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📋</div>
          <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)", marginBottom: "8px" }}>
            まだプロジェクトがありません
          </div>
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", lineHeight: "1.7", marginBottom: "24px" }}>
            AIに目的や背景を伝えるだけで、<br />プロジェクトとタスクの計画を自動作成します。
          </div>
          <button
            onClick={onOpenAiProject}
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "12px 24px",
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "14px", fontWeight: "700",
              boxShadow: "0 4px 16px rgba(99,102,241,0.4)",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: "16px" }}>✨</span> AIでプロジェクトを作る
          </button>
          <div style={{ marginTop: "16px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            右下の ＋ ボタンから手動で追加することもできます
          </div>
        </div>
      </div>
    );
  }

  const showOnboarding = !selectedProject
    && (krs.length === 0 || projects.length === 0 || allTasks.length < 3)
    && (onOpenAdmin || onOpenAiProject || onOpenQuickAdd);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ===== 固定ヘッダー帯 ===== */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-primary)", flexShrink: 0,
        flexWrap: "wrap",
      }}>
        {/* タイトル：サイドバーPJ選択中は色ドット＋PJ名＋✕解除ボタン、未選択は「全プロジェクト」
            flexShrink:0で常に自然幅を確保する（横幅が足りない場合は後続のPJフィルターチップ側が
            外側のflexWrapで2行目に折り返す。このdiv自体を縮めると「全プロジェクト」の文字が
            1文字ずつ縦に折り返され、ボタンとPJチップが重なってクリック不能になる不具合があった） */}
        <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {selectedProject ? (
            <>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: selectedProject.color_tag, display: "inline-block", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "240px" }}>
                {selectedProject.name}
              </span>
              {onClearProjectFilter && (
                <button
                  onClick={onClearProjectFilter}
                  title="絞り込みを解除して全プロジェクトに戻る"
                  style={{
                    display: "flex", alignItems: "center", gap: "3px",
                    padding: "2px 8px", fontSize: "10px", borderRadius: "var(--radius-full)",
                    border: "1px solid var(--color-border-primary)", background: "var(--color-bg-secondary)",
                    color: "var(--color-text-secondary)", cursor: "pointer", flexShrink: 0,
                  }}
                >✕ 解除</button>
              )}
            </>
          ) : (
            <>
              <span style={{ whiteSpace: "nowrap" }}>全プロジェクト</span>
              <button
                onClick={allAnalyzing ? undefined : () => { setShowAllAnalysis(true); if (!allAnalysisResult) runAllProjectsAnalysis(); }}
                disabled={allAnalyzing}
                title="全PJをポートフォリオ視点でAI分析します"
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "4px 12px", fontSize: "11px", fontWeight: 600,
                  border: "none", borderRadius: "var(--radius-full)", flexShrink: 0,
                  background: allAnalyzing ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                  color: allAnalyzing ? "var(--color-text-tertiary)" : "#fff",
                  cursor: allAnalyzing ? "default" : "pointer",
                  boxShadow: allAnalyzing ? "none" : "0 2px 8px rgba(99,102,241,0.3)",
                }}
              >
                <span>✨</span>
                {allAnalyzing ? "分析中…" : allAnalysisResult ? "分析結果を見る" : "全PJをAI分析"}
              </button>
            </>
          )}
          <HelpButton modeKey="dashboard.main" title="ダッシュボードの使い方を開く" />
        </div>

        {/* PJフィルターチップ（サイドバーPJ未選択時のみ） */}
        {!selectedProject && projects.length > 0 && (
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {projects.map(pj => (
              <button
                key={pj.id}
                onClick={() => togglePj(pj.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  padding: "3px 10px", fontSize: "10px", borderRadius: "var(--radius-full)",
                  border: selectedPjIds.includes(pj.id) ? `1px solid ${pj.color_tag}` : "1px solid var(--color-border-primary)",
                  background: selectedPjIds.includes(pj.id) ? `${pj.color_tag}22` : "var(--color-bg-primary)",
                  color: selectedPjIds.includes(pj.id) ? pj.color_tag : "var(--color-text-secondary)",
                  cursor: "pointer", fontWeight: selectedPjIds.includes(pj.id) ? "500" : "400",
                  transition: "background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)",
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: pj.color_tag, display: "inline-block" }} />
                {pj.name.slice(0, 10)}
              </button>
            ))}
          </div>
        )}

        {/* 自分のみ/全員トグル */}
        <div style={{ display: "flex", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", padding: "2px", gap: "2px", flexShrink: 0 }}>
          {[{ val: false, label: "全員" }, { val: true, label: "自分のみ" }].map(({ val, label }) => (
            <button
              key={label}
              onClick={() => { if (mineOnly !== val && onToggleMineOnly) onToggleMineOnly(); }}
              title="サイドバーの「自分/全件」トグルと連動します"
              style={{
                padding: "4px 12px", fontSize: "11px",
                borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                fontWeight: mineOnly === val ? "500" : "400",
                background: mineOnly === val ? "var(--color-bg-primary)" : "transparent",
                color: mineOnly === val ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                boxShadow: mineOnly === val ? "var(--shadow-sm)" : "none",
                transition: "background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 全PJ AI分析モーダル ===== */}
      {showAllAnalysis && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
          onClick={e => { if (e.target === e.currentTarget) setShowAllAnalysis(false); }}
        >
          <div style={{ width: "min(740px, 100%)", maxHeight: "calc(100vh - 48px)", background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>
            <div className="ai-shimmer" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", padding: "12px 16px", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <span style={{ fontSize: "16px" }}>✨</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>AI分析：全プロジェクト ポートフォリオ</div>
                {!allAnalyzing && allAnalysisResult && (
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.85)", marginTop: "1px" }}>
                    {projects.filter(p => p.status === "active").length}件のアクティブPJを横断分析
                  </div>
                )}
              </div>
              <button onClick={() => setShowAllAnalysis(false)} style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", fontSize: "16px", color: "#fff", padding: "3px 8px", borderRadius: "var(--radius-sm)", lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
              {allAnalyzing && (
                <AIProgressLoader
                  phases={["プロジェクト一覧を読み込んでいます", "タスク状況を集計しています", "リスクを横断的に評価しています", "担当者の負荷バランスを確認しています", "全体の次の一手をまとめています"]}
                  intervalMs={4000}
                />
              )}
              {!allAnalyzing && allAnalysisError && (
                <div style={{ fontSize: "13px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "12px 14px", borderRadius: "var(--radius-md)" }}>{allAnalysisError}</div>
              )}
              {!allAnalyzing && !allAnalysisError && allAnalysisResult && <MarkdownLite text={allAnalysisResult} />}
            </div>

            <div style={{ flexShrink: 0, borderTop: "1px solid var(--color-border-primary)", padding: "10px 16px", display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>AIの分析は参考情報です。事実は元データで確認してください。</span>
              {allAnalysisResult && !allAnalyzing && (
                <button
                  onClick={() => { navigator.clipboard?.writeText(allAnalysisResult).then(() => { setAllAnalysisCopied(true); setTimeout(() => setAllAnalysisCopied(false), 1500); }).catch(() => {}); }}
                  style={{ fontSize: "11px", padding: "5px 12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                >
                  {allAnalysisCopied ? "コピーしました" : "コピー"}
                </button>
              )}
              <button
                onClick={allAnalyzing ? undefined : runAllProjectsAnalysis}
                disabled={allAnalyzing}
                style={{ fontSize: "11px", padding: "5px 12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: allAnalyzing ? "default" : "pointer", opacity: allAnalyzing ? 0.5 : 1 }}
              >
                {allAnalyzing ? "分析中…" : "再分析"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== スクロールラッパー ===== */}
      <div style={{ flex: 1, overflow: "auto" }}>
      {showOnboarding && (
        <OnboardingHome
          krCount={krs.length}
          pjCount={projects.length}
          taskCount={allTasks.length}
          onOpenAdmin={onOpenAdmin ?? (() => {})}
          onOpenAiProject={onOpenAiProject ?? (() => {})}
          onOpenQuickAdd={onOpenQuickAdd ?? (() => {})}
        />
      )}
      <div style={{ padding: "16px 20px", maxWidth: "1000px" }}>

        {/* プロジェクトカルテ（PJ選択中のみ） */}
        {selectedProject && (
          <ProjectKarte project={selectedProject} currentUser={currentUser} />
        )}

        {/* リマインダー（PJ選択中は非表示） */}
        {!selectedProject && (
          <div style={{ marginBottom: "14px" }}>
            <Card
              title="🔔 自分のリマインダー"
              headerExtra={
                <>
                  {reminderTasks.length > 0 && (
                    <span style={{
                      fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
                      background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
                      border: "1px solid var(--color-border-warning)", fontWeight: "500",
                    }}>
                      {reminderTasks.length}件
                    </span>
                  )}
                  <select
                    value={notifyPref}
                    onChange={e => handleNotifyPrefChange(e.target.value as NotifyPref)}
                    title="期限の通知方法（自分の設定）"
                    style={{
                      fontSize: "10px", padding: "2px 6px", paddingRight: "16px",
                      background: "transparent", color: "var(--color-text-tertiary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-sm)", cursor: "pointer",
                    }}
                  >
                    <option value="none">🔕 通知なし</option>
                    <option value="browser">🔔 ブラウザ通知</option>
                    <option value="teams">💬 Teamsまとめ</option>
                  </select>
                  <select
                    value={reminderDays}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10);
                      setReminderDaysState(n);
                      localStorage.setItem(KEYS.REMINDER_DAYS, String(n));
                    }}
                    title="リマインダー対象期間"
                    style={{
                      fontSize: "10px", padding: "2px 6px", paddingRight: "16px",
                      background: "transparent", color: "var(--color-text-tertiary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-sm)", cursor: "pointer",
                    }}
                  >
                    {[3, 7, 14, 30].map(d => (
                      <option key={d} value={d}>{d}日前〜</option>
                    ))}
                  </select>
                </>
              }
            >
              {reminderTasks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "12px 0", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  {reminderDays}日以内に期限のタスクはありません ✓
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", gap: "4px" }}>
                  {reminderTasks.map(task => {
                    const pj = projects.find(p => p.id === task.project_id);
                    const diff = task.due_date ? diffDaysFromToday(task.due_date) : 0;
                    const isOverdue  = diff < 0;
                    const isToday    = diff === 0;
                    const isTomorrow = diff === 1;
                    const tone = isOverdue ? "danger"
                               : isToday    ? "warning"
                               : isTomorrow ? "soft"
                               : "neutral";
                    const bg = tone === "danger"  ? "var(--color-bg-danger)"
                             : tone === "warning" ? "#fff4e0"
                             : tone === "soft"    ? "var(--color-bg-warning)"
                             :                      "var(--color-bg-secondary)";
                    const border = tone === "danger"  ? "var(--color-border-danger)"
                                 : tone === "warning" ? "#f59e0b"
                                 : tone === "soft"    ? "var(--color-border-warning)"
                                 :                      "var(--color-border-primary)";
                    const fg = tone === "danger"  ? "var(--color-text-danger)"
                             : tone === "warning" ? "#b45309"
                             : tone === "soft"    ? "var(--color-text-warning)"
                             :                      "var(--color-text-secondary)";
                    return (
                      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                      <div
                        key={task.id}
                        onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
                        role={onOpenTask ? "button" : undefined}
                        tabIndex={onOpenTask ? 0 : undefined}
                        onKeyDown={onOpenTask ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenTask(task.id); } } : undefined}
                        title={onOpenTask ? "クリックでタスク詳細を開く" : undefined}
                        style={{
                          display: "flex", alignItems: "center", gap: "6px",
                          padding: "5px 10px",
                          background: bg,
                          borderRadius: "var(--radius-md)",
                          border: `1px solid ${border}`,
                          flex: isMobile ? "1" : "0 0 auto",
                          minWidth: 0,
                          cursor: onOpenTask ? "pointer" : undefined,
                        }}>
                        {pj && <span style={{ width: 5, height: 5, borderRadius: "50%", background: pj.color_tag, flexShrink: 0 }} />}
                        <span style={{
                          fontSize: "11px",
                          color: isToday ? fg : "var(--color-text-primary)",
                          fontWeight: isToday ? 600 : 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: isMobile ? "none" : "160px",
                        }}>
                          {task.name}
                        </span>
                        <span style={{
                          fontSize: "10px", flexShrink: 0, fontWeight: isToday || isOverdue ? 700 : 500,
                          color: fg,
                        }}>
                          {isOverdue ? `${Math.abs(diff)}日超過` : isToday ? "🔥 今日" : isTomorrow ? "明日" : `${diff}日後`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* グリッド — key でフィルター変更時にアニメーションを再発火 */}
        <div
          key={`${mineOnly ? "1" : "0"}-${effectivePjIds.join(",")}-${activeKrId ?? ""}`}
          className="animate-fadeIn"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gridTemplateRows: "auto",
            gap: "14px",
          }}>

          {/* ① KR進捗サマリー（PJ選択中は非表示） */}
          {!selectedProject && (<Card title="KR 進捗サマリー" badge={`${krs.length}件`} order={3}>
            {krs.length === 0 && (
              <EmptyState>管理画面でKRを登録してください</EmptyState>
            )}
            {krProgress.map(({ kr, pct, tfSummaries }, i) => {
              const isActive = activeKrId === kr.id;
              const krColor = pct >= 80 ? "var(--color-text-success)" : pct >= 40 ? "var(--color-text-warning)" : "var(--color-text-tertiary)";
              return (
                // KR ボックスはクリックで絞り込みする意図的なインタラクティブ要素
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
                <div
                  key={kr.id}
                  onClick={() => handleKrClick(kr.id)}
                  title="クリックでこのKRに紐づくPJに絞り込み"
                  style={{
                    marginBottom: i < krProgress.length - 1 ? "10px" : 0,
                    padding: "10px", borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    background: isActive ? "var(--color-bg-info)" : "var(--color-bg-secondary)",
                    border: `1px solid ${isActive ? "var(--color-border-info)" : "var(--color-border-primary)"}`,
                    transition: "all 0.1s",
                  }}
                >
                  {/* KRヘッダー */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                    <span style={{
                      fontSize: "11px", color: "var(--color-text-primary)", fontWeight: 500,
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      paddingRight: "8px",
                    }}>
                      <span style={{
                        display: "inline-block", fontSize: "9px", fontWeight: "700",
                        padding: "1px 5px", borderRadius: "3px", marginRight: "5px",
                        background: "var(--color-bg-info)", color: "var(--color-text-info)",
                      }}>KR{i + 1}</span>
                      {kr.title}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      {/* シグナル履歴ドット（最新4週、古い順） */}
                      {(krSessionsMap[kr.id] ?? []).slice(0, 4).reverse().map((s, si) => {
                        const dot = s.signal === "green" ? { bg: "var(--color-signal-green)", title: "🟢" }
                          : s.signal === "yellow" ? { bg: "var(--color-signal-yellow)", title: "🟡" }
                          : s.signal === "red" ? { bg: "var(--color-signal-red)", title: "🔴" }
                          : { bg: "#d1d5db", title: "−" };
                        const typeLabel = s.session_type === "checkin" ? "C" : "W";
                        return (
                          <span
                            key={si}
                            title={`${s.week_start} ${typeLabel}: ${dot.title}`}
                            style={{
                              display: "inline-block",
                              width: "8px", height: "8px", borderRadius: "50%",
                              background: dot.bg, opacity: 0.85, cursor: "default",
                            }}
                          />
                        );
                      })}
                      <span style={{ fontSize: "12px", fontWeight: "700", color: krColor }}>{pct}%</span>
                    </div>
                  </div>
                  <ProgressBar pct={pct} color={krColor} />

                  {/* 今期のTFごとサマリー */}
                  <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed var(--color-border-primary)" }}>
                    <div style={{ fontSize: "9px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: "5px" }}>
                      今期のTF（{tfSummaries.length}）
                    </div>
                    {tfSummaries.length === 0 ? (
                      <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>TFが登録されていません</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                        {tfSummaries.map(({ tf, done, total, pct: tfPct }) => {
                          const tfColor = total === 0 ? "var(--color-text-tertiary)"
                            : tfPct >= 80 ? "var(--color-text-success)"
                            : tfPct >= 40 ? "var(--color-text-warning)"
                            : "var(--color-text-tertiary)";
                          return (
                            <div key={tf.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                <span style={{ color: "var(--color-text-tertiary)", marginRight: "4px" }}>TF{tf.tf_number}</span>
                                {tf.name}
                              </span>
                              <div style={{ width: "56px", flexShrink: 0 }}>
                                <ProgressBar pct={total === 0 ? 0 : tfPct} color={tfColor} />
                              </div>
                              <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0, width: "46px", textAlign: "right" }}>
                                {total === 0 ? "—" : `${done}/${total}・${tfPct}%`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>)}

          {/* ② 期限アラート + 滞留タスク */}
          <Card
            title="期限アラート"
            badge={(alertTasks.length + stagnantTasks.length) > 0 ? `${alertTasks.length + stagnantTasks.length}件` : undefined}
            badgeColor="danger"
            order={4}
          >
            {alertTasks.length === 0 && stagnantTasks.length === 0 && (
              <EmptyState>期限超過・滞留タスクはありません ✓</EmptyState>
            )}
            {alertTasks.map(task => {
              const pj = projects.find(p => p.id === task.project_id);
              const diff = task.due_date ? diffDaysFromToday(task.due_date) : 0;
              const isToday = diff === 0;
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  members={members}
                  saveTask={saveTask}
                  project={pj}
                  onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
                  badge={
                    <span style={{
                      fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                      background: isToday ? "var(--color-bg-warning)" : "var(--color-bg-danger)",
                      color: isToday ? "var(--color-text-warning)" : "var(--color-text-danger)",
                      fontWeight: "500",
                    }}>
                      {isToday ? "今日" : `${Math.abs(diff)}日超過`}
                    </span>
                  }
                />
              );
            })}
            {stagnantTasks.length > 0 && (
              <>
                {alertTasks.length > 0 && (
                  <div style={{ height: "1px", background: "var(--color-border-primary)", margin: "8px 0" }} />
                )}
                <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-tertiary)", marginBottom: "6px", letterSpacing: "0.04em" }}>
                  滞留タスク（{stagnantDays}日以上進捗なし）
                </div>
                {stagnantTasks.map(task => {
                  const pj = projects.find(p => p.id === task.project_id);
                  const diffMs = Date.now() - new Date(task.updated_at ?? Date.now()).getTime();
                  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                  return (
                    <TaskRow
                      key={task.id}
                      task={task}
                      members={members}
                      saveTask={saveTask}
                      project={pj}
                      onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
                      badge={
                        <span style={{
                          fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                          background: "#fff7ed",
                          color: "#c2410c",
                          border: "1px solid #fed7aa",
                          fontWeight: "500",
                        }}>
                          ⚠ {days}日滞留
                        </span>
                      }
                    />
                  );
                })}
              </>
            )}
          </Card>

          {/* ③ 今週のタスク */}
          <Card title="今週のタスク" badge={`${thisWeekTasks.length}件`} order={1}>
            {thisWeekTasks.length === 0 && (
              <EmptyState>今週期限のタスクはありません</EmptyState>
            )}
            {thisWeekTasks.map(task => {
              const pj = projects.find(p => p.id === task.project_id);
              const diff = task.due_date ? diffDaysFromToday(task.due_date) : 0;
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  members={members}
                  saveTask={saveTask}
                  project={pj}
                  onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
                  badge={
                    <span style={{
                      fontSize: "9px", padding: "1px 6px", borderRadius: "3px",
                      background: diff === 0
                        ? "var(--color-bg-warning)"
                        : "var(--color-bg-secondary)",
                      color: diff === 0
                        ? "var(--color-text-warning)"
                        : "var(--color-text-tertiary)",
                    }}>
                      {diff === 0 ? "今日" : diff === 1 ? "明日" : `${diff}日後`}
                    </span>
                  }
                />
              );
            })}
          </Card>

          {/* ④ PJ進捗一覧（PJ選択中はカルテに集約されるので非表示） */}
          {!selectedProject && (
          <Card title="PJ 進捗一覧" order={2}>
            {pjProgress.length === 0 && (
              <EmptyState>プロジェクトを作成してください</EmptyState>
            )}
            {pjProgress.map(({ pj, done, total, pct }) => (
              <div key={pj.id} style={{ marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: pj.color_tag, display: "inline-block", flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: "11px", color: "var(--color-text-secondary)",
                    flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {pj.name}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                    {done}/{total}件
                  </span>
                  <span style={{
                    fontSize: "11px", fontWeight: "500", flexShrink: 0,
                    color: pct >= 80 ? "var(--color-text-success)"
                      : pct >= 40 ? "var(--color-text-warning)"
                      : "var(--color-text-tertiary)",
                  }}>
                    {pct}%
                  </span>
                </div>
                <ProgressBar pct={pct} color={pj.color_tag} />
              </div>
            ))}
          </Card>
          )}

          {/* ⑤ メンション（PJ選択中は非表示） */}
          {!selectedProject && mentionedTasks.length > 0 && (
            <Card
              title="自分へのメンション"
              badge={`${mentionedTasks.length}件`}
              order={5}
            >
              {mentionedTasks.map(task => {
                const m   = members.find(mb => mb.id === task.updated_by);
                const pj  = projects.find(p => p.id === task.project_id);
                const token = `@${currentUser.short_name}`;
                // コメントからメンション周辺の抜粋を作る（前後20文字）
                const idx = (task.comment ?? "").indexOf(token);
                const snippet = idx >= 0
                  ? "…" + (task.comment ?? "").slice(Math.max(0, idx - 10), idx + token.length + 20).trim() + "…"
                  : "";
                return (
                  <div
                    key={task.id}
                    onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
                    style={{
                      padding: "8px 0",
                      borderBottom: "1px solid var(--color-border-primary)",
                      cursor: onOpenTask ? "pointer" : "default",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {m && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                          fontSize: "9px", fontWeight: 700,
                          background: m.color_bg || "var(--color-brand-primary)",
                          color: m.color_text || "#fff",
                        }}>
                          {m.initials}
                        </span>
                      )}
                      <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.name}
                      </span>
                      {pj && (
                        <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                          {pj.name}
                        </span>
                      )}
                    </div>
                    {snippet && (
                      <div style={{ fontSize: "10px", color: "var(--color-text-secondary)", marginTop: "2px", paddingLeft: "24px" }}>
                        {snippet}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          )}

        </div>

        {/* ⑥ ToDo進捗一覧（PJ選択中は非表示） */}
        {!selectedProject && todoProgress.length > 0 && (
          <div style={{ marginTop: "14px" }}>
            <Card title="ToDo 進捗一覧">
              {todoProgress.map(({ tf, todoItems }) => (
                <div key={tf.id} style={{ marginBottom: "14px" }}>
                  {/* TFラベル */}
                  <div style={{
                    fontSize: "10px", fontWeight: "600",
                    color: "var(--color-text-tertiary)",
                    marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {tf.tf_number} {tf.name}
                  </div>
                  {/* ToDoアイテム */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "8px",
                  }}>
                    {todoItems.map(({ todo, done, total, pct }) => (
                      <div key={todo.id} style={{
                        padding: "8px 10px",
                        background: "var(--color-bg-secondary)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-border-primary)",
                      }}>
                        <div style={{
                          fontSize: "11px", color: "var(--color-text-primary)",
                          marginBottom: "4px",
                          overflow: "hidden", textOverflow: "ellipsis",
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          lineHeight: "1.4",
                        }}>
                          {todo.title}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div style={{ flex: 1 }}>
                            <ProgressBar pct={pct} color={
                              pct >= 80 ? "var(--color-text-success)"
                                : pct >= 40 ? "var(--color-text-warning)"
                                : "var(--color-text-tertiary)"
                            } />
                          </div>
                          <span style={{
                            fontSize: "10px", flexShrink: 0, fontWeight: "500",
                            color: pct >= 80 ? "var(--color-text-success)"
                              : pct >= 40 ? "var(--color-text-warning)"
                              : "var(--color-text-tertiary)",
                          }}>
                            {done}/{total}
                          </span>
                          {todo.due_date && (
                            <span style={{
                              fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0,
                            }}>
                              {formatMD(todo.due_date)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ===== 小コンポーネント =====

function Card({
  title, badge, badgeColor = "info", order, headerExtra, children,
}: {
  title: string;
  badge?: string;
  badgeColor?: "info" | "danger";
  /** グリッド内の表示順（CSS order）。JSXを動かさず行の上下を入れ替えるために使う */
  order?: number;
  /** ヘッダー右端に追加するコンテンツ（セレクタ・カスタムバッジ等） */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const badgeStyles = {
    info: { bg: "var(--color-bg-info)", color: "var(--color-text-info)", border: "var(--color-border-info)" },
    danger: { bg: "var(--color-bg-danger)", color: "var(--color-text-danger)", border: "var(--color-border-danger)" },
  };
  const bs = badgeStyles[badgeColor];

  return (
    <div style={{
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      order,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "10px 14px 8px",
        borderBottom: "1px solid var(--color-border-primary)",
      }}>
        <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)", flex: 1 }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
            background: bs.bg, color: bs.color, border: `1px solid ${bs.border}`,
            fontWeight: "500",
          }}>
            {badge}
          </span>
        )}
        {headerExtra}
      </div>
      <div style={{ padding: "10px 14px", minHeight: "80px" }}>
        {children}
      </div>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      height: 5, background: "var(--color-bg-tertiary)",
      borderRadius: "var(--radius-full)", overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: `${pct}%`,
        background: color, borderRadius: "var(--radius-full)",
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function TaskRow({
  task, project, badge, onClick, members, saveTask,
}: {
  task: Task;
  project?: Project;
  badge: React.ReactNode;
  /** 指定時：行クリック（Enter/Space）でタスク詳細を開く */
  onClick?: () => void;
  /** 担当者アイコンをクリックしての変更（複数選択可）に使う */
  members: Member[];
  saveTask: (task: Task) => Promise<void> | void;
}) {
  return (
    // onClick 指定時のみ role/tabIndex/onKeyDown を付与する条件付きインタラクティブ要素
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      title={onClick ? "クリックでタスク詳細を開く" : undefined}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-secondary)"; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "5px 6px", margin: "0 -6px",
        borderBottom: "1px solid var(--color-bg-tertiary)",
        borderRadius: "var(--radius-sm)",
        cursor: onClick ? "pointer" : undefined,
        background: "transparent",
        transition: "background var(--transition-fast)",
      }}>
      {/* 行クリックでタスク詳細が開くため、アイコンクリックはそちらに伝播させない */}
      <div onClick={e => e.stopPropagation()}>
        <InlineEditAssignee
          assigneeIds={getAssigneeIds(task)}
          members={members}
          onSave={ids => saveTask({ ...task, assignee_member_ids: ids })}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "11px", color: "var(--color-text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {task.name}
        </div>
        {project && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
            <span style={{
              width: 4, height: 4, borderRadius: "50%",
              background: project.color_tag, display: "inline-block",
            }} />
            <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)" }}>
              {project.name.slice(0, 16)}
            </span>
          </div>
        )}
      </div>
      {badge}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      textAlign: "center", padding: "16px 0",
      fontSize: "11px", color: "var(--color-text-tertiary)",
    }}>
      {children}
    </div>
  );
}
