// src/components/layout/MainLayout.tsx
import { useState, useMemo, useRef, lazy, Suspense } from "react";
import { useTheme } from "../../hooks/useTheme";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, ViewMode, KeyResult, TaskForce, TaskTaskForce } from "../../lib/localData/types";
import { KEYS } from "../../lib/localData/localStore";
import { TaskEditModal } from "../task/TaskEditModal";
import { Avatar } from "../auth/UserSelectScreen";
import { ConsultationPanel } from "../consultation/ConsultationPanel";
import type { OkrActiveTool } from "../okr/OkrDashboardView";
import { CustomSelect } from "../common/CustomSelect";
import { ErrorBar } from "../common/ErrorBar";
import { DashIcon, KanbanIcon, GanttIcon, ListIcon, AdminIcon, GraphIcon, AIIcon } from "../common/icons/NavIcons";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";

/**
 * 【設計意図】
 * 重量級ビューとラボ機能を React.lazy で分割し初回バンドルを縮小する。
 * 名前付き export を default export 形に変換するブリッジを噛ませている。
 * 切替頻度の低い管理画面・ラボ機能は別チャンクに分離されることで初回 LCP に寄与する。
 */
const KanbanView         = lazy(() => import("../kanban/KanbanView").then(m => ({ default: m.KanbanView })));
const AdminView          = lazy(() => import("../admin/AdminView").then(m => ({ default: m.AdminView })));
const GanttView          = lazy(() => import("../gantt/GanttView").then(m => ({ default: m.GanttView })));
const DashboardView      = lazy(() => import("../dashboard/DashboardView").then(m => ({ default: m.DashboardView })));
const ListView           = lazy(() => import("../list/ListView").then(m => ({ default: m.ListView })));
const GraphView          = lazy(() => import("../graph/GraphView").then(m => ({ default: m.GraphView })));
const KrReportPanel      = lazy(() => import("../lab/KrReportPanel").then(m => ({ default: m.KrReportPanel })));
const KrSessionPanel     = lazy(() => import("../lab/KrSessionPanel").then(m => ({ default: m.KrSessionPanel })));
const KrWhyPanel         = lazy(() => import("../lab/KrWhyPanel").then(m => ({ default: m.KrWhyPanel })));
const OkrDashboardView   = lazy(() => import("../okr/OkrDashboardView").then(m => ({ default: m.OkrDashboardView })));

function ViewLoading() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        className="animate-spin"
        style={{
          width: "24px", height: "24px",
          border: "2px solid var(--color-border-primary)",
          borderTopColor: "var(--color-brand)",
          borderRadius: "50%",
        }}
      />
    </div>
  );
}

type AppMode = "plan" | "okr";

interface Props {
  currentUser: Member;
  onLogout: () => void;
}

const NAV_ITEMS: { view: ViewMode; label: string; shortLabel: string; icon: React.ReactNode; tooltip: string }[] = [
  { view: "dashboard", label: "ダッシュボード", shortLabel: "DB", icon: <DashIcon />,   tooltip: "OKRの進捗・今週のタスク・期限アラートをまとめて確認できます" },
  { view: "kanban",    label: "カンバン",       shortLabel: "KB", icon: <KanbanIcon />, tooltip: "タスクを「未着手／進行中／完了」の列でドラッグ&ドロップ管理できます" },
  { view: "gantt",     label: "ガント",         shortLabel: "GT", icon: <GanttIcon />,  tooltip: "プロジェクトの期間とタスクの期日をカレンダー形式で一覧できます" },
  { view: "list",      label: "リスト",         shortLabel: "LT", icon: <ListIcon />,   tooltip: "タスクを一覧形式で表示・絞り込み・CSV出力できます" },
];

