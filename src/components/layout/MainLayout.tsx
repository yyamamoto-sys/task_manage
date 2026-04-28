// src/components/layout/MainLayout.tsx
import { useState, useMemo, useRef } from "react";
import { useTheme } from "../../hooks/useTheme";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, ViewMode, KeyResult, TaskForce, TaskTaskForce } from "../../lib/localData/types";
import { TaskEditModal } from "../task/TaskEditModal";
import { Avatar } from "../auth/UserSelectScreen";
import { KanbanView } from "../kanban/KanbanView";
import { AdminView } from "../admin/AdminView";
import { GanttView } from "../gantt/GanttView";
import { DashboardView } from "../dashboard/DashboardView";
import { ListView } from "../list/ListView";
import { ConsultationPanel } from "../consultation/ConsultationPanel";
import { GraphView } from "../graph/GraphView";
import { KrReportPanel } from "../lab/KrReportPanel";
import { KrSessionPanel } from "../lab/KrSessionPanel";
import { CustomSelect } from "../common/CustomSelect";
import { ErrorBar } from "../common/ErrorBar";
import { DashIcon, KanbanIcon, GanttIcon, ListIcon, AdminIcon, GraphIcon, AIIcon } from "../common/icons/NavIcons";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";

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
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => (localStorage.getItem("plan_app_view") as ViewMode | null) ?? "dashboard"
  );
  const setViewMode = (v: ViewMode) => {
    localStorage.setItem("plan_app_view", v);
    setViewModeState(v);
  };
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isConsultOpen, setIsConsultOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem("sidebar_collapsed") === "1"
  );
  const toggleSidebar = () => setIsSidebarCollapsed(prev => {
    const next = !prev;
    localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
    return next;
  });
  const [consultPanelWidth, setConsultPanelWidth] = useState(() => {
    try { return Math.min(800, Math.max(300, parseInt(localStorage.getItem("consultation_panel_width") ?? "400", 10) || 400)); } catch { return 400; }
  });
  const [isGraphOpen,   setIsGraphOpen]   = useState(false);
  const [isKrReportOpen, setIsKrReportOpen] = useState(false);
  const [isKrSessionOpen, setIsKrSessionOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [graphEditTaskId, setGraphEditTaskId] = useState<string | null>(null);
  const [aiEditTaskId, setAiEditTaskId] = useState<string | null>(null);

  const { projects: allProjects, keyResults: rawKrs, taskForces: rawTfs, taskTaskForces: rawTtfs } = useAppData();
  const projects = useMemo(
    () => allProjects.filter(p => !p.is_deleted && p.status === "active"),
    [allProjects]
  );
  const keyResults = useMemo(() => (rawKrs ?? []).filter((kr: KeyResult) => !kr.is_deleted), [rawKrs]);

  const [selectedKrId, setSelectedKrId] = useState<string | null>(null);

  const handleSelectProject = (id: string | null) => {
    setSelectedProjectId(id);
    setSelectedKrId(null);
  };
  const handleSelectKr = (id: string | null) => {
    setSelectedKrId(id);
    setSelectedProjectId(null);
  };

  const selectedProject = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId) ?? null
    : null;

  const krTaskIds = useMemo<Set<string> | null>(() => {
    if (!selectedKrId) return null;
    const tfIds = new Set((rawTfs ?? []).filter((tf: TaskForce) => tf.kr_id === selectedKrId && !tf.is_deleted).map((tf: TaskForce) => tf.id));
    const ids = new Set<string>();
    (rawTtfs ?? []).forEach((ttf: TaskTaskForce) => { if (tfIds.has(ttf.tf_id)) ids.add(ttf.task_id); });
    return ids;
  }, [selectedKrId, rawTfs, rawTtfs]);

  const mainContent = (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      paddingBottom: isMobile ? "56px" : 0,
    }}>
      {/* key={viewMode} でビュー切り替え時に animate-fadeIn が毎回発火する */}
      <div key={viewMode} className="animate-fadeIn" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        {viewMode === "dashboard" && (
          <DashboardView currentUser={currentUser} projects={projects} />
        )}
        {viewMode === "kanban" && (
          <KanbanView
            currentUser={currentUser}
            selectedProject={selectedProject}
            projects={projects}
            selectedKrId={selectedKrId}
            krTaskIds={krTaskIds}
          />
        )}
        {viewMode === "gantt" && (
          <GanttView
            currentUser={currentUser}
            selectedProject={selectedProject}
            projects={projects}
            selectedKrId={selectedKrId}
            krTaskIds={krTaskIds}
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
            selectedKrId={selectedKrId}
            krTaskIds={krTaskIds}
          />
        )}
        {viewMode !== "dashboard" && viewMode !== "kanban" && viewMode !== "gantt" && viewMode !== "list" && viewMode !== "admin" && (
          <ComingSoon view={viewMode} />
        )}
      </div>
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
        <ErrorBar />
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
          position: "fixed", bottom: "24px",
          right: isConsultOpen ? `${consultPanelWidth + 24}px` : "24px",
          transition: "right 0.3s ease",
          zIndex: 60,
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
        onSelectProject={handleSelectProject}
        keyResults={keyResults}
        selectedKrId={selectedKrId}
        onSelectKr={handleSelectKr}
        currentUser={currentUser}
        onLogout={onLogout}
        isConsultOpen={isConsultOpen}
        onOpenConsult={() => setIsConsultOpen(prev => !prev)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenGraph={() => setIsGraphOpen(true)}
        onOpenKrReport={() => setIsKrReportOpen(true)}
        onOpenKrSession={() => setIsKrSessionOpen(true)}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      />
      {mainContent}
      {isGraphOpen && (
        <GraphView
          onClose={() => setIsGraphOpen(false)}
          currentUser={currentUser}
          onOpenTask={taskId => setGraphEditTaskId(taskId)}
        />
      )}
      {isKrReportOpen && (
        <KrReportPanel
          onClose={() => setIsKrReportOpen(false)}
          currentUser={currentUser}
        />
      )}
      {isKrSessionOpen && (
        <KrSessionPanel
          onClose={() => setIsKrSessionOpen(false)}
          currentUser={currentUser}
        />
      )}
      {graphEditTaskId && (
        <TaskEditModal
          taskId={graphEditTaskId}
          currentUser={currentUser}
          onClose={() => setGraphEditTaskId(null)}
        />
      )}
      {aiEditTaskId && (
        <TaskEditModal
          taskId={aiEditTaskId}
          currentUser={currentUser}
          onClose={() => setAiEditTaskId(null)}
        />
      )}
      <ErrorBar />
      {/* AIパネルをインライン横並びで配置。width遷移でコンテンツ幅が自然に縮む */}
      <div style={{
        width: isConsultOpen ? `${consultPanelWidth}px` : "0",
        flexShrink: 0,
        overflow: "hidden",
        transition: "width 0.3s ease",
      }}>
        <ConsultationPanel
          isOpen={isConsultOpen}
          onClose={() => setIsConsultOpen(false)}
          currentUser={currentUser}
          inline
          onWidthChange={setConsultPanelWidth}
          onOpenTask={setAiEditTaskId}
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
  onSelectProject: (id: string | null) => void;
  keyResults: KeyResult[];
  selectedKrId: string | null;
  onSelectKr: (id: string | null) => void;
  currentUser: Member;
  onLogout: () => void;
  isConsultOpen: boolean;
  onOpenConsult: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenGraph: () => void;
  onOpenKrReport: () => void;
  onOpenKrSession: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function Sidebar({
  viewMode, setViewMode, projects,
  selectedProjectId, onSelectProject,
  keyResults, selectedKrId, onSelectKr,
  currentUser, onLogout, isConsultOpen, onOpenConsult,
  theme, onToggleTheme, onOpenGraph, onOpenKrReport, onOpenKrSession,
  collapsed, onToggleCollapsed,
}: SidebarProps) {
  const [labOpen, setLabOpen] = useState(false);
  const c = collapsed; // 省略形

  return (
    <div style={{
      width: c ? "48px" : "196px",
      flexShrink: 0,
      background: "var(--color-bg-secondary)",
      borderRight: "1px solid var(--color-border-primary)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      transition: "width 0.2s ease",
    }}>

      {/* ロゴ・折りたたみボタン行 */}
      <div style={{
        padding: c ? "10px 0" : "10px 14px 10px",
        borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center",
        gap: "6px", flexShrink: 0,
      }}>
        {!c && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              グループ計画管理
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
              チーム計画管理ツール
            </div>
          </div>
        )}
        <button
          onClick={onToggleCollapsed}
          title={c ? "メニューを開く" : "メニューを閉じる"}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--color-text-tertiary)", padding: "4px",
            borderRadius: "var(--radius-sm)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            ...(c ? { width: "100%", justifyContent: "center" } : {}),
          }}
        >
          <CollapseIcon collapsed={c} />
        </button>
      </div>

      {/* メニュー */}
      <div style={{ padding: c ? "6px 0" : "8px 0 4px" }}>
        {!c && <SectionLabel>メニュー</SectionLabel>}
        {NAV_ITEMS.map(({ view, label, icon, tooltip }) => (
          <NavItem
            key={view}
            active={viewMode === view}
            icon={icon}
            label={label}
            tooltip={tooltip ?? label}
            onClick={() => setViewMode(view)}
            collapsed={c}
          />
        ))}
      </div>

      {/* プロジェクト一覧 */}
      <div style={{ flex: 1, overflow: "auto", padding: c ? "6px 0" : "4px 0" }}>
        {!c && <SectionLabel>プロジェクト</SectionLabel>}
        <NavItem
          active={selectedProjectId === null && selectedKrId === null}
          icon={<span style={{ width: 8, height: 8, borderRadius: "50%", background: "#888780", display: "inline-block" }} />}
          label="全PJ表示"
          tooltip="全PJ表示"
          onClick={() => onSelectProject(null)}
          collapsed={c}
        />
        {projects.map(pj => (
          <NavItem
            key={pj.id}
            active={selectedProjectId === pj.id}
            icon={<span style={{ width: 7, height: 7, borderRadius: "50%", background: pj.color_tag, display: "inline-block" }} />}
            label={pj.name}
            tooltip={pj.name}
            onClick={() => onSelectProject(pj.id)}
            collapsed={c}
          />
        ))}

        {keyResults.length > 0 && (
          <>
            {!c && <SectionLabel>OKRタスク</SectionLabel>}
            {keyResults.map(kr => (
              <NavItem
                key={kr.id}
                active={selectedKrId === kr.id}
                icon={<KrIcon />}
                label={kr.title}
                tooltip={kr.title}
                onClick={() => onSelectKr(selectedKrId === kr.id ? null : kr.id)}
                collapsed={c}
              />
            ))}
          </>
        )}
      </div>

      {/* ラボセクション */}
      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "4px 0" : "4px 6px" }}>
        {c ? (
          <button
            onClick={() => { setLabOpen(o => !o); }}
            title="ラボ"
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              padding: "7px 0", background: "transparent", border: "none",
              cursor: "pointer", borderRadius: "6px",
              color: "var(--color-text-tertiary)", fontSize: "15px",
            }}
          >
            🧪
          </button>
        ) : (
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
        )}
        {labOpen && (
          <>
            <NavItem
              active={false}
              icon={<GraphIcon />}
              label="関係グラフ"
              tooltip="関係グラフ"
              onClick={onOpenGraph}
              collapsed={c}
            />
            <NavItem
              active={false}
              icon={<span style={{ fontSize: "13px" }}>🗓️</span>}
              label="KRセッション記録"
              tooltip="文字起こしを貼り付けてチェックイン・ウィンセッションを記録"
              onClick={onOpenKrSession}
              collapsed={c}
            />
            <NavItem
              active={false}
              icon={<span style={{ fontSize: "13px" }}>📊</span>}
              label="KRレポート生成"
              tooltip="チェックイン・ウィンセッションの議事メモからKRレポートをAI生成"
              onClick={onOpenKrReport}
              collapsed={c}
            />
          </>
        )}
      </div>

      {/* AI相談・ユーザー情報 */}
      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "6px 4px" : "8px 6px" }}>
        <button
          onClick={onOpenConsult}
          title={isConsultOpen ? "AIパネルを閉じる" : "AIに変更を相談"}
          style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: c ? "center" : "flex-start",
            gap: "8px",
            padding: c ? "9px 0" : "9px 12px",
            background: isConsultOpen
              ? "linear-gradient(135deg, #7c3aed, #5b21b6)"
              : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
            border: "none",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            color: "#fff",
            fontSize: "11px", fontWeight: "600",
            boxShadow: "0 2px 8px rgba(124,58,237,0.35)",
            marginBottom: "2px",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          <AIIcon />
          {!c && <span>{isConsultOpen ? "AIパネルを閉じる" : "AIに変更を相談"}</span>}
        </button>
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: c ? "center" : "flex-start",
          gap: c ? "0" : "7px",
          padding: c ? "6px 0" : "7px 10px",
          marginTop: "2px",
          flexWrap: c ? "wrap" : "nowrap",
        }}>
          <div title={currentUser.short_name} style={{ flexShrink: 0 }}>
            <Avatar member={currentUser} size={22} />
          </div>
          {!c && (
            <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentUser.short_name}
            </span>
          )}
          {!c && (
            <button
              onClick={onToggleTheme}
              style={{ fontSize: "13px", color: "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}
              title={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          )}
          {!c && (
            <button
              onClick={onLogout}
              style={{ fontSize: "10px", color: "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}
              title="ログアウト"
            >
              ⏏
            </button>
          )}
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
  active, icon, label, onClick, color, tooltip, collapsed = false,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
  tooltip?: string;
  collapsed?: boolean;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    // 折りたたみ時は即座に表示、展開時は2秒後
    const delay = collapsed ? 400 : 2000;
    const effectiveTooltip = collapsed ? label : tooltip;
    if (!effectiveTooltip) return;
    const { clientX, clientY } = e;
    timerRef.current = setTimeout(() => setTipPos({ x: clientX, y: clientY }), delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTipPos(null);
  };

  const effectiveTooltip = collapsed ? label : tooltip;

  if (collapsed) {
    return (
      <>
        <button
          onClick={onClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "7px 0",
            background: active ? "var(--color-bg-primary)" : "transparent",
            border: "none",
            borderRadius: "var(--radius-md)",
            margin: "1px 4px", width: "calc(100% - 8px)",
            cursor: "pointer",
            color: color ?? (active ? "var(--color-text-primary)" : "var(--color-text-secondary)"),
          }}
        >
          <span style={{ opacity: active ? 1 : 0.6 }}>{icon}</span>
        </button>
        {tipPos && effectiveTooltip && (
          <div style={{
            position: "fixed",
            left: tipPos.x + 12, top: tipPos.y - 10,
            zIndex: 9999,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            padding: "5px 10px",
            fontSize: "11px", fontWeight: "500",
            color: "var(--color-text-primary)",
            pointerEvents: "none", whiteSpace: "nowrap",
          }}>
            {effectiveTooltip}
          </div>
        )}
      </>
    );
  }

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
          left: tipPos.x + 12, top: tipPos.y - 10,
          zIndex: 9999,
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          padding: "8px 12px", maxWidth: "220px",
          fontSize: "11px", color: "var(--color-text-secondary)",
          lineHeight: 1.5, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "3px" }}>{label}</div>
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

function KrIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      {collapsed ? (
        // ›› 展開アイコン
        <>
          <path d="M5 3.5L9 7.5L5 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9 3.5L13 7.5L9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
        </>
      ) : (
        // ‹‹ 折りたたみアイコン
        <>
          <path d="M10 3.5L6 7.5L10 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 3.5L2 7.5L6 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
        </>
      )}
    </svg>
  );
}
