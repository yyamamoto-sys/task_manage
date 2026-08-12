// src/components/task/DuplicateTasksModal.tsx
//
// 【設計意図】
// 「選択したタスクを複製」（山本さん確定仕様・2026-08-12・v3.72）。
// ListView / KanbanView の一括操作（useBulkTaskActions）から選択中のタスク集合を受け取り、
// 基準日の移動・名前の一括置換（任意）を設定してプレビューしてから複製する。
//
// 【前例の採用】investigatorの調査（7製品の公式ドキュメント）を踏まえ、「明示選択」方式
// （Primavera P6のCopy Activity Optionsに近い）を採用した。「期間で切り取る」方式は
// どの製品にも存在しなかったため採用しない。日付移動はv3.57の「他PJから引き継ぐ」
// （ProjectCreateModal・inheritTaskDates.ts）と同じ「基準を1つ決めて暦日の間隔を保つ」方式
// をそのまま踏襲する（Wrike Blueprint/ClickUp Remap Datesと同じ考え方）。
//
// 【計算ロジックの再利用】日付移動はinheritTaskDates.tsの純粋関数（新規実装なし）。
// タスクの複製本体・TF/PJ紐づけの複製はduplicateSelectedTasks.ts（新規。project_idを
// 固定せず複製元のまま保つ点がtaskInheritance.tsのbuildInheritedTasksと異なるため専用に
// 用意した）。依存関係の複製はtaskInheritance.tsのbuildInheritedDependenciesを無改修で
// 再利用する（project_idを一切参照しない汎用実装のため、そのまま使えた）。
//
// 【保存の順序とB3対策】ProjectCreateModalの「他PJから引き継ぐ」と同じ順序：
// 親タスクを先にsaveTask({skipCascade:true})で保存→成功したIDだけを使って子を保存
// （親の保存が失敗した子は親なしに落として保存を試みる。FK制約対応）→依存関係は
// 両端が保存に成功したタスクだけをaddTaskDependencyで追加→最後にTF/PJ紐づけを追加。
// skipCascade:trueを付けるのは、複製直後の時点ではどの新タスクも依存関係を持たない
// （このあとの手順で追加する）ためB3自動リスケ連鎖は本来空振りするはずだが、複数タスクを
// 一括作成する操作である以上、将来の変更で依存関係を先に貼る順序に変わった場合の事故を
// 防ぐため、既存の一括作成系（ProjectCreateModal・runBulkShift）と同じ防御的な付与にした。
// トランザクションではないため、個々の保存が失敗しても他は止めない（Promise.allSettled）。
//
// 【マイルストーンは複製対象にしない】選択の起点がuseBulkTaskActionsのタスク選択のみで、
// マイルストーンを選択する既存UIが無い（複製対象に含めるには新しい選択UIが必要になり、
// 主要ユースケース＝タスクの複製から外れる）。一方、基準（アンカー）の選択肢には
// PJのマイルストーンも含める（選択したタスクが単一PJに閉じている場合のみ。複数PJを
// またぐ選択では「PJの」という前提が崩れるため対象外にする）。

import { useMemo, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { formatMD } from "../../lib/date";
import { computeInheritOffsetDays } from "../../lib/project/inheritTaskDates";
import { buildDuplicatedTasks, buildDuplicatedTaskForceLinks, buildDuplicatedTaskProjectLinks } from "../../lib/project/duplicateSelectedTasks";
import { buildInheritedDependencies } from "../../lib/project/taskInheritance";
import { showToast } from "../common/Toast";
import { alertDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  /** 複製対象として選択されたタスク（呼び出し側でselectedIdsから解決済み） */
  selectedTasks: Task[];
  /** 親子関係・アンカー候補の判定に使う全タスク（選択範囲外の親子も含む） */
  allTasks: Task[];
  currentUser: Member;
  onClose: () => void;
  /** 複製成功時（1件以上成功した場合）に呼ぶ。選択解除等の後処理用 */
  onDuplicated: () => void;
}

interface AnchorCandidate {
  key: string;
  label: string;
  originDate: string;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "5px" }}>{children}</div>;
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

