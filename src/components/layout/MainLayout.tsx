// src/components/layout/MainLayout.tsx
import { useState, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, ViewMode } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { KanbanView } from "../kanban/KanbanView";
import { AdminView } from "../admin/AdminView";
import { GanttView } from "../gantt/GanttView";
import { DashboardView } from "../dashboard/DashboardView";
import { ListView } from "../list/ListView";
import { ConsultationPanel } from "../consultation/ConsultationPanel";

interface Props {
  currentUser: Member;
  onLogout: () => void;
}

const NAV_ITEMS: { view: ViewMode; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { view: "dashboard", label: "ダッシュボード", shortLabel: "DB",    icon: <DashIcon /> },
  { view: "kanban",    label: "カンバン",       shortLabel: "KB",    icon: <KanbanIcon /> },
  { view: "gantt",     label: "ガント",         shortLabel: "GT",    icon: <GanttIcon /> },
  { view: "list",      label: "リスト",         shortLabel: "LT",    icon: <ListIcon /> },
  { view: "admin",     label: "管理",           shortLabel: "管理",  icon: <AdminIcon /> },
];

export function MainLayout({ currentUser, onLogout }: Props) {
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isConsultOpen, setIsConsultOpen] = useState(false);

  const { projects: allProjects } = useAppData();
  const projects = useMemo(
    () => allProjects.filter(p => !p.is_deleted && p.status === "active"),
    [allProjects]
  );

  const selectedProject = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId) ?? null
    : null;

  const mainContent = (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      paddingBottom: isMobile ? "56px" : 0,
    }}>
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
  );

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* モバイル：ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px",
          background: "var(--color-bg-primary)",
          borderBottom: "1px solid var(--color-border-primary)",
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>
            グループ計画管理
          </div>
          {/* プロジェクト選択（ドロップダウン） */}
          <select
            value={selectedProjectId ?? ""}
            onChange={e => setSelectedProjectId(e.target.value || null)}
            style={{
              fontSize: "11px", padding: "4px 8px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              color: "var(--color-text-secondary)",
              maxWidth: "120px",
            }}
          >
            <option value="">全PJ</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Avatar member={currentUser} size={28} />
          <button
            onClick={onLogout}
            style={{
              fontSize: "16px", background: "transparent", border: "none",
              cursor: "pointer", color: "var(--color-text-tertiary)", padding: "2px",
            }}
            title="ログアウト"
          >
            ⏏
          </button>
        </div>

        {mainContent}

        {/* モバイル：ボトムナビ */}
        <div
          className="bottom-nav-safe"
          style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            height: "56px",
            background: "var(--color-bg-primary)",
            borderTop: "1px solid var(--color-border-primary)",
            display: "flex",
            zIndex: 50,
          }}
        >
          {NAV_ITEMS.map(({ view, shortLabel, icon }) => {
            const active = viewMode === view;
            return (
              <button
                key={view}
                onClick={() => setViewMode(view)}
                style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "3px",
                  background: "transparent", border: "none", cursor: "pointer",
                  color: active ? "var(--color-brand)" : "var(--color-text-tertiary)",
                  fontSize: "9px", fontWeight: active ? "600" : "400",
                  transition: "color 0.1s",
                }}
              >
                <span style={{ opacity: active ? 1 : 0.6 }}>{icon}</span>
                <span>{shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // PC レイアウト
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        viewMode={viewMode}
        setViewMode={setViewMode}
        projects={projects}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        currentUser={currentUser}
        onLogout={onLogout}
        isConsultOpen={isConsultOpen}
        onOpenConsult={() => setIsConsultOpen(prev => !prev)}
      />
      {mainContent}
      {/* AIパネルをインライン横並びで配置。width遷移でコンテンツ幅が自然に縮む */}
      <div style={{
        width: isConsultOpen ? "400px" : "0",
        flexShrink: 0,
        overflow: "hidden",
        transition: "width 0.3s ease",
      }}>
        <ConsultationPanel
          isOpen={isConsultOpen}
          onClose={() => setIsConsultOpen(false)}
          currentUser={currentUser}
          inline
        />
      </div>
    </div>
  );
}

// ===== サイドバー（PC のみ）=====

interface SidebarProps {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  projects: Project[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  currentUser: Member;
  onLogout: () => void;
  isConsultOpen: boolean;
  onOpenConsult: () => void;
}

function Sidebar({
  viewMode, setViewMode, projects,
  selectedProjectId, setSelectedProjectId,
  currentUser, onLogout, isConsultOpen, onOpenConsult,
}: SidebarProps) {
  return (
    <div style={{
      width: "196px", flexShrink: 0,
      background: "var(--color-bg-secondary)",
      borderRight: "1px solid var(--color-border-primary)",
      display: "flex", flexDirection: "column",
    }}>
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

      <div style={{ padding: "8px 0 4px" }}>
        <SectionLabel>メニュー</SectionLabel>
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <NavItem
            key={view}
            active={viewMode === view}
            icon={icon}
            label={label}
            onClick={() => setViewMode(view)}
          />
        ))}
      </div>

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

      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: "8px 6px" }}>
        <NavItem
          active={isConsultOpen}
          icon={<AIIcon />}
          label={isConsultOpen ? "AIパネルを閉じる" : "AIに変更を相談"}
          onClick={onOpenConsult}
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
function DashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}
function KanbanIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="3" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="5.5" y="2" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="10" y="2" width="3" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}
function GanttIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="2.5" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.4"/>
      <rect x="5" y="5.5" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.4"/>
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <line x1="4" y1="3.5" x2="13" y2="3.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="4" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="4" y1="10.5" x2="13" y2="10.5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="2" cy="3.5" r="1" fill="currentColor"/>
      <circle cx="2" cy="7" r="1" fill="currentColor"/>
      <circle cx="2" cy="10.5" r="1" fill="currentColor"/>
    </svg>
  );
}
function AdminIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2 12c0-2.8 2.2-4 5-4s5 1.2 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="11" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1"/>
      <path d="M11 9v1l.6.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
    </svg>
  );
}
function AIIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 6c0-1.1.9-2 2-2s2 .9 2 2c0 .8-.5 1.5-1.2 1.8L7 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="7" cy="10.5" r="0.6" fill="currentColor"/>
    </svg>
  );
}
