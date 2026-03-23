// src/components/consultation/GanttPreviewPanel.tsx
//
// 【設計意図】
// ガントチャートを「現在」と「AI提案適用後（仮）」に分割表示するパネル。
// 画面下からスライドインするオーバーレイ。
// - 上半分（50vh）：通常のGanttView（DBデータそのまま）
// - 下半分（50vh）：プレビュー用GanttView（proposalを適用した仮のタスクデータ）
// DBは変更しない（React stateの一時的な上書きのみ）。

import { useMemo, useState, useEffect } from "react";
import type { UIProposal } from "../../lib/ai/proposalMapper";
import { useAppData } from "../../context/AppDataContext";
import { GanttView } from "../gantt/GanttView";
import type { Member, Project, Task } from "../../lib/localData/types";

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
  const { tasks, projects } = useAppData();

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

  const { previewTasks, changedTaskIds } = useMemo(() => {
    const changed = new Set<string>();

    // proposalのtarget_task_idsをshortIdMap経由でUUIDに変換
    const targetUuids = proposal.target_task_ids
      .map(shortId => shortIdMap.get(shortId))
      .filter((uuid): uuid is string => !!uuid);

    const modified = tasks.map((task): Task => {
      if (!targetUuids.includes(task.id)) return task;

      let updated = { ...task };

      if (proposal.action_type === "date_change" && proposal.suggested_date) {
        updated = { ...updated, due_date: proposal.suggested_date };
        changed.add(task.id);
      } else if (proposal.action_type === "assignee" && proposal.suggested_assignee) {
        // suggested_assigneeはshort_name。membersから逆引きしてUUIDを取得
        // 注意：ここではハイライトのみ行う（担当者名の解決はGanttView内で行われる）
        changed.add(task.id);
      } else {
        // その他のaction_typeはハイライトのみ（due_date変更なし）
        changed.add(task.id);
      }

      return updated;
    });

    return { previewTasks: modified, changedTaskIds: changed };
  }, [tasks, proposal, shortIdMap]);

  const visibleProjects = selectedProject ? [selectedProject] : projects.filter(p => !p.is_deleted);

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
      }}
    >
      {/* 上半分：現在のガント */}
      <div
        style={{
          height: "50vh",
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
        />
      </div>

      {/* 下半分：プレビューガント */}
      <div
        style={{
          height: "50vh",
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
          previewTasks={previewTasks}
          isPreview={true}
          previewChangedTaskIds={changedTaskIds}
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
