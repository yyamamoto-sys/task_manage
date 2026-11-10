// src/components/consultation/GanttPreviewPanel.tsx
//
// 【設計意図】
// ガントチャートを「現在」と「AI提案適用後（仮）」に分割表示するパネル。
// 画面下からスライドインするオーバーレイ。
// - 最上部：凡例・変更件数・「変更のある行だけ表示」（v3.209）
// - 上半分：通常のGanttView（DBデータそのまま）
// - 下半分：プレビュー用GanttView（proposalを適用した仮のタスクデータ）
// DBは変更しない（React stateの一時的な上書きのみ）。
// v3.209：変更のあった行を種類別の色・記号で目立たせる（lib/ai/ganttPreviewDiff.ts）。上部に凡例・件数・
// 「変更のある行だけ表示」の切替を置く。変更前の位置は下のガントのバーに点線で重ねる。

import { useMemo, useState, useEffect } from "react";
import type { UIProposal } from "../../lib/ai/proposalMapper";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedMembers } from "../../stores/appStore";
import { active } from "../../lib/localData/localStore";
import { GanttView } from "../gantt/GanttView";
import type { Member, Project } from "../../lib/localData/types";
import {
  applyProposalToPreview, diffTasksForPreview, summarizeChanges, onlyChangedTasks, CHANGE_STYLES, type ChangeKind,
} from "../../lib/ai/ganttPreviewDiff";

interface Props {
  proposal: UIProposal;
  shortIdMap: Map<string, string>;
  currentUser: Member;
  selectedProject: Project | null;
  onClose: () => void;
}

export function GanttPreviewPanel({
  proposal,
  shortIdMap,
  currentUser,
  selectedProject,
  onClose,
}: Props) {
  const tasks    = useAppStore(selectScopedTasks);
  const projects = useAppStore(selectScopedProjects);
  const members  = useAppStore(selectScopedMembers);
  const [onlyChanged, setOnlyChanged] = useState(false);

  // アニメーション用state
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // マウント後に少し遅らせてvisibleにすることでCSSトランジションを発火させる
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setVisible(false);
    // トランジション完了後にonCloseを呼ぶ
    setTimeout(onClose, 300);
  };

  // ===== プレビュー用タスクの計算 =====

  const { previewTasks, changes, summary } = useMemo(() => {
    // proposalのtarget_task_idsをshortIdMap経由でUUIDに変換
    const targetUuids = proposal.target_task_ids
      .map(shortId => shortIdMap.get(shortId))
      .filter((uuid): uuid is string => !!uuid);
    const findMemberId = (shortName: string) =>
      members.find(m => !m.is_deleted && (m.short_name === shortName || m.display_name === shortName))?.id;
    const after = applyProposalToPreview(tasks, proposal, targetUuids, findMemberId);
    const diff = diffTasksForPreview(tasks, after);
    return { previewTasks: after, changes: diff, summary: summarizeChanges(diff) };
  }, [tasks, proposal, shortIdMap, members]);

  // 「変更のある行だけ表示」は下（変更後）のガントだけに効かせる。上（現在）は常に全体を見せる
  const shownPreviewTasks = useMemo(
    () => (onlyChanged && changes.size > 0 ? onlyChangedTasks(previewTasks, changes) : previewTasks),
    [onlyChanged, previewTasks, changes],
  );
  const changedTaskIds = useMemo(() => new Set(changes.keys()), [changes]);

  const visibleProjects = selectedProject ? [selectedProject] : active(projects);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        display: "flex",
        flexDirection: "column",
        transform: visible ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.3s ease",
        pointerEvents: "auto",
      }}
    >
      {/* 変更の見方：凡例（記号つき）・変更件数・変更のある行だけ表示 */}
      <div
        data-testid="gantt-preview-legend"
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 12px",
          padding: "6px 12px", background: "var(--color-bg-secondary)",
          borderBottom: "1px solid var(--color-border-secondary)",
          fontSize: "11px", color: "var(--color-text-secondary)",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
          {summary.total > 0 ? `変更 ${summary.total}件` : "変更される行はありません"}
        </span>
        {(Object.keys(CHANGE_STYLES) as ChangeKind[]).map(kind => {
          const st = CHANGE_STYLES[kind];
          const n = summary[kind];
          return (
            <span
              key={kind}
              style={{
                display: "inline-flex", alignItems: "center", gap: "4px", padding: "1px 8px",
                borderRadius: "var(--radius-full)", border: `1px solid ${st.color}`,
                color: st.color, background: st.bg, fontWeight: 600, opacity: n > 0 ? 1 : 0.45,
              }}
            >
              <span aria-hidden="true">{st.symbol}</span>
              {st.label}
              <span>{n}</span>
            </span>
          );
        })}
        <span style={{ color: "var(--color-text-tertiary)" }}>
          点線の枠＝変更前の位置 ／ 変更のない行は薄く表示
        </span>
        <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px", cursor: summary.total > 0 ? "pointer" : "default" }}>
          <input
            type="checkbox"
            checked={onlyChanged}
            disabled={summary.total === 0}
            onChange={e => setOnlyChanged(e.target.checked)}
          />
          変更のある行だけ表示（下の画面）
        </label>
      </div>

      {/* 上半分：現在のガント */}
      <div
        style={{
          flex: 1, minHeight: 0,
          display: "flex",
          flexDirection: "column",
          borderBottom: "2px solid var(--color-border-secondary)",
          background: "var(--color-bg-primary)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* 「現在」ラベル */}
        <div
          style={{
            position: "absolute",
            top: "8px",
            left: "8px",
            zIndex: 20,
            fontSize: "10px",
            padding: "2px 8px",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-secondary)",
            borderRadius: "var(--radius-full)",
            color: "var(--color-text-secondary)",
            fontWeight: "500",
            pointerEvents: "none",
          }}
        >
          現在
        </div>
        <GanttView
          currentUser={currentUser}
          selectedProject={selectedProject}
          projects={visibleProjects}
          enableKeyboardShortcuts={false}
        />
      </div>

      {/* 下半分：プレビューガント */}
      <div
        style={{
          flex: 1, minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg-primary)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <GanttView
          currentUser={currentUser}
          selectedProject={selectedProject}
          projects={visibleProjects}
          previewTasks={shownPreviewTasks}
          isPreview={true}
          previewChangedTaskIds={changedTaskIds}
          previewChanges={changes}
          enableKeyboardShortcuts={false}
        />

        {/* 閉じるボタン */}
        <button
          onClick={handleClose}
          style={{
            position: "absolute",
            bottom: "16px",
            right: "16px",
            zIndex: 20,
            fontSize: "12px",
            padding: "8px 18px",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-secondary)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            boxShadow: "var(--shadow-md)",
            fontWeight: "500",
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
