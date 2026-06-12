// src/components/lab/ProjectStructureView.tsx
//
// 【設計意図】
// ラボ機能：PJの体制図を階層ブロック型で表示・編集する。
// オーナー層 / メンバー層の2ブロック。カードをD&Dでブロック間移動（昇格・降格）できる。
// localStorage は使わない。

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  onClose: () => void;
  currentUser: Member;
}

// ===== アバター色 =====

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
  return (member.display_name ?? "").slice(0, 2);
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

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

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
        onClick={e => e.stopPropagation()}
        style={{
          fontSize: "11px", width: "100%", padding: "3px 6px",
          border: "1px solid var(--color-brand)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          boxSizing: "border-box", textAlign: "center", outline: "none",
        }}
      />
    );
  }

  if (value) {
    return (
      <div
        onClick={e => { if (!disabled) { e.stopPropagation(); setDraft(value); setEditing(true); } }}
        title={disabled ? undefined : "クリックして役割を編集"}
        style={{
          display: "inline-block", fontSize: "10px", color: "var(--color-brand)",
          background: "var(--color-brand-light, rgba(99,102,241,0.1))",
          border: "1px solid var(--color-brand)", borderRadius: "999px",
          padding: "2px 8px", cursor: disabled ? "default" : "text",
          maxWidth: "112px", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", fontWeight: 600,
        }}
      >
        {value}
      </div>
    );
  }

  return (
    <div
      onClick={e => { if (!disabled) { e.stopPropagation(); setDraft(""); setEditing(true); } }}
      title={disabled ? undefined : "クリックして役割を入力"}
      style={{
        fontSize: "10px", color: "var(--color-text-tertiary)",
        cursor: disabled ? "default" : "text", padding: "2px 4px",
        borderRadius: "var(--radius-sm)", minHeight: "18px",
        border: "1px dashed transparent", transition: "border-color 0.15s", textAlign: "center",
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
      width: size, height: size, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.35, flexShrink: 0,
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
  onDemote: () => void;   // メンバー層に降格
  canDemote: boolean;     // オーナーが1人のみの場合 false
  saving: boolean;
  isDragging: boolean;
  showChangeOwner: boolean;
  onToggleChangeOwner: () => void;
  ownerCandidates: Member[];
  onChangeOwner: (id: string) => void;
}

function OwnerCard({
  member, role, onRoleSave, onDemote, canDemote, saving, isDragging,
  showChangeOwner, onToggleChangeOwner, ownerCandidates, onChangeOwner,
}: OwnerCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("memberId", member.id);
        e.dataTransfer.setData("fromZone", "owner");
        e.dataTransfer.effectAllowed = "move";
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", width: 132,
        padding: "12px 14px", boxSizing: "border-box",
        background: "var(--color-brand-light, rgba(99,102,241,0.08))",
        border: "2px solid var(--color-brand)",
        borderRadius: "var(--radius-md)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        flexShrink: 0,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.4 : 1,
        boxShadow: hovered ? "0 4px 16px rgba(99,102,241,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s, opacity 0.15s",
        userSelect: "none",
      }}
    >
      <Avatar member={member} size={40} isOwner />
      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: 2, textAlign: "center" }}>
        {member.display_name}
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-brand)", fontWeight: 600 }}>
        オーナー
      </div>
      <RoleInput value={role} placeholder="役割を入力…" onSave={onRoleSave} />

      {/* 降格ボタン（オーナーが2人以上のとき hover で表示） */}
      {hovered && !saving && canDemote && (
        <button
          onClick={e => { e.stopPropagation(); onDemote(); }}
          title="メンバー層に移動"
          style={{
            position: "absolute", top: 5, right: 5,
            width: 18, height: 18, borderRadius: "50%",
            border: "none", background: "var(--color-bg-secondary)",
            color: "var(--color-text-secondary)", cursor: "pointer",
            fontSize: "11px", fontWeight: 700, lineHeight: "18px",
            textAlign: "center", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ×
        </button>
      )}

      {/* オーナー変更ボタン */}
      {hovered && !saving && (
        <button
          onClick={e => { e.stopPropagation(); onToggleChangeOwner(); }}
          style={{
            position: "absolute", top: 6, left: 6,
            fontSize: "9px", padding: "2px 5px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-brand)",
            background: "var(--color-bg-primary)",
            color: "var(--color-brand)", cursor: "pointer", fontWeight: 600,
          }}
        >
          変更
        </button>
      )}

      {/* オーナー変更ドロップダウン */}
      {showChangeOwner && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: "50%",
          transform: "translateX(-50%)",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          zIndex: 30, minWidth: 160, maxHeight: 200, overflow: "auto",
        }}>
          <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border-primary)" }}>
            新しいオーナーを選択
          </div>
          {ownerCandidates.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>候補なし</div>
          )}
          {ownerCandidates.map(mc => (
            <button
              key={mc.id}
              onClick={e => { e.stopPropagation(); onChangeOwner(mc.id); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 10px",
                background: "transparent", border: "none",
                cursor: "pointer", fontSize: "12px",
                color: "var(--color-text-primary)", textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: avatarColor(mc.id),
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: "10px", fontWeight: 700, flexShrink: 0,
              }}>{initials(mc)}</div>
              {mc.display_name}
            </button>
          ))}
          <button
            onClick={e => { e.stopPropagation(); onToggleChangeOwner(); }}
            style={{
              display: "block", width: "100%", padding: "6px 10px",
              background: "transparent", border: "none",
              borderTop: "1px solid var(--color-border-primary)",
              cursor: "pointer", fontSize: "11px",
              color: "var(--color-text-tertiary)", textAlign: "center",
            }}
          >キャンセル</button>
        </div>
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
  isDragging: boolean;
}

