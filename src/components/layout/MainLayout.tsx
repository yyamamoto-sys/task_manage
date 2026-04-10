// src/components/layout/MainLayout.tsx
import { useState, useMemo, useRef } from "react";
import { useTheme } from "../../hooks/useTheme";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, ViewMode, Task, TaskForce, ToDo, KeyResult, Quarter } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { KanbanView } from "../kanban/KanbanView";
import { AdminView } from "../admin/AdminView";
import { GanttView } from "../gantt/GanttView";
import { DashboardView } from "../dashboard/DashboardView";
import { ListView } from "../list/ListView";
import { ConsultationPanel } from "../consultation/ConsultationPanel";
import { GraphView } from "../graph/GraphView";
import { v4 as uuidv4 } from "uuid";
import { CustomSelect } from "../common/CustomSelect";

interface Props {
  currentUser: Member;
  onLogout: () => void;
}

const NAV_ITEMS: { view: ViewMode; label: string; shortLabel: string; icon: React.ReactNode; tooltip: string }[] = [
  { view: "dashboard", label: "ダッシュボード", shortLabel: "DB",   icon: <DashIcon />,   tooltip: "OKRの進捗・今週のタスク・期限アラートをまとめて確認できます" },
  { view: "kanban",    label: "カンバン",       shortLabel: "KB",   icon: <KanbanIcon />, tooltip: "タスクを「未着手／進行中／完了」の列でドラッグ&ドロップ管理できます" },
  { view: "gantt",     label: "ガント",         shortLabel: "GT",   icon: <GanttIcon />,  tooltip: "プロジェクトの期間とタスクの期日をカレンダー形式で一覧できます" },
  { view: "list",      label: "リスト",         shortLabel: "LT",   icon: <ListIcon />,   tooltip: "タスクを一覧形式で表示・絞り込み・CSV出力できます" },
  { view: "admin",     label: "管理",           shortLabel: "管理", icon: <AdminIcon />,  tooltip: "OKR・プロジェクト・メンバーの作成・編集・削除を行う設定画面です" },
];

export function MainLayout({ currentUser, onLogout }: Props) {
  const isMobile = useIsMobile();
  const { theme, toggle: toggleTheme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isConsultOpen, setIsConsultOpen] = useState(false);
  const [isGraphOpen,   setIsGraphOpen]   = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

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
        {isQuickAddOpen && (
          <QuickAddTaskModal currentUser={currentUser} projects={projects} onClose={() => setIsQuickAddOpen(false)} />
        )}
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

        {/* モバイル：タスク追加FAB */}
        <button
          onClick={() => setIsQuickAddOpen(true)}
          style={{
            position: "fixed", bottom: "68px", right: "16px", zIndex: 60,
            width: "44px", height: "44px", borderRadius: "50%",
            background: "var(--color-brand)", color: "#fff",
            border: "none", fontSize: "22px", lineHeight: 1,
            boxShadow: "var(--shadow-lg)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          title="タスクを追加"
        >＋</button>

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
      {isQuickAddOpen && (
        <QuickAddTaskModal currentUser={currentUser} projects={projects} onClose={() => setIsQuickAddOpen(false)} />
      )}
      {/* PCタスク追加FAB */}
      <button
        onClick={() => setIsQuickAddOpen(true)}
        style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 60,
          height: "40px", borderRadius: "var(--radius-full)",
          padding: "0 18px",
          background: "var(--color-brand)", color: "#fff",
          border: "none", fontSize: "13px", fontWeight: "600",
          boxShadow: "var(--shadow-lg)", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "6px",
          letterSpacing: "0.02em",
        }}
        title="タスクを追加"
      >
        <span style={{ fontSize: "16px", lineHeight: 1 }}>＋</span> タスク追加
      </button>
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
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenGraph={() => setIsGraphOpen(true)}
      />
      {mainContent}
      {isGraphOpen && <GraphView onClose={() => setIsGraphOpen(false)} />}
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
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenGraph: () => void;
}

