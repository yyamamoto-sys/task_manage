// src/components/lab/ProjectStructureView.tsx
//
// 【設計意図】
// ラボ機能：PJの体制図を多層・グループ対応の組織図として表示・編集する。
// 層とグループを自由に追加・削除でき、カードをD&DでグループやLayer間を移動できる。
// 組織構造（どの層・グループに属するか）は localStorage のみ保存（DB変更なし）。
// メンバーのPJ追加・除外は saveProject 経由で DB にも反映する。

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useAppStore, selectScopedProjects } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  onClose: () => void;
  currentUser: Member;
}

// ===== OrgStructure データ型 =====

interface Group {
  id: string;
  name: string;
  memberIds: string[];
}

interface Layer {
  id: string;
  name: string;
  groups: Group[];
}

interface OrgStructure {
  pjId: string;
  layers: Layer[];
}

const ORG_KEY = "structure_org_v2";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadOrg(pjId: string, ownerIds: string[], memberIds: string[]): OrgStructure {
  try {
    const raw = localStorage.getItem(ORG_KEY);
    if (raw) {
      const all = JSON.parse(raw) as OrgStructure[];
      const found = all.find(o => o.pjId === pjId);
      if (found) return found;
    }
  } catch {
    // ignore
  }
  // 初期化
  return {
    pjId,
    layers: [
      { id: genId(), name: "オーナー", groups: [{ id: genId(), name: "", memberIds: [...ownerIds] }] },
      { id: genId(), name: "メンバー", groups: [{ id: genId(), name: "", memberIds: [...memberIds] }] },
    ],
  };
}

function saveOrg(org: OrgStructure): void {
  try {
    const raw = localStorage.getItem(ORG_KEY);
    const all: OrgStructure[] = raw ? JSON.parse(raw) : [];
    const idx = all.findIndex(o => o.pjId === org.pjId);
    if (idx >= 0) {
      all[idx] = org;
    } else {
      all.push(org);
    }
    localStorage.setItem(ORG_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
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
      // disabled=false 時のみ role/tabIndex/onKeyDown を付与する条件付きインタラクティブ要素
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        onClick={e => { if (!disabled) { e.stopPropagation(); setDraft(value); setEditing(true); } }}
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={disabled ? undefined : (e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setDraft(value); setEditing(true); } })}
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
    // disabled=false 時のみ role/tabIndex/onKeyDown を付与する条件付きインタラクティブ要素
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onClick={e => { if (!disabled) { e.stopPropagation(); setDraft(""); setEditing(true); } }}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={disabled ? undefined : (e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setDraft(""); setEditing(true); } })}
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

function Avatar({ member, size = 40 }: { member: Member; size?: number }) {
  const bg = avatarColor(member.id);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.35, flexShrink: 0,
      border: "2px solid transparent",
      boxSizing: "border-box",
    }}>
      {initials(member)}
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
        e.dataTransfer.effectAllowed = "move";
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", width: 120,
        padding: "10px 10px", boxSizing: "border-box",
        background: "var(--color-bg-primary)",
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
      <Avatar member={member} size={34} />
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", marginTop: 2, textAlign: "center", wordBreak: "break-all" }}>
        {member.display_name}
      </div>
      <RoleInput value={role} placeholder="役割を入力…" onSave={onRoleSave} />
      {hovered && !saving && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="PJから外す"
          style={{
            position: "absolute", top: 4, right: 4,
            width: 16, height: 16, borderRadius: "50%",
            border: "none", background: "var(--color-bg-danger, #fef2f2)",
            color: "var(--color-text-danger, #b91c1c)", cursor: "pointer",
            fontSize: "10px", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ===== LayerNameInput =====

interface LayerNameInputProps {
  value: string;
  onSave: (v: string) => void;
}

function LayerNameInput({ value, onSave }: LayerNameInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== value) onSave(draft.trim());
    else setDraft(value);
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
          fontSize: "13px", fontWeight: 700, padding: "2px 6px",
          border: "1px solid var(--color-brand)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          outline: "none", width: "120px",
        }}
      />
    );
  }

  return (
    <span
      style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", cursor: "text" }}
      onClick={() => { setDraft(value); setEditing(true); }}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { setDraft(value); setEditing(true); } }}
      title="クリックして層名を編集"
    >
      {value}
    </span>
  );
}

// ===== GroupNameInput =====