export function MainLayout({ currentUser, onLogout }: Props) {
  const isMobile = useIsMobile();
  const { theme, toggle: toggleTheme } = useTheme();
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(KEYS.VIEW_MODE) as ViewMode | null;
    // "admin" は設定パネルに移行したため、ダッシュボードにフォールバック
    return (saved && saved !== "admin") ? saved : "dashboard";
  });
  const setViewMode = (v: ViewMode) => {
    localStorage.setItem(KEYS.VIEW_MODE, v);
    setViewModeState(v);
  };
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isConsultOpen, setIsConsultOpen] = useState(false);
  const [consultDefaultMode, setConsultDefaultMode] = useState<"consult" | "create" | "meeting">("consult");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem(KEYS.SIDEBAR_COLLAPSED) === "1"
  );
  const toggleSidebar = () => setIsSidebarCollapsed(prev => {
    const next = !prev;
    localStorage.setItem(KEYS.SIDEBAR_COLLAPSED, next ? "1" : "0");
    return next;
  });
  const [consultPanelWidth, setConsultPanelWidth] = useState(() => {
    try { return Math.min(800, Math.max(300, parseInt(localStorage.getItem(KEYS.CONSULT_PANEL_WIDTH) ?? "400", 10) || 400)); } catch { return 400; }
  });
  const [isGraphOpen,   setIsGraphOpen]   = useState(false);
  const [isKrReportOpen, setIsKrReportOpen] = useState(false);
  const [isKrSessionOpen, setIsKrSessionOpen] = useState(false);
  const [isKrWhyOpen, setIsKrWhyOpen] = useState(false);
  const [okrActiveTool, setOkrActiveTool] = useState<OkrActiveTool>(() => {
    const saved = localStorage.getItem(KEYS.OKR_ACTIVE_TOOL) as OkrActiveTool | null;
    const validTools: OkrActiveTool[] = ["session", "why", "plan", "overview", "guide", null];
    return (saved !== undefined && validTools.includes(saved)) ? saved : "session";
  });
  const setOkrActiveToolPersisted = (tool: OkrActiveTool) => {
    if (tool) localStorage.setItem(KEYS.OKR_ACTIVE_TOOL, tool);
    setOkrActiveTool(tool);
  };
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  const [isMobileLabOpen, setIsMobileLabOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [graphEditTaskId, setGraphEditTaskId] = useState<string | null>(null);
  const [aiEditTaskId, setAiEditTaskId] = useState<string | null>(null);
  const [appMode, setAppModeState] = useState<AppMode>(() =>
    (localStorage.getItem(KEYS.APP_MODE) as AppMode | null) ?? "plan"
  );
  const setAppMode = (m: AppMode) => {
    localStorage.setItem(KEYS.APP_MODE, m);
    setAppModeState(m);
  };

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


  const adminOverlay = isAdminOpen ? (
    <div className="animate-overlay-rich" style={{
      position: "fixed", inset: 0, zIndex: 250,
      display: "flex", flexDirection: "column",
      background: "var(--color-bg-primary)",
    }}>
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center", gap: "10px",
        flexShrink: 0,
        background: "var(--color-bg-secondary)",
      }}>
        <span style={{ fontSize: "15px" }}>⚙️</span>
        <span style={{ fontSize: "13px", fontWeight: "700", flex: 1, color: "var(--color-text-primary)" }}>設定</span>
        <button
          onClick={() => setIsAdminOpen(false)}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: "18px", color: "var(--color-text-tertiary)", padding: "4px",
            lineHeight: 1,
          }}
        >✕</button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Suspense fallback={<ViewLoading />}>
          <AdminView currentUser={currentUser} />
        </Suspense>
      </div>
    </div>
  ) : null;

  const mainContent = (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      paddingBottom: isMobile ? "56px" : 0,
    }}>
      {appMode === "okr" ? (
        <div key="okr" className="animate-fadeIn" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <Suspense fallback={<ViewLoading />}>
            <OkrDashboardView
              currentUser={currentUser}
              selectedKrId={selectedKrId}
              onSelectKr={handleSelectKr}
              activeTool={okrActiveTool}
              onSetActiveTool={setOkrActiveToolPersisted}
            />
          </Suspense>
        </div>
      ) : (
        /* key={viewMode} でビュー切り替え時に animate-fadeIn が毎回発火する */
        <div key={viewMode} className="animate-fadeIn" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <Suspense fallback={<ViewLoading />}>
            {viewMode === "dashboard" && (
              <DashboardView currentUser={currentUser} projects={projects} onOpenAiProject={() => { setConsultDefaultMode("create"); setIsConsultOpen(true); }} />
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
          </Suspense>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {adminOverlay}
        {isQuickAddOpen && (
          <QuickAddTaskModal currentUser={currentUser} projects={projects} onClose={() => setIsQuickAddOpen(false)} />
        )}
        {isGraphOpen && (
          <Suspense fallback={<ViewLoading />}>
            <GraphView onClose={() => setIsGraphOpen(false)} currentUser={currentUser} onOpenTask={taskId => setGraphEditTaskId(taskId)} />
          </Suspense>
        )}
        {isKrReportOpen && (
          <Suspense fallback={<ViewLoading />}>
            <KrReportPanel onClose={() => setIsKrReportOpen(false)} currentUser={currentUser} />
          </Suspense>
        )}
        {isKrSessionOpen && (
          <Suspense fallback={<ViewLoading />}>
            <KrSessionPanel onClose={() => setIsKrSessionOpen(false)} currentUser={currentUser} />
          </Suspense>
        )}
        {isKrWhyOpen && (
          <Suspense fallback={<ViewLoading />}>
            <KrWhyPanel onClose={() => setIsKrWhyOpen(false)} currentUser={currentUser} />
          </Suspense>
        )}
        {graphEditTaskId && (
          <TaskEditModal taskId={graphEditTaskId} currentUser={currentUser} onClose={() => setGraphEditTaskId(null)} />
        )}
        {aiEditTaskId && (
          <TaskEditModal taskId={aiEditTaskId} currentUser={currentUser} onClose={() => setAiEditTaskId(null)} />
        )}
        {/* ラボ機能ボトムシート */}
        {isMobileLabOpen && (
          <div
            className="animate-overlay"
            style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)" }}
            onClick={() => setIsMobileLabOpen(false)}
          >
            <div
              className="panel-slide-up"
              style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: "var(--color-bg-primary)",
                borderRadius: "16px 16px 0 0",
                padding: "12px 0 32px",
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ width: "40px", height: "4px", background: "var(--color-border-primary)", borderRadius: "2px", margin: "0 auto 16px" }} />
              <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", padding: "0 20px 10px", letterSpacing: "0.05em" }}>
                🧪 ラボ機能
              </div>
              {[
                { icon: "🕸️", label: "関係グラフ", desc: "PJ・タスクの関係を可視化", onClick: () => { setIsGraphOpen(true); setIsMobileLabOpen(false); } },
                { icon: "🗓️", label: "KRセッション記録", desc: "文字起こしからチェックイン・ウィン記録", onClick: () => { setIsKrSessionOpen(true); setIsMobileLabOpen(false); } },
                { icon: "📊", label: "KRレポート生成", desc: "議事メモからKRレポートをAI生成", onClick: () => { setIsKrReportOpen(true); setIsMobileLabOpen(false); } },
                { icon: "🔍", label: "KRなぜなぜ分析", desc: "AIとの対話で根本原因を5Whys形式で掘り下げ", onClick: () => { setIsKrWhyOpen(true); setIsMobileLabOpen(false); } },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "14px",
                    padding: "12px 20px", background: "transparent", border: "none",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "22px", flexShrink: 0 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>{item.label}</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{item.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* モバイル：ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "8px 12px",
          background: "var(--color-bg-primary)",
          borderBottom: "1px solid var(--color-border-primary)",
          flexShrink: 0,
        }}>
          {/* モードトグル */}
          <AppModeToggle mode={appMode} onToggle={() => setAppMode(appMode === "plan" ? "okr" : "plan")} compact />
          {/* プロジェクト選択（計画モードのみ） */}
          {appMode === "plan" && (
            <select
              value={selectedProjectId ?? ""}
              onChange={e => handleSelectProject(e.target.value || null)}
              style={{
                fontSize: "11px", padding: "4px 6px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-secondary)",
                maxWidth: "80px",
              }}
            >
              <option value="">全PJ</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {/* AI相談ボタン */}
          <button
            onClick={() => setIsConsultOpen(prev => !prev)}
            title="AIに変更を相談"
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: isConsultOpen ? "linear-gradient(135deg,#7c3aed,#5b21b6)" : "linear-gradient(135deg,#8b5cf6,#7c3aed)",
              border: "none", cursor: "pointer", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AIIcon />
          </button>
          {/* ラボボタン */}
          <button
            onClick={() => setIsMobileLabOpen(true)}
            title="ラボ機能"
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              cursor: "pointer", fontSize: "16px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            🧪
          </button>
          {/* 設定ボタン */}
          <button
            onClick={() => setIsAdminOpen(true)}
            title="設定"
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              cursor: "pointer", fontSize: "15px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, color: "var(--color-text-secondary)",
            }}
          >
            <GearIcon />
          </button>
          {/* テーマ切り替え */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              cursor: "pointer", fontSize: "14px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            onClick={onLogout}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px", flexShrink: 0 }}
            title="ログアウト"
          >
            <Avatar member={currentUser} size={28} />
          </button>
        </div>

        {/* AI相談パネル（モバイル：右側から全幅でスライドイン） */}
        <ConsultationPanel
          isOpen={isConsultOpen}
          onClose={() => setIsConsultOpen(false)}
          currentUser={currentUser}
          onOpenTask={setAiEditTaskId}
        />

        {mainContent}

        {/* モバイル：FAB（計画モードのみ） */}
        {appMode === "plan" && (<>
          {isFabMenuOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 58 }}
              onClick={() => setIsFabMenuOpen(false)}
            />
          )}
          {isFabMenuOpen && (
            <div style={{
              position: "fixed", bottom: "122px", right: "16px", zIndex: 59,
              display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end",
            }}>
              <button
                className="fab-item-in"
                onClick={() => { setIsFabMenuOpen(false); setConsultDefaultMode("create"); setIsConsultOpen(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "10px 16px",
                  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                  border: "none", borderRadius: "var(--radius-full)",
                  color: "#fff", fontSize: "13px", fontWeight: "600",
                  boxShadow: "var(--shadow-lg)", cursor: "pointer",
                  whiteSpace: "nowrap", animationDelay: "0.06s",
                }}
              >✨ AIでPJを作る</button>
              <button
                className="fab-item-in"
                onClick={() => { setIsFabMenuOpen(false); setIsQuickAddOpen(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "10px 16px",
                  background: "var(--color-brand)",
                  border: "none", borderRadius: "var(--radius-full)",
                  color: "#fff", fontSize: "13px", fontWeight: "600",
                  boxShadow: "var(--shadow-lg)", cursor: "pointer",
                  whiteSpace: "nowrap", animationDelay: "0s",
                }}
              >＋ タスクを追加</button>
            </div>
          )}
          <button
            onClick={() => setIsFabMenuOpen(prev => !prev)}
            style={{
              position: "fixed", bottom: "68px", right: "16px", zIndex: 60,
              width: "48px", height: "48px", borderRadius: "50%",
              background: isFabMenuOpen ? "var(--color-text-secondary)" : "var(--color-brand)",
              color: "#fff", border: "none", fontSize: "22px", lineHeight: 1,
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s, transform 0.2s",
              transform: isFabMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
            }}
            title="メニューを開く"
          >＋</button>
        </>)}

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
          {appMode === "plan" ? NAV_ITEMS.map(({ view, shortLabel, icon }) => {
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
          }) : ([
            { label: "概要", icon: "🎯", onClick: () => setOkrActiveTool("overview") },
            { label: "セッション", icon: "🗓️", onClick: () => setOkrActiveTool("session") },
            { label: "なぜなぜ", icon: "🔍", onClick: () => setOkrActiveTool("why") },
            { label: "計画", icon: "📅", onClick: () => setOkrActiveTool("plan") },
          ] as const).map(item => (
            <button
              key={item.label}
              onClick={item.onClick}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "3px",
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--color-text-tertiary)", fontSize: "9px",
              }}
            >
              <span style={{ fontSize: "16px" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <ErrorBar />
      </div>
    );
  }

  // PC レイアウト
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {adminOverlay}

      {isQuickAddOpen && (
        <QuickAddTaskModal currentUser={currentUser} projects={projects} onClose={() => setIsQuickAddOpen(false)} />
      )}
      {/* PC FAB（計画モードのみ） */}
      {appMode === "plan" && isFabMenuOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 58 }}
          onClick={() => setIsFabMenuOpen(false)}
        />
      )}
      {appMode === "plan" && isFabMenuOpen && (
        <div style={{
          position: "fixed",
          bottom: "74px",
          right: isConsultOpen ? `${consultPanelWidth + 24}px` : "24px",
          transition: "right 0.3s ease",
          zIndex: 59,
          display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end",
        }}>
          <button
            className="fab-item-in"
            onClick={() => { setIsFabMenuOpen(false); setConsultDefaultMode("create"); setIsConsultOpen(true); }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "9px 16px", height: "38px",
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap",
              animationDelay: "0.06s",
            }}
          >
            <span>✨</span> AIでPJを作る
          </button>
          <button
            className="fab-item-in"
            onClick={() => { setIsFabMenuOpen(false); setIsQuickAddOpen(true); }}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "9px 16px", height: "38px",
              background: "var(--color-brand)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap",
              animationDelay: "0s",
            }}
          >
            <span style={{ fontSize: "16px", lineHeight: 1 }}>＋</span> タスクを追加
          </button>
        </div>
      )}
      {/* PC FABボタン本体（計画モードのみ） */}
      {appMode === "plan" && (
        <button
          onClick={() => setIsFabMenuOpen(prev => !prev)}
          style={{
            position: "fixed", bottom: "24px",
            right: isConsultOpen ? `${consultPanelWidth + 24}px` : "24px",
            transition: "right 0.3s ease, background 0.2s, transform 0.2s",
            zIndex: 60,
            width: "48px", height: "48px", borderRadius: "50%",
            background: isFabMenuOpen ? "var(--color-text-secondary)" : "var(--color-brand)",
            color: "#fff",
            border: "none", fontSize: "22px",
            boxShadow: "var(--shadow-lg)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transform: isFabMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
          }}
          title="メニューを開く"
        >＋</button>
      )}
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
        onOpenConsult={() => { setConsultDefaultMode("consult"); setIsConsultOpen(prev => !prev); }}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenGraph={() => setIsGraphOpen(true)}
        onOpenKrReport={() => setIsKrReportOpen(true)}
        onOpenKrSession={() => setIsKrSessionOpen(true)}
        onOpenKrWhy={() => setIsKrWhyOpen(true)}
        onSetOkrActiveTool={setOkrActiveTool}
        okrActiveTool={okrActiveTool}
        onOpenAdmin={() => setIsAdminOpen(true)}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        appMode={appMode}
        onToggleMode={() => setAppMode(appMode === "plan" ? "okr" : "plan")}
      />
      {mainContent}
      {isGraphOpen && (
        <Suspense fallback={<ViewLoading />}>
          <GraphView
            onClose={() => setIsGraphOpen(false)}
            currentUser={currentUser}
            onOpenTask={taskId => setGraphEditTaskId(taskId)}
          />
        </Suspense>
      )}
      {isKrReportOpen && (
        <Suspense fallback={<ViewLoading />}>
          <KrReportPanel
            onClose={() => setIsKrReportOpen(false)}
            currentUser={currentUser}
          />
        </Suspense>
      )}
      {isKrSessionOpen && (
        <Suspense fallback={<ViewLoading />}>
          <KrSessionPanel
            onClose={() => setIsKrSessionOpen(false)}
            currentUser={currentUser}
          />
        </Suspense>
      )}
      {isKrWhyOpen && (
        <Suspense fallback={<ViewLoading />}>
          <KrWhyPanel
            onClose={() => setIsKrWhyOpen(false)}
            currentUser={currentUser}
          />
        </Suspense>
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
          defaultMode={consultDefaultMode}
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
  onOpenKrWhy: () => void;
  okrActiveTool: OkrActiveTool;
  onSetOkrActiveTool: (tool: OkrActiveTool) => void;
  onOpenAdmin: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  appMode: AppMode;
  onToggleMode: () => void;
}

function Sidebar({
  viewMode, setViewMode, projects,
  selectedProjectId, onSelectProject,
  keyResults, selectedKrId, onSelectKr,
  currentUser, onLogout, isConsultOpen, onOpenConsult,
  theme, onToggleTheme, onOpenGraph, onOpenKrReport, onOpenKrSession, onOpenKrWhy,
  onSetOkrActiveTool, okrActiveTool, onOpenAdmin, collapsed, onToggleCollapsed,
  appMode, onToggleMode,
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

      {/* モードトグル */}
      <div style={{ padding: c ? "6px 4px" : "8px 8px 4px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
        <AppModeToggle mode={appMode} onToggle={onToggleMode} compact={c} />
      </div>

      {/* AI ツール（モード共通） */}
      <div style={{ borderBottom: "1px solid var(--color-border-primary)", padding: c ? "6px 4px" : "8px 6px", flexShrink: 0 }}>
        <button
          onClick={onOpenConsult}
          title="AI相談・PJ/タスク登録・会議読み込みをまとめて使えます"
          style={{
            display: "flex", alignItems: "center", gap: c ? 0 : "10px",
            padding: c ? "10px 0" : "10px 12px",
            width: "100%", boxSizing: "border-box",
            justifyContent: c ? "center" : "flex-start",
            background: isConsultOpen
              ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
              : "linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(139,92,246,0.1) 100%)",
            border: `1.5px solid ${isConsultOpen ? "transparent" : "rgba(99,102,241,0.3)"}`,
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <span style={{ fontSize: c ? "18px" : "15px", flexShrink: 0, lineHeight: 1 }}>✨</span>
          {!c && (
            <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: isConsultOpen ? "#fff" : "#6366f1", lineHeight: 1.3 }}>
                AIツールを開く
              </div>
              <div style={{ fontSize: "10px", color: isConsultOpen ? "rgba(255,255,255,0.8)" : "var(--color-text-tertiary)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                相談 · PJ/タスク登録 · 会議読み込み
              </div>
            </div>
          )}
          {!c && (
            <span style={{ fontSize: "13px", color: isConsultOpen ? "rgba(255,255,255,0.7)" : "rgba(99,102,241,0.5)", flexShrink: 0, lineHeight: 1 }}>
              {isConsultOpen ? "×" : "›"}
            </span>
          )}
        </button>
      </div>

      {appMode === "plan" ? (<>
        {/* 計画管理：メニュー */}
        <div className="stagger-children" style={{ padding: c ? "6px 0" : "8px 0 4px" }}>
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

        {/* 計画管理：プロジェクト一覧 */}
        <div style={{ flex: 1, overflow: "auto", padding: c ? "6px 0" : "4px 0" }}>
          {!c && <SectionLabel>プロジェクト</SectionLabel>}
          <NavItem
            active={selectedProjectId === null && selectedKrId === null}
            icon={<span style={{ width: 8, height: 8, borderRadius: "50%", background: "#888780", display: "inline-block" }} />}
            label="全PJ表示" tooltip="全PJ表示"
            onClick={() => onSelectProject(null)} collapsed={c}
          />
          {projects.map(pj => (
            <NavItem key={pj.id} active={selectedProjectId === pj.id}
              icon={<span style={{ width: 7, height: 7, borderRadius: "50%", background: pj.color_tag, display: "inline-block" }} />}
              label={pj.name} tooltip={pj.name}
              onClick={() => onSelectProject(pj.id)} collapsed={c}
            />
          ))}
          {keyResults.length > 0 && (<>
            {!c && <SectionLabel>OKRタスク</SectionLabel>}
            {keyResults.map(kr => (
              <NavItem key={kr.id} active={selectedKrId === kr.id}
                icon={<KrIcon />} label={kr.title} tooltip={kr.title}
                onClick={() => onSelectKr(selectedKrId === kr.id ? null : kr.id)} collapsed={c}
              />
            ))}
          </>)}
        </div>

        {/* 計画管理：ラボセクション */}
        <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "4px 0" : "4px 6px" }}>
          {c ? (
            <button onClick={() => setLabOpen(o => !o)} title="ラボ"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 0", background: "transparent", border: "none", cursor: "pointer", borderRadius: "6px", color: "var(--color-text-tertiary)", fontSize: "15px" }}
            >🧪</button>
          ) : (
            <button onClick={() => setLabOpen(o => !o)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "7px", padding: "6px 10px", background: "transparent", border: "none", cursor: "pointer", borderRadius: "6px", color: "var(--color-text-tertiary)", fontSize: "11px" }}
            >
              <span style={{ fontSize: "13px" }}>🧪</span>
              <span style={{ flex: 1, textAlign: "left" }}>ラボ</span>
              <span style={{ fontSize: "9px" }}>{labOpen ? "▴" : "▾"}</span>
            </button>
        )}
        {labOpen && (
          <NavItem
            active={false}
            icon={<GraphIcon />}
            label="関係グラフ"
            tooltip="プロジェクト・タスクフォース・タスクの関係をグラフで可視化"
            onClick={onOpenGraph}
            collapsed={c}
          />
        )}
      </div>
      </>) : (<>
        {/* OKR管理：KR一覧（フィルター用） */}
        <div style={{ flex: 1, overflow: "auto", padding: c ? "6px 0" : "4px 0" }}>
          {!c && <SectionLabel>Key Results</SectionLabel>}
          <NavItem
            active={selectedKrId === null}
            icon={<span style={{ fontSize: "13px" }}>🎯</span>}
            label="全KR" tooltip="全KRを表示"
            onClick={() => onSelectKr(null)} collapsed={c}
          />
          {keyResults.map(kr => (
            <NavItem key={kr.id} active={selectedKrId === kr.id}
              icon={<KrIcon />} label={kr.title} tooltip={kr.title}
              onClick={() => onSelectKr(selectedKrId === kr.id ? null : kr.id)} collapsed={c}
            />
          ))}
          {keyResults.length === 0 && !c && (
            <div style={{ padding: "8px 12px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              KRが登録されていません
            </div>
          )}
        </div>

        {/* OKR管理：使い方ページ */}
        <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "4px 0" : "4px 6px" }}>
          <NavItem
            active={okrActiveTool === "guide"}
            icon={<span style={{ fontSize: "13px" }}>📖</span>}
            label="使い方・案内"
            tooltip="このモードでできることの説明と週次の使い方ガイド"
            onClick={() => onSetOkrActiveTool("guide")}
            collapsed={c}
          />
        </div>
      </>)}

      {/* AI相談・設定・ユーザー情報 */}
      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "6px 4px" : "8px 6px" }}>
        {/* 設定（歯車）ボタン */}
        <button
          onClick={onOpenAdmin}
          title="設定"
          style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: c ? "center" : "flex-start",
            gap: "8px",
            padding: c ? "6px 0" : "6px 12px",
            background: "transparent",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            color: "var(--color-text-secondary)",
            fontSize: "11px",
            marginBottom: "4px",
          }}
        >
          <GearIcon />
          {!c && <span>設定</span>}
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

