// src/components/project/ProjectCreateModal.tsx
//
// 【設計意図】
// サイドバーの「＋」ボタンから素早くプロジェクトを作成するための簡易モーダル。
// 必須フィールド（名前・目的・オーナー）のみで即座に作成でき、
// 細かい設定（TF連携・メンバー・contribution_memo等）は作成後に管理画面で補完する。
//
// 【他PJからのタスク引き継ぎ（山本さん確定仕様・2026-07-22／日付基準・マイルストーン・
// メンバー引き継ぎを2026-08-12・v3.57で追加）】
// 「まっさらな新規作成」に加え、過去含む他PJを選んでタスク・マイルストーン・メンバーを
// チェックボックスで引き継ぎながら新PJを作る導線。同じ段取りで回す案件（フォーラム運営・
// 定例調査等）を毎回ゼロから作らずに済むようにするため。
//
// 【日付の引き継ぎ（v3.57）】旧実装（〜v3.56）は元PJ開始日→新PJ開始日の相対日数を必ず保つ
// 設計だったが、次の3通りから選べるようにした：
//   (a) 元PJのマイルストーンの1つを基準にする（下のマイルストーン一覧の各行にある
//       「基準」ラジオで選ぶ。基準に選んだ行は自動でチェックON＝矛盾防止）
//   (b) 元PJの開始日を基準にする
//   (c) 日付を引き継がない（既定。既存利用者が意図せず日付付きタスクを大量に作る事故を防ぐ）
// (a)(b)を選んだ場合、新PJ側の対応する日付（newAnchorDate）を入力してもらい、
// 「基準の元日付→新日付」の差分（暦日オフセット）を全タスク・全マイルストーンの日付に
// 同じだけ加算する（lib/project/inheritTaskDates.ts）。ステータスは全てtodoにリセット・
// 担当者は引き継ぐ・依存関係は先行/後続の両方がチェックされている組だけ引き継ぐ
// （詳細は lib/project/taskInheritance.ts）。
//
// 【メンバーの引き継ぎ（v3.57）】CLAUDE.md Section 3-2の「PJ↔Member多対多」は本実装では
// 独立テーブルではなく projects.member_ids（配列列）。候補は元PJのmember_ids∪全タスクの
// 担当者、既定チェックはチェック中タスクの担当者のみ（lib/project/inheritMembers.ts）。
// 選んだメンバーはnewProjectのmember_idsとしてプロジェクト作成時に1回のupsertで書き込む
// （タスク・マイルストーンのような追加の保存呼び出しは不要＝順序問題が発生しない）。
//
// タスク・マイルストーン作成は既存の appStore.saveTask/saveMilestone/addTaskDependency
// 経由で行う（B1/B3/B4/v2.75の choke pointをそのまま活かすため）。新規作成する大量タスクで
// B3自動リスケ連鎖を誤発火させないよう { skipCascade: true } を必ず付ける（依存関係は
// タスク作成後にまとめて張るため、作成時点では対象タスクに依存の相手がまだ存在せず
// cascadeは元々no-opだが、安全側かつ無駄な計算を避けるため明示的にskipする）。
//
// 【トランザクションではない】saveProjectが成功した後にmilestone/task/依存関係の保存が
// 一部失敗しても、プロジェクト自体のロールバックはしない（既存のB3の割り切りと同じ考え方）。
// 失敗した分はトーストで件数を知らせ、利用者が編集画面から手動で追加する想定。

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedTaskDependencies } from "../../stores/appStore";
import { active } from "../../lib/localData/localStore";
import type { Member, Milestone, Project, Task } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { formatErrorForUser } from "../../lib/errorMessage";
import { showToast } from "../common/Toast";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { todayStr, formatMD } from "../../lib/date";
import { childrenOf } from "../../lib/taskHierarchy";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE } from "../../lib/taskMeta";
import {
  defaultCheckedTaskIds, buildInheritedTasks, buildInheritedDependencies, buildInheritedMilestones,
} from "../../lib/project/taskInheritance";
import { candidateInheritMembers, defaultCheckedMemberIds } from "../../lib/project/inheritMembers";
import { computeInheritOffsetDays, computeInheritedTaskDates, computeInheritedMilestoneDate } from "../../lib/project/inheritTaskDates";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";

