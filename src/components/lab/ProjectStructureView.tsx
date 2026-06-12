// src/components/lab/ProjectStructureView.tsx
//
// 【設計意図】
// ラボ機能：PJの体制図を組織図として表示・編集する。
// オーナーが頂点、メンバーが下部に並ぶ階層図。
// 役割テキストはクリックでインライン編集→即時 saveProject 保存。
// メンバーの追加・削除も体制図から直接操作できる。

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  onClose: () => void;
  currentUser: Member;
}

// アバター背景色（IDハッシュで決定論的に選択）
const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#3b82f6", "#ef4444", "#14b8a6",
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(member: Member): string {
  if (member.initials) return member.initials;
  const name = member.display_name ?? "";
  return name.slice(0, 2);
}

// ===== RoleInput =====

interface RoleInputProps {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  disabled?: boolean;
}

function RoleInput({ value, placeholder, onSave, disabled }: RoleInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // 外側から value が変わった場合に draft を同期
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

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
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        style={{
          fontSize: "11px",
          width: "100%",
          padding: "3px 6px",
          border: "1px solid var(--color-brand)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          boxSizing: "border-box",
          textAlign: "center",
          outline: "none",
        }}
      />
    );
  }

  if (value) {
    return (
      <div
        onClick={() => { if (!disabled) { setDraft(value); setEditing(true); } }}
        title={disabled ? undefined : "クリックして役割を編集"}
        style={{
          display: "inline-block",
          fontSize: "10px",
          color: "var(--color-brand)",
          background: "var(--color-brand-light, rgba(99,102,241,0.1))",
          border: "1px solid var(--color-brand)",
          borderRadius: "999px",
          padding: "2px 8px",
          cursor: disabled ? "default" : "text",
          maxWidth: "112px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    );
  }

  return (
    <div
      onClick={() => { if (!disabled) { setDraft(""); setEditing(true); } }}
      title={disabled ? undefined : "クリックして役割を入力"}
      style={{
        fontSize: "10px",
        color: "var(--color-text-tertiary)",
        cursor: disabled ? "default" : "text",
        padding: "2px 4px",
        borderRadius: "var(--radius-sm)",
        minHeight: "18px",
        border: "1px dashed transparent",
        transition: "border-color 0.15s",
        textAlign: "center",
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-primary)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}
    >
      {placeholder}
    </div>
  );
}

// ===== Avatar =====

function Avatar({ member, size = 40, isOwner }: { member: Member; size?: number; isOwner?: boolean }) {
  const bg = isOwner ? "var(--color-brand)" : avatarColor(member.id);
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontWeight: 700,
      fontSize: size * 0.35,
      flexShrink: 0,
      border: isOwner ? "2px solid var(--color-brand)" : "2px solid transparent",
      boxSizing: "border-box",
    }}>
      {initials(member)}
    </div>
  );
}

// ===== OwnerCard =====

interface OwnerCardProps {
  member: Member;
  role: string;
  onRoleSave: (v: string) => void;
  onChangeOwner: () => void;
  saving: boolean;
}

function OwnerCard({ member, role, onRoleSave, onChangeOwner, saving }: OwnerCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 140,
        padding: "12px 14px",
        boxSizing: "border-box",
        background: "var(--color-brand-light, rgba(99,102,241,0.08))",
        border: "2px solid var(--color-brand)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        boxShadow: hovered ? "0 4px 16px rgba(99,102,241,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s",
      }}
    >
      <Avatar member={member} size={40} isOwner />
      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: 2, textAlign: "center" }}>
        {member.display_name}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: "11px", color: "var(--color-brand)", fontWeight: 600 }}>👑 オーナー</span>
      </div>
      <RoleInput value={role} placeholder="役割を入力…" onSave={onRoleSave} />
      {hovered && !saving && (
        <button
          onClick={onChangeOwner}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            fontSize: "9px",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-brand)",
            background: "var(--color-bg-primary)",
            color: "var(--color-brand)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          変更
        </button>
      )}
    </div>
  );
}

// ===== MemberCard =====

