// src/components/project/ProjectCreateModal.tsx
//
// 【設計意図】
// サイドバーの「＋」ボタンから素早くプロジェクトを作成するための簡易モーダル。
// 必須フィールド（名前・目的・オーナー）のみで即座に作成でき、
// 細かい設定（TF連携・メンバー・contribution_memo等）は作成後に管理画面で補完する。
//
// 【他PJからのタスク引き継ぎ（山本さん確定仕様・2026-07-22）】
// 「まっさらな新規作成」に加え、過去含む他PJを選んでそのタスクをチェックボックスで
// 引き継ぎながら新PJを作る導線を追加。同じ段取りで回す案件（フォーラム運営・定例調査等）を
// 毎回ゼロから作らずに済むようにするため。日付は元PJ開始日からの相対日数を保ったまま新PJ
// 開始日にスライド・ステータスは全てtodoにリセット・担当者は引き継ぐ・依存関係は先行/後続の
// 両方がチェックされている組だけ引き継ぐ（詳細は lib/project/taskInheritance.ts）。
// タスク作成は既存の appStore.saveTask/addTaskDependency 経由で行う（B1/B3/B4/v2.75の
// choke pointをそのまま活かすため）。新規作成する大量タスクでB3自動リスケ連鎖を
// 誤発火させないよう { skipCascade: true } を必ず付ける（依存関係はタスク作成後にまとめて
// 張るため、作成時点では対象タスクに依存の相手がまだ存在せずcascadeは元々no-opだが、
// 安全側かつ無駄な計算を避けるため明示的にskipする）。

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedTaskDependencies } from "../../stores/appStore";
import { active } from "../../lib/localData/localStore";
import type { Member, Project, Task } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { todayStr } from "../../lib/date";
import { childrenOf } from "../../lib/taskHierarchy";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE } from "../../lib/taskMeta";
import { defaultCheckedTaskIds, buildInheritedTasks, buildInheritedDependencies } from "../../lib/project/taskInheritance";

const PROJECT_STATUS_LABEL: Record<Project["status"], string> = {
  active: "進行中", completed: "完了", archived: "アーカイブ",
};

const COLOR_PRESETS = [
  "#7F77DD", "#4A90D9", "#27AE60", "#F59E0B",
  "#EF4444", "#EC4899", "#14B8A6", "#8B5CF6",
  "#F97316", "#6B7280",
];

interface Props {
  currentUser: Member;
  onClose: () => void;
  /** 作成完了後にそのPJを選択状態にするコールバック（任意） */
  onCreated?: (projectId: string) => void;
}