function MemberCard({ member, role, onRoleSave, onRemove, saving, isDragging }: MemberCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("memberId", member.id);
        e.dataTransfer.setData("fromZone", "member");
        e.dataTransfer.effectAllowed = "move";
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", width: 132,
        padding: "12px 14px", boxSizing: "border-box",
        background: "var(--color-bg-secondary)",
        border: `1.5px solid ${hovered ? "var(--color-brand)" : "var(--color-border-primary)"}`,
        borderRadius: "var(--radius-md)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        flexShrink: 0,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.4 : 1,
        boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.10)" : "0 1px 3px rgba(0,0,0,0.05)",
        transition: "box-shadow 0.15s, border-color 0.15s, opacity 0.15s",
        userSelect: "none",
      }}
    >
      <Avatar member={member} size={36} />
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginTop: 2, textAlign: "center" }}>
        {member.display_name}
      </div>
      <RoleInput value={role} placeholder="役割を入力…" onSave={onRoleSave} />
      {hovered && !saving && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="PJから外す"
          style={{
            position: "absolute", top: 5, right: 5,
            width: 18, height: 18, borderRadius: "50%",
            border: "none", background: "var(--color-bg-danger, #fef2f2)",
            color: "var(--color-text-danger, #b91c1c)", cursor: "pointer",
            fontSize: "11px", fontWeight: 700, lineHeight: "18px",
            textAlign: "center", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ===== DropZone =====

interface DropZoneProps {
  zone: "owner" | "member";
  isOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  label: string;
  children: React.ReactNode;
}

function DropZone({ zone: _zone, isOver, onDragOver, onDragLeave, onDrop, label, children }: DropZoneProps) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        border: isOver
          ? "2px dashed var(--color-brand)"
          : "2px dashed var(--color-border-primary)",
        borderRadius: "var(--radius-lg)",
        background: isOver
          ? "rgba(99,102,241,0.04)"
          : "var(--color-bg-secondary)",
        padding: "16px 20px",
        transition: "border-color 0.15s, background 0.15s",
        minHeight: 120,
      }}
    >
      <div style={{
        fontSize: "12px", fontWeight: 700,
        color: "var(--color-text-secondary)",
        marginBottom: 12,
      }}>
        {label}
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start",
      }}>
        {children}
      </div>
    </div>
  );
}

// ===== SVG接続線 =====

interface ConnectorSVGProps {
  ownerBlockRef: React.RefObject<HTMLDivElement | null>;
  memberBlockRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  hasMember: boolean;
}