const sectionBoxStyle: React.CSSProperties = {
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  padding: "12px",
  background: "var(--color-bg-primary)",
};

const noteBoxStyle: React.CSSProperties = {
  fontSize: "11px", lineHeight: 1.6, color: "var(--color-text-secondary)",
  background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)",
  padding: "8px 10px",
};

export function DuplicateTasksModal({ selectedTasks, allTasks, currentUser, onClose, onDuplicated }: Props) {
  const milestones = useAppStore(s => s.milestones);
  const [nameFind, setNameFind] = useState("");
  const [nameReplace, setNameReplace] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedIdSet = useMemo(() => new Set(selectedTasks.map(t => t.id)), [selectedTasks]);

  // 選択範囲をまたぐ親子関係の明示（利用者が驚かないための注記。判断はコード先頭コメント参照）
  const excludedParentCount = useMemo(
    () => selectedTasks.filter(t => t.parent_task_id && !selectedIdSet.has(t.parent_task_id)).length,
    [selectedTasks, selectedIdSet],
  );
  const excludedChildrenCount = useMemo(
    () => selectedTasks.filter(t =>
      allTasks.some(c => c.parent_task_id === t.id && !c.is_deleted && !selectedIdSet.has(c.id)),
    ).length,
    [selectedTasks, allTasks, selectedIdSet],
  );

  // 単一PJに閉じている場合のみ、そのPJのマイルストーンを基準の選択肢に含める
  const commonProjectId = useMemo(() => {
    const ids = new Set(selectedTasks.map(t => t.project_id).filter((id): id is string => !!id));
    return ids.size === 1 ? [...ids][0] : null;
  }, [selectedTasks]);

  const anchorCandidates: AnchorCandidate[] = useMemo(() => {
    const list: AnchorCandidate[] = [];
    for (const t of selectedTasks) {
      if (t.start_date) list.push({ key: `task:${t.id}:start`, label: `${t.name}（開始日）`, originDate: t.start_date });
      if (t.due_date) list.push({ key: `task:${t.id}:due`, label: `${t.name}（期日）`, originDate: t.due_date });
    }
    if (commonProjectId) {
      for (const m of milestones) {
        if (m.project_id === commonProjectId && !m.is_deleted) {
          list.push({ key: `milestone:${m.id}`, label: `🚩 ${m.name}`, originDate: m.date });
        }
      }
    }
    return list;
  }, [selectedTasks, milestones, commonProjectId]);

  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const effectiveAnchorKey = anchorKey ?? anchorCandidates[0]?.key ?? null;
  const anchorCandidate = anchorCandidates.find(c => c.key === effectiveAnchorKey) ?? null;

  // 新しい基準日の既定値は「元の日付のまま（offset=0）」＝何もしなければ日付は変わらない
  const [newAnchorDate, setNewAnchorDate] = useState<string | null>(null);
  const effectiveNewAnchorDate = newAnchorDate ?? anchorCandidate?.originDate ?? "";

  const dateOffsetDays = useMemo(
    () => computeInheritOffsetDays(anchorCandidate?.originDate ?? null, effectiveNewAnchorDate || null),
    [anchorCandidate, effectiveNewAnchorDate],
  );

  // プレビュー（そのまま保存にも使う。再計算するとID・作成時刻がズレるため useMemo で固定する）
  const preview = useMemo(() => {
    const now = new Date().toISOString();
    const generateId = () => uuidv4();
    const { tasks, idMap } = buildDuplicatedTasks({
      selectedTasks, dateOffsetDays, nameFind, nameReplace,
      createdBy: currentUser.id, now, generateId,
    });
    return { tasks, idMap, now };
  }, [selectedTasks, dateOffsetDays, nameFind, nameReplace, currentUser.id]);

  const anchorOptions: SelectOption[] = anchorCandidates.map(c => ({ value: c.key, label: c.label }));

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const state = useAppStore.getState();
      const { tasks, idMap } = preview;

      const topLevel = tasks.filter(t => !t.parent_task_id);
      const children = tasks.filter(t => t.parent_task_id);

      const topResults = await Promise.allSettled(topLevel.map(t => state.saveTask(t, { skipCascade: true })));
      const succeededIds = new Set<string>();
      topLevel.forEach((t, i) => { if (topResults[i].status === "fulfilled") succeededIds.add(t.id); });

      // 親の保存が失敗した子は親なしに落として保存を試みる（FK制約対応。ProjectCreateModalと同じ方式）
      const childrenToSave = children.map(c =>
        c.parent_task_id && !succeededIds.has(c.parent_task_id) ? { ...c, parent_task_id: null } : c,
      );
      const childResults = await Promise.allSettled(childrenToSave.map(t => state.saveTask(t, { skipCascade: true })));
      childrenToSave.forEach((t, i) => { if (childResults[i].status === "fulfilled") succeededIds.add(t.id); });

      const successfulIdMap = new Map([...idMap].filter(([, newId]) => succeededIds.has(newId)));

      const depPairs = buildInheritedDependencies(state.taskDependencies, successfulIdMap);
      const depResults = await Promise.allSettled(
        depPairs.map(p => state.addTaskDependency(p.predecessorTaskId, p.successorTaskId, currentUser.id)),
      );
      const succeededDeps = depResults.filter(r => r.status === "fulfilled").length;

      const tfLinks = buildDuplicatedTaskForceLinks(state.taskTaskForces, successfulIdMap);
      const pjLinks = buildDuplicatedTaskProjectLinks(state.taskProjects, successfulIdMap);
      await Promise.allSettled(tfLinks.map(l => state.addTaskTaskForce(l)));
      await Promise.allSettled(pjLinks.map(l => state.addTaskProject(l)));

      const failedTasks = tasks.length - succeededIds.size;
      const failedDeps = depPairs.length - succeededDeps;

      if (succeededIds.size === 0) {
        await alertDialog("複製に失敗しました。時間をおいて再度お試しください。");
        setSubmitting(false);
        return;
      }

      if (failedTasks > 0 || failedDeps > 0) {
        const parts = [`${succeededIds.size}/${tasks.length}件のタスクを複製しました。`];
        if (failedTasks > 0) parts.push(`${failedTasks}件は複製できませんでした。`);
        if (failedDeps > 0) parts.push(`依存関係${depPairs.length - failedDeps}/${depPairs.length}件。`);
        showToast(parts.join(""), "error");
      } else {
        showToast(`${succeededIds.size}件のタスクを複製しました`, "success");
      }
      onDuplicated();
      onClose();
    } catch (e) {
      await alertDialog(formatErrorForUser("複製に失敗しました", e));
    } finally {
      setSubmitting(false);
    }
  }, [preview, currentUser.id, onDuplicated, onClose]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="animate-fadeIn"
        style={{ ...modalBoxStyle("min(560px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}
      >
        {/* ヘッダー */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "13px" }}>選択したタスクを複製</div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "16px", color: "var(--color-text-tertiary)", lineHeight: 1 }}
            aria-label="閉じる"
          >×</button>
        </div>

        {/* 本文 */}
        <div style={{ ...MODAL_BODY_STYLE, padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* ① 複製対象の確認 */}
          <div>
            <Label>複製対象（{selectedTasks.length}件）</Label>
            <div style={{ ...sectionBoxStyle, maxHeight: "140px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
              {selectedTasks.map(t => (
                <div key={t.id} style={{ fontSize: "12px", color: "var(--color-text-primary)", padding: "2px 0" }}>
                  {t.name}
                </div>
              ))}
            </div>
            {(excludedParentCount > 0 || excludedChildrenCount > 0) && (
              <div style={{ marginTop: "8px", ...noteBoxStyle }}>
                {excludedParentCount > 0 && (
                  <div>・親タスクが選択されていないタスクが{excludedParentCount}件あります。複製後は親を持たない独立したタスクになります。</div>
                )}
                {excludedChildrenCount > 0 && (
                  <div>・子タスクを持つが子タスク自体は選択されていないタスクが{excludedChildrenCount}件あります。その子タスクは複製されません。</div>
                )}
              </div>
            )}
          </div>

          {/* ② 日付の基準 */}
          <div>
            <Label>日付の基準</Label>
            {anchorCandidates.length === 0 ? (
              <div style={noteBoxStyle}>
                基準にできる日付がありません（選択したタスクに開始日・期日が無く、マイルストーンも使えません）。複製後のタスクには日付が設定されません。
              </div>
            ) : (
              <div style={{ ...sectionBoxStyle, display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  基準に選んだタスク（またはマイルストーン）を複製先でいつに置くかを指定します。他のタスクは基準との日数の間隔を保ったまま移動します。
                </div>
                <div>
                  <Label>基準にするタスク・マイルストーン</Label>
                  <CustomSelect
                    value={effectiveAnchorKey ?? ""}
                    onChange={value => { setAnchorKey(value); setNewAnchorDate(null); }}
                    options={anchorOptions}
                    searchable
                    searchPlaceholder="タスク名で検索..."
                  />
                </div>
                <div>
                  <Label>複製先ではいつに置きますか</Label>
                  <input
                    type="date"
                    value={effectiveNewAnchorDate}
                    onChange={e => setNewAnchorDate(e.target.value)}
                    style={{ ...inputStyle, maxWidth: "200px" }}
                  />
                  {anchorCandidate && (
                    <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                      元：{formatMD(anchorCandidate.originDate)} → 複製先：{effectiveNewAnchorDate ? formatMD(effectiveNewAnchorDate) : "未入力"}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ③ 名前の一括置換（任意） */}
          <div>
            <Label>名前の一括置換（任意）</Label>
            <div style={{ ...sectionBoxStyle, display: "flex", gap: "10px", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <Label>置換前</Label>
                <input type="text" value={nameFind} onChange={e => setNameFind(e.target.value)} placeholder="例：第1回" style={inputStyle} />
              </div>
              <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", paddingBottom: "8px" }}>→</div>
              <div style={{ flex: 1 }}>
                <Label>置換後</Label>
                <input type="text" value={nameReplace} onChange={e => setNameReplace(e.target.value)} placeholder="例：第2回" style={inputStyle} />
              </div>
            </div>
          </div>

          {/* ④ プレビュー */}
          <div>
            <Label>プレビュー（{preview.tasks.length}件）</Label>
            <div style={{ ...sectionBoxStyle, maxHeight: "220px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
              {preview.tasks.map(t => {
                const dateLabel = t.start_date && t.due_date
                  ? `${formatMD(t.start_date)}〜${formatMD(t.due_date)}`
                  : (t.start_date ?? t.due_date)
                    ? formatMD((t.start_date ?? t.due_date) as string)
                    : "日付なし";
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "5px" }}>
                    <span style={{ flex: 1, color: "var(--color-text-primary)" }}>{t.name}</span>
                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{dateLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* フッター */}
        <div style={{ ...MODAL_FOOTER_STYLE, padding: "12px 20px", borderTop: "1px solid var(--color-border-primary)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ fontSize: "12px", padding: "6px 14px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}
          >キャンセル</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || preview.tasks.length === 0}
            style={{
              fontSize: "12px", padding: "6px 14px",
              background: submitting || preview.tasks.length === 0 ? "var(--color-bg-tertiary)" : "var(--color-brand)",
              border: "none", borderRadius: "var(--radius-md)",
              color: submitting || preview.tasks.length === 0 ? "var(--color-text-tertiary)" : "#fff",
              cursor: submitting || preview.tasks.length === 0 ? "not-allowed" : "pointer",
            }}
          >{submitting ? "複製中..." : "複製する"}</button>
        </div>
      </div>
    </div>
  );
}
