// src/components/project/ProjectCreateModal.tsx
//
// 【設計意図】
// サイドバーの「＋」ボタンから素早くプロジェクトを作成するための簡易モーダル。
// 必須フィールド（名前・目的・オーナー）のみで即座に作成でき、
// 細かい設定（TF連携・メンバー・contribution_memo等）は作成後に管理画面で補完する。

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../../stores/appStore";
import { active } from "../../lib/localData/localStore";
import type { Member, Project } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { formatErrorForUser } from "../../lib/errorMessage";

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

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  const handleSave = useCallback(async () => {
    if (!name.trim() || !purpose.trim() || ownerIds.length === 0) return;
    if (startDate && endDate && startDate > endDate) {
      setError("開始日は終了日より前に設定してください。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = uuidv4();
      const now = new Date().toISOString();
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
        start_date: startDate || new Date().toISOString().split("T")[0],
        end_date: endDate || `${new Date().getFullYear()}-12-31`,
        is_deleted: false,
        created_at: now,
        updated_at: now,
        updated_by: currentUser.id,
      };
      await saveProject(newProject);
      onCreated?.(id);
      onClose();
    } catch (e) {
      setError(formatErrorForUser("プロジェクトの作成に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [name, purpose, ownerIds, colorTag, startDate, endDate, saveProject, currentUser.id, onCreated, onClose]);

  const canSave = name.trim() && purpose.trim() && ownerIds.length > 0;

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