function ConnectorSVG({ ownerBlockRef, memberBlockRef, containerRef, hasMember }: ConnectorSVGProps) {
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    if (!hasMember) { setLine(null); return; }

    const calc = () => {
      const container = containerRef.current;
      const ownerBlock = ownerBlockRef.current;
      const memberBlock = memberBlockRef.current;
      if (!container || !ownerBlock || !memberBlock) return;
      const containerRect = container.getBoundingClientRect();
      const ownerRect = ownerBlock.getBoundingClientRect();
      const memberRect = memberBlock.getBoundingClientRect();
      setLine({
        x1: ownerRect.left + ownerRect.width / 2 - containerRect.left,
        y1: ownerRect.bottom - containerRect.top,
        x2: memberRect.left + memberRect.width / 2 - containerRect.left,
        y2: memberRect.top - containerRect.top,
      });
    };

    calc();
    const observer = new ResizeObserver(calc);
    if (ownerBlockRef.current) observer.observe(ownerBlockRef.current);
    if (memberBlockRef.current) observer.observe(memberBlockRef.current);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasMember, ownerBlockRef, memberBlockRef, containerRef]);

  if (!line) return null;

  return (
    <svg
      style={{
        position: "absolute", inset: 0,
        width: "100%", height: "100%",
        pointerEvents: "none", overflow: "visible",
      }}
    >
      <line
        x1={line.x1} y1={line.y1}
        x2={line.x2} y2={line.y2}
        stroke="var(--color-border-primary)"
        strokeWidth={2}
        strokeDasharray="6 3"
      />
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

  const [selectedPjId, setSelectedPjId] = useState<string>(() => activeProjects[0]?.id ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [showChangeOwnerForId, setShowChangeOwnerForId] = useState<string | null>(null);

  // D&D 状態
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overZone, setOverZone] = useState<"owner" | "member" | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const ownerBlockRef = useRef<HTMLDivElement>(null);
  const memberBlockRef = useRef<HTMLDivElement>(null);

  const project = useMemo(
    () => activeProjects.find(p => p.id === selectedPjId) ?? null,
    [activeProjects, selectedPjId]
  );

  const activeMemberMap = useMemo(
    () => new Map(members.filter(m => !m.is_deleted).map(m => [m.id, m])),
    [members]
  );

  const ownerIds = useMemo<string[]>(() => {
    if (!project) return [];
    if (project.owner_member_ids && project.owner_member_ids.length > 0) return project.owner_member_ids;
    if (project.owner_member_id) return [project.owner_member_id];
    return [];
  }, [project]);

  const memberIds = useMemo<string[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    return (project.member_ids ?? []).filter(id => !ownerSet.has(id));
  }, [project, ownerIds]);

  const addCandidates = useMemo<Member[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    const memberSet = new Set(memberIds);
    return members.filter(m => !m.is_deleted && !ownerSet.has(m.id) && !memberSet.has(m.id));
  }, [members, ownerIds, memberIds, project]);

  const ownerCandidates = useCallback((_ownerId: string): Member[] => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    // 自分以外のメンバー（オーナーセット外）が候補
    return members.filter(m => !m.is_deleted && !ownerSet.has(m.id));
  }, [members, ownerIds, project]);

  // ===== 保存処理 =====

  const doSave = useCallback(async (updated: Project) => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveProject({ ...updated, updated_by: currentUser.id });
    } catch (e) {
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [saveProject, currentUser.id]);

  const handleRoleSave = (memberId: string, role: string) => {
    if (!project) return;
    doSave({ ...project, member_roles: { ...(project.member_roles ?? {}), [memberId]: role } });
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

  const handleChangeOwner = (currentOwnerId: string, newOwnerId: string) => {
    if (!project) return;
    setShowChangeOwnerForId(null);
    // 既存のオーナーIDを差し替え（単純置換）
    const newOwnerIds = ownerIds.map(id => id === currentOwnerId ? newOwnerId : id);
    // member_ids からは外す（すでに外れている場合は無視）
    const newMemberIds = (project.member_ids ?? []).filter(id => id !== newOwnerId);
    doSave({
      ...project,
      owner_member_ids: newOwnerIds,
      owner_member_id: newOwnerIds[0] ?? newOwnerId,
      member_ids: newMemberIds,
    });
  };

  // ===== D&D ハンドラ =====

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setOverZone(null);
  }, []);

  const handleDragOverZone = useCallback((zone: "owner" | "member") => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverZone(zone);
  }, []);

  const handleDragLeaveZone = useCallback(() => {
    setOverZone(null);
  }, []);

  const handleDropOnOwner = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOverZone(null);
    const memberId = e.dataTransfer.getData("memberId");
    const fromZone = e.dataTransfer.getData("fromZone");
    if (!project || !memberId || fromZone === "owner") return;

    // メンバー → オーナーへ昇格
    const newOwnerIds = [...ownerIds, memberId];
    const newMemberIds = (project.member_ids ?? []).filter(id => id !== memberId);
    doSave({
      ...project,
      owner_member_ids: newOwnerIds,
      owner_member_id: project.owner_member_id || newOwnerIds[0],
      member_ids: newMemberIds,
    });
  }, [project, ownerIds, doSave]);

  const handleDropOnMember = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOverZone(null);
    const memberId = e.dataTransfer.getData("memberId");
    const fromZone = e.dataTransfer.getData("fromZone");
    if (!project || !memberId || fromZone === "member") return;

    // オーナー → メンバーへ降格（オーナーが1人のみなら拒否）
    if (ownerIds.length <= 1) {
      setSaveError("オーナーは最低1人必要です");
      return;
    }

    const newOwnerIds = ownerIds.filter(id => id !== memberId);
    const newMemberIds = [...(project.member_ids ?? []), memberId];
    doSave({
      ...project,
      owner_member_ids: newOwnerIds,
      owner_member_id: newOwnerIds[0] ?? project.owner_member_id,
      member_ids: newMemberIds,
    });
  }, [project, ownerIds, doSave]);

  // 降格ボタン（×ボタン）でも同じロジック
  const handleDemoteOwner = (ownerId: string) => {
    if (!project || ownerIds.length <= 1) {
      setSaveError("オーナーは最低1人必要です");
      return;
    }
    const newOwnerIds = ownerIds.filter(id => id !== ownerId);
    const newMemberIds = [...(project.member_ids ?? []), ownerId];
    doSave({
      ...project,
      owner_member_ids: newOwnerIds,
      owner_member_id: newOwnerIds[0] ?? project.owner_member_id,
      member_ids: newMemberIds,
    });
  };

  // ===== レンダリング =====

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "var(--color-bg-primary)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
      onDragEnd={handleDragEnd}
    >
      {/* ヘッダー */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-secondary)",
      }}>
        <span style={{ fontSize: "15px" }}>PJ体制図</span>
        <select
          value={selectedPjId}
          onChange={e => {
            setSelectedPjId(e.target.value);
            setShowAddDropdown(false);
            setShowChangeOwnerForId(null);
            setSaveError(null);
          }}
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
          {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {project?.purpose && (
          <div style={{
            fontSize: "11px", color: "var(--color-text-tertiary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 360,
          }}>
            {project.purpose}
          </div>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          カードをドラッグして層間を移動
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: "18px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1,
          }}
          title="閉じる"
        >✕</button>
      </div>

      {/* エラーバー */}
      {saveError && (
        <div style={{
          flexShrink: 0, padding: "8px 16px",
          background: "var(--color-bg-danger, #fef2f2)",
          color: "var(--color-text-danger, #b91c1c)",
          fontSize: "12px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>{saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "var(--color-text-danger, #b91c1c)" }}
          >✕</button>
        </div>
      )}

      {/* ドロップダウン外側クリックで閉じるオーバーレイ */}
      {(showChangeOwnerForId !== null || showAddDropdown) && (
        <div
          onClick={() => { setShowChangeOwnerForId(null); setShowAddDropdown(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 9 }}
        />
      )}

      {/* コンテンツ */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          padding: "24px 32px",
          position: "relative",
        }}
      >
        {!project && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            PJを選択してください
          </div>
        )}

        {project && ownerIds.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            オーナーが設定されていません。管理画面でPJを編集してください。
          </div>
        )}

        {project && ownerIds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 900 }}>

            {/* SVG接続線（ブロック間） */}
            <ConnectorSVG
              ownerBlockRef={ownerBlockRef}
              memberBlockRef={memberBlockRef}
              containerRef={containerRef}
              hasMember={memberIds.length > 0}
            />

            {/* オーナーブロック */}
            <div ref={ownerBlockRef}>
              <DropZone
                zone="owner"
                isOver={overZone === "owner"}
                onDragOver={handleDragOverZone("owner")}
                onDragLeave={handleDragLeaveZone}
                onDrop={handleDropOnOwner}
                label="オーナー層"
              >
                {ownerIds.map(ownerId => {
                  const m = activeMemberMap.get(ownerId);
                  if (!m) return null;
                  const role = project.member_roles?.[ownerId] ?? "";
                  return (
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                    <div
                      key={ownerId}
                      onDragStart={() => handleDragStart(ownerId)}
                    >
                      <OwnerCard
                        member={m}
                        role={role}
                        onRoleSave={v => handleRoleSave(ownerId, v)}
                        onDemote={() => handleDemoteOwner(ownerId)}
                        canDemote={ownerIds.length > 1}
                        saving={saving}
                        isDragging={draggingId === ownerId}
                        showChangeOwner={showChangeOwnerForId === ownerId}
                        onToggleChangeOwner={() => {
                          setShowChangeOwnerForId(v => v === ownerId ? null : ownerId);
                          setShowAddDropdown(false);
                        }}
                        ownerCandidates={ownerCandidates(ownerId)}
                        onChangeOwner={newId => handleChangeOwner(ownerId, newId)}
                      />
                    </div>
                  );
                })}
              </DropZone>
            </div>

            {/* ブロック間スペーサー（接続線の余白） */}
            <div style={{ height: 40 }} />

            {/* メンバーブロック */}
            <div ref={memberBlockRef}>
              <DropZone
                zone="member"
                isOver={overZone === "member"}
                onDragOver={handleDragOverZone("member")}
                onDragLeave={handleDragLeaveZone}
                onDrop={handleDropOnMember}
                label="メンバー層"
              >
                {memberIds.map(memberId => {
                  const m = activeMemberMap.get(memberId);
                  if (!m) return null;
                  const role = project.member_roles?.[memberId] ?? "";
                  return (
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                    <div
                      key={memberId}
                      onDragStart={() => handleDragStart(memberId)}
                    >
                      <MemberCard
                        member={m}
                        role={role}
                        onRoleSave={v => handleRoleSave(memberId, v)}
                        onRemove={() => handleRemoveMember(memberId)}
                        saving={saving}
                        isDragging={draggingId === memberId}
                      />
                    </div>
                  );
                })}

                {/* メンバー追加ボタン */}
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => { setShowAddDropdown(v => !v); setShowChangeOwnerForId(null); }}
                    disabled={saving || addCandidates.length === 0}
                    title={addCandidates.length === 0 ? "追加できるメンバーがいません" : "メンバーを追加"}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "8px 14px", height: 90,
                      border: "1.5px dashed var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "transparent",
                      color: "var(--color-text-secondary)",
                      cursor: saving || addCandidates.length === 0 ? "not-allowed" : "pointer",
                      fontSize: "12px", fontWeight: 600,
                      opacity: addCandidates.length === 0 ? 0.45 : 1,
                      flexDirection: "column", justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: "18px", lineHeight: 1 }}>＋</span>
                    <span>メンバーを追加</span>
                  </button>

                  {showAddDropdown && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0,
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                      zIndex: 30, minWidth: 180, maxHeight: 240, overflow: "auto",
                    }}>
                      <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border-primary)" }}>
                        追加するメンバーを選択
                      </div>
                      {addCandidates.map(mc => (
                        <button
                          key={mc.id}
                          onClick={() => handleAddMember(mc.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 10px",
                            background: "transparent", border: "none",
                            cursor: "pointer", fontSize: "12px",
                            color: "var(--color-text-primary)", textAlign: "left",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{
                            width: 24, height: 24, borderRadius: "50%",
                            background: avatarColor(mc.id),
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontSize: "10px", fontWeight: 700, flexShrink: 0,
                          }}>{initials(mc)}</div>
                          {mc.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </DropZone>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
