// src/components/milestone/MilestoneAddModal.tsx
//
// 【設計意図】
// FAB（右下＋）から開くグローバルなマイルストーン追加モーダル。
// 「タスクを追加」(QuickAddTaskModal) と同じ演出（オーバーレイ＋スライドアップ）で表示する。
// 追加先プロジェクトを選んでから、既存の共有部品 MilestoneAddForm で名前・日付・説明を設定する。
// 追加処理は appStore.saveMilestone をそのまま使う（管理画面・PJカルテと同一経路）。

import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project, Milestone } from "../../lib/localData/types";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { MilestoneAddForm } from "./MilestoneAddForm";
import { showToast } from "../common/Toast";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  currentUser: Member;
  projects: Project[];
  /** 既定の追加先（サイドバーでPJ選択中ならそのPJ） */
  defaultProjectId?: string;
  onClose: () => void;
}

export function MilestoneAddModal({ currentUser, projects, defaultProjectId, onClose }: Props) {
  const saveMilestone = useAppStore(s => s.saveMilestone);
  const [pjId, setPjId] = useState(defaultProjectId || projects[0]?.id || "");

  // プロジェクト選択肢：PJカラーのドット付き（どのPJに追加するか視覚的に分かるように）
  const projectOptions: SelectOption[] = [
    { value: "", label: "プロジェクトを選択..." },
    ...projects.map(p => ({ value: p.id, label: p.name, color: p.color_tag })),
  ];
  const selectedPj = projects.find(p => p.id === pjId);

  const handleAdd = async (ms: Milestone) => {
    try {
      await saveMilestone(ms);
      showToast(`マイルストーン「${ms.name}」を追加しました`);
      onClose();
    } catch (e) {
      showToast(formatErrorForUser("マイルストーンの追加に失敗しました", e), "error");
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="panel-slide-up" style={{
        width: "min(460px, 100%)", maxHeight: "90vh",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* ヘッダー（マイルストーン色＝ガントの◆と同系） */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          background: "linear-gradient(135deg,#f59e0b,#d97706)",
        }}>
          <span style={{ width: 14, height: 14, background: "#fff", transform: "rotate(45deg)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>マイルストーンを追加</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", marginTop: "2px" }}>
              プロジェクトの節目（期日マーカー）を設定します
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            style={{
              background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "6px",
              fontSize: "16px", cursor: "pointer", color: "#fff",
              width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>
        </div>

        {/* 本体 */}
        <div style={{ padding: "16px 18px", overflow: "auto" }}>
          <div style={{
            fontSize: "10px", fontWeight: 500, color: "var(--color-text-tertiary)",
            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px",
          }}>プロジェクト *</div>
          <div style={{ marginBottom: "14px" }}>
            <CustomSelect
              value={pjId}
              onChange={setPjId}
              options={projectOptions}
              searchable searchPlaceholder="プロジェクトで検索..."
            />
          </div>

          {pjId && selectedPj ? (
            <>
              <div style={{
                fontSize: "10px", fontWeight: 500, color: "var(--color-text-tertiary)",
                textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px",
              }}>マイルストーン</div>
              {/* key={pjId} でPJ切替時にフォーム入力をリセット */}
              <MilestoneAddForm key={pjId} pjId={pjId} currentUserId={currentUser.id} onAdd={handleAdd} />
            </>
          ) : (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 0" }}>
              先に追加先のプロジェクトを選択してください。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
