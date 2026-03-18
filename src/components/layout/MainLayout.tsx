// src/components/layout/MainLayout.tsx
import { useState, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member, Project, ViewMode } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { KanbanView } from "../kanban/KanbanView";
import { AdminView } from "../admin/AdminView";
import { GanttView } from "../gantt/GanttView";
import { DashboardView } from "../dashboard/DashboardView";
import { ListView } from "../list/ListView";

interface Props {
  currentUser: Member;
  onLogout: () => void;
}

export function MainLayout({ currentUser, onLogout }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const { projects: allProjects } = useAppData();
  const projects = useMemo(
    () => allProjects.filter(p => !p.is_deleted && p.status === "active"),
    [allProjects]
  );

  const selectedProject = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId) ?? null
    : null;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* サイドバー */}
      <Sidebar
        viewMode={viewMode}
        setViewMode={setViewMode}
        projects={projects}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        currentUser={currentUser}
        onLogout={onLogout}
      />

      {/* メインエリア */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {viewMode === "dashboard" && (
          <DashboardView currentUser={currentUser} projects={projects} />
        )}
        {viewMode === "kanban" && (
          <KanbanView
            currentUser={currentUser}
            selectedProject={selectedProject}
            projects={projects}
          />
        )}
        {viewMode === "gantt" && (
          <GanttView
            currentUser={currentUser}
            selectedProject={selectedProject}
            projects={projects}
          />
        )}
        {viewMode === "admin" && (
          <AdminView currentUser={currentUser} />
        )}
        {viewMode === "list" && (
          <ListView
            currentUser={currentUser}
            selectedProject={selectedProject}
            projects={projects}
          />
        )}
        {viewMode !== "dashboard" && viewMode !== "kanban" && viewMode !== "gantt" && viewMode !== "list" && viewMode !== "admin" && (
          <ComingSoon view={viewMode} />
        )}
      </div>
    </div>
  );
}

// ===== サイドバー =====

interface SidebarProps {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  projects: Project[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  currentUser: Member;
  onLogout: () => void;
}

function Sidebar({
  viewMode, setViewMode, projects,
  selectedProjectId, setSelectedProjectId,
  currentUser, onLogout,
}: SidebarProps) {
  const navItems: { view: ViewMode; label: string; icon: React.ReactNode }[] = [
    { view: "dashboard", label: "ダッシュボード", icon: <DashIcon /> },
    { view: "kanban",    label: "カンバン",       icon: <KanbanIcon /> },
    { view: "gantt",     label: "ガント",         icon: <GanttIcon /> },
    { view: "list",      label: "リスト",         icon: <ListIcon /> },
    { view: "admin",     label: "管理",           icon: <AdminIcon /> },
  ];

  return (
    <div style={{
      width: "196px", flexShrink: 0,
      background: "var(--color-bg-secondary)",
      borderRight: "1px solid var(--color-border-primary)",
      display: "flex", flexDirection: "column",
    }}>
      {/* ロゴ */}
      <div style={{
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--color-border-primary)",
      }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>
          グループ計画管理
        </div>
        <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
          チーム計画管理ツール
        </div>
      </div>

      {/* ナビゲーション */}
      <div style={{ padding: "8px 0 4px" }}>
        <SectionLabel>メニュー</SectionLabel>
        {navItems.map(({ view, label, icon }) => (
          <NavItem
            key={view}
            active={viewMode === view}
            icon={icon}
            label={label}
            onClick={() => setViewMode(view)}
          />
        ))}
      </div>

      {/* プロジェクト一覧 */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        <SectionLabel>プロジェクト</SectionLabel>
        <NavItem
          active={selectedProjectId === null}
          icon={<span style={{ width: 8, height: 8, borderRadius: "50%", background: "#888780", display: "inline-block" }} />}
          label="全PJ表示"
          onClick={() => setSelectedProjectId(null)}
        />
        {projects.map(pj => (
          <NavItem
            key={pj.id}
            active={selectedProjectId === pj.id}
            icon={<span style={{ width: 7, height: 7, borderRadius: "50%", background: pj.color_tag, display: "inline-block" }} />}
            label={pj.name}
            onClick={() => setSelectedProjectId(pj.id)}
          />
        ))}
      </div>

      {/* フッター：AI相談 + ユーザー */}
      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: "8px 6px" }}>
        <NavItem
          active={false}
          icon={<AIIcon />}
          label="AIに変更を相談"
          onClick={() => {}} // TODO: AI相談パネルを開く
          color="var(--color-text-purple)"
        />
        <div style={{
          display: "flex", alignItems: "center", gap: "7px",
          padding: "7px 10px", marginTop: "2px",
        }}>
          <Avatar member={currentUser} size={22} />
          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", flex: 1 }}>
            {currentUser.short_name}
          </span>
          <button
            onClick={onLogout}
            style={{
              fontSize: "10px", color: "var(--color-text-tertiary)",
              background: "transparent", border: "none", cursor: "pointer", padding: "2px",
            }}
            title="ログアウト"
          >
            ⏏
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 小コンポーネント =====

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "6px 12px 3px",
      fontSize: "10px", fontWeight: "500",
      color: "var(--color-text-tertiary)", letterSpacing: "0.05em",
    }}>
      {children}
    </div>
  );
}

function NavItem({
  active, icon, label, onClick, color,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "6px 10px",
        background: active ? "var(--color-bg-primary)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-md)",
        margin: "1px 4px", width: "calc(100% - 8px)",
        fontSize: "11px",
        fontWeight: active ? "500" : "400",
        color: color ?? (active ? "var(--color-text-primary)" : "var(--color-text-secondary)"),
        cursor: "pointer", textAlign: "left",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      <span style={{ flexShrink: 0, opacity: active ? 1 : 0.6 }}>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
  );
}

function ComingSoon({ view }: { view: ViewMode }) {
  const labels: Record<ViewMode, string> = {
    dashboard: "ダッシュボード",
    kanban: "カンバン",
    gantt: "ガント",
    list: "リスト",
    admin: "管理画面",
  };
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: "8px", color: "var(--color-text-tertiary)",
    }}>
      <div style={{ fontSize: "24px" }}>🚧</div>
      <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-secondary)" }}>
        {labels[view]}ビュー
      </div>
      <div style={{ fontSize: "12px" }}>実装予定</div>
    </div>
  );
}

// ===== SVGアイコン =====
const DashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);
const KanbanIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <rect x="1" y="2" width="3" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="5.5" y="2" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="10" y="2" width="3" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);
const GanttIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="2" y="2.5" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.4"/>
    <rect x="5" y="5.5" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.4"/>
  </svg>
);
const ListIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <line x1="4" y1="3.5" x2="13" y2="3.5" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="4" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="4" y1="10.5" x2="13" y2="10.5" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="2" cy="3.5" r="1" fill="currentColor"/>
    <circle cx="2" cy="7" r="1" fill="currentColor"/>
    <circle cx="2" cy="10.5" r="1" fill="currentColor"/>
  </svg>
);
const AdminIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 12c0-2.8 2.2-4 5-4s5 1.2 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="11" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1"/>
    <path d="M11 9v1l.6.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
  </svg>
);
const AIIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M5 6c0-1.1.9-2 2-2s2 .9 2 2c0 .8-.5 1.5-1.2 1.8L7 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="7" cy="10.5" r="0.6" fill="currentColor"/>
  </svg>
);
