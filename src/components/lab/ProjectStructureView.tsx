// src/components/lab/ProjectStructureView.tsx
//
// 【設計意図】
// ラボ機能：PJの体制図をフリーフォームキャンバスで表示・編集する。
// カードを自由にドラッグ配置し、カード間に矢印線を手動で引ける（miro風）。
// 座標・エッジはlocalStorageに保存し、PJ切替時に復元する。

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";

interface Props {
  onClose: () => void;
  currentUser: Member;
}

// ===== レイアウトのデータ構造 =====

interface NodePos { x: number; y: number; }
interface Edge { id: string; from: string; to: string; }

interface StructureLayout {
  pjId: string;
  nodes: Record<string, NodePos>; // key = memberId
  edges: Edge[];
}

const LAYOUT_KEY = "structure_layout_v1";

function loadLayout(pjId: string): StructureLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const all: Record<string, StructureLayout> = JSON.parse(raw);
    return all[pjId] ?? null;
  } catch {
    return null;
  }
}

function saveLayout(layout: StructureLayout) {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const all: Record<string, StructureLayout> = raw ? JSON.parse(raw) : {};
    all[layout.pjId] = layout;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch {
    // ストレージ失敗は黙って無視
  }
}

// ===== カードのサイズ定数 =====
const CARD_W = 140;
const CARD_H = 110; // 大まかな高さ（ドラッグ用）

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
  onChangeOwner: () => void;
  saving: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onHandleMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
}

function OwnerCard({
  member, role, onRoleSave, onChangeOwner, saving,
  onMouseDown, onHandleMouseDown, isDragging,
}: OwnerCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={onMouseDown}
      style={{
        position: "relative", width: CARD_W,
        padding: "12px 14px", boxSizing: "border-box",
        background: "var(--color-brand-light, rgba(99,102,241,0.08))",
        border: "2px solid var(--color-brand)",
        borderRadius: "var(--radius-md)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        flexShrink: 0, cursor: isDragging ? "grabbing" : "grab",
        boxShadow: hovered ? "0 4px 16px rgba(99,102,241,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
        transition: isDragging ? "none" : "box-shadow 0.15s",
        userSelect: "none",
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
      {hovered && !saving && !isDragging && (
        <button
          onClick={e => { e.stopPropagation(); onChangeOwner(); }}
          style={{
            position: "absolute", top: 6, right: 6,
            fontSize: "9px", padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-brand)",
            background: "var(--color-bg-primary)",
            color: "var(--color-brand)", cursor: "pointer", fontWeight: 600,
          }}
        >
          変更
        </button>
      )}
      {/* 線引きハンドル */}
      <EdgeHandle onMouseDown={onHandleMouseDown} hovered={hovered} />
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
  onMouseDown: (e: React.MouseEvent) => void;
  onHandleMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
}

function MemberCard({
  member, role, onRoleSave, onRemove, saving,
  onMouseDown, onHandleMouseDown, isDragging,
}: MemberCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={onMouseDown}
      style={{
        position: "relative", width: CARD_W,
        padding: "12px 14px", boxSizing: "border-box",
        background: "var(--color-bg-secondary)",
        border: `1.5px solid ${hovered ? "var(--color-brand)" : "var(--color-border-primary)"}`,
        borderRadius: "var(--radius-md)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        flexShrink: 0, cursor: isDragging ? "grabbing" : "grab",
        boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.10)" : "0 1px 3px rgba(0,0,0,0.05)",
        transition: isDragging ? "none" : "box-shadow 0.15s, border-color 0.15s",
        userSelect: "none",
      }}
    >
      <Avatar member={member} size={36} />
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginTop: 2, textAlign: "center" }}>
        {member.display_name}
      </div>
      <RoleInput value={role} placeholder="役割を入力…" onSave={onRoleSave} />
      {hovered && !saving && !isDragging && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="メンバーを外す"
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
      {/* 線引きハンドル */}
      <EdgeHandle onMouseDown={onHandleMouseDown} hovered={hovered} />
    </div>
  );
}

