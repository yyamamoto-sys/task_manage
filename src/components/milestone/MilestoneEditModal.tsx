// src/components/milestone/MilestoneEditModal.tsx
//
// 【設計意図】
// 既存マイルストーンの編集モーダル。作成後に「名前・日付・メモ詳細」を追記・修正できる。
// 通常のタスク（TaskEditModal）と同様に、節目にも後から補足を残せるようにするため。
// 保存は appStore.saveMilestone（楽観ロック付き upsert）、削除は deleteMilestone を使う
// ＝ 追加フォーム（MilestoneAddForm）と同一経路。description 列は
// migrations/20260603_add_milestone_description.sql で追加。

import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project, Milestone } from "../../lib/localData/types";
import { showToast } from "../common/Toast";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  milestone: Milestone;
  currentUser: Member;
  /** 所属PJの表示用（任意） */
  project?: Project | null;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 10px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", fontSize: "13px",
  color: "var(--color-text-primary)", background: "var(--color-bg-primary)",
  outline: "none",
};

export function MilestoneEditModal({ milestone, currentUser, project, onClose }: Props) {
  const saveMilestone   = useAppStore(s => s.saveMilestone);
  const deleteMilestone = useAppStore(s => s.deleteMilestone);

  const [name, setName]               = useState(milestone.name);
  const [date, setDate]               = useState(milestone.date);
  const [description, setDescription] = useState(milestone.description ?? "");
  const [saving, setSaving]           = useState(false);

  const canSave = name.trim() !== "" && date !== "";

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await saveMilestone({
        ...milestone,
        name: name.trim(),
        date,
        description: description.trim() || undefined,
        updated_by: currentUser.id,
      });
      showToast(`マイルストーン「${name.trim()}」を更新しました`);
      onClose();
    } catch (e) {
      showToast(formatErrorForUser("マイルストーンの更新に失敗しました", e), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (saving) return;
    if (!(await confirmDialog(`マイルストーン「${milestone.name}」を削除しますか？`))) return;
    setSaving(true);
    try {
      await deleteMilestone(milestone.id, currentUser.id);
      showToast(`マイルストーン「${milestone.name}」を削除しました`);
      onClose();
    } catch (e) {
      showToast(formatErrorForUser("マイルストーンの削除に失敗しました", e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
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
        {/* ヘッダー（ガントの◆と同系のアンバー） */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          background: "linear-gradient(135deg,#f59e0b,#d97706)",
        }}>
          <span style={{ width: 14, height: 14, background: "#fff", transform: "rotate(45deg)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>マイルストーンを編集</div>
            {project && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", marginTop: "2px" }}>
                {project.name}
              </div>
            )}
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
        <div style={{ padding: "16px 18px", overflow: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>マイルストーン名 *</div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={60}
              placeholder="例：β版リリース"
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>日付 *</div>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ ...inputStyle, width: "160px" }}
            />
          </div>

          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>メモ・詳細（任意）</div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="この節目に関する補足・条件・関係者など"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
            />
          </div>
        </div>

        {/* フッター */}
        <div style={{
          padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <button
            onClick={handleDelete}
            disabled={saving}
            style={{
              fontSize: "12px", padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--btn-danger-border)",
              borderRadius: "var(--radius-md)",
              color: "var(--btn-danger-text)",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            🗑 削除
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              fontSize: "12px", padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-text-secondary)", cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              fontSize: "12px", padding: "6px 16px",
              background: canSave && !saving ? "var(--color-brand)" : "var(--color-bg-tertiary)",
              border: "none", borderRadius: "var(--radius-md)",
              color: canSave && !saving ? "#fff" : "var(--color-text-tertiary)",
              cursor: canSave && !saving ? "pointer" : "not-allowed",
              fontWeight: "500",
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