/** アンカー選択の値："none"＝引き継がない／"project_start"＝元PJ開始日／それ以外＝マイルストーンID */
type AnchorSelection = "none" | "project_start" | string;

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
  const rawMilestonesAll = useAppStore(s => s.milestones);
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

  // ===== 他PJからの引き継ぎ（タスク／マイルストーン／メンバー） =====
  const [mode, setMode] = useState<"blank" | "inherit">("blank");
  const [originProjectId, setOriginProjectId] = useState("");
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());
  const [checkedMilestoneIds, setCheckedMilestoneIds] = useState<Set<string>>(new Set());
  const [checkedMemberIds, setCheckedMemberIds] = useState<Set<string>>(new Set());
  // 日付の基準（アンカー）："project_start"（既定＝v3.56以前と同じ挙動）／"none"／マイルストーンID。
  // 【v3.57→v3.58の訂正】v3.57では既定を"none"（引き継がない）にしたが、これは統括が
  // 「旧実装は常にPJ開始日基準で日付を引き継いでいた（オプトアウト不可）」という事実を
  // 把握しないまま出した誤った指示に基づくもので、結果的にv3.56以前の便利な既定挙動を
  // 退行させてしまった。v3.58で"project_start"に戻す。
  const [anchorSelection, setAnchorSelection] = useState<AnchorSelection>("project_start");
  // 新PJ側の対応する日付（マイルストーンを基準にしたときのみ使う。"project_start"は
  // resolvedNewStartDate＝新PJの開始日欄（期間セクション）をそのまま使うため、この状態は不要）
  const [newAnchorDate, setNewAnchorDate] = useState("");

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

  const originProject = useMemo(
    () => active(rawProjects).find(p => p.id === originProjectId) ?? null,
    [rawProjects, originProjectId],
  );

  const originMilestones = useMemo(
    () => (mode === "inherit" && originProjectId)
      ? active(rawMilestonesAll).filter(m => m.project_id === originProjectId).sort((a, b) => a.date.localeCompare(b.date))
      : [],
    [mode, originProjectId, rawMilestonesAll],
  );

  // 候補＝元PJのmember_ids ∪ 全タスクの担当者（非削除メンバーのみ）。projectMembers.ts の
  // computeProjectMembers（オーナー・担当者・招待者まで広げる別目的の集約）は流用しない
  // （lib/project/inheritMembers.ts のコメント参照）。
  const candidateMembers = useMemo(
    () => (mode === "inherit" && originProjectId)
      ? candidateInheritMembers(rawMembers, originProject?.member_ids, originTasks)
      : [],
    [mode, originProjectId, rawMembers, originProject, originTasks],
  );

  // 引き継ぎ元PJを切り替えた時だけチェック状態を既定値に初期化する。
  // originTasks（rawTasksAllから派生）を依存に含めると、他人の無関係なタスク編集で
  // rawTasksAll の参照が変わるたびにユーザーが手で外したチェックがリセットされてしまうため、
  // 依存は mode/originProjectId のみにし、既定値の算出はここで最新スナップショットを直接読む。
  useEffect(() => {
    if (mode !== "inherit" || !originProjectId) {
      setCheckedTaskIds(new Set());
      setCheckedMilestoneIds(new Set());
      setCheckedMemberIds(new Set());
      setAnchorSelection("project_start");
      setNewAnchorDate("");
      return;
    }
    const state = useAppStore.getState();
    const liveTasks = selectScopedTasks(state).filter(t => !t.is_deleted && t.project_id === originProjectId);
    const defaultTaskIds = defaultCheckedTaskIds(liveTasks);
    setCheckedTaskIds(defaultTaskIds);

    const liveMilestones = active(state.milestones).filter(m => m.project_id === originProjectId);
    setCheckedMilestoneIds(new Set(liveMilestones.map(m => m.id))); // マイルストーンは既定で全チェック

    const liveOriginProject = selectScopedProjects(state).find(p => p.id === originProjectId);
    const liveCandidates = candidateInheritMembers(state.members, liveOriginProject?.member_ids, liveTasks);
    const defaultCheckedTasks = liveTasks.filter(t => defaultTaskIds.has(t.id));
    const liveDefaultMemberIds = defaultCheckedMemberIds(defaultCheckedTasks);
    // candidate外（is_deleted等）のIDが紛れないよう候補集合との積を取る
    const candidateIdSet = new Set(liveCandidates.map(m => m.id));
    setCheckedMemberIds(new Set([...liveDefaultMemberIds].filter(id => candidateIdSet.has(id))));

    setAnchorSelection("project_start"); // 既定はv3.56以前と同じ「元PJ開始日を基準にする」
    setNewAnchorDate("");
  }, [mode, originProjectId]);

  const toggleTask = useCallback((id: string) => {
    setCheckedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleMember = useCallback((id: string) => {
    setCheckedMemberIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleMilestone = useCallback((id: string) => {
    setCheckedMilestoneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // 基準にしていたマイルストーンのチェックを外したら基準指定も解除する（矛盾防止）。
        // 「引き継がない」ではなく既定の"project_start"へ戻す（v3.58）。
        setAnchorSelection(sel => (sel === id ? "project_start" : sel));
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** 基準（アンカー）を選ぶ。マイルストーンを基準にした場合はそのマイルストーンを自動でチェックONにする。 */
  const selectAnchor = useCallback((value: AnchorSelection) => {
    setAnchorSelection(value);
    if (value !== "none" && value !== "project_start") {
      setCheckedMilestoneIds(prev => new Set(prev).add(value));
    }
  }, []);

  // 新PJの開始日欄（期間セクション）の解決値。未入力なら今日（v3.56以前のinheritTasksFromOrigin
  // と同じフォールバック＝resolvedStartDateと同じ式をここでも使う）。"project_start"アンカーは
  // 別の入力欄を持たず、必ずこの値を新しい基準日として使う（新PJ自身の開始日と、日付移動の
  // 基準日を別々に入力させると食い違いが起きるため、単一の入力欄に統一する）。
  const resolvedNewStartDate = startDate || todayStr();

  // 基準の元日付（マイルストーンの日付／元PJ開始日／未選択ならnull）
  const originAnchorDate = useMemo(() => {
    if (anchorSelection === "none") return null;
    if (anchorSelection === "project_start") return originProject?.start_date ?? null;
    return originMilestones.find(m => m.id === anchorSelection)?.date ?? null;
  }, [anchorSelection, originProject, originMilestones]);

  // 基準の新日付："project_start"はresolvedNewStartDate（新PJの開始日欄）・マイルストーン
  // 基準はnewAnchorDate（専用のdate input）・"none"は使わない
  const newAnchorDateForOffset = anchorSelection === "project_start" ? resolvedNewStartDate : newAnchorDate;

  // 日付移動のオフセット（暦日）。null＝「日付を引き継がない」（タスクは日付無し・
  // マイルストーンは基準が無いため作成自体をしない。lib/project/inheritTaskDates.ts参照）
  const dateOffsetDays = useMemo(
    () => (anchorSelection === "none" ? null : computeInheritOffsetDays(originAnchorDate, newAnchorDateForOffset || null)),
    [anchorSelection, originAnchorDate, newAnchorDateForOffset],
  );

  /**
   * チェックされたタスク（＋両端がチェック済みの依存関係）・マイルストーンを新PJに複製する。
   * 親を先に保存してから子を保存（FK制約対応・既存のQuickAddTaskModalと同じ順序）。
   * 個々の保存が失敗しても他は止めない（Promise.allSettled・B3カスケード等と同じ
   * 「最善努力＋失敗はトースト」の割り切り）。親の保存が失敗した子はダングリングした
   * parent_task_id のままだとFK違反で確実に失敗するため、親なしとして保存を試みる。
   * メンバー（member_ids）はこの関数の対象外＝newProject作成時に1回のupsertで書き込み済み
   * （project.member_idsはプロジェクト自身の列のため、追加の保存呼び出しが不要）。
   */
  const inheritFromOrigin = useCallback(async (newProjectId: string) => {
    const state = useAppStore.getState();
    const liveOriginTasks = selectScopedTasks(state).filter(t => !t.is_deleted && t.project_id === originProjectId);
    const liveOriginDeps = selectScopedTaskDependencies(state).filter(d => !d.is_deleted);
    const liveOriginMilestones = active(state.milestones).filter(m => m.project_id === originProjectId);

    const now = new Date().toISOString();

    const milestones = buildInheritedMilestones({
      originMilestones: liveOriginMilestones,
      checkedMilestoneIds,
      newProjectId,
      dateOffsetDays,
      createdBy: currentUser.id,
      now,
      generateId: () => uuidv4(),
    });
    const milestoneResults = await Promise.allSettled(milestones.map(m => state.saveMilestone(m)));
    const failedMilestones = milestoneResults.filter(r => r.status === "rejected").length;

    const { tasks, idMap } = buildInheritedTasks({
      originTasks: liveOriginTasks,
      checkedTaskIds,
      newProjectId,
      dateOffsetDays,
      createdBy: currentUser.id,
      now,
      generateId: () => uuidv4(),
    });

    let failedTasks = 0;
    let failedDeps = 0;
    let depPairsLength = 0;
    if (tasks.length > 0) {
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
      depPairsLength = depPairs.length;
      const depResults = await Promise.allSettled(
        depPairs.map(p => state.addTaskDependency(p.predecessorTaskId, p.successorTaskId, currentUser.id)),
      );
      const succeededDeps = depResults.filter(r => r.status === "fulfilled").length;

      failedTasks = tasks.length - succeededIds.size;
      failedDeps = depPairs.length - succeededDeps;
    }

    if (failedMilestones > 0 || failedTasks > 0 || failedDeps > 0) {
      const parts = ["プロジェクトは作成されましたが、一部の引き継ぎに失敗しました。"];
      if (failedMilestones > 0) parts.push(`マイルストーン${milestones.length - failedMilestones}/${milestones.length}件。`);
      if (failedTasks > 0) parts.push(`タスク${tasks.length - failedTasks}/${tasks.length}件。`);
      if (failedDeps > 0) parts.push(`依存関係${depPairsLength - failedDeps}/${depPairsLength}件。`);
      parts.push("不足分は編集画面から手動で追加してください。");
      showToast(parts.join(""), "error");
    }
  }, [originProjectId, checkedTaskIds, checkedMilestoneIds, dateOffsetDays, currentUser.id]);

  // マイルストーン基準（anchorSelectionが"none"/"project_start"以外）だけがnewAnchorDateの
  // 入力を要求する。"project_start"はresolvedNewStartDateで自動的に確定するため必須としない。
  const anchorNeedsManualDate = anchorSelection !== "none" && anchorSelection !== "project_start";
  const canSave = !!(name.trim() && purpose.trim() && ownerIds.length > 0
    && (mode === "blank" || (!!originProjectId && (!anchorNeedsManualDate || !!newAnchorDate))));

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    if (startDate && endDate && startDate > endDate) {
      setError("開始日は終了日より前に設定してください。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      // resolvedNewStartDateと同じ式（startDate || todayStr()）。日付移動の基準（"project_start"）
      // と新PJ自身のstart_dateを必ず同じ値にするため、ここで作り直さずレンダー中に確定した値を使う。
      const resolvedStartDate = resolvedNewStartDate;
      const newProject: Project = {
        id,
        name: name.trim(),
        purpose: purpose.trim(),
        contribution_memo: "",
        owner_member_id: ownerIds[0],
        owner_member_ids: ownerIds,
        member_ids: mode === "inherit" ? [...checkedMemberIds] : [],
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
        await inheritFromOrigin(id);
      }
      onCreated?.(id);
      onClose();
    } catch (e) {
      setError(formatErrorForUser("プロジェクトの作成に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [canSave, name, purpose, ownerIds, checkedMemberIds, colorTag, startDate, endDate, resolvedNewStartDate, mode, originProjectId, inheritFromOrigin, saveProject, currentUser.id, onCreated, onClose]);

  return (
    // 背景クリックで閉じる（マウス操作の補助）。Escapeキー（handleKeyDown）と
    // ✕ボタンでキーボードからも閉じられるため、背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="animate-overlay"
      style={{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="animate-fadeIn" style={{ ...modalBoxStyle("min(560px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        {/* ヘッダー */}
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>📁</span>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>新規プロジェクト</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--color-text-tertiary)", padding: "2px 6px", lineHeight: 1 }}>✕</button>
        </div>

        {/* フォーム */}
        <div style={{ ...MODAL_BODY_STYLE, padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>

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
                <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "14px" }}>

                  {/* 日付の基準＋マイルストーン */}
                  <div>
                    <Label>マイルストーン（{checkedMilestoneIds.size}/{originMilestones.length}件）・日付の基準</Label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginBottom: "8px" }}>
                      <label style={anchorRadioRowStyle}>
                        <input type="radio" name="dateAnchor" checked={anchorSelection === "project_start"} onChange={() => selectAnchor("project_start")} />
                        元PJの開始日を基準にする（既定。元:{originProject?.start_date ?? "-"} → 新:{resolvedNewStartDate}）
                      </label>
                      <label style={anchorRadioRowStyle}>
                        <input type="radio" name="dateAnchor" checked={anchorSelection === "none"} onChange={() => selectAnchor("none")} />
                        日付を引き継がない
                      </label>
                    </div>

                    {anchorNeedsManualDate && (
                      <div style={{ marginBottom: "8px" }}>
                        <Label>新PJでの基準日 *</Label>
                        <input
                          type="date"
                          value={newAnchorDate}
                          onChange={e => setNewAnchorDate(e.target.value)}
                          style={{ ...inputStyle, maxWidth: "200px" }}
                        />
                      </div>
                    )}

                    {originMilestones.length === 0 ? (
                      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "4px 0" }}>
                        このプロジェクトにはマイルストーンがありません。
                      </div>
                    ) : (
                      <>
                        {anchorSelection === "none" && (
                          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", padding: "2px 0 6px" }}>
                            「日付を引き継がない」を選んでいる間はマイルストーンを引き継げません（マイルストーンには日付が必須のため）。基準を選ぶと引き継げます。
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginBottom: "4px" }}>
                          <button type="button" disabled={anchorSelection === "none"} onClick={() => setCheckedMilestoneIds(new Set(originMilestones.map(m => m.id)))} style={miniBtnStyle}>全選択</button>
                          <button type="button" disabled={anchorSelection === "none"} onClick={() => setCheckedMilestoneIds(new Set())} style={miniBtnStyle}>全解除</button>
                        </div>
                        <div style={checklistBoxStyle}>
                          {originMilestones.map(m => (
                            <MilestoneCheckRow
                              key={m.id}
                              milestone={m}
                              checked={checkedMilestoneIds.has(m.id)}
                              isAnchor={anchorSelection === m.id}
                              disabled={anchorSelection === "none"}
                              onToggle={toggleMilestone}
                              onSelectAnchor={selectAnchor}
                              offsetDays={dateOffsetDays}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* タスク */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <Label>タスク（{checkedTaskIds.size}/{originTasks.length}件選択中）</Label>
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
                      <div style={checklistBoxStyle}>
                        {topLevelOriginTasks.map(t => (
                          <div key={t.id}>
                            <TaskCheckRow task={t} checked={checkedTaskIds.has(t.id)} onToggle={toggleTask} members={members} offsetDays={dateOffsetDays} />
                            {childrenOf(originTasks, t.id).map(c => (
                              <TaskCheckRow key={c.id} task={c} checked={checkedTaskIds.has(c.id)} onToggle={toggleTask} members={members} offsetDays={dateOffsetDays} indent />
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                      ステータスは全て「ToDo」にリセットされます。日付は上で選んだ基準に従って移動します（既定は「元PJの開始日を基準にする」＝v3.56以前と同じ挙動）。
                    </div>
                  </div>

                  {/* メンバー */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <Label>メンバー（{checkedMemberIds.size}/{candidateMembers.length}件）</Label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button type="button" onClick={() => setCheckedMemberIds(new Set(candidateMembers.map(m => m.id)))} style={miniBtnStyle}>全選択</button>
                        <button type="button" onClick={() => setCheckedMemberIds(new Set())} style={miniBtnStyle}>全解除</button>
                      </div>
                    </div>
                    {candidateMembers.length === 0 ? (
                      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
                        候補となるメンバーがいません。
                      </div>
                    ) : (
                      <div style={checklistBoxStyle}>
                        {candidateMembers.map(m => (
                          <label key={m.id} style={memberRowStyle}>
                            <input type="checkbox" checked={checkedMemberIds.has(m.id)} onChange={() => toggleMember(m.id)} style={{ flexShrink: 0, accentColor: "var(--color-brand-primary)" }} />
                            <Avatar member={m} size={18} />
                            <span style={{ flex: 1 }}>{m.short_name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                      選択したメンバーが新PJのメンバーとして登録されます（タスクの担当者は既定でチェック済み）。
                    </div>
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
        <div style={{ ...MODAL_FOOTER_STYLE, padding: "12px 16px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
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

/**
 * タスク1件の日付移動プレビュー文字列を組み立てる（「→ 8/1〜8/10」「→ 日付なし」等）。
 * 元々日付が無いタスクは null（プレビュー行自体を出さない）。
 */
function formatTaskDatePreview(task: Task, offsetDays: number | null): string | null {
  if (!task.start_date && !task.due_date) return null;
  const { start_date, due_date } = computeInheritedTaskDates({
    offsetDays, startDate: task.start_date, dueDate: task.due_date,
  });
  if (!start_date && !due_date) return "→ 日付なし";
  if (start_date && due_date) return `→ ${formatMD(start_date)}〜${formatMD(due_date)}`;
  return `→ ${formatMD((start_date ?? due_date) as string)}`;
}

/** 引き継ぎタスクチェックリストの1行（親・子共通。indent=trueで子の表示に使う） */
function TaskCheckRow({ task, checked, onToggle, members, indent, offsetDays }: {
  task: Task;
  checked: boolean;
  onToggle: (id: string) => void;
  members: Member[];
  indent?: boolean;
  offsetDays: number | null;
}) {
  const assignee = members.find(m => m.id === task.assignee_member_id);
  const showStatusBadge = task.status !== "todo" && task.status !== "in_progress";
  const datePreview = formatTaskDatePreview(task, offsetDays);
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
      {datePreview && <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, whiteSpace: "nowrap" }}>{datePreview}</span>}
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

/**
 * マイルストーンチェックリストの1行。チェックボックス（引き継ぐか）＋「基準」ラジオ
 * （このマイルストーンを日付の基準にするか。1つだけ選べる＝name="dateAnchor"で他の
 * 基準ラジオと同じグループにする）を持つ。
 */
function MilestoneCheckRow({ milestone, checked, isAnchor, disabled, onToggle, onSelectAnchor, offsetDays }: {
  milestone: Milestone;
  checked: boolean;
  isAnchor: boolean;
  /** true＝「日付を引き継がない」を選んでいる間。引き継ぐか否かのチェックボックスは無効化する
   *  （NOT NULL列のため日付が決まらないマイルストーンは作れない）。「基準」ラジオは無効化しない
   *  （これを押すこと自体が"none"から脱出する唯一の手段のため） */
  disabled: boolean;
  onToggle: (id: string) => void;
  onSelectAnchor: (id: string) => void;
  offsetDays: number | null;
}) {
  const newDate = offsetDays === null ? null : computeInheritedMilestoneDate({ offsetDays, date: milestone.date });
  const showPreview = newDate !== null && newDate !== milestone.date;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: "7px", padding: "4px 0",
        fontSize: "12px", color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-primary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={() => onToggle(milestone.id)}
        style={{ flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0, fontSize: "10px", color: "var(--color-text-tertiary)", cursor: "pointer" }}>
        <input type="radio" name="dateAnchor" checked={isAnchor} onChange={() => onSelectAnchor(milestone.id)} />
        基準
      </label>
      <span style={{ flex: 1 }}>◆ {milestone.name}</span>
      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, whiteSpace: "nowrap" }}>
        {formatMD(milestone.date)}{showPreview && ` → ${formatMD(newDate as string)}`}
      </span>
    </div>
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

/** 引き継ぎブロック（タスク／マイルストーン／メンバー）共通のチェックリスト箱 */
const checklistBoxStyle: React.CSSProperties = {
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  maxHeight: "180px", overflowY: "auto", padding: "2px 10px",
  background: "var(--color-bg-secondary)",
};

const anchorRadioRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "6px", fontSize: "12px",
  color: "var(--color-text-primary)", cursor: "pointer",
};

const memberRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "7px", padding: "4px 0",
  cursor: "pointer", fontSize: "12px", color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border-primary)",
};