interface GroupNameInputProps {
  value: string;
  onSave: (v: string) => void;
}

function GroupNameInput({ value, onSave }: GroupNameInputProps) {
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
        placeholder="グループ名"
        style={{
          fontSize: "11px", fontWeight: 600, padding: "2px 5px",
          border: "1px solid var(--color-brand)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          outline: "none", width: "90px",
        }}
      />
    );
  }

  return (
    <span
      style={{
        fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)",
        cursor: "text", padding: "1px 2px",
      }}
      onClick={() => { setDraft(value); setEditing(true); }}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { setDraft(value); setEditing(true); } }}
      title="クリックしてグループ名を編集"
    >
      {value || "（名前なし）"}
    </span>
  );
}

// ===== AddMemberDropdown =====

interface AddMemberDropdownProps {
  candidates: Member[];
  onAdd: (memberId: string) => void;
  onClose: () => void;
}

function AddMemberDropdown({ candidates, onAdd, onClose }: AddMemberDropdownProps) {
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 4px)", left: 0,
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-md)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      zIndex: 30, minWidth: 160, maxHeight: 220, overflow: "auto",
    }}>
      <div style={{ padding: "5px 8px", fontSize: "11px", color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border-primary)" }}>
        メンバーを選択
      </div>
      {candidates.length === 0 && (
        <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>候補なし</div>
      )}
      {candidates.map(mc => (
        <button
          key={mc.id}
          onClick={() => { onAdd(mc.id); onClose(); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            width: "100%", padding: "6px 8px",
            background: "transparent", border: "none",
            cursor: "pointer", fontSize: "12px",
            color: "var(--color-text-primary)", textAlign: "left",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-secondary)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <div style={{
            width: 22, height: 22, borderRadius: "50%",
            background: avatarColor(mc.id),
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: "9px", fontWeight: 700, flexShrink: 0,
          }}>{initials(mc)}</div>
          {mc.display_name}
        </button>
      ))}
    </div>
  );
}

// ===== GroupBlock =====

interface GroupBlockProps {
  group: Group;
  isFirstGroup: boolean;
  isLastGroup: boolean;
  activeMemberMap: Map<string, Member>;
  project: Project;
  draggingId: string | null;
  overGroupId: string | null;
  saving: boolean;
  addCandidates: Member[];
  onDragOverGroup: (groupId: string, e: React.DragEvent) => void;
  onDragLeaveGroup: () => void;
  onDropGroup: (groupId: string, e: React.DragEvent) => void;
  onRoleSave: (memberId: string, role: string) => void;
  onRemoveMember: (memberId: string) => void;
  onAddMember: (groupId: string, memberId: string) => void;
  onGroupNameSave: (name: string) => void;
  onDeleteGroup: () => void;
}