// ===== EdgeHandle（各カード下端の接続ハンドル） =====

function EdgeHandle({ onMouseDown, hovered }: {
  onMouseDown: (e: React.MouseEvent) => void;
  hovered: boolean;
}) {
  const [handleHovered, setHandleHovered] = useState(false);
  return (
    <div
      onMouseDown={e => { e.stopPropagation(); onMouseDown(e); }}
      onMouseEnter={() => setHandleHovered(true)}
      onMouseLeave={() => setHandleHovered(false)}
      title="ドラッグして別カードへ線を引く"
      style={{
        position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
        width: 12, height: 12, borderRadius: "50%",
        background: handleHovered ? "var(--color-brand)" : "var(--color-border-primary)",
        border: "2px solid var(--color-bg-primary)",
        cursor: "crosshair", zIndex: 2,
        opacity: hovered || handleHovered ? 1 : 0,
        transition: "opacity 0.15s, background 0.15s",
      }}
    />
  );
}

// ===== キャンバスのSVGレイヤー =====

interface CanvasSVGProps {
  edges: Edge[];
  nodes: Record<string, NodePos>;
  allMemberIds: string[]; // ownerIds + memberIds
  draggingEdge: DraggingEdge | null;
  onEdgeRightClick: (edgeId: string, e: React.MouseEvent) => void;
}

interface DraggingEdge {
  fromId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

// カードの下端中央座標を計算
function edgePoint(id: string, nodes: Record<string, NodePos>): { x: number; y: number } {
  const pos = nodes[id];
  if (!pos) return { x: 0, y: 0 };
  return { x: pos.x + CARD_W / 2, y: pos.y + CARD_H };
}
// カードの上端中央座標を計算（矢印終点）
function arrowEndPoint(id: string, nodes: Record<string, NodePos>): { x: number; y: number } {
  const pos = nodes[id];
  if (!pos) return { x: 0, y: 0 };
  return { x: pos.x + CARD_W / 2, y: pos.y };
}

function CanvasSVG({ edges, nodes, allMemberIds, draggingEdge, onEdgeRightClick }: CanvasSVGProps) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
    >
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="var(--color-border-primary)" />
        </marker>
        <marker id="arrow-drag" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="var(--color-brand)" />
        </marker>
      </defs>

      {/* 確定済みエッジ */}
      {edges.map(edge => {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        if (!from || !to) return null;
        const start = edgePoint(edge.from, nodes);
        const end = arrowEndPoint(edge.to, nodes);
        return (
          <line
            key={edge.id}
            x1={start.x} y1={start.y}
            x2={end.x} y2={end.y}
            stroke="var(--color-border-primary)"
            strokeWidth={2}
            markerEnd="url(#arrow)"
            style={{ pointerEvents: "stroke", cursor: "context-menu" }}
            onContextMenu={e => { e.preventDefault(); onEdgeRightClick(edge.id, e); }}
          />
        );
      })}

      {/* ドラッグ中の仮線 */}
      {draggingEdge && (
        <line
          x1={draggingEdge.fromX} y1={draggingEdge.fromY}
          x2={draggingEdge.toX} y2={draggingEdge.toY}
          stroke="var(--color-brand)"
          strokeWidth={2}
          strokeDasharray="6 3"
          markerEnd="url(#arrow-drag)"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* 未使用変数エラー抑制 */}
      {allMemberIds.length === 0 && null}
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
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);

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

  const allMemberIds = useMemo(() => [...ownerIds, ...memberIds], [ownerIds, memberIds]);

