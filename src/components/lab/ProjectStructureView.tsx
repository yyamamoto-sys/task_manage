// src/components/lab/ProjectStructureView.tsx
//
// 【設計意図】
// ラボ機能：PJの体制図を組織図として表示・編集する。
// オーナーが頂点、メンバーが下部に並ぶ階層図。
// 役割テキストはクリックでインライン編集→Enter/Blurで saveProject 即時保存。

import { useMemo, useState, useRef, useEffect } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  onClose: () => void;
  currentUser: Member;
}

// オーナーカードとメンバーカードの共通スタイル
const CARD_BASE: React.CSSProperties = {
  background: "var(--color-bg-secondary)",
  border: "1.5px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  padding: "10px 14px",
  minWidth: "120px",
  maxWidth: "160px",
  textAlign: "center",
  boxSizing: "border-box",
};

interface RoleInputProps {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}

function RoleInput({ value, placeholder, onSave }: RoleInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        style={{
          fontSize: "11px",
          width: "100%",
          padding: "2px 6px",
          border: "1px solid var(--color-brand)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          boxSizing: "border-box",
          textAlign: "center",
        }}
      />
    );
  }

  return (
    <div
      onClick={() => { setDraft(value); setEditing(true); }}
      title="クリックして役割を編集"
      style={{
        fontSize: "11px",
        color: value ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
        cursor: "text",
        padding: "2px 4px",
        borderRadius: "var(--radius-sm)",
        minHeight: "18px",
        border: "1px dashed transparent",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-primary)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}
    >
      {value || placeholder}
    </div>
  );
}

export function ProjectStructureView({ onClose, currentUser }: Props) {
  const allProjects = useAppStore(s => s.projects);
  const members = useAppStore(s => s.members);
  const saveProject = useAppStore(s => s.saveProject);

  const activeProjects = useMemo(
    () => allProjects.filter(p => !p.is_deleted && p.status !== "archived"),
    [allProjects]
  );

  const [selectedPjId, setSelectedPjId] = useState<string>(() =>
    activeProjects[0]?.id ?? ""
  );

  const [saveError, setSaveError] = useState<string | null>(null);

  const project = useMemo(
    () => activeProjects.find(p => p.id === selectedPjId) ?? null,
    [activeProjects, selectedPjId]
  );

  const memberMap = useMemo(
    () => new Map(members.filter(m => !m.is_deleted).map(m => [m.id, m])),
    [members]
  );

  // オーナーID群（複数対応・単数フォールバック）
  const ownerIds = useMemo<string[]>(() => {
    if (!project) return [];
    if (project.owner_member_ids && project.owner_member_ids.length > 0) {
      return project.owner_member_ids;
    }
    if (project.owner_member_id) return [project.owner_member_id];
    return [];
  }, [project]);

  // メンバー（オーナー除外）
  const memberIds = useMemo<string[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    return (project.member_ids ?? []).filter(id => !ownerSet.has(id));
  }, [project, ownerIds]);

  const handleRoleSave = async (memberId: string, role: string) => {
    if (!project) return;
    setSaveError(null);
    const updated: Project = {
      ...project,
      member_roles: {
        ...(project.member_roles ?? {}),
        [memberId]: role,
      },
      updated_by: currentUser.id,
    };
    try {
      await saveProject(updated);
    } catch (e) {
      setSaveError(formatErrorForUser("役割の保存に失敗しました", e));
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "var(--color-bg-primary)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ヘッダー */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-secondary)",
      }}>
        <span style={{ fontSize: "15px" }}>🏢</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          PJ体制図
        </span>
        <select
          value={selectedPjId}
          onChange={e => setSelectedPjId(e.target.value)}
          style={{
            fontSize: "12px",
            padding: "4px 8px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            maxWidth: "240px",
          }}
        >
          {activeProjects.length === 0 && <option value="">（PJなし）</option>}
          {activeProjects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          役割をクリックして編集
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: "18px", color: "var(--color-text-tertiary)", padding: "4px",
            lineHeight: 1,
          }}
          title="閉じる"
        >✕</button>
      </div>

      {/* エラーバー */}
      {saveError && (
        <div style={{
          flexShrink: 0,
          padding: "8px 16px",
          background: "var(--color-bg-danger, #fef2f2)",
          color: "var(--color-text-danger, #b91c1c)",
          fontSize: "12px",
          borderBottom: "1px solid var(--color-border-primary)",
        }}>
          {saveError}
        </div>
      )}

      {/* 体制図本体 */}
      <div style={{ flex: 1, overflow: "auto", padding: "32px 24px" }}>
        {!project && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            PJを選択してください
          </div>
        )}

        {project && ownerIds.length === 0 && memberIds.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            ⚠ メンバーが登録されていません。管理画面で追加してください。
          </div>
        )}

        {project && ownerIds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
            {/* オーナー行 */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              {ownerIds.map(ownerId => {
                const m = memberMap.get(ownerId);
                return (
                  <div key={ownerId} style={{ ...CARD_BASE, borderColor: "var(--color-brand)", background: "var(--color-brand-light, rgba(99,102,241,0.08))" }}>
                    <div style={{ fontSize: "18px", marginBottom: "4px" }}>👑</div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "4px" }}>
                      {m?.display_name ?? ownerId}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-brand)", fontWeight: 600 }}>オーナー</div>
                  </div>
                );
              })}
            </div>

            {/* 接続線（メンバーがいる時のみ） */}
            {memberIds.length > 0 && (
              <div style={{
                width: "2px",
                height: "28px",
                background: "var(--color-border-primary)",
                margin: "0 auto",
              }} />
            )}

            {/* 水平線（メンバーが2人以上） */}
            {memberIds.length > 1 && (
              <div style={{
                height: "2px",
                background: "var(--color-border-primary)",
                // 中央のカード幅に合わせて伸ばす（カード132px+gap12px）
                width: `${Math.min(memberIds.length, 5) * 144 - 12}px`,
                maxWidth: "calc(100% - 48px)",
                margin: "0 auto",
              }} />
            )}

            {/* メンバー行 */}
            {memberIds.length > 0 && (
              <div style={{
                display: "flex", gap: "12px", justifyContent: "center",
                flexWrap: "wrap",
                marginTop: memberIds.length === 1 ? "0" : "0",
              }}>
                {memberIds.map(memberId => {
                  const m = memberMap.get(memberId);
                  const role = project.member_roles?.[memberId] ?? "";
                  return (
                    <div key={memberId} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      {/* 縦線（各メンバーへ） */}
                      <div style={{ width: "2px", height: memberIds.length > 1 ? "16px" : "0", background: "var(--color-border-primary)" }} />
                      <div style={{ ...CARD_BASE }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "6px" }}>
                          {m?.display_name ?? memberId}
                        </div>
                        <RoleInput
                          value={role}
                          placeholder="役割を入力…"
                          onSave={v => handleRoleSave(memberId, v)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* メンバー0人の場合 */}
            {memberIds.length === 0 && (
              <div style={{ marginTop: "16px", color: "var(--color-text-tertiary)", fontSize: "12px" }}>
                ⚠ メンバーが登録されていません。管理画面で追加してください。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