function GroupBlock({
  group, isFirstGroup, isLastGroup, activeMemberMap, project, draggingId, overGroupId,
  saving, addCandidates, onDragOverGroup, onDragLeaveGroup, onDropGroup,
  onRoleSave, onRemoveMember, onAddMember, onGroupNameSave, onDeleteGroup,
}: GroupBlockProps) {
  const [showAdd, setShowAdd] = useState(false);
  const isOver = overGroupId === group.id;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onDragOver={e => onDragOverGroup(group.id, e)}
      onDragLeave={onDragLeaveGroup}
      onDrop={e => onDropGroup(group.id, e)}
      style={{
        border: isOver
          ? "2px dashed var(--color-brand)"
          : "1.5px solid var(--color-border-primary)",
        borderRadius: "var(--radius-md)",
        background: isOver ? "rgba(99,102,241,0.04)" : "var(--color-bg-primary)",
        padding: "10px 12px",
        minWidth: 140,
        transition: "border-color 0.15s, background 0.15s",
        position: "relative",
      }}
    >
      {/* グループヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
        <GroupNameInput value={group.name} onSave={onGroupNameSave} />
        {!isFirstGroup || !isLastGroup ? (
          <button
            onClick={onDeleteGroup}
            title="このグループを削除"
            style={{
              marginLeft: "auto", width: 16, height: 16, borderRadius: "50%",
              border: "none", background: "transparent",
              color: "var(--color-text-tertiary)", cursor: "pointer",
              fontSize: "11px", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0,
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      {/* メンバーカード */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 40 }}>
        {group.memberIds.map(memberId => {
          const m = activeMemberMap.get(memberId);
          if (!m) return null;
          const role = project.member_roles?.[memberId] ?? "";
          return (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div key={memberId} onDragStart={() => { /* handled in MemberCard */ }}>
              <MemberCard
                member={m}
                role={role}
                onRoleSave={v => onRoleSave(memberId, v)}
                onRemove={() => onRemoveMember(memberId)}
                saving={saving}
                isDragging={draggingId === memberId}
              />
            </div>
          );
        })}

        {/* メンバー追加ボタン */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowAdd(v => !v)}
            disabled={saving}
            title="このグループにメンバーを追加"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "1.5px dashed var(--color-border-primary)",
              background: "transparent",
              color: "var(--color-text-tertiary)",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: "16px", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center",
              alignSelf: "center",
            }}
          >
            ＋
          </button>
          {showAdd && (
            <AddMemberDropdown
              candidates={addCandidates}
              onAdd={memberId => onAddMember(group.id, memberId)}
              onClose={() => setShowAdd(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ===== LayerBlock =====

interface LayerBlockProps {
  layer: Layer;
  layerIndex: number;
  totalLayers: number;
  activeMemberMap: Map<string, Member>;
  project: Project;
  draggingId: string | null;
  overGroupId: string | null;
  saving: boolean;
  addCandidatesForGroup: (groupId: string) => Member[];
  onDragOverGroup: (groupId: string, e: React.DragEvent) => void;
  onDragLeaveGroup: () => void;
  onDropGroup: (groupId: string, e: React.DragEvent) => void;
  onRoleSave: (memberId: string, role: string) => void;
  onRemoveMember: (memberId: string) => void;
  onAddMember: (groupId: string, memberId: string) => void;
  onLayerNameSave: (name: string) => void;
  onDeleteLayer: () => void;
  onAddGroup: () => void;
  onGroupNameSave: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string) => void;
}

function LayerBlock({
  layer, layerIndex, totalLayers, activeMemberMap, project, draggingId, overGroupId,
  saving, addCandidatesForGroup, onDragOverGroup, onDragLeaveGroup, onDropGroup,
  onRoleSave, onRemoveMember, onAddMember, onLayerNameSave, onDeleteLayer, onAddGroup,
  onGroupNameSave, onDeleteGroup,
}: LayerBlockProps) {
  const isFirst = layerIndex === 0;

  return (
    <div
      style={{
        border: isFirst ? "2px solid var(--color-brand)" : "1.5px dashed var(--color-border-primary)",
        borderRadius: "var(--radius-lg)",
        background: "var(--color-bg-secondary)",
        padding: "14px 16px",
      }}
    >
      {/* 層ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <LayerNameInput value={layer.name} onSave={onLayerNameSave} />
        {totalLayers > 1 && (
          <button
            onClick={onDeleteLayer}
            title="この層を削除"
            style={{
              width: 18, height: 18, borderRadius: "50%",
              border: "none", background: "transparent",
              color: "var(--color-text-tertiary)", cursor: "pointer",
              fontSize: "12px", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0,
            }}
          >
            ×
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onAddGroup}
          style={{
            fontSize: "11px", padding: "3px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-secondary)",
            cursor: "pointer", fontWeight: 500,
          }}
        >
          ＋ グループ追加
        </button>
      </div>

      {/* グループ群（横並び） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {layer.groups.map((group, gi) => (
          <GroupBlock
            key={group.id}
            group={group}
            isFirstGroup={gi === 0}
            isLastGroup={gi === layer.groups.length - 1}
            activeMemberMap={activeMemberMap}
            project={project}
            draggingId={draggingId}
            overGroupId={overGroupId}
            saving={saving}
            addCandidates={addCandidatesForGroup(group.id)}
            onDragOverGroup={onDragOverGroup}
            onDragLeaveGroup={onDragLeaveGroup}
            onDropGroup={onDropGroup}
            onRoleSave={onRoleSave}
            onRemoveMember={onRemoveMember}
            onAddMember={onAddMember}
            onGroupNameSave={name => onGroupNameSave(group.id, name)}
            onDeleteGroup={() => onDeleteGroup(group.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ===== LayerConnector（SVG接続線） =====

interface LayerConnectorProps {
  upperRef: React.RefObject<HTMLDivElement | null>;
  lowerRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function LayerConnector({ upperRef, lowerRef, containerRef }: LayerConnectorProps) {
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    const calc = () => {
      const container = containerRef.current;
      const upper = upperRef.current;
      const lower = lowerRef.current;
      if (!container || !upper || !lower) return;
      const cr = container.getBoundingClientRect();
      const ur = upper.getBoundingClientRect();
      const lr = lower.getBoundingClientRect();
      setLine({
        x1: ur.left + ur.width / 2 - cr.left,
        y1: ur.bottom - cr.top,
        x2: lr.left + lr.width / 2 - cr.left,
        y2: lr.top - cr.top,
      });
    };

    calc();
    const observer = new ResizeObserver(calc);
    if (upperRef.current) observer.observe(upperRef.current);
    if (lowerRef.current) observer.observe(lowerRef.current);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [upperRef, lowerRef, containerRef]);

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
  const allProjects = useAppStore(selectScopedProjects);
  const members = useAppStore(s => s.members);
  const saveProject = useAppStore(s => s.saveProject);

  const activeProjects = useMemo(
    () => allProjects.filter(p => !p.is_deleted && p.status !== "archived"),
    [allProjects]
  );

  const [selectedPjId, setSelectedPjId] = useState<string>(() => activeProjects[0]?.id ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // D&D 状態
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overGroupId, setOverGroupId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // 各層ブロックへの ref（動的に生成）
  const layerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // 組織構造
  const [org, setOrg] = useState<OrgStructure | null>(null);

  useEffect(() => {
    if (!project) { setOrg(null); return; }
    setOrg(loadOrg(project.id, ownerIds, memberIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const updateOrg = useCallback((next: OrgStructure) => {
    setOrg(next);
    saveOrg(next);
  }, []);

  // PJ内の全メンバーID集合（オーナー + member_ids）
  const allPjMemberIds = useMemo(() => {
    if (!project) return new Set<string>();
    return new Set([...ownerIds, ...(project.member_ids ?? [])]);
  }, [project, ownerIds]);

  // グループ内に既にいるメンバーのIDをorg全体から収集
  const orgMemberIdSet = useMemo(() => {
    if (!org) return new Set<string>();
    const s = new Set<string>();
    org.layers.forEach(l => l.groups.forEach(g => g.memberIds.forEach(id => s.add(id))));
    return s;
  }, [org]);

  // グループごとの追加候補（PJメンバーかつorgにまだいないメンバー + そのグループ以外のorgメンバー）
  // 実際には「PJにまだいない全アクティブメンバー」が追加対象
  // グループ追加 = PJへの追加 + orgへの配置
  const globalAddCandidates = useMemo(() => {
    return members.filter(m => !m.is_deleted && !allPjMemberIds.has(m.id));
  }, [members, allPjMemberIds]);

  // グループ内の追加候補：PJメンバーのうちorgにまだ配置されていない人
  const unplacedPjMembers = useMemo(() => {
    return members.filter(m => !m.is_deleted && allPjMemberIds.has(m.id) && !orgMemberIdSet.has(m.id));
  }, [members, allPjMemberIds, orgMemberIdSet]);

  const addCandidatesForGroup = useCallback((_groupId: string): Member[] => {
    // 既存PJメンバーでorgに未配置 + PJ外の全アクティブメンバー
    const unplaced = unplacedPjMembers;
    const notInPj = globalAddCandidates;
    const all = [...unplaced, ...notInPj];
    // 重複除去
    const seen = new Set<string>();
    return all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  }, [unplacedPjMembers, globalAddCandidates]);

  // ===== DB保存 =====

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

  // メンバーをPJから除外 + orgからも除外
  const handleRemoveMember = (memberId: string) => {
    if (!project || !org) return;
    const newMemberIds = (project.member_ids ?? []).filter(id => id !== memberId);
    const newOwnerIds = ownerIds.filter(id => id !== memberId);
    const newRoles = { ...(project.member_roles ?? {}) };
    delete newRoles[memberId];

    const nextOrg: OrgStructure = {
      ...org,
      layers: org.layers.map(l => ({
        ...l,
        groups: l.groups.map(g => ({
          ...g,
          memberIds: g.memberIds.filter(id => id !== memberId),
        })),
      })),
    };
    updateOrg(nextOrg);
    doSave({
      ...project,
      member_ids: newMemberIds,
      owner_member_ids: newOwnerIds,
      owner_member_id: newOwnerIds[0] ?? project.owner_member_id,
      member_roles: newRoles,
    });
  };

  // グループにメンバーを追加（PJ外のメンバーならPJにも追加）
  const handleAddMember = (groupId: string, memberId: string) => {
    if (!project || !org) return;

    const nextOrg: OrgStructure = {
      ...org,
      layers: org.layers.map(l => ({
        ...l,
        groups: l.groups.map(g => {
          if (g.id !== groupId) return g;
          if (g.memberIds.includes(memberId)) return g;
          return { ...g, memberIds: [...g.memberIds, memberId] };
        }),
      })),
    };
    updateOrg(nextOrg);

    // PJにまだいない場合はmember_idsに追加
    if (!allPjMemberIds.has(memberId)) {
      const newMemberIds = [...(project.member_ids ?? []), memberId];
      doSave({ ...project, member_ids: newMemberIds });
    }
  };

  // ===== 層の操作 =====

  const handleLayerNameSave = (layerId: string, name: string) => {
    if (!org) return;
    updateOrg({
      ...org,
      layers: org.layers.map(l => l.id === layerId ? { ...l, name } : l),
    });
  };

  const handleDeleteLayer = (layerId: string) => {
    if (!org || org.layers.length <= 1) return;
    const layerIdx = org.layers.findIndex(l => l.id === layerId);
    if (layerIdx < 0) return;

    // 削除対象層のメンバーを最下層の先頭グループへ移動
    const deletedMemberIds = org.layers[layerIdx].groups.flatMap(g => g.memberIds);
    const remainingLayers = org.layers.filter(l => l.id !== layerId);
    const lastLayer = remainingLayers[remainingLayers.length - 1];
    const firstGroupOfLast = lastLayer.groups[0];

    const mergedMemberIds = [
      ...firstGroupOfLast.memberIds,
      ...deletedMemberIds.filter(id => !firstGroupOfLast.memberIds.includes(id)),
    ];

    const nextLayers: Layer[] = remainingLayers.map((l, idx) => {
      if (idx === remainingLayers.length - 1) {
        return {
          ...l,
          groups: l.groups.map((g, gi) => gi === 0 ? { ...g, memberIds: mergedMemberIds } : g),
        };
      }
      return l;
    });

    updateOrg({ ...org, layers: nextLayers });
  };

  const handleAddLayer = () => {
    if (!org) return;
    const newLayer: Layer = {
      id: genId(),
      name: "新しい層",
      groups: [{ id: genId(), name: "", memberIds: [] }],
    };
    updateOrg({ ...org, layers: [...org.layers, newLayer] });
  };

  // ===== グループの操作 =====

  const handleAddGroup = (layerId: string) => {
    if (!org) return;
    updateOrg({
      ...org,
      layers: org.layers.map(l => {
        if (l.id !== layerId) return l;
        return { ...l, groups: [...l.groups, { id: genId(), name: "", memberIds: [] }] };
      }),
    });
  };

  const handleDeleteGroup = (layerId: string, groupId: string) => {
    if (!org) return;
    const layer = org.layers.find(l => l.id === layerId);
    if (!layer || layer.groups.length <= 1) return;

    const deletedGroup = layer.groups.find(g => g.id === groupId);
    if (!deletedGroup) return;
    const firstGroup = layer.groups.find(g => g.id !== groupId);
    if (!firstGroup) return;

    updateOrg({
      ...org,
      layers: org.layers.map(l => {
        if (l.id !== layerId) return l;
        const mergedFirst: Group = {
          ...firstGroup,
          memberIds: [
            ...firstGroup.memberIds,
            ...deletedGroup.memberIds.filter(id => !firstGroup.memberIds.includes(id)),
          ],
        };
        return {
          ...l,
          groups: l.groups.filter(g => g.id !== groupId).map(g => g.id === firstGroup.id ? mergedFirst : g),
        };
      }),
    });
  };

  const handleGroupNameSave = (layerId: string, groupId: string, name: string) => {
    if (!org) return;
    updateOrg({
      ...org,
      layers: org.layers.map(l => {
        if (l.id !== layerId) return l;
        return { ...l, groups: l.groups.map(g => g.id === groupId ? { ...g, name } : g) };
      }),
    });
  };

  // ===== D&D ハンドラ =====

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setOverGroupId(null);
  }, []);

  const handleDragOverGroup = useCallback((groupId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverGroupId(groupId);
  }, []);

  const handleDragLeaveGroup = useCallback(() => {
    setOverGroupId(null);
  }, []);

  const handleDropGroup = useCallback((targetGroupId: string, e: React.DragEvent) => {
    e.preventDefault();
    setOverGroupId(null);
    const memberId = e.dataTransfer.getData("memberId");
    if (!memberId || !org) return;

    const targetGroup = org.layers.flatMap(l => l.groups).find(g => g.id === targetGroupId);
    if (!targetGroup || targetGroup.memberIds.includes(memberId)) return;

    // 元のグループから削除し、ターゲットグループに追加
    const nextOrg: OrgStructure = {
      ...org,
      layers: org.layers.map(l => ({
        ...l,
        groups: l.groups.map(g => {
          if (g.id === targetGroupId) {
            return { ...g, memberIds: [...g.memberIds, memberId] };
          }
          return { ...g, memberIds: g.memberIds.filter(id => id !== memberId) };
        }),
      })),
    };
    updateOrg(nextOrg);
  }, [org, updateOrg]);

  // ===== レンダリング =====

  // SVG接続線用に各層ブロックのrefを収集するコールバック
  const setLayerRef = useCallback((layerId: string, el: HTMLDivElement | null) => {
    if (el) {
      layerRefs.current.set(layerId, el);
    } else {
      layerRefs.current.delete(layerId);
    }
  }, []);

  return (
    // ドラッグ中の要素がどこにドロップされてもクリーンアップするためのハンドラのみ。マウス操作専用でキーボード代替手段はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
            setSaveError(null);
            setOrg(null);
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
          カードをドラッグしてグループ間を移動
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

        {project && !org && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", marginTop: "60px" }}>
            読み込み中…
          </div>
        )}

        {project && org && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 960 }}>

            {/* SVG接続線（層ブロック間） */}
            {org.layers.map((layer, idx) => {
              if (idx === 0) return null;
              const prevLayer = org.layers[idx - 1];
              const upperRef = { current: layerRefs.current.get(prevLayer.id) ?? null } as React.RefObject<HTMLDivElement | null>;
              const lowerRef = { current: layerRefs.current.get(layer.id) ?? null } as React.RefObject<HTMLDivElement | null>;
              return (
                <LayerConnector
                  key={`conn-${prevLayer.id}-${layer.id}`}
                  upperRef={upperRef}
                  lowerRef={lowerRef}
                  containerRef={containerRef}
                />
              );
            })}

            {/* 層ブロック */}
            {org.layers.map((layer, idx) => (
              <div key={layer.id}>
                <div
                  ref={el => setLayerRef(layer.id, el)}
                >
                  <LayerBlock
                    layer={layer}
                    layerIndex={idx}
                    totalLayers={org.layers.length}
                    activeMemberMap={activeMemberMap}
                    project={project}
                    draggingId={draggingId}
                    overGroupId={overGroupId}
                    saving={saving}
                    addCandidatesForGroup={addCandidatesForGroup}
                    onDragOverGroup={handleDragOverGroup}
                    onDragLeaveGroup={handleDragLeaveGroup}
                    onDropGroup={handleDropGroup}
                    onRoleSave={handleRoleSave}
                    onRemoveMember={handleRemoveMember}
                    onAddMember={handleAddMember}
                    onLayerNameSave={name => handleLayerNameSave(layer.id, name)}
                    onDeleteLayer={() => handleDeleteLayer(layer.id)}
                    onAddGroup={() => handleAddGroup(layer.id)}
                    onGroupNameSave={(groupId, name) => handleGroupNameSave(layer.id, groupId, name)}
                    onDeleteGroup={groupId => handleDeleteGroup(layer.id, groupId)}
                  />
                </div>
                {/* 層間スペーサー */}
                {idx < org.layers.length - 1 && <div style={{ height: 40 }} />}
              </div>
            ))}

            {/* 層追加ボタン */}
            <div style={{ marginTop: 32 }}>
              <button
                onClick={handleAddLayer}
                style={{
                  fontSize: "12px", padding: "8px 18px",
                  borderRadius: "var(--radius-md)",
                  border: "1.5px dashed var(--color-border-primary)",
                  background: "transparent",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer", fontWeight: 500,
                }}
              >
                ＋ 層を追加
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