export function ProjectCreateModal({ currentUser, onClose, onCreated }: Props) {
  const rawMembers = useAppStore(s => s.members);
  const rawProjects = useAppStore(selectScopedProjects);
  const rawTasksAll = useAppStore(selectScopedTasks);
  const saveProject = useAppStore(s => s.saveProject);
  const members = active(rawMembers);

  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [ownerIds, setOwnerIds] = useState<string[]>([currentUser.id]);
  const [colorTag, setColorTag] = useState(COLOR_PRESETS[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ===== 他PJからのタスク引き継ぎ =====
  const [mode, setMode] = useState<"blank" | "inherit">("blank");
  const [originProjectId, setOriginProjectId] = useState("");
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  // 引き継ぎ元候補：過去（完了・アーカイブ・終了日超過）も含む非削除PJ。過去のものは一覧上で分かるよう dim + meta 表示
  const originOptions = useMemo<SelectOption[]>(() => {
    const today = todayStr();
    return active(rawProjects)
      .map(p => {
        const isPastByDate = !!p.end_date && p.end_date < today;
        const isPast = p.status !== "active" || isPastByDate;
        const meta = p.status !== "active"
          ? PROJECT_STATUS_LABEL[p.status]
          : (isPastByDate ? "進行中・終了日超過" : "進行中");
        return { value: p.id, label: p.name, color: p.color_tag, meta, dim: isPast };
      })
      .sort((a, b) => Number(a.dim) - Number(b.dim));
  }, [rawProjects]);

  const originTasks = useMemo(
    () => (mode === "inherit" && originProjectId)
      ? rawTasksAll.filter(t => !t.is_deleted && t.project_id === originProjectId)
      : [],
    [mode, originProjectId, rawTasksAll],
  );

  const topLevelOriginTasks = useMemo(
    () => originTasks.filter(t => !t.parent_task_id).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [originTasks],
  );

  // 引き継ぎ元PJを切り替えた時だけチェック状態を既定値に初期化する。
  // originTasks（rawTasksAllから派生）を依存に含めると、他人の無関係なタスク編集で
  // rawTasksAll の参照が変わるたびにユーザーが手で外したチェックがリセットされてしまうため、
  // 依存は mode/originProjectId のみにし、既定値の算出はここで最新スナップショットを直接読む。
  useEffect(() => {
    if (mode !== "inherit" || !originProjectId) {
      setCheckedTaskIds(new Set());
      return;
    }
    const liveTasks = selectScopedTasks(useAppStore.getState())
      .filter(t => !t.is_deleted && t.project_id === originProjectId);
    setCheckedTaskIds(defaultCheckedTaskIds(liveTasks));
  }, [mode, originProjectId]);

  const toggleTask = useCallback((id: string) => {
    setCheckedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /**
   * チェックされたタスク（＋両端がチェック済みの依存関係）を新PJに複製する。
   * 親を先に保存してから子を保存（FK制約対応・既存のQuickAddTaskModalと同じ順序）。
   * 個々の保存が失敗しても他は止めない（Promise.allSettled・B3カスケード等と同じ
   * 「最善努力＋失敗はトースト」の割り切り）。親の保存が失敗した子はダングリングした
   * parent_task_id のままだとFK違反で確実に失敗するため、親なしとして保存を試みる。
   */
  const inheritTasksFromOrigin = useCallback(async (newProjectId: string, newProjectStartDate: string) => {
    const state = useAppStore.getState();
    const liveOriginTasks = selectScopedTasks(state).filter(t => !t.is_deleted && t.project_id === originProjectId);
    const liveOriginProject = selectScopedProjects(state).find(p => p.id === originProjectId);
    const liveOriginDeps = selectScopedTaskDependencies(state).filter(d => !d.is_deleted);

    const now = new Date().toISOString();
    const { tasks, idMap } = buildInheritedTasks({
      originTasks: liveOriginTasks,
      checkedTaskIds,
      newProjectId,
      newProjectStartDate,
      originProjectStartDate: liveOriginProject?.start_date ?? null,
      createdBy: currentUser.id,
      now,
      generateId: () => uuidv4(),
    });
    if (tasks.length === 0) return;

    const topLevel = tasks.filter(t => !t.parent_task_id);
    const children = tasks.filter(t => t.parent_task_id);

    const topResults = await Promise.allSettled(
      topLevel.map(t => state.saveTask(t, { skipCascade: true })),
    );
    const succeededIds = new Set<string>();
    topLevel.forEach((t, i) => { if (topResults[i].status === "fulfilled") succeededIds.add(t.id); });

    const childrenToSave = children.map(c =>
      c.parent_task_id && !succeededIds.has(c.parent_task_id) ? { ...c, parent_task_id: null } : c,
    );
    const childResults = await Promise.allSettled(
      childrenToSave.map(t => state.saveTask(t, { skipCascade: true })),
    );
    childrenToSave.forEach((t, i) => { if (childResults[i].status === "fulfilled") succeededIds.add(t.id); });

    const successfulIdMap = new Map([...idMap].filter(([, newId]) => succeededIds.has(newId)));
    const depPairs = buildInheritedDependencies(liveOriginDeps, successfulIdMap);
    const depResults = await Promise.allSettled(
      depPairs.map(p => state.addTaskDependency(p.predecessorTaskId, p.successorTaskId, currentUser.id)),
    );
    const succeededDeps = depResults.filter(r => r.status === "fulfilled").length;

    const failedTasks = tasks.length - succeededIds.size;
    const failedDeps = depPairs.length - succeededDeps;
    if (failedTasks > 0 || failedDeps > 0) {
      const parts = [`プロジェクトは作成されましたが、タスクは${succeededIds.size}/${tasks.length}件しか引き継げませんでした。`];
      if (failedDeps > 0) parts.push(`依存関係も${failedDeps}件引き継げませんでした。`);
      parts.push("不足分は編集画面から手動で追加してください。");
      showToast(parts.join(""), "error");
    }
  }, [originProjectId, checkedTaskIds, currentUser.id]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !purpose.trim() || ownerIds.length === 0) return;
    if (mode === "inherit" && !originProjectId) return;
    if (startDate && endDate && startDate > endDate) {
      setError("開始日は終了日より前に設定してください。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const resolvedStartDate = startDate || todayStr();
      const newProject: Project = {
        id,
        name: name.trim(),
        purpose: purpose.trim(),
        contribution_memo: "",
        owner_member_id: ownerIds[0],
        owner_member_ids: ownerIds,
        member_ids: [],
        status: "active",
        color_tag: colorTag,
        start_date: resolvedStartDate,
        end_date: endDate || `${new Date().getFullYear()}-12-31`,
        is_deleted: false,
        created_at: now,
        updated_at: now,
        updated_by: currentUser.id,
      };
      await saveProject(newProject);
      if (mode === "inherit" && originProjectId) {
        await inheritTasksFromOrigin(id, resolvedStartDate);
      }
      onCreated?.(id);
      onClose();
    } catch (e) {
      setError(formatErrorForUser("プロジェクトの作成に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [name, purpose, ownerIds, colorTag, startDate, endDate, mode, originProjectId, inheritTasksFromOrigin, saveProject, currentUser.id, onCreated, onClose]);

  const canSave = name.trim() && purpose.trim() && ownerIds.length > 0 && (mode === "blank" || !!originProjectId);

  return (
    // 背景クリックで閉じる（マウス操作の補助）。Escapeキー（handleKeyDown）と
    // ✕ボタンでキーボードからも閉じられるため、背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="animate-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="animate-fadeIn" style={{ width: "min(480px, 100%)", background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ヘッダー */}
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>📁</span>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>新規プロジェクト</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--color-text-tertiary)", padding: "2px 6px", lineHeight: 1 }}>✕</button>
        </div>

        {/* フォーム */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto" }}>

          {/* 作成方法 */}
          <div>
            <Label>作成方法</Label>
            <div style={{ display: "flex", gap: "4px" }}>
              {([
                { value: "blank" as const, label: "まっさらな新規作成" },
                { value: "inherit" as const, label: "他のPJから引き継ぐ" },
              ]).map(seg => {
                const isActive = mode === seg.value;
                return (
                  <button
                    key={seg.value}
                    type="button"
                    onClick={() => setMode(seg.value)}
                    style={{
                      flex: 1, padding: "7px 4px", fontSize: "12px", fontWeight: isActive ? 600 : 400,
                      border: `1px solid ${isActive ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                      borderRadius: "var(--radius-md)",
                      background: isActive ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                      color: isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {seg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 引き継ぎ元PJ選択＋タスクチェックリスト（他PJから引き継ぐ選択時のみ） */}
          {mode === "inherit" && (
            <div className="animate-slideDown">
              <Label>引き継ぎ元プロジェクト *</Label>
              <CustomSelect
                value={originProjectId}
                onChange={setOriginProjectId}
                options={originOptions}
                placeholder="プロジェクトを選択..."
                searchable
                searchPlaceholder="プロジェクト名で検索..."
              />
              {originProjectId && (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <Label>引き継ぐタスク（{checkedTaskIds.size}/{originTasks.length}件選択中）</Label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button type="button" onClick={() => setCheckedTaskIds(new Set(originTasks.map(t => t.id)))} style={miniBtnStyle}>全選択</button>
                      <button type="button" onClick={() => setCheckedTaskIds(new Set())} style={miniBtnStyle}>全解除</button>
                    </div>
                  </div>
                  {originTasks.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
                      このプロジェクトにはタスクがありません。
                    </div>
                  ) : (
                    <div style={{
                      border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                      maxHeight: "220px", overflowY: "auto", padding: "2px 10px",
                      background: "var(--color-bg-secondary)",
                    }}>
                      {topLevelOriginTasks.map(t => (
                        <div key={t.id}>
                          <TaskCheckRow task={t} checked={checkedTaskIds.has(t.id)} onToggle={toggleTask} members={members} />
                          {childrenOf(originTasks, t.id).map(c => (
                            <TaskCheckRow key={c.id} task={c} checked={checkedTaskIds.has(c.id)} onToggle={toggleTask} members={members} indent />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    ステータスは全て「ToDo」にリセットされ、日付は新PJの開始日を基準にスライドして引き継がれます。
                  </div>
                </div>
              )}
            </div>
          )}

          {/* カラー＋PJ名 */}
          <div>
            <Label>プロジェクト名 *</Label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {/* カラードット（クリックでカラーピッカー） */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <input
                  type="color"
                  value={colorTag}
                  onChange={e => setColorTag(e.target.value)}
                  title="カラーを変更"
                  style={{ position: "absolute", opacity: 0, width: "24px", height: "24px", cursor: "pointer", border: "none", padding: 0 }}
                />
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: colorTag, display: "block", cursor: "pointer", border: "2px solid var(--color-border-primary)", flexShrink: 0 }} />
              </div>
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); } }}
                placeholder="例：動画生成AI活用プロジェクト"
                maxLength={80}
                style={inputStyle}
              />
            </div>
            {/* カラープリセット */}
            <div style={{ display: "flex", gap: "5px", marginTop: "8px", flexWrap: "wrap" }}>
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setColorTag(c)}
                  title={c}
                  style={{
                    width: 18, height: 18, borderRadius: "50%", background: c, border: "none", cursor: "pointer", flexShrink: 0,
                    outline: colorTag === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                />
              ))}
            </div>
          </div>

          {/* 目的 */}
          <div>
            <Label>目的 * （何のためのPJか一行で）</Label>
            <textarea
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="例：全員が動画を作れる体制を構築する"
              maxLength={200}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {/* オーナー */}
          <div>
            <Label>オーナー *</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "6px" }}>
              {ownerIds.map(id => {
                const m = members.find(m => m.id === id);
                if (!m) return null;
                return (
                  <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", padding: "3px 8px 3px 5px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}>
                    <Avatar member={m} size={16} />
                    {m.short_name}
                    {ownerIds.length > 1 && (
                      <button onClick={() => setOwnerIds(ids => ids.filter(i => i !== id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--color-text-tertiary)", fontSize: "12px" }}>×</button>
                    )}
                  </span>
                );
              })}
              <select
                value=""
                onChange={e => { const v = e.target.value; if (v && !ownerIds.includes(v)) setOwnerIds(ids => [...ids, v]); }}
                style={{ fontSize: "11px", padding: "3px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-primary)", background: "var(--color-bg-primary)", color: "var(--color-text-secondary)", cursor: "pointer" }}
              >
                <option value="">＋ 追加</option>
                {members.filter(m => !ownerIds.includes(m.id)).map(m => (
                  <option key={m.id} value={m.id}>{m.short_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 期間（任意） */}
          <div>
            <Label>期間（任意）</Label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>〜</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            </div>
          </div>

          {error && (
            <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>{error}</div>
          )}
        </div>

        {/* フッター */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ fontSize: "12px", padding: "7px 16px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              fontSize: "12px", padding: "7px 20px", border: "none", borderRadius: "var(--radius-md)", fontWeight: 600,
              background: canSave && !saving ? "var(--color-brand)" : "var(--color-bg-tertiary)",
              color: canSave && !saving ? "#fff" : "var(--color-text-tertiary)",
              cursor: canSave && !saving ? "pointer" : "default",
            }}
          >
            {saving ? "作成中…" : "作成"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "5px" }}>{children}</div>;
}

/** 引き継ぎタスクチェックリストの1行（親・子共通。indent=trueで子の表示に使う） */
function TaskCheckRow({ task, checked, onToggle, members, indent }: {
  task: Task;
  checked: boolean;
  onToggle: (id: string) => void;
  members: Member[];
  indent?: boolean;
}) {
  const assignee = members.find(m => m.id === task.assignee_member_id);
  const showStatusBadge = task.status !== "todo" && task.status !== "in_progress";
  return (
    <label
      style={{
        display: "flex", alignItems: "center", gap: "7px", padding: "4px 0",
        paddingLeft: indent ? "20px" : 0, cursor: "pointer", fontSize: "12px",
        color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-primary)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(task.id)}
        style={{ flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
      />
      {indent && <span style={{ color: "var(--color-text-tertiary)" }}>↳</span>}
      <span style={{ flex: 1, textDecoration: task.status === "cancelled" ? "line-through" : "none" }}>{task.name}</span>
      {assignee && <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>{assignee.short_name}</span>}
      {showStatusBadge && (
        <span style={{
          fontSize: "10px", padding: "1px 6px", borderRadius: "var(--radius-full)", flexShrink: 0,
          background: TASK_STATUS_STYLE[task.status].bg, color: TASK_STATUS_STYLE[task.status].color,
        }}>
          {TASK_STATUS_LABEL[task.status]}
        </span>
      )}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: "13px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-secondary)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
  outline: "none",
};

const miniBtnStyle: React.CSSProperties = {
  fontSize: "10px",
  padding: "2px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border-primary)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