interface MemberCardProps {
  member: Member;
  role: string;
  onRoleSave: (v: string) => void;
  onRemove: () => void;
  saving: boolean;
}

function MemberCard({ member, role, onRoleSave, onRemove, saving }: MemberCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 140,
        padding: "12px 14px",
        boxSizing: "border-box",
        background: "var(--color-bg-secondary)",
        border: "1.5px solid var(--color-border-primary)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.10)" : "0 1px 3px rgba(0,0,0,0.05)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        borderColor: hovered ? "var(--color-brand)" : "var(--color-border-primary)",
      }}
    >
      <Avatar member={member} size={36} />
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginTop: 2, textAlign: "center" }}>
        {member.display_name}
      </div>
      <RoleInput value={role} placeholder="役割を入力…" onSave={onRoleSave} />
      {hovered && !saving && (
        <button
          onClick={onRemove}
          title="メンバーを外す"
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "none",
            background: "var(--color-bg-danger, #fef2f2)",
            color: "var(--color-text-danger, #b91c1c)",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: 700,
            lineHeight: "18px",
            textAlign: "center",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ===== SVG接続線 =====

interface ConnectorLinesProps {
  ownerRef: React.RefObject<HTMLDivElement>;
  memberRefs: React.MutableRefObject<HTMLDivElement | null>[];
  containerRef: React.RefObject<HTMLDivElement>;
}

function ConnectorLines({ ownerRef, memberRefs, containerRef }: ConnectorLinesProps) {
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  const recalc = useCallback(() => {
    if (!ownerRef.current || !containerRef.current) return;
    const container = containerRef.current.getBoundingClientRect();
    const owner = ownerRef.current.getBoundingClientRect();
    const ownerCx = owner.left + owner.width / 2 - container.left;
    const ownerCy = owner.bottom - container.top;

    const newLines = memberRefs
      .filter(r => r.current)
      .map(r => {
        const rect = r.current!.getBoundingClientRect();
        return {
          x1: ownerCx,
          y1: ownerCy,
          x2: rect.left + rect.width / 2 - container.left,
          y2: rect.top - container.top,
        };
      });
    setLines(newLines);
  }, [ownerRef, memberRefs, containerRef]);

  useEffect(() => {
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [recalc]);

  // メンバー数が変わったら再計算
  useEffect(() => {
    const id = requestAnimationFrame(recalc);
    return () => cancelAnimationFrame(id);
  }, [memberRefs.length, recalc]);

  if (lines.length === 0) return null;

  const minX = Math.min(...lines.flatMap(l => [l.x1, l.x2]));
  const maxX = Math.max(...lines.flatMap(l => [l.x1, l.x2]));
  const minY = Math.min(...lines.flatMap(l => [l.y1, l.y2]));
  const maxY = Math.max(...lines.flatMap(l => [l.y1, l.y2]));
  const pad = 4;

  return (
    <svg
      style={{
        position: "absolute",
        left: minX - pad,
        top: minY - pad,
        pointerEvents: "none",
        overflow: "visible",
      }}
      width={maxX - minX + pad * 2}
      height={maxY - minY + pad * 2}
    >
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.x1 - (minX - pad)}
          y1={l.y1 - (minY - pad)}
          x2={l.x2 - (minX - pad)}
          y2={l.y2 - (minY - pad)}
          stroke="var(--color-border-primary)"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

// ===== Main Component =====

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
  const [saving, setSaving] = useState(false);

  // インラインドロップダウン（メンバー追加）の表示状態
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  // オーナー変更ドロップダウン
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);

  const project = useMemo(
    () => activeProjects.find(p => p.id === selectedPjId) ?? null,
    [activeProjects, selectedPjId]
  );

  const activeMemberMap = useMemo(
    () => new Map(members.filter(m => !m.is_deleted).map(m => [m.id, m])),
    [members]
  );

  // オーナーID（複数対応・単数フォールバック）
  const ownerIds = useMemo<string[]>(() => {
    if (!project) return [];
    if (project.owner_member_ids && project.owner_member_ids.length > 0) return project.owner_member_ids;
    if (project.owner_member_id) return [project.owner_member_id];
    return [];
  }, [project]);

  // メンバー（オーナー除外）
  const memberIds = useMemo<string[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    return (project.member_ids ?? []).filter(id => !ownerSet.has(id));
  }, [project, ownerIds]);

  // 追加候補（アクティブ・オーナーでも既存メンバーでもない人）
  const addCandidates = useMemo<Member[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    const memberSet = new Set(memberIds);
    return members.filter(m => !m.is_deleted && !ownerSet.has(m.id) && !memberSet.has(m.id));
  }, [members, ownerIds, memberIds, project]);

  // オーナー変更候補（現在のオーナー以外）
  const ownerCandidates = useMemo<Member[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    return members.filter(m => !m.is_deleted && !ownerSet.has(m.id));
  }, [members, ownerIds, project]);

  // SVG接続線用のRef
  const containerRef = useRef<HTMLDivElement>(null);
  const ownerCardRef = useRef<HTMLDivElement>(null);
  const memberCardRefs = useRef<React.MutableRefObject<HTMLDivElement | null>[]>([]);

  // memberIds が変わったら refs を再生成
  if (memberCardRefs.current.length !== memberIds.length) {
    memberCardRefs.current = memberIds.map(() => ({ current: null } as React.MutableRefObject<HTMLDivElement | null>));
  }

  const doSave = async (updated: Project) => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveProject({ ...updated, updated_by: currentUser.id });
    } catch (e) {
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  const handleRoleSave = (memberId: string, role: string) => {
    if (!project) return;
    doSave({
      ...project,
      member_roles: { ...(project.member_roles ?? {}), [memberId]: role },
    });
  };

  const handleRemoveMember = (memberId: string) => {
    if (!project) return;
    const newMemberIds = (project.member_ids ?? []).filter(id => id !== memberId);
    const newRoles = { ...(project.member_roles ?? {}) };
    delete newRoles[memberId];
    doSave({ ...project, member_ids: newMemberIds, member_roles: newRoles });
  };

  const handleAddMember = (memberId: string) => {
    if (!project) return;
    setShowAddDropdown(false);
    const newMemberIds = [...(project.member_ids ?? []), memberId];
    doSave({ ...project, member_ids: newMemberIds });
  };

  const handleChangeOwner = (newOwnerId: string) => {
    if (!project) return;
    setShowOwnerDropdown(false);
    // owner_member_ids はDBカラムなし。owner_member_id（単数）のみ変更
    doSave({ ...project, owner_member_id: newOwnerId, owner_member_ids: [newOwnerId] });
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
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>PJ体制図</span>
        <select
          value={selectedPjId}
          onChange={e => { setSelectedPjId(e.target.value); setShowAddDropdown(false); setShowOwnerDropdown(false); }}
          style={{
            fontSize: "12px", padding: "4px 8px",
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

      {/* PJ目的テキスト */}
      {project?.purpose && (
        <div style={{
          flexShrink: 0,
          padding: "6px 16px",
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {project.purpose}
        </div>
      )}

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
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "auto", padding: "40px 24px", position: "relative" }}
      >
        {!project && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            PJを選択してください
          </div>
        )}

        {project && ownerIds.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            ⚠ オーナーが設定されていません。管理画面でPJを編集してください。
          </div>
        )}

        {project && ownerIds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>

            {/* オーナー行 */}
            <div style={{ position: "relative", display: "flex", gap: "12px", justifyContent: "center" }}>
              {ownerIds.map((ownerId, idx) => {
                const m = activeMemberMap.get(ownerId);
                if (!m) return null;
                const role = project.member_roles?.[ownerId] ?? "";
                return (
                  <div key={ownerId} ref={idx === 0 ? ownerCardRef : undefined}>
                    <OwnerCard
                      member={m}
                      role={role}
                      onRoleSave={v => handleRoleSave(ownerId, v)}
                      onChangeOwner={() => { setShowOwnerDropdown(v => !v); setShowAddDropdown(false); }}
                      saving={saving}
                    />
                  </div>
                );
              })}

              {/* オーナー変更ドロップダウン */}
              {showOwnerDropdown && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  marginTop: 4,
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  zIndex: 10,
                  minWidth: 160,
                  maxHeight: 200,
                  overflow: "auto",
                }}>
                  <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border-primary)" }}>
                    新しいオーナーを選択
                  </div>
                  {ownerCandidates.length === 0 && (
                    <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>候補なし</div>
                  )}
                  {ownerCandidates.map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleChangeOwner(m.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "7px 10px",
                        background: "transparent", border: "none",
                        cursor: "pointer", fontSize: "12px",
                        color: "var(--color-text-primary)",
                        textAlign: "left",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: avatarColor(m.id),
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: "10px", fontWeight: 700, flexShrink: 0,
                      }}>{initials(m)}</div>
                      {m.display_name}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowOwnerDropdown(false)}
                    style={{
                      display: "block", width: "100%", padding: "6px 10px",
                      background: "transparent", border: "none", borderTop: "1px solid var(--color-border-primary)",
                      cursor: "pointer", fontSize: "11px", color: "var(--color-text-tertiary)",
                      textAlign: "center",
                    }}
                  >キャンセル</button>
                </div>
              )}
            </div>

            {/* SVG接続線 */}
            {memberIds.length > 0 && ownerCardRef.current && (
              <ConnectorLines
                ownerRef={ownerCardRef as React.RefObject<HTMLDivElement>}
                memberRefs={memberCardRefs.current}
                containerRef={containerRef as React.RefObject<HTMLDivElement>}
              />
            )}

            {/* スペーサー */}
            <div style={{ height: 40 }} />

            {/* メンバー行 */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", alignItems: "flex-start" }}>
              {memberIds.map((memberId, idx) => {
                const m = activeMemberMap.get(memberId);
                if (!m) return null;
                const role = project.member_roles?.[memberId] ?? "";
                return (
                  <div key={memberId} ref={el => { if (memberCardRefs.current[idx]) memberCardRefs.current[idx].current = el; }}>
                    <MemberCard
                      member={m}
                      role={role}
                      onRoleSave={v => handleRoleSave(memberId, v)}
                      onRemove={() => handleRemoveMember(memberId)}
                      saving={saving}
                    />
                  </div>
                );
              })}

              {/* メンバー追加ボタン */}
              <div style={{ position: "relative", display: "flex", alignItems: "flex-start" }}>
                <button
                  onClick={() => { setShowAddDropdown(v => !v); setShowOwnerDropdown(false); }}
                  disabled={saving || addCandidates.length === 0}
                  title={addCandidates.length === 0 ? "追加できるメンバーがいません" : "メンバーを追加"}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    border: "1.5px dashed var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "transparent",
                    color: "var(--color-text-secondary)",
                    cursor: saving || addCandidates.length === 0 ? "not-allowed" : "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                    opacity: addCandidates.length === 0 ? 0.45 : 1,
                    whiteSpace: "nowrap",
                    height: 36,
                    alignSelf: "center",
                    marginTop: memberIds.length > 0 ? 48 : 0,
                  }}
                >
                  <span style={{ fontSize: "16px", lineHeight: 1 }}>＋</span>
                  <span>メンバーを追加</span>
                </button>

                {/* 追加用インラインドロップダウン */}
                {showAddDropdown && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                    zIndex: 10,
                    minWidth: 180,
                    maxHeight: 240,
                    overflow: "auto",
                  }}>
                    <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border-primary)" }}>
                      追加するメンバーを選択
                    </div>
                    {addCandidates.map(m => (
                      <button
                        key={m.id}
                        onClick={() => handleAddMember(m.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 10px",
                          background: "transparent", border: "none",
                          cursor: "pointer", fontSize: "12px",
                          color: "var(--color-text-primary)",
                          textAlign: "left",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{
                          width: 24, height: 24, borderRadius: "50%",
                          background: avatarColor(m.id),
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontSize: "10px", fontWeight: 700, flexShrink: 0,
                        }}>{initials(m)}</div>
                        {m.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>


          </div>
        )}
      </div>
    </div>
  );
}