function AppModeToggle({ mode, onToggle, compact = false }: { mode: AppMode; onToggle: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <button
        onClick={onToggle}
        title={mode === "plan" ? "OKR管理モードに切り替え" : "計画管理モードに切り替え"}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          padding: "4px 0", background: "transparent", border: "none", cursor: "pointer",
          fontSize: "14px",
        }}
      >
        {mode === "plan" ? "🎯" : "📋"}
      </button>
    );
  }
  return (
    <div style={{
      display: "flex", borderRadius: "var(--radius-md)",
      border: "1px solid var(--color-border-primary)",
      overflow: "hidden", fontSize: "10px", fontWeight: "600",
    }}>
      {(["plan", "okr"] as const).map(m => (
        <button
          key={m}
          onClick={() => { if (mode !== m) onToggle(); }}
          style={{
            flex: 1, padding: "5px 4px", border: "none", cursor: "pointer",
            background: mode === m ? "var(--color-brand)" : "transparent",
            color: mode === m ? "#fff" : "var(--color-text-tertiary)",
            transition: "background 0.15s, color 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          {m === "plan" ? "📋 計画" : "🎯 OKR"}
        </button>
      ))}
    </div>
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

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.2 3.2l.7.7M10.1 10.1l.7.7M10.8 3.2l-.7.7M3.9 10.1l-.7.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
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