function Sidebar({
  viewMode, setViewMode, projects,
  selectedProjectId, setSelectedProjectId,
  currentUser, onLogout, isConsultOpen, onOpenConsult,
  theme, onToggleTheme, onOpenGraph,
}: SidebarProps) {
  const [labOpen, setLabOpen] = useState(false);
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
        {NAV_ITEMS.map(({ view, label, icon, tooltip }) => (
          <NavItem
            key={view}
            active={viewMode === view}
            icon={icon}
            label={label}
            tooltip={tooltip}
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

      {/* ラボセクション */}
      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: "4px 6px" }}>
        <button
          onClick={() => setLabOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: "7px",
            padding: "6px 10px", background: "transparent", border: "none",
            cursor: "pointer", borderRadius: "6px",
            color: "var(--color-text-tertiary)", fontSize: "11px",
          }}
        >
          <span style={{ fontSize: "13px" }}>🧪</span>
          <span style={{ flex: 1, textAlign: "left" }}>ラボ</span>
          <span style={{ fontSize: "9px" }}>{labOpen ? "▴" : "▾"}</span>
        </button>
        {labOpen && (
          <NavItem
            active={false}
            icon={<GraphIcon />}
            label="関係グラフ"
            onClick={onOpenGraph}
          />
        )}
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
            onClick={onToggleTheme}
            style={{
              fontSize: "13px", color: "var(--color-text-tertiary)",
              background: "transparent", border: "none", cursor: "pointer", padding: "2px",
            }}
            title={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
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
  active, icon, label, onClick, color, tooltip,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
  tooltip?: string;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (!tooltip) return;
    const { clientX, clientY } = e;
    timerRef.current = setTimeout(() => {
      setTipPos({ x: clientX, y: clientY });
    }, 2000);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTipPos(null);
  };

  return (
    <>
      <button
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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
      {tipPos && tooltip && (
        <div style={{
          position: "fixed",
          left: tipPos.x + 12,
          top: tipPos.y - 10,
          zIndex: 9999,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          padding: "8px 12px",
          maxWidth: "220px",
          fontSize: "11px",
          color: "var(--color-text-secondary)",
          lineHeight: 1.5,
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "3px" }}>
            {label}
          </div>
          {tooltip}
        </div>
      )}
    </>
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
function GraphIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7"  cy="2"  r="1.5" fill="currentColor"/>
      <circle cx="2"  cy="10" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="10" r="1.5" fill="currentColor"/>
      <circle cx="7"  cy="7"  r="1.2" fill="currentColor" opacity="0.7"/>
      <line x1="7" y1="3.5" x2="7"  y2="5.8"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="3.5" x2="2"  y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="3.5" x2="12" y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="7"   x2="2"  y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="7"   x2="12" y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
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

/** ToDoに紐づかない「その他」選択肢の仮想ID。保存時に todo_ids からは除外する */
const TODO_OTHER_ID = "__other__";

// ===== グローバルタスク追加モーダル =====

function QuickAddTaskModal({ currentUser, projects, onClose }: {
  currentUser: Member;
  projects: Project[];
  onClose: () => void;
}) {
  const {
    saveTask, members: rawMembers, taskForces: rawTfs, todos: rawTodos,
    keyResults: rawKrs, objective, quarterlyObjectives, quarterlyKrTaskForces,
  } = useAppData();
  const members = useMemo(() => rawMembers.filter((m: Member) => !m.is_deleted), [rawMembers]);
  const tfs = useMemo(() => (rawTfs ?? []).filter((tf: TaskForce) => !tf.is_deleted), [rawTfs]);
  const todos = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const krs = useMemo(() => (rawKrs ?? []).filter((kr: KeyResult) => !kr.is_deleted), [rawKrs]);

  // 今日の日付から現在のQを計算（1Q=1-3月 / 2Q=4-6月 / 3Q=7-9月 / 4Q=10-12月）
  const currentQ = useMemo<Quarter>(() => {
    const m = new Date().getMonth() + 1;
    if (m <= 3) return "1Q";
    if (m <= 6) return "2Q";
    if (m <= 9) return "3Q";
    return "4Q";
  }, []);

  // 現在Qに属するTF IDのSet
  const currentQTfIds = useMemo(() => {
    const qObj = (quarterlyObjectives ?? []).find(
      q => q.quarter === currentQ && q.objective_id === (objective?.id ?? "") && !q.is_deleted
    );
    if (!qObj) return new Set<string>();
    return new Set(
      (quarterlyKrTaskForces ?? [])
        .filter(q => q.quarterly_objective_id === qObj.id)
        .map(q => q.tf_id)
    );
  }, [quarterlyObjectives, quarterlyKrTaskForces, objective, currentQ]);

  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [projectId, setProjectId] = useState("");
  const [krId, setKrId] = useState("");
  const [tfId, setTfId] = useState("");
  const [todoIds, setTodoIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [tooltipTodo, setTooltipTodo] = useState<ToDo | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // KRが変わったらTF・ToDo選択をリセット
  const handleKrChange = (val: string) => {
    setKrId(val);
    setTfId("");
    setTodoIds([]);
  };

  // TFが変わったらToDo選択をリセット
  const handleTfChange = (val: string) => {
    setTfId(val);
    setTodoIds([]);
  };

  // 現在QのKR一覧（TFが存在するKRのみ）
  const filteredKrs = useMemo(() => {
    return krs.filter(kr => {
      const krTfs = tfs.filter(tf => tf.kr_id === kr.id && (currentQTfIds.size === 0 || currentQTfIds.has(tf.id)));
      return krTfs.length > 0;
    });
  }, [krs, tfs, currentQTfIds]);

  // 選択中KRのTF一覧（TF番号順）
  const filteredTfs = useMemo(() => {
    if (!krId) return [];
    return tfs
      .filter(tf => tf.kr_id === krId && (currentQTfIds.size === 0 || currentQTfIds.has(tf.id)))
      .sort((a, b) => (parseInt(a.tf_number) || 0) - (parseInt(b.tf_number) || 0));
  }, [krId, tfs, currentQTfIds]);

  // 選択中TFに属するToDo一覧
  const filteredTodos = useMemo(
    () => tfId ? todos.filter(td => td.tf_id === tfId) : [],
    [tfId, todos],
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      name: name.trim(),
      project_id: projectId || null,
      todo_ids: todoIds.filter(id => id !== TODO_OTHER_ID),
      assignee_member_id: assigneeId,
      status: "todo",
      priority: null,
      due_date: dueDate || null,
      estimated_hours: null,
      comment: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    try {
      await saveTask(task);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // ToDoホバー時のツールチップ表示位置を計算（画面端で折り返す）
  const TOOLTIP_W = 280;
  const TOOLTIP_OFFSET = 16;
  const tooltipLeft = tooltipPos.x + TOOLTIP_OFFSET + TOOLTIP_W > window.innerWidth
    ? tooltipPos.x - TOOLTIP_W - TOOLTIP_OFFSET
    : tooltipPos.x + TOOLTIP_OFFSET;
  const tooltipTop = Math.min(tooltipPos.y - 8, window.innerHeight - 200);

  return (
    <>
      {/* ToDoホバーツールチップ（モーダル外・最前面） */}
      {tooltipTodo && (
        <div
          style={{
            position: "fixed",
            left: tooltipLeft,
            top: tooltipTop,
            zIndex: 500,
            width: TOOLTIP_W,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            padding: "10px 12px",
            pointerEvents: "none",
          }}
        >
          {tooltipTodo.name && (
            <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "6px" }}>
              {tooltipTodo.name}
            </div>
          )}
          <div style={{ fontSize: "12px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", lineHeight: 1.5, marginBottom: tooltipTodo.memo ? "6px" : 0 }}>
            {tooltipTodo.title}
          </div>
          {tooltipTodo.memo && (
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.4, borderTop: "1px solid var(--color-border-primary)", paddingTop: "6px", marginTop: "2px" }}>
              {tooltipTodo.memo}
            </div>
          )}
          {tooltipTodo.due_date && (
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
              期日: {tooltipTodo.due_date}
            </div>
          )}
        </div>
      )}
      {/* オーバーレイ */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)",
        }}
      />
      {/* モーダル本体 */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 201,
        transform: "translate(-50%, -50%)",
        width: "min(480px, calc(100vw - 32px))",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: "20px",
      }}>
        <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "16px" }}>
          タスクを追加
        </div>

        {/* タスク名 */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>タスク名 *</div>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="タスク名を入力..."
            maxLength={200}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
            style={{
              width: "100%", padding: "8px 12px", fontSize: "13px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          {/* 担当者 */}
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>担当者</div>
            <CustomSelect
              value={assigneeId}
              onChange={setAssigneeId}
              options={[
                { value: "", label: "（なし）" },
                ...members.map(m => ({ value: m.id, label: m.display_name })),
              ]}
              placeholder="担当者を選択..."
            />
          </div>

          {/* 期日 */}
          <div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>期日（任意）</div>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              style={{
                width: "100%", padding: "7px 10px", fontSize: "12px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
        </div>

        {/* KR選択 */}
        <div style={{ marginBottom: "10px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>KR（任意）</div>
          <CustomSelect
            value={krId}
            onChange={handleKrChange}
            options={[
              { value: "", label: "KRを選択..." },
              ...filteredKrs.map(kr => ({ value: kr.id, label: kr.title })),
            ]}
            placeholder="KRを選択..."
          />
        </div>

        {/* タスクフォース（KR選択後に表示） */}
        {krId && (
          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>タスクフォース（任意）</div>
            <CustomSelect
              value={tfId}
              onChange={handleTfChange}
              options={[
                { value: "", label: "タスクフォースを選択..." },
                ...filteredTfs.map(tf => ({
                  value: tf.id,
                  label: `${tf.tf_number ? `TF ${tf.tf_number}` : ""}${tf.tf_number && tf.name ? " — " : ""}${tf.name}`,
                })),
              ]}
              placeholder="タスクフォースを選択..."
            />
          </div>
        )}

        {/* ToDo（TF選択時のみ・複数選択可） */}
        {tfId && (
          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
              ToDo（複数選択可）
            </div>
            <div style={{
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              padding: "6px 10px",
              maxHeight: "140px",
              overflowY: "auto",
              background: "var(--color-bg-primary)",
            }}>
              {filteredTodos.map((td) => (
                <label
                  key={td.id}
                  onMouseEnter={e => { setTooltipTodo(td); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltipTodo(null)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: "7px",
                    padding: "4px 0", cursor: "pointer",
                    fontSize: "12px", color: "var(--color-text-primary)",
                    borderBottom: "1px solid var(--color-border-primary)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={todoIds.includes(td.id)}
                    onChange={e => setTodoIds(prev =>
                      e.target.checked ? [...prev, td.id] : prev.filter(id => id !== td.id)
                    )}
                    style={{ marginTop: "2px", flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
                  />
                  <span style={{ lineHeight: 1.4 }}>
                    {(() => {
                      const label = td.name || td.title.split("\n")[0];
                      return label.length > 60 ? label.slice(0, 60) + "…" : label;
                    })()}
                  </span>
                </label>
              ))}
              {/* その他（常に末尾に表示） */}
              <label style={{
                display: "flex", alignItems: "center", gap: "7px",
                padding: "4px 0", cursor: "pointer",
                fontSize: "12px", color: "var(--color-text-secondary)",
              }}>
                <input
                  type="checkbox"
                  checked={todoIds.includes(TODO_OTHER_ID)}
                  onChange={e => setTodoIds(prev =>
                    e.target.checked ? [...prev, TODO_OTHER_ID] : prev.filter(id => id !== TODO_OTHER_ID)
                  )}
                  style={{ flexShrink: 0, accentColor: "var(--color-brand-primary)" }}
                />
                <span>その他</span>
              </label>
            </div>
          </div>
        )}

        {/* プロジェクト */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>プロジェクト（任意）</div>
          <CustomSelect
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: "", label: "プロジェクトを選択..." },
              ...projects.map(p => ({ value: p.id, label: p.name })),
            ]}
            placeholder="プロジェクトを選択..."
          />
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>キャンセル</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
          >
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      </div>
    </>
  );
}