  const addCandidates = useMemo<Member[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    const memberSet = new Set(memberIds);
    return members.filter(m => !m.is_deleted && !ownerSet.has(m.id) && !memberSet.has(m.id));
  }, [members, ownerIds, memberIds, project]);

  const ownerCandidates = useMemo<Member[]>(() => {
    if (!project) return [];
    const ownerSet = new Set(ownerIds);
    return members.filter(m => !m.is_deleted && !ownerSet.has(m.id));
  }, [members, ownerIds, project]);

  // ===== キャンバス状態 =====

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ノード座標
  const [nodes, setNodes] = useState<Record<string, NodePos>>({});
  // エッジ（接続線）
  const [edges, setEdges] = useState<Edge[]>([]);

  // パン（背景移動）
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // カードドラッグ状態
  const draggingCardRef = useRef<{
    id: string;
    startMouseX: number;
    startMouseY: number;
    startCardX: number;
    startCardY: number;
  } | null>(null);
  const isDraggingCardRef = useRef(false);

  // パン状態
  const panningRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  // 線引き状態
  const [draggingEdge, setDraggingEdge] = useState<DraggingEdge | null>(null);
  const draggingEdgeRef = useRef<DraggingEdge | null>(null);
  const edgeFromIdRef = useRef<string | null>(null);

  // ドラッグ中かどうか（クリックイベント抑制用）
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  // ===== レイアウト初期化 =====

  const buildInitialLayout = useCallback((ids: string[], canvasW: number): Record<string, NodePos> => {
    const result: Record<string, NodePos> = {};
    // ownerIds を先頭に配置
    const ownerCount = ownerIds.length;
    const memberCount = ids.length - ownerCount;

    // オーナー行（上部中央）
    ownerIds.forEach((id, i) => {
      const total = ownerCount;
      const startX = canvasW / 2 - (total * (CARD_W + 20)) / 2 + 10;
      result[id] = { x: startX + i * (CARD_W + 20), y: 60 };
    });

    // メンバー行（オーナーの下）
    const memberIdsLocal = ids.filter(id => !ownerIds.includes(id));
    memberIdsLocal.forEach((id, i) => {
      const total = memberCount || 1;
      const startX = canvasW / 2 - (total * (CARD_W + 20)) / 2 + 10;
      result[id] = { x: startX + i * (CARD_W + 20), y: 230 };
    });

    return result;
  }, [ownerIds]);

  // PJ選択変更時にレイアウトを復元or初期化
  useEffect(() => {
    if (!selectedPjId || allMemberIds.length === 0) {
      setNodes({});
      setEdges([]);
      return;
    }

    const saved = loadLayout(selectedPjId);
    if (saved) {
      // 保存済みレイアウト：新メンバー分を補完
      const newNodes: Record<string, NodePos> = { ...saved.nodes };
      allMemberIds.forEach((id, i) => {
        if (!newNodes[id]) {
          // 新規メンバーは右下に配置
          const canvasW = canvasContainerRef.current?.clientWidth ?? 800;
          newNodes[id] = { x: canvasW - CARD_W - 20, y: 60 + i * (CARD_H + 20) };
        }
      });
      // 削除済みメンバーのノードを除去
      const validIds = new Set(allMemberIds);
      Object.keys(newNodes).forEach(id => { if (!validIds.has(id)) delete newNodes[id]; });
      setNodes(newNodes);
      // 削除済みメンバーに紐づくエッジを除去
      setEdges(saved.edges.filter(e => validIds.has(e.from) && validIds.has(e.to)));
    } else {
      // 初回：自動配置
      const canvasW = canvasContainerRef.current?.clientWidth ?? 800;
      setNodes(buildInitialLayout(allMemberIds, canvasW));
      setEdges([]);
    }

    // パンをリセット
    setPanX(0);
    setPanY(0);
  }, [selectedPjId]); // eslint-disable-line react-hooks/exhaustive-deps
  // buildInitialLayout は ownerIds に依存するが、PJ変更時だけ実行したい

  // nodes/edges を localStorage に保存（変更のたびに）
  useEffect(() => {
    if (!selectedPjId || Object.keys(nodes).length === 0) return;
    saveLayout({ pjId: selectedPjId, nodes, edges });
  }, [nodes, edges, selectedPjId]);

  // ===== Escキーで線引きキャンセル =====

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        edgeFromIdRef.current = null;
        draggingEdgeRef.current = null;
        setDraggingEdge(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ===== グローバルmousemove / mouseup =====

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // カードドラッグ
      if (draggingCardRef.current) {
        isDraggingCardRef.current = true;
        const drag = draggingCardRef.current;
        const dx = e.clientX - drag.startMouseX;
        const dy = e.clientY - drag.startMouseY;
        setNodes(prev => ({
          ...prev,
          [drag.id]: { x: drag.startCardX + dx, y: drag.startCardY + dy },
        }));
        return;
      }

      // パン
      if (panningRef.current) {
        const dx = e.clientX - panningRef.current.startMouseX;
        const dy = e.clientY - panningRef.current.startMouseY;
        setPanX(panningRef.current.startPanX + dx);
        setPanY(panningRef.current.startPanY + dy);
        return;
      }

      // 線引きドラッグ
      if (edgeFromIdRef.current !== null && canvasContainerRef.current) {
        const rect = canvasContainerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - panX;
        const mouseY = e.clientY - rect.top - panY;
        const fromPos = nodes[edgeFromIdRef.current];
        if (fromPos) {
          const newDragEdge: DraggingEdge = {
            fromId: edgeFromIdRef.current,
            fromX: fromPos.x + CARD_W / 2,
            fromY: fromPos.y + CARD_H,
            toX: mouseX,
            toY: mouseY,
          };
          draggingEdgeRef.current = newDragEdge;
          setDraggingEdge(newDragEdge);
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      // カードドラッグ終了
      if (draggingCardRef.current) {
        draggingCardRef.current = null;
        // 少し遅らせてからdraggingCardIdをクリア（クリックイベント抑制のため）
        setTimeout(() => {
          isDraggingCardRef.current = false;
          setDraggingCardId(null);
        }, 50);
        return;
      }

      // パン終了
      if (panningRef.current) {
        panningRef.current = null;
        return;
      }

      // 線引き終了：ターゲットカードを探す
      if (edgeFromIdRef.current !== null) {
        const fromId = edgeFromIdRef.current;
        edgeFromIdRef.current = null;
        draggingEdgeRef.current = null;
        setDraggingEdge(null);

        // マウス位置からカードを探す
        if (canvasContainerRef.current) {
          const rect = canvasContainerRef.current.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - panX;
          const mouseY = e.clientY - rect.top - panY;

          const toId = Object.entries(nodes).find(([id, pos]) => {
            return (
              id !== fromId &&
              mouseX >= pos.x && mouseX <= pos.x + CARD_W &&
              mouseY >= pos.y && mouseY <= pos.y + CARD_H
            );
          })?.[0];

          if (toId) {
            // self-loop・重複チェック
            setEdges(prev => {
              const exists = prev.some(edge => edge.from === fromId && edge.to === toId);
              if (exists) return prev;
              return [...prev, { id: `${fromId}_${toId}_${Date.now()}`, from: fromId, to: toId }];
            });
          }
        }
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [nodes, panX, panY]);

  // ===== イベントハンドラ =====

  const handleCardMouseDown = useCallback((id: string) => (e: React.MouseEvent) => {
    // 右クリックは無視
    if (e.button !== 0) return;
    e.stopPropagation();
    const pos = nodes[id];
    if (!pos) return;
    setDraggingCardId(id);
    draggingCardRef.current = {
      id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startCardX: pos.x,
      startCardY: pos.y,
    };
  }, [nodes]);

  const handleHandleMouseDown = useCallback((id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    edgeFromIdRef.current = id;
    const pos = nodes[id];
    if (pos) {
      const initDrag: DraggingEdge = {
        fromId: id,
        fromX: pos.x + CARD_W / 2,
        fromY: pos.y + CARD_H,
        toX: pos.x + CARD_W / 2,
        toY: pos.y + CARD_H,
      };
      draggingEdgeRef.current = initDrag;
      setDraggingEdge(initDrag);
    }
  }, [nodes]);

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 左クリックのみパン開始
    if (e.button !== 0) return;
    panningRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPanX: panX,
      startPanY: panY,
    };
  };

  const handleEdgeRightClick = useCallback((edgeId: string, _e: React.MouseEvent) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId));
  }, []);

  // ===== 配置リセット =====

  const handleResetLayout = () => {
    const canvasW = canvasContainerRef.current?.clientWidth ?? 800;
    setNodes(buildInitialLayout(allMemberIds, canvasW));
  };

  const handleClearEdges = () => {
    setEdges([]);
  };

  // ===== PJ保存処理 =====

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
    doSave({ ...project, member_roles: { ...(project.member_roles ?? {}), [memberId]: role } });
  };

  const handleRemoveMember = (memberId: string) => {
    if (!project) return;
    const newMemberIds = (project.member_ids ?? []).filter(id => id !== memberId);
    const newRoles = { ...(project.member_roles ?? {}) };
    delete newRoles[memberId];
    doSave({ ...project, member_ids: newMemberIds, member_roles: newRoles });
    // ノードとエッジからも削除
    setNodes(prev => { const n = { ...prev }; delete n[memberId]; return n; });
    setEdges(prev => prev.filter(e => e.from !== memberId && e.to !== memberId));
  };

  const handleAddMember = (memberId: string) => {
    if (!project) return;
    setShowAddDropdown(false);
    const newMemberIds = [...(project.member_ids ?? []), memberId];
    doSave({ ...project, member_ids: newMemberIds });
    // 新しいノードを追加（右下に仮配置）
    const canvasW = canvasContainerRef.current?.clientWidth ?? 800;
    setNodes(prev => ({
      ...prev,
      [memberId]: { x: canvasW - CARD_W - 40, y: 60 + Object.keys(prev).length * (CARD_H + 20) },
    }));
  };

  const handleChangeOwner = (newOwnerId: string) => {
    if (!project) return;
    setShowOwnerDropdown(false);
    doSave({ ...project, owner_member_id: newOwnerId, owner_member_ids: [newOwnerId] });
  };

  // ===== レンダリング =====

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "var(--color-bg-primary)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* ヘッダー */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-secondary)",
      }}>
        <span style={{ fontSize: "15px" }}>🏢</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>PJ体制図</span>
        <select
          value={selectedPjId}
          onChange={e => {
            setSelectedPjId(e.target.value);
            setShowAddDropdown(false);
            setShowOwnerDropdown(false);
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
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          役割をクリックして編集
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

      {/* PJ目的 */}
      {project?.purpose && (
        <div style={{
          flexShrink: 0, padding: "6px 16px",
          fontSize: "12px", color: "var(--color-text-secondary)",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {project.purpose}
        </div>
      )}

      {/* ツールバー */}
      {project && allMemberIds.length > 0 && (
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-secondary)",
        }}>
          <button
            onClick={handleResetLayout}
            style={{
              fontSize: "11px", padding: "3px 10px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            リセット配置
          </button>
          <button
            onClick={handleClearEdges}
            disabled={edges.length === 0}
            style={{
              fontSize: "11px", padding: "3px 10px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-primary)",
              color: edges.length === 0 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
              cursor: edges.length === 0 ? "default" : "pointer",
              opacity: edges.length === 0 ? 0.5 : 1,
            }}
          >
            線をすべて消す
          </button>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginLeft: 4 }}>
            カード下端の丸をドラッグして線を引く / 線を右クリックで削除 / 背景ドラッグでパン / Escで線引きキャンセル
          </div>
        </div>
      )}

      {/* エラーバー */}
      {saveError && (
        <div style={{
          flexShrink: 0, padding: "8px 16px",
          background: "var(--color-bg-danger, #fef2f2)",
          color: "var(--color-text-danger, #b91c1c)",
          fontSize: "12px", borderBottom: "1px solid var(--color-border-primary)",
        }}>
          {saveError}
        </div>
      )}

      {/* ドロップダウン外側クリックで閉じるオーバーレイ */}
      {(showOwnerDropdown || showAddDropdown) && (
        <div
          onClick={() => { setShowOwnerDropdown(false); setShowAddDropdown(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 9 }}
        />
      )}

      {/* キャンバス本体 */}
      <div
        ref={canvasContainerRef}
        onMouseDown={handleCanvasMouseDown}
        style={{
          flex: 1, position: "relative", overflow: "hidden",
          cursor: panningRef.current ? "grabbing" : "default",
        }}
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
          <div
            style={{
              position: "absolute", inset: 0,
              transform: `translate(${panX}px, ${panY}px)`,
            }}
          >
            {/* SVGレイヤー（線・矢印） */}
            <CanvasSVG
              edges={edges}
              nodes={nodes}
              allMemberIds={allMemberIds}
              draggingEdge={draggingEdge}
              onEdgeRightClick={handleEdgeRightClick}
            />

            {/* オーナーカード */}
            {ownerIds.map((ownerId, idx) => {
              const m = activeMemberMap.get(ownerId);
              const pos = nodes[ownerId];
              if (!m || !pos) return null;
              const role = project.member_roles?.[ownerId] ?? "";
              return (
                <div
                  key={ownerId}
                  style={{ position: "absolute", left: pos.x, top: pos.y, zIndex: draggingCardId === ownerId ? 20 : 5 }}
                >
                  {/* オーナー変更ドロップダウン（最初のオーナーのみ） */}
                  {idx === 0 && showOwnerDropdown && (
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
                          onClick={() => handleChangeOwner(mc.id)}
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
                        onClick={() => setShowOwnerDropdown(false)}
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

                  <OwnerCard
                    member={m}
                    role={role}
                    onRoleSave={v => handleRoleSave(ownerId, v)}
                    onChangeOwner={() => { setShowOwnerDropdown(v => !v); setShowAddDropdown(false); }}
                    saving={saving}
                    onMouseDown={handleCardMouseDown(ownerId)}
                    onHandleMouseDown={handleHandleMouseDown(ownerId)}
                    isDragging={draggingCardId === ownerId}
                  />
                </div>
              );
            })}

            {/* メンバーカード */}
            {memberIds.map(memberId => {
              const m = activeMemberMap.get(memberId);
              const pos = nodes[memberId];
              if (!m || !pos) return null;
              const role = project.member_roles?.[memberId] ?? "";
              return (
                <div
                  key={memberId}
                  style={{ position: "absolute", left: pos.x, top: pos.y, zIndex: draggingCardId === memberId ? 20 : 5 }}
                >
                  <MemberCard
                    member={m}
                    role={role}
                    onRoleSave={v => handleRoleSave(memberId, v)}
                    onRemove={() => handleRemoveMember(memberId)}
                    saving={saving}
                    onMouseDown={handleCardMouseDown(memberId)}
                    onHandleMouseDown={handleHandleMouseDown(memberId)}
                    isDragging={draggingCardId === memberId}
                  />
                </div>
              );
            })}

            {/* メンバー追加ボタン（キャンバス内の固定位置） */}
            <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 10 }}>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => { setShowAddDropdown(v => !v); setShowOwnerDropdown(false); }}
                  disabled={saving || addCandidates.length === 0}
                  title={addCandidates.length === 0 ? "追加できるメンバーがいません" : "メンバーを追加"}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 14px",
                    border: "1.5px dashed var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-secondary)",
                    color: "var(--color-text-secondary)",
                    cursor: saving || addCandidates.length === 0 ? "not-allowed" : "pointer",
                    fontSize: "12px", fontWeight: 600,
                    opacity: addCandidates.length === 0 ? 0.45 : 1,
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                >
                  <span style={{ fontSize: "16px", lineHeight: 1 }}>＋</span>
                  <span>メンバーを追加</span>
                </button>

                {showAddDropdown && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 4px)", right: 0,
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
