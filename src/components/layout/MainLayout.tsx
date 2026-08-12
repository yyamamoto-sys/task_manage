// src/components/layout/MainLayout.tsx
import { useState, useMemo, useRef, useEffect, useCallback, Suspense } from "react";
import { v4 as uuidv4 } from "uuid";
import { useTheme } from "../../hooks/useTheme";
import { useT } from "../../hooks/useT";
import { useAppStore, selectScopedTasks, selectScopedProjects } from "../../stores/appStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useDeadlineNotifications } from "../../hooks/useDeadlineNotifications";
import { useMentionNotifications } from "../../hooks/useMentionNotifications";
import type { Member, Project, ViewMode, KeyResult, TaskForce, TaskTaskForce, Task, Group } from "../../lib/localData/types";
import { CustomSelect } from "../common/CustomSelect";
import { LangToggle } from "../common/LangToggle";
import { VersionBadge } from "../common/VersionBadge";
import { KEYS, active } from "../../lib/localData/localStore";
import { keyResultsInGroup } from "../../lib/okr/deptScope";
import { TaskEditModal } from "../task/TaskEditModal";
import { isAssignedTo } from "../../lib/taskMeta";
import { Avatar } from "../auth/UserSelectScreen";
import { ConsultationPanel } from "../consultation/ConsultationPanel";
import { OkrModeIntroModal } from "../okr/OkrModeIntroModal";
import { shouldShowOkrModeIntro, hasApprovedOkrModeIntro, markOkrModeIntroApproved } from "../../lib/okr/okrModeGate";
// GuideModeViewは全props省略可能な既定値付きコンポーネントのため、withChunkDownloadGate<P>への
// P推論がTS上うまくいかず object に落ちてしまう。型のみをimportして明示的に指定する（実行時の
// importは発生しない＝バンドルサイズに影響しない）
import type { GuideModeView as GuideModeViewComponent } from "../guide/GuideModeView";
import { ErrorBar } from "../common/ErrorBar";
import { ShortcutsPanel } from "../common/ShortcutsPanel";
import { dismissUndoToasts, showToast } from "../common/Toast";
import { consumeLastUndoAction } from "../../lib/lastUndoStore";
import { ViewSkeleton } from "../common/Skeleton";
import { CommandPalette } from "../common/CommandPalette";
import { DashIcon, KanbanIcon, GanttIcon, ListIcon, GraphIcon, AIIcon, WorkloadIcon } from "../common/icons/NavIcons";
import { QuickAddTaskModal } from "../task/QuickAddTaskModal";
import { MilestoneAddModal } from "../milestone/MilestoneAddModal";
import { ProjectCreateModal } from "../project/ProjectCreateModal";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { withChunkDownloadGate } from "../common/ChunkDownloadGate";
import { HelpButton } from "../guide/HelpButton";
import { TourProvider, useTour } from "../tour/TourProvider";
import { buildTours, FIRST_TIME_TOUR_ID } from "../tour/tours";
import { modalOverlayStyle, modalBoxStyle } from "../common/modalStyles";
import { isGuestMember } from "../../lib/guestMode";
import { canGuestEdit } from "../../lib/guest/guestCapability";
import { GuestAiQuotaNotice } from "../common/GuestAiQuotaNotice";
import { filterInviteGroupsForSidebar } from "../../lib/projectInvite/sidebarGroupVisibility";
import { filterSidebarProjects } from "../../lib/project/sidebarProjectFilter";
import { canEditProjectBasicInfo } from "../../lib/project/projectEditPermission";
import type { ProjectRowMenuActionId } from "../../lib/project/projectRowMenu";
import { ProjectRowMenu } from "../project/ProjectRowMenu";
import { ProjectSettingsModal } from "../project/ProjectSettingsModal";
import { AcceptInviteModal } from "../project/AcceptInviteModal";
import { formatErrorForUser } from "../../lib/errorMessage";
import { clampSidebarWidth, parseStoredSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_KEY_STEP, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "../../lib/layout/sidebarWidth";
import { confirmDialog } from "../../lib/dialog";
import { loadDemoDataset } from "../../lib/demo/loadDemoDataset";

/**
 * 【設計意図】
 * 重量級ビューとラボ機能を React.lazy で分割し初回バンドルを縮小する。
 * 名前付き export を default export 形に変換するブリッジを噛ませている。
 * 切替頻度の低い管理画面・ラボ機能は別チャンクに分離されることで初回 LCP に寄与する。
 *
 * 【グランドルール（v3.19・CLAUDE.md参照）】使用者が限られる重量級機能はReact.lazyで
 * 分割し、withChunkDownloadGate() で閾値超えチャンクのダウンロード確認を通す。
 * 第2引数の name はそのまま vite.config.ts の chunk-size-manifest が書き出すチャンク名
 * （＝ファイル名）と一致させること。現時点では200KB(gzip)を超えるチャンクは無いため
 * 実際には確認ダイアログは発火しないが、将来チャンクが育った時に自動で効く。
 */
const KanbanView         = withChunkDownloadGate(lazyWithRetry(() => import("../kanban/KanbanView").then(m => ({ default: m.KanbanView })), "KanbanView"), "KanbanView");
const AdminView          = withChunkDownloadGate(lazyWithRetry(() => import("../admin/AdminView").then(m => ({ default: m.AdminView })), "AdminView"), "AdminView");
const GanttView          = withChunkDownloadGate(lazyWithRetry(() => import("../gantt/GanttView").then(m => ({ default: m.GanttView })), "GanttView"), "GanttView");
const DashboardView      = withChunkDownloadGate(lazyWithRetry(() => import("../dashboard/DashboardView").then(m => ({ default: m.DashboardView })), "DashboardView"), "DashboardView");
const OnboardingHome     = withChunkDownloadGate(lazyWithRetry(() => import("../dashboard/OnboardingHome").then(m => ({ default: m.OnboardingHome })), "OnboardingHome"), "OnboardingHome");
const ListView           = withChunkDownloadGate(lazyWithRetry(() => import("../list/ListView").then(m => ({ default: m.ListView })), "ListView"), "ListView");
const WorkloadView       = withChunkDownloadGate(lazyWithRetry(() => import("../workload/WorkloadView").then(m => ({ default: m.WorkloadView })), "WorkloadView"), "WorkloadView");
const GraphView          = withChunkDownloadGate(lazyWithRetry(() => import("../graph/GraphView").then(m => ({ default: m.GraphView })), "GraphView"), "GraphView");
const CalendarLabView    = withChunkDownloadGate(lazyWithRetry(() => import("../lab/CalendarLabView").then(m => ({ default: m.CalendarLabView })), "CalendarLabView"), "CalendarLabView");
const MyPageView         = withChunkDownloadGate(lazyWithRetry(() => import("../lab/MyPageView").then(m => ({ default: m.MyPageView })), "MyPageView"), "MyPageView");
const ProjectStructureView = withChunkDownloadGate(lazyWithRetry(() => import("../lab/ProjectStructureView").then(m => ({ default: m.ProjectStructureView })), "ProjectStructureView"), "ProjectStructureView");
const OkrDashboardView   = withChunkDownloadGate(lazyWithRetry(() => import("../okr/OkrDashboardView").then(m => ({ default: m.OkrDashboardView })), "OkrDashboardView"), "OkrDashboardView");
// バージョン履歴（v3.61）：releaseNotes.ts（利用者向けデータ）を静的importするため、開かない
// 利用者にダウンロードさせないようlazy化する（CLAUDE.md Section 19）。小さいためDLゲート対象外。
const VersionHistoryModal = lazyWithRetry(() => import("../common/VersionHistoryModal").then(m => ({ default: m.VersionHistoryModal })), "VersionHistoryModal");
type GuideModeViewProps = NonNullable<Parameters<typeof GuideModeViewComponent>[0]>;
const GuideModeView      = withChunkDownloadGate<GuideModeViewProps>(lazyWithRetry(() => import("../guide/GuideModeView").then(m => ({ default: m.GuideModeView })), "GuideModeView"), "GuideModeView");

function ViewLoading() {
  // スピナー単体よりレイアウトの骨格を見せた方が体感が速い（スケルトンUI）
  return <ViewSkeleton />;
}

// mineOnly=false のときに filterSidebarProjects へ渡す空集合（毎回 new Set() を作らないための
// 安定参照。mineOnly=false 分岐では参照されないため中身は常に空でよい）
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/**
 * モバイル専用：全画面ラボビュー（GraphView 等）を全画面表示にする薄いラッパー。
 * 【CLAUDE.md Section 20（v3.33）】ビュー本体は position:"fixed" を持たない
 * 「メインエリアに収まる flex 子要素」になったため、PC では mainContent 内に
 * そのまま埋め込めば #root の角丸クリップの内側に収まる。一方モバイルは #root の
 * 角丸カード自体が存在せず（body { padding: 0 }）常に全画面表示が正しいため、
 * 呼び出し側のこのラッパーだけが position:fixed; inset:0 を持つ。
 * zIndex は各ビューがPC非埋め込み時代に持っていた値をそのまま踏襲する。
 */
function MobileFullscreenOverlay({ zIndex, children }: { zIndex: number; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex, display: "flex" }}>
      {children}
    </div>
  );
}

type AppMode = "plan" | "okr";

/**
 * 全画面ラボ系ビュー（体制図・関係性グラフ・カレンダー・マイページ）の識別子。
 * 同時に開けるのは常にこのうち1つだけ（CLAUDE.md Section 20・v3.34）。新しいラボ機能を
 * 足すときはここに1つ id を足し、labOverlay の switch と（必要ならモバイル分岐に）
 * 1本分岐を足すだけでよい。
 * 【2026-08-10】OKRレポート／なぜなぜ分析／セッション記録（"kr-report" / "kr-why" /
 * "kr-session"）は、OKRモードのグループ側アーカイブに伴いここから撤去した
 * （src/components/okr/ARCHIVED.md 参照。ファイル自体は削除していない）。
 */
type LabViewId = "graph" | "calendar" | "structure" | "mypage";

/**
 * サイドバー幅（折りたたみ時）。Sidebar自身の width が参照する。展開時の幅は可変
 * （v3.66・境界のドラッグでリサイズ可能）のため、`src/lib/layout/sidebarWidth.ts` の
 * `SIDEBAR_DEFAULT_WIDTH`（196px）が既定値として使われる。
 */
const SIDEBAR_WIDTH_COLLAPSED = "48px";

interface Props {
  currentUser: Member;
  onLogout: () => void;
}

/**
 * 【i18n（Phase 1）】元は module 定数だったが、label/tooltipが t() 経由になったため
 * 現在言語(t)を受け取って組み立てる関数にした（ShortcutsPanel.tsxのbuildSectionsと同じ方針）。
 */
function buildNavItems(t: ReturnType<typeof useT>): { view: ViewMode; label: string; shortLabel: string; icon: React.ReactNode; tooltip: string }[] {
  return [
    { view: "dashboard", label: t("layout.nav.dashboard.label"), shortLabel: "DB", icon: <DashIcon />,   tooltip: t("layout.nav.dashboard.tooltip") },
    { view: "kanban",    label: t("layout.nav.kanban.label"),    shortLabel: "KB", icon: <KanbanIcon />, tooltip: t("layout.nav.kanban.tooltip") },
    { view: "gantt",     label: t("layout.nav.gantt.label"),     shortLabel: "GT", icon: <GanttIcon />,  tooltip: t("layout.nav.gantt.tooltip") },
    { view: "list",      label: t("layout.nav.list.label"),      shortLabel: "LT", icon: <ListIcon />,   tooltip: t("layout.nav.list.tooltip") },
    { view: "workload",  label: t("layout.nav.workload.label"),  shortLabel: "WL", icon: <WorkloadIcon />, tooltip: t("layout.nav.workload.tooltip") },
  ];
}

export function MainLayout(props: Props) {
  // ツアー機能を全体で使えるように。useTour() は MainLayoutInner で呼ぶ
  // ゲスト（サンプル閲覧）ではAI実演ステップ等を差し替えた版を使う（CLAUDE.md Section 23）。
  // useMemo で props.currentUser にのみ依存させ、毎レンダーで新しいオブジェクトを作らない
  // （tours が毎回別参照だと TourProvider 内の useCallback が作り直され不要な再レンダーを誘発する）。
  const tours = useMemo(
    () => buildTours({ isGuest: isGuestMember(props.currentUser) }),
    [props.currentUser]
  );
  return (
    <TourProvider tours={tours}>
      <MainLayoutInner {...props} />
    </TourProvider>
  );
}

function MainLayoutInner({ currentUser, onLogout }: Props) {
  const isMobile = useIsMobile();
  // ゲスト（閲覧のみ）：書き込みは client.ts でブロック済み。UI 側では設定（管理）を隠し、
  // 上部に閲覧専用バナーを出す。AI機能は表示する（反映だけブロックされる）。
  const isGuest = isGuestMember(currentUser);
  const { theme, toggle: toggleTheme } = useTheme();
  const t = useT();
  const NAV_ITEMS = useMemo(() => buildNavItems(t), [t]);
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
  const [consultDefaultMode, setConsultDefaultMode] = useState<"consult" | "meeting">("consult");
  // PJ作成導線などから AI相談チャットの入力欄に下書きをプレフィルするためのリクエスト
  const [consultPrefill, setConsultPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem(KEYS.SIDEBAR_COLLAPSED) === "1"
  );
  const toggleSidebar = () => setIsSidebarCollapsed(prev => {
    const next = !prev;
    localStorage.setItem(KEYS.SIDEBAR_COLLAPSED, next ? "1" : "0");
    return next;
  });
  // サイドバー幅（境界のドラッグ／キーボードでの変更。v3.66。折りたたみ時の48pxとは別に、
  // 展開時の幅だけを記憶する＝折りたたみ→展開で必ず記憶した幅に戻る）。
  // ConsultationPanel.tsx / PersonalOkrAiPanel.tsx の「左端ドラッグでリサイズ」と同じ流儀
  // （window の mousemove/mouseup・refで最新値を持つ・mouseup時にlocalStorageへ確定保存）だが、
  // 3箇所目にして初めてキーボード操作（矢印キー）とdblclickでの既定幅復帰が要件に入ったため、
  // 既存2箇所の共通化はしていない（判断理由はCLAUDE.md Section 20参照）。
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    () => parseStoredSidebarWidth(localStorage.getItem(KEYS.SIDEBAR_WIDTH))
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  const isDraggingSidebar = useRef(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartW = useRef(0);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

  const handleSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (isSidebarCollapsed) return; // 折りたたみ中はドラッグ不可
    e.preventDefault();
    isDraggingSidebar.current = true;
    sidebarDragStartX.current = e.clientX;
    sidebarDragStartW.current = sidebarWidthRef.current;
    setIsSidebarResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      // 右端ドラッグ：右に動かすと幅が増える
      const delta = e.clientX - sidebarDragStartX.current;
      const w = clampSidebarWidth(sidebarDragStartW.current + delta);
      sidebarWidthRef.current = w;
      setSidebarWidth(w);
    };
    const onUp = () => {
      if (!isDraggingSidebar.current) return;
      isDraggingSidebar.current = false;
      setIsSidebarResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(KEYS.SIDEBAR_WIDTH, String(sidebarWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleSidebarResizeDoubleClick = useCallback(() => {
    if (isSidebarCollapsed) return;
    sidebarWidthRef.current = SIDEBAR_DEFAULT_WIDTH;
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    try { localStorage.setItem(KEYS.SIDEBAR_WIDTH, String(SIDEBAR_DEFAULT_WIDTH)); } catch { /* ignore */ }
  }, [isSidebarCollapsed]);

  const handleSidebarResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isSidebarCollapsed) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? SIDEBAR_WIDTH_KEY_STEP : -SIDEBAR_WIDTH_KEY_STEP;
    const w = clampSidebarWidth(sidebarWidthRef.current + delta);
    sidebarWidthRef.current = w;
    setSidebarWidth(w);
    try { localStorage.setItem(KEYS.SIDEBAR_WIDTH, String(w)); } catch { /* ignore */ }
  }, [isSidebarCollapsed]);
  const [consultPanelWidth, setConsultPanelWidth] = useState(() => {
    try { return Math.min(800, Math.max(300, parseInt(localStorage.getItem(KEYS.CONSULT_PANEL_WIDTH) ?? "400", 10) || 400)); } catch { return 400; }
  });
  // AIパネルをドラッグでリサイズ中はwidth/rightの遷移アニメを切る（カーソル追従の遅延を防ぐ）
  const [isConsultResizing, setIsConsultResizing] = useState(false);
  // ラボ系ビュー（体制図・関係性グラフ・カレンダー・マイページ）は同時に1つだけ開く。
  // 真偽値を機能ごとに並べる旧方式は2つ同時にtrueになり得て、「押したのに切り替わらない」
  // 「押し直しても戻れない」の原因になっていた（山本さん指摘・2026-08-07。CLAUDE.md Section 20
  // 参照）。単一stateにすることで、2つ同時に開くこと自体が型レベルで不可能になる。
  // 【2026-08-10】OKRレポート／セッション記録／なぜなぜ分析はOKRモードのグループ側アーカイブに
  // 伴い LabViewId から撤去した（src/components/okr/ARCHIVED.md 参照）。
  const [activeLabView, setActiveLabView] = useState<LabViewId | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isMilestoneAddOpen, setIsMilestoneAddOpen] = useState(false);
  const [isPjCreateOpen, setIsPjCreateOpen] = useState(false);
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  const [isMobileLabOpen, setIsMobileLabOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  // バージョン履歴モーダル（v3.61）。サイドバー最下部・モバイルラボシートのVersionBadgeから開く。
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  // ショートカット一覧パネル（全ビュー共通・MainLayoutが唯一の描画元）。非モーダル・✕でのみ閉じる。
  // 開閉stateはここに1つだけ持ち、ガント凡例バーのリンクにも同じstateを渡して繋ぎ替える
  // （2つのパネルを作らない。CLAUDE.md 参照）。
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const toggleShortcuts = () => setIsShortcutsOpen(prev => !prev);
  const closeShortcuts = () => setIsShortcutsOpen(false);

  // Ctrl+K / Cmd+K でコマンドパレットをトグル（PC向け）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Ctrl+Z / Cmd+Z で「直前のUndo」を発火する軽量版Undo（アプリ全体）。
  // 本格的な多段Undo履歴は作らず、直前に出たUndoトースト1件だけを対象にする。
  // 入力欄（input/textarea/select/contenteditable）ではブラウザ標準のテキストUndoを
  // 優先させるため、ここでは何もしない（preventDefaultしない・自前Undoも発火しない）。
  // Redo（Shift+Ctrl/Cmd+Z）は今回未実装（将来課題）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
        || (el instanceof HTMLElement && el.isContentEditable);
      if (isEditable) return;
      const action = consumeLastUndoAction();
      if (!action) return;
      e.preventDefault();
      action();
      dismissUndoToasts();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 期限のブラウザ通知（自分の notify_pref==="browser" のときだけ発火・アプリ表示中のみ）
  useDeadlineNotifications(currentUser.id);
  // @メンション通知（コメントに @自分 が新たに現れたらブラウザ通知）
  useMentionNotifications(currentUser.id);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  // プロジェクト招待：招待コードを手入力して参加する入口（Phase 4・山本さんの指摘対応）。
  // AdminViewの「プロジェクト招待」タブは部署管理者限定（管理者が1人もいない部署は
  // ブートストラップモードで全員アクセス可だが、通常は非管理者から到達できない）のため、
  // 「招待コードを持つ人なら誰でも受け入れられる」べきこの入口はAdminViewの外に置く
  // （CLAUDE.md Section 25参照）。
  const [isAcceptInviteOpen, setIsAcceptInviteOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isOnboardingOverlayOpen, setIsOnboardingOverlayOpen] = useState(false);
  // ツアーの実演（AI相談）で相談パネルに渡す自動入力リクエスト
  const [consultDemoRequest, setConsultDemoRequest] = useState<{ text: string; nonce: number } | null>(null);

  // ツアー：初回起動で「見ますか？」ダイアログ → ユーザー選択で start
  const tour = useTour();
  const [showTourInvite, setShowTourInvite] = useState<boolean>(() => !tour.isCompleted(FIRST_TIME_TOUR_ID));
  // 招待ダイアログのスキップ判定を localStorage に永続化（再ログイン時に再表示しない）
  useEffect(() => {
    if (tour.isCompleted(FIRST_TIME_TOUR_ID)) setShowTourInvite(false);
  }, [tour]);
  // ツアーの実演アクションを受信 → AI相談パネルを開いて例文を自動入力・送信させる。
  // StrictMode の副作用二重実行等で "tour:action" が二重発火しても二重送信しないよう、
  // 直近に起動したら短時間は重複トリガを無視する（再入防止）。
  const demoTriggerGuardRef = useRef(false);
  // ツアーの "open-dashboard-pj-analysis" アクションで参照するため、最新の projects を ref で持つ
  const projectsRef = useRef<Project[]>([]);
  // ツアーの "demo-ai-consult" アクションで、実データの有無を判定するため最新の tasks を ref で持つ
  const tasksRef = useRef<Task[]>([]);
  // 【バグ修正・v3.19】t はマウント時にクロージャで固定される（下のuseEffectのdeps=[]）ため、
  // マウント後に言語を切り替えてからツアーデモを発火すると切替前の言語の文言が入っていた。
  // リスナーの張り替え（deps に t を足す）ではなく、ref で最新の t を参照する形で直す。
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const onTourAction = (e: Event) => {
      const action = (e as CustomEvent).detail as string;
      if (action === "demo-ai-consult") {
        if (demoTriggerGuardRef.current) return; // 直近に起動済み → 重複は無視
        demoTriggerGuardRef.current = true;
        window.setTimeout(() => { demoTriggerGuardRef.current = false; }, 4000);
        setConsultDefaultMode("consult");
        setIsConsultOpen(true);
        // 部署スコープ済みのPJ/タスクが1件でもあれば、AIが送っているコンテキストを
        // 実際に活かせる分析質問にする。まだ何も無ければ始め方の質問にフォールバック
        const hasData = projectsRef.current.length > 0 || tasksRef.current.length > 0;
        setConsultDemoRequest({
          text: hasData
            ? tRef.current("layout.tourDemo.withData")
            : tRef.current("layout.tourDemo.noData"),
          nonce: Date.now(),
        });
      }
      // ダッシュボードへ移動して最初のアクティブPJを選択（pj-karteツアーステップ用）
      if (action === "open-dashboard-pj-analysis") {
        setViewMode("dashboard");
        const firstPj = projectsRef.current[0];
        if (firstPj) setSelectedProjectId(firstPj.id);
      }
    };
    window.addEventListener("tour:action", onTourAction);
    return () => window.removeEventListener("tour:action", onTourAction);
  }, []);
  const [graphEditTaskId, setGraphEditTaskId] = useState<string | null>(null);
  // カレンダー/グラフなど zIndex が高いオーバーレイ上でタスク編集を開く専用 state。
  // TaskEditModal の zIndex(200) < CalendarLabView(250) のため、カレンダーの上に
  // 出るよう zIndex:300 のラッパーでレンダリングする。
  const [calendarEditTaskId, setCalendarEditTaskId] = useState<string | null>(null);
  // ③ カレンダーの日付セルから開くQuickAddTaskModal（zIndex 300 で calendarEditTaskId と同じ流儀）
  const [calendarQuickAddDate, setCalendarQuickAddDate] = useState<string | null>(null);
  // マイページ（ラボ機能）：CalendarLabView と全く同じ流儀（zIndex 250のオーバーレイ＋
  // タスク編集はzIndex 300のラッパーで重ねる）
  const [myPageEditTaskId, setMyPageEditTaskId] = useState<string | null>(null);
  const [aiEditTaskId, setAiEditTaskId] = useState<string | null>(null);

  /**
   * ラボ系ビューを開く／切り替える唯一の入口（choke point）。`setActiveLabView` を直接
   * 呼ぶ箇所はこのヘルパーと `closeLabViews` の中だけに限定すること
   * （`src/components/__tests__/labViewChokePoint.test.ts` が機械的に検査する）。
   *
   * GraphView・CalendarLabView・MyPageView が持つ「タスク編集モーダルを開く」ための一時state
   * （`graphEditTaskId`/`calendarEditTaskId`/`calendarQuickAddDate`/`myPageEditTaskId`）は
   * 開いているビューに紐づくものであり、ビューが実際に切り替わった後まで残っていると
   * 「どのビューから開いたか分からない浮遊モーダル」になる（2026-08-07・統括レビュー指摘。
   * v3.33まではラボビューを2つ同時に開けなかったため「ビューAからビューBへ切り替える」操作
   * 自体が存在せず、この不具合は起こり得なかった。v3.34の単一state化で切り替えが可能になり、
   * 初めて到達可能になった経路）。そのため「前と違うidに変わる」ときだけ、この4つをまとめて
   * クリアする。**同じビューをもう一度開く操作（例：MyPage表示中にonOpenTaskで
   * myPageEditTaskIdをセットする通常操作）まで巻き込まないよう、「前と同じidなら何もしない」
   * を先に判定する**（クリアするのは「切り替わったとき」「閉じたとき」だけ）。
   */
  const openLabView = (id: LabViewId) => {
    if (activeLabView !== id) {
      setGraphEditTaskId(null);
      setCalendarEditTaskId(null);
      setCalendarQuickAddDate(null);
      setMyPageEditTaskId(null);
    }
    setActiveLabView(id);
  };

  /**
   * 開いていると全画面（PC）を覆う「ラボ系ビュー」を全て閉じる。付随する一時state
   * （タスク編集モーダル等。理由は openLabView のコメント参照）も同時にクリアする。
   * サイドバーからのナビ操作（ビュー切替・モード切替・PJ/KR/部署選択）や、各ビューの✕ボタン
   * から呼ぶことで、「ラボ系ビューを開いたままメインエリアの表示だけが裏で切り替わる」混乱と、
   * 「閉じたビューの編集モーダルだけが浮遊する」混乱の両方を防ぐ（CLAUDE.md Section 20）。
   */
  const closeLabViews = () => {
    setGraphEditTaskId(null);
    setCalendarEditTaskId(null);
    setCalendarQuickAddDate(null);
    setMyPageEditTaskId(null);
    setActiveLabView(null);
  };

  const [appMode, setAppModeState] = useState<AppMode>(() =>
    (localStorage.getItem(KEYS.APP_MODE) as AppMode | null) ?? "plan"
  );
  const setAppMode = (m: AppMode) => {
    closeLabViews();
    localStorage.setItem(KEYS.APP_MODE, m);
    setAppModeState(m);
  };
  // OKRモードの初回ゲート（紹介ポップアップ＋データ読み込みの承認。v3.39・
  // src/lib/okr/okrModeGate.ts・CLAUDE.md Section 19）。plan→okr の切替だけを対象にする
  // （okr→plan に戻る操作にゲートは不要）。「OKR」トグルの呼び出し口はPC/モバイル共通で
  // この1関数に集約する（setActiveLabView と同じ choke point の考え方）。
  const [okrIntroOpen, setOkrIntroOpen] = useState(false);
  const handleToggleAppMode = () => {
    if (appMode !== "plan") { setAppMode("plan"); return; }
    if (shouldShowOkrModeIntro(hasApprovedOkrModeIntro(), isGuest)) {
      setOkrIntroOpen(true);
      return;
    }
    setAppMode("okr");
  };
  // ゲストバナーの「サンプルを初期状態に戻す」（2026-08-12）。appStore（タスク・PJ・
  // マイルストーン等）を dataset.ts の初期値で再注入するだけ。デモデータのidは固定
  // （"demo-"接頭辞・毎回同じ）なので、リセット後も開いたままのモーダル等が指すidが
  // ずれて壊れることはない。OKRモード「自分」タブのゲストデータ（personalOkrUiStore）は
  // 今回の対象範囲外のため、このボタンはappMode==="plan"のときだけ表示する。
  const handleGuestReset = async () => {
    if (!await confirmDialog(t("layout.guestReset.confirm"))) return;
    // loadDemoDataset自体は薄いラッパー（App.tsxも静的import済み・上のコメント参照）で
    // データ本体（dataset.ts/guestPersona.ts）はその内部で動的importするため、ここで
    // 静的importしてもSection 19のダウンロード量最小化は崩れない。
    const dataset = await loadDemoDataset();
    useAppStore.getState().loadDemoData(dataset);
    showToast(t("layout.guestReset.done"), "success");
  };
  // サイドバーのビュー切替ナビ専用（PC）。ツアーの内部遷移（"tour:action" ハンドラ）は
  // 素の setViewMode を使い続ける（closeLabViewsを挟むと、その効果のexhaustive-depsで
  // setViewModeが不安定と判定され警告が出るため、ナビ経由の呼び出しだけをここで分離する）。
  const navSetViewMode = (v: ViewMode) => {
    closeLabViews();
    setViewMode(v);
  };

  const allProjects = useAppStore(selectScopedProjects);
  const rawKrs      = useAppStore(s => s.keyResults);
  const rawObjectives = useAppStore(s => s.objectives);
  const rawTfs      = useAppStore(s => s.taskForces);
  const rawTtfs     = useAppStore(s => s.taskTaskForces);
  const rawTasks    = useAppStore(selectScopedTasks);
  const saveTask    = useAppStore(s => s.saveTask);
  // 部署切替UI（サイドバー）用。CLAUDE.md Section 1.6参照。
  const rawGroups              = useAppStore(s => s.groups);
  const currentGroupId         = useAppStore(s => s.currentGroupId);
  const setCurrentGroupId      = useAppStore(s => s.setCurrentGroupId);
  const currentUserIsSuperAdmin = useAppStore(s => s.currentUserIsSuperAdmin);
  // プロジェクト招待の兼務（is_invite_group=true）は「表示部署」切替の選択肢から除く。
  // 招待された本人（招待用部署しか持たない）の場合は除外すると選べる部署が無くなるため、
  // 除外しない（filterInviteGroupsForSidebar内部で自動的に判定。CLAUDE.md Section 25参照）。
  const accessibleGroups = useMemo(() => {
    const groupsActive = rawGroups.filter(g => !g.is_deleted);
    if (currentUserIsSuperAdmin) return filterInviteGroupsForSidebar(groupsActive);
    const ids = currentUser.group_ids?.length ? currentUser.group_ids
      : (currentUser.group_id ? [currentUser.group_id] : []);
    return filterInviteGroupsForSidebar(groupsActive.filter(g => ids.includes(g.id)));
  }, [rawGroups, currentUserIsSuperAdmin, currentUser.group_ids, currentUser.group_id]);
  // 「完了・アーカイブも表示」トグル（既定OFF）。CLAUDE.md参照：既定ではactiveのみ表示、
  // completed/archivedはこのトグルで表示/非表示を切り替える（v3.50。山本さんの要望・2026-08-11）。
  const [showCompletedAndArchived, setShowCompletedAndArchivedState] = useState<boolean>(
    () => localStorage.getItem(KEYS.SIDEBAR_SHOW_COMPLETED_ARCHIVED) === "1", // デフォルト OFF
  );
  const toggleShowCompletedAndArchived = () => setShowCompletedAndArchivedState(prev => {
    const next = !prev;
    localStorage.setItem(KEYS.SIDEBAR_SHOW_COMPLETED_ARCHIVED, next ? "1" : "0");
    return next;
  });
  const projects = useMemo(
    () => filterSidebarProjects(allProjects, {
      showCompletedAndArchived, mineOnly: false, myProjectIds: EMPTY_ID_SET,
      pinnedProjectId: selectedProjectId,
    }),
    [allProjects, showCompletedAndArchived, selectedProjectId]
  );
  // ツアーのアクションハンドラが最新のprojectsを参照できるよう同期
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  // ツアーの "demo-ai-consult" アクションが最新のtasks（スコープ済み・非削除）を参照できるよう同期
  useEffect(() => { tasksRef.current = (rawTasks ?? []).filter((t: Task) => !t.is_deleted); }, [rawTasks]);
  // 「OKRタスク」KR一覧は表示中の部署（currentGroupId）でスコープする（CLAUDE.md Section 1.6参照。
  // OKR系はRLS非対応のため全員が全部署分を手元に持っており、Objective.group_id経由で絞り込む）。
  const keyResults = useMemo(
    () => keyResultsInGroup((rawKrs ?? []).filter((kr: KeyResult) => !kr.is_deleted), rawObjectives, currentGroupId),
    [rawKrs, rawObjectives, currentGroupId],
  );

  // 「自分が担当タスクを持つPJ」。サイドバーの「自分」モードで各ビューが
  // 担当者=自分のタスクに絞られるのと連動して PJ 表示も絞る。
  const myProjectIds = useMemo(() => {
    const ids = new Set<string>();
    (rawTasks ?? []).forEach((t: Task) => {
      if (t.is_deleted || !t.project_id) return;
      if (isAssignedTo(t, currentUser.id)) ids.add(t.project_id);
    });
    return ids;
  }, [rawTasks, currentUser.id]);

  const [mineOnly, setMineOnlyState] = useState<boolean>(
    () => localStorage.getItem(KEYS.SIDEBAR_MY_PROJECTS_ONLY) !== "0", // デフォルト ON
  );
  const toggleMineOnly = () => setMineOnlyState(prev => {
    const next = !prev;
    localStorage.setItem(KEYS.SIDEBAR_MY_PROJECTS_ONLY, next ? "1" : "0");
    return next;
  });

  const visibleProjects = useMemo(
    () => mineOnly ? projects.filter(p => myProjectIds.has(p.id)) : projects,
    [projects, mineOnly, myProjectIds],
  );

  // コマンドパレットの検索対象タスク（スコープ済み・非削除）
  const paletteTasks = useMemo(
    () => (rawTasks ?? []).filter((t: Task) => !t.is_deleted),
    [rawTasks],
  );

  const [selectedKrId, setSelectedKrId] = useState<string | null>(null);

  const handleSelectProject = (id: string | null) => {
    closeLabViews();
    setSelectedProjectId(id);
    setSelectedKrId(null);
  };
  const handleSelectKr = (id: string | null) => {
    closeLabViews();
    setSelectedKrId(id);
    setSelectedProjectId(null);
  };
  // サイドバーの部署切替（CLAUDE.md Section 1.6）：表示データの範囲が変わるナビ操作のため
  // ビュー切替等と同様にラボ系ビューを閉じる
  const handleSelectGroupNav = (id: string) => {
    closeLabViews();
    setCurrentGroupId(id);
  };

  // マイページ（ウィジェット）のQuickAddTaskWidget向け。ウィジェットからsaveTaskを直接呼ばせず、
  // 必ずこのホスト側から appStore.saveTask を呼ぶ（B1依存ゲート・B4ベースライン・v2.75親自動完了
  // などの choke point を通すため。CLAUDE.md「actions の拡張ポリシー」参照）。
  // フィールドの形はGanttViewのhandleQuickAddTask（v3.04）を雛形にした（uuidv4／status "todo"／
  // updated_byはcurrentUser.id／group_idはappStoreが自動注入）。
  const handleMyPageCreateTask = useCallback(async (draft: { name: string; projectId?: string | null; dueDate?: string | null }) => {
    const now = new Date().toISOString();
    const projectId = draft.projectId ?? null;
    const siblings = paletteTasks.filter(t => (t.project_id ?? null) === projectId && !t.parent_task_id);
    const nextOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(t => t.display_order ?? 0)) + 1;
    const task: Task = {
      id: uuidv4(),
      name: draft.name,
      project_id: projectId,
      parent_task_id: null,
      display_order: nextOrder,
      todo_ids: [],
      assignee_member_id: "",
      assignee_member_ids: [],
      status: "todo",
      priority: null,
      start_date: null,
      due_date: draft.dueDate ?? null,
      estimated_hours: null,
      comment: "",
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: currentUser.id,
    };
    await saveTask(task);
  }, [paletteTasks, saveTask, currentUser.id]);

  // 設定/ガイドはメインコンテンツ領域の独立パネルとして表示する。
  // ビュー・モード・PJ・KR・OKRツールなどナビ操作で切り替えたら自動的に閉じる
  // （その操作対象のビューを mainContent に出すため）。閉じるのは✕とこのeffectのみ。
  useEffect(() => {
    setIsAdminOpen(false);
    setIsGuideOpen(false);
  }, [viewMode, appMode, selectedProjectId, selectedKrId]);

  /**
   * 「AIでPJを作る」導線。新規PJ作成は AI相談（consult）チャットの add_project 提案で行う前提に
   * 統一したため、create モードは廃止。consult チャットを開き、入力欄に下書きをプレフィルする
   * （送信はせず、ユーザーが目的・背景を追記してから送る）。
   */
  const openAiProjectCreate = () => {
    setConsultDefaultMode("consult");
    setIsConsultOpen(true);
    setConsultPrefill({
      text: t("layout.aiProjectCreate.prefill"),
      nonce: Date.now(),
    });
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
    <div style={{
      flex: 1, minHeight: 0,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
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
        <span style={{ fontSize: "13px", fontWeight: "700", flex: 1, color: "var(--color-text-primary)" }}>{t("layout.admin.title")}</span>
        <HelpButton modeKey="admin.settings" title={t("layout.admin.helpTitle")} />
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

  // 📖 ガイド（全モード共通・全画面オーバーレイ）
  // 初回起動時の「ツアーを見ますか？」招待ダイアログ
  const tourInviteDialog = showTourInvite ? (
    <div
      style={{ ...modalOverlayStyle(270), background: "rgba(0,0,0,0.4)", padding: "16px" }}
    >
      <div style={{
        ...modalBoxStyle("min(460px, 100%)"),
        overflow: "auto",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: "24px 26px",
      }}>
        <div style={{ fontSize: "20px", marginBottom: "6px" }}>👋</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "8px" }}>
          {t("layout.tourInvite.title")}
        </div>
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: "16px" }}>
          {t("layout.tourInvite.body1")}<br />
          {t("layout.tourInvite.body2")}
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={() => { setShowTourInvite(false); tour.markCompleted(FIRST_TIME_TOUR_ID); /* 開始せず完了フラグを保存。再ログインで再表示しない */ }}
            style={{
              padding: "8px 14px", fontSize: "12px",
              background: "transparent", color: "var(--color-text-tertiary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            {t("layout.tourInvite.skip")}
          </button>
          <button
            onClick={() => { setShowTourInvite(false); tour.start(FIRST_TIME_TOUR_ID); }}
            style={{
              padding: "8px 18px", fontSize: "12px", fontWeight: 600,
              background: "var(--color-brand)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            {t("layout.tourInvite.start")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // OKRモードの初回ゲート（v3.39）。PC・モバイル両方の return ブロックで参照するため
  // onboardingOverlay/tourInviteDialog と同じく1つの変数として組み立てる。
  const okrIntroModal = okrIntroOpen ? (
    <OkrModeIntroModal
      onApprove={() => { markOkrModeIntroApproved(); setOkrIntroOpen(false); setAppMode("okr"); }}
      onCancel={() => setOkrIntroOpen(false)}
    />
  ) : null;

  const onboardingOverlay = isOnboardingOverlayOpen ? (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      onClick={() => setIsOnboardingOverlayOpen(false)}
      style={{ ...modalOverlayStyle(260), background: "rgba(0,0,0,0.4)", padding: "16px" }}
    >
      {/* イベントバブリング防止用のラッパー（クリックしても何も起きない） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="animate-fadeIn"
        onClick={e => e.stopPropagation()}
        style={{
          ...modalBoxStyle("min(780px, 100%)"),
          overflow: "auto",
          background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{
          padding: "10px 14px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          background: "var(--color-bg-secondary)",
        }}>
          <span style={{ fontSize: "13px", fontWeight: 700, flex: 1, color: "var(--color-text-primary)" }}>
            {t("layout.onboarding.title")}
          </span>
          <button
            onClick={() => setIsOnboardingOverlayOpen(false)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: "16px", color: "var(--color-text-tertiary)", padding: "4px",
            }}
          >✕</button>
        </div>
        <Suspense fallback={<ViewLoading />}>
          <OnboardingHome
            krCount={active(keyResults).length}
            pjCount={projects.length}
            taskCount={(rawTasks ?? []).filter((t: Task) => !t.is_deleted).length}
            onOpenAdmin={() => { setIsOnboardingOverlayOpen(false); setIsAdminOpen(true); }}
            onOpenAiProject={() => { setIsOnboardingOverlayOpen(false); openAiProjectCreate(); }}
            onOpenQuickAdd={() => { setIsOnboardingOverlayOpen(false); setIsQuickAddOpen(true); }}
          />
        </Suspense>
      </div>
    </div>
  ) : null;

  const guideOverlay = isGuideOpen ? (
    <div style={{
      flex: 1, minHeight: 0,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      background: "var(--color-bg-primary)",
    }}>
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center", gap: "10px",
        flexShrink: 0,
        background: "var(--color-bg-secondary)",
      }}>
        <span style={{ fontSize: "15px" }}>📖</span>
        <span style={{ fontSize: "13px", fontWeight: "700", flex: 1, color: "var(--color-text-primary)" }}>{t("layout.guide.title")}</span>
        <button
          onClick={() => setIsGuideOpen(false)}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: "18px", color: "var(--color-text-tertiary)", padding: "4px",
            lineHeight: 1,
          }}
        >✕</button>
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <Suspense fallback={<ViewLoading />}>
          <GuideModeView
            onShowOnboarding={() => setIsOnboardingOverlayOpen(true)}
            onStartTour={(tourId: string) => { setIsGuideOpen(false); tour.start(tourId); }}
          />
        </Suspense>
      </div>
    </div>
  ) : null;

  // ショートカット一覧パネルで「現在のビュー」を強調するための対象（計画モードのビューのみ対応。
  // OKRモード・ダッシュボード・ワークロード・設定は対応セクションが無いためハイライト無し＝
  // 「全ビュー共通」だけが表示される）
  const shortcutsCurrentView = appMode === "plan" ? viewMode : null;

  // 全ビュー共通・画面右下付近に薄く常設する「⌨ ショートカット」affordance。
  // 【配置の注意】Toast（bottom:24/right:24, z10000）・ErrorBar（bottom:0 全幅, z9000）と
  // 座標が重ならないよう、Toast/FAB/ErrorBarの通常時の占有域より上（bottom:100px/128px）に置く。
  // z-indexはモーダル類（z200以上）より低く保つ（モーダル表示中はこのボタンが上に浮いて見えない
  // ようにするため）。Toast/ErrorBarは元々モーダルより上に出る設計のため、それらが同じ位置に
  // 一時的に重なった場合はToast/ErrorBarが上に見える＝トーストは自動で数秒で消えるため実害は小さい。
  // AI相談パネル（PC・インライン）が開いているときは、FABと同じ考え方でパネル幅ぶん左へ避ける。
  // 【FAB展開時の重なり対策】FABを開くと展開項目（3つ）がFABボタンの上に積み上がる
  // （PC: bottom 74px起点で高さ約126px＝top端200px付近／モバイル: bottom 122px起点で
  // 高さ約124px＝top端246px付近）。このショートカットボタンのz-index(140)はFAB展開項目(59)
  // より高いため、通常位置のままだと展開項目の上に覆い被さって視認性を損なう＝これが
  // 「＋ボタンを押すとショートカットボタンと被る」の実体。isFabMenuOpen中だけ展開項目の
  // 積み上げ範囲より上（PC:216px/モバイル:270px）へ退避させ、閉じたら元の位置に戻す。
  const shortcutsButton = (
    <button
      onClick={toggleShortcuts}
      title={t("layout.shortcuts.buttonTitle")}
      aria-pressed={isShortcutsOpen}
      style={{
        position: "fixed",
        bottom: isFabMenuOpen
          ? (isMobile ? "270px" : "216px")
          : (isMobile ? "128px" : "100px"),
        right: (!isMobile && isConsultOpen) ? `${consultPanelWidth + 16}px` : "16px",
        transition: isConsultResizing ? "bottom 0.2s ease" : "right 0.3s ease, bottom 0.2s ease",
        zIndex: 140,
        display: "flex", alignItems: "center", gap: "5px",
        padding: "6px 10px",
        fontSize: "11px", fontWeight: 500,
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--radius-full)",
        color: "var(--color-text-tertiary)",
        boxShadow: "var(--shadow-md)",
        cursor: "pointer",
        opacity: 0.85,
      }}
    >
      <span style={{ fontSize: "12px", lineHeight: 1 }}>⌨</span>
      <span>{t("layout.shortcuts.buttonLabel")}</span>
    </button>
  );

  /**
   * 全画面ラボ系ビュー（体制図・関係性グラフ・カレンダー・マイページ）をメインエリア内
   * （mainContent）に描画するための束ね。PCのみが対象（モバイルは呼び出し側の
   * MobileFullscreenOverlay で全画面表示する。CLAUDE.md Section 20・v3.33）。
   * activeLabView は常に1つの id しか持てないため、旧方式にあった「宣言順で先勝ち」という
   * 概念自体が無くなった（CLAUDE.md Section 20・v3.34）。switch の default で LabViewId を
   * never に代入させており、id を追加したのに分岐を書き忘れると型エラーで気づける。
   */
  const labOverlay = isMobile ? null : (() => {
    switch (activeLabView) {
      case "graph":
        return (
          <Suspense fallback={<ViewLoading />}>
            <GraphView onClose={closeLabViews} currentUser={currentUser} onOpenTask={taskId => setGraphEditTaskId(taskId)} />
          </Suspense>
        );
      case "calendar":
        return (
          <Suspense fallback={<ViewLoading />}>
            <CalendarLabView
              onClose={closeLabViews}
              currentUser={currentUser}
              onOpenTask={taskId => setCalendarEditTaskId(taskId)}
              onRequestQuickAdd={dateStr => setCalendarQuickAddDate(dateStr)}
            />
          </Suspense>
        );
      case "structure":
        return (
          <Suspense fallback={<ViewLoading />}>
            <ProjectStructureView onClose={closeLabViews} currentUser={currentUser} />
          </Suspense>
        );
      case "mypage":
        return (
          <Suspense fallback={<ViewLoading />}>
            <MyPageView
              onClose={closeLabViews}
              currentUser={currentUser}
              onOpenTask={taskId => setMyPageEditTaskId(taskId)}
              onNavigate={v => { setAppMode("plan"); setViewMode(v); }}
              onCreateTask={handleMyPageCreateTask}
            />
          </Suspense>
        );
      case null:
        return null;
      default: {
        const _exhaustive: never = activeLabView;
        return _exhaustive;
      }
    }
  })();

  const mainContent = (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      // モバイルのボトムナビはappMode==="plan"の時だけ出す（OKRモードは個人OKR1画面のみで
      // 切り替える先が無いため。上の「モバイル：ボトムナビ」参照）。
      paddingBottom: isMobile && appMode === "plan" ? "56px" : 0,
    }}>
      {isGuest && (
        <div style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          padding: "5px 12px",
          background: "linear-gradient(135deg,#f59e0b,#d97706)",
          color: "#fff", fontSize: "11px", fontWeight: 600,
        }}>
          {/* 【v3.71で訂正】このコメントはv3.69（日常編集の開放）より前の状態を書いたまま
              取り残されていた。現在はplanモード（タスク・カンバン・ガント・PJ・マイルストーン・
              AI提案の反映）もOKRモードの「自分」タブと同様に編集可能（実際はメモリ上のみ・
              リロードで消える）。appModeに応じてバナー文言を切り替えるのは、リセット
              ボタン（↺ サンプルを初期状態に戻す）がplanモードのデータしか対象にしないため
              （personalOkrUiStoreのゲストデータは対象外。CLAUDE.md Section 23）。
              編集不可のまま残る画面はAdminView（設定画面）配下のみ。 */}
          <span>{appMode === "okr" ? t("layout.guestBannerOkr") : t("layout.guestBanner")}</span>
          {appMode === "plan" && (
            <button
              onClick={() => void handleGuestReset()}
              style={{
                flexShrink: 0,
                padding: "2px 9px",
                fontSize: "11px", fontWeight: 600,
                background: "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.4)",
                borderRadius: "var(--radius-full)",
                color: "#fff", cursor: "pointer",
              }}
            >{t("layout.guestReset.button")}</button>
          )}
          <GuestAiQuotaNotice variant="banner" />
        </div>
      )}
      {isGuideOpen ? guideOverlay : (isAdminOpen && !isGuest) ? adminOverlay : labOverlay ? labOverlay : appMode === "okr" ? (
        <div key="okr" className="animate-fadeIn" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <Suspense fallback={<ViewLoading />}>
            <OkrDashboardView currentUser={currentUser} />
          </Suspense>
        </div>
      ) : (
        /* key={viewMode} でビュー切り替え時に animate-fadeIn が毎回発火する */
        <div key={viewMode} className="animate-fadeIn" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <Suspense fallback={<ViewLoading />}>
            {viewMode === "dashboard" && (
              <DashboardView
                currentUser={currentUser}
                projects={projects}
                selectedProject={selectedProject}
                onClearProjectFilter={() => handleSelectProject(null)}
                onOpenAiProject={openAiProjectCreate}
                onOpenAdmin={() => setIsAdminOpen(true)}
                onOpenQuickAdd={() => setIsQuickAddOpen(true)}
                mineOnly={mineOnly}
                onToggleMineOnly={toggleMineOnly}
                onOpenTask={setAiEditTaskId}
              />
            )}
            {viewMode === "kanban" && (
              <KanbanView
                currentUser={currentUser}
                selectedProject={selectedProject}
                projects={projects}
                selectedKrId={selectedKrId}
                krTaskIds={krTaskIds}
                mineOnly={mineOnly}
              />
            )}
            {viewMode === "gantt" && (
              <GanttView
                currentUser={currentUser}
                selectedProject={selectedProject}
                projects={projects}
                selectedKrId={selectedKrId}
                krTaskIds={krTaskIds}
                mineOnly={mineOnly}
                shortcutsOpen={isShortcutsOpen}
                onToggleShortcuts={toggleShortcuts}
              />
            )}
            {viewMode === "list" && (
              <ListView
                currentUser={currentUser}
                selectedProject={selectedProject}
                projects={projects}
                selectedKrId={selectedKrId}
                krTaskIds={krTaskIds}
                mineOnly={mineOnly}
              />
            )}
            {viewMode === "workload" && (
              <WorkloadView projects={projects} onOpenTask={setAiEditTaskId} />
            )}
            {viewMode !== "dashboard" && viewMode !== "kanban" && viewMode !== "gantt" && viewMode !== "list" && viewMode !== "admin" && viewMode !== "workload" && (
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
        {onboardingOverlay}
        {tourInviteDialog}
        {okrIntroModal}
        {isQuickAddOpen && (
          <QuickAddTaskModal currentUser={currentUser} projects={projects} defaultProjectId={selectedProject?.id} onClose={() => setIsQuickAddOpen(false)} />
        )}
        {isMilestoneAddOpen && (
          <MilestoneAddModal currentUser={currentUser} projects={projects} defaultProjectId={selectedProject?.id} onClose={() => setIsMilestoneAddOpen(false)} />
        )}
        {isAcceptInviteOpen && (
          <AcceptInviteModal currentUser={currentUser} onClose={() => setIsAcceptInviteOpen(false)} />
        )}
        {activeLabView === "graph" && (
          <MobileFullscreenOverlay zIndex={200}>
            <Suspense fallback={<ViewLoading />}>
              <GraphView onClose={closeLabViews} currentUser={currentUser} onOpenTask={taskId => setGraphEditTaskId(taskId)} />
            </Suspense>
          </MobileFullscreenOverlay>
        )}
        {/* CalendarLabView・MyPageView はモバイル・PC 共通で PC return ブロック側
            （mainContent 内）に1つだけ置く。ここに置くと PC では2つ同時にDOMに
            存在してしまい印刷2ページ・マイルストーン重複が起きる（＝この2つはモバイルの
            全画面表示に入口が無い。activeLabView がこの2値になっても何も描画しない） */}
        {activeLabView === "structure" && (
          <MobileFullscreenOverlay zIndex={250}>
            <Suspense fallback={<ViewLoading />}>
              <ProjectStructureView onClose={closeLabViews} currentUser={currentUser} />
            </Suspense>
          </MobileFullscreenOverlay>
        )}
        {graphEditTaskId && (
          <TaskEditModal taskId={graphEditTaskId} currentUser={currentUser} onClose={() => setGraphEditTaskId(null)} />
        )}
        {/* カレンダーからのタスク編集：zIndex:300 でカレンダー(250)の上に出す */}
        {calendarEditTaskId && (
          <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
            <TaskEditModal taskId={calendarEditTaskId} currentUser={currentUser} onClose={() => setCalendarEditTaskId(null)} />
          </div>
        )}
        {aiEditTaskId && (
          <TaskEditModal taskId={aiEditTaskId} currentUser={currentUser} onClose={() => setAiEditTaskId(null)} />
        )}
        <CommandPalette
          isOpen={isPaletteOpen}
          onClose={() => setIsPaletteOpen(false)}
          tasks={paletteTasks}
          projects={projects}
          canCreate={canGuestEdit(isGuest, "task")}
          onOpenTask={setAiEditTaskId}
          onSelectProject={id => { setAppMode("plan"); handleSelectProject(id); }}
          onSwitchView={v => { setAppMode("plan"); setViewMode(v); }}
          onQuickAdd={() => setIsQuickAddOpen(true)}
          onOpenConsult={() => { setConsultDefaultMode("consult"); setIsConsultOpen(true); }}
        />
        {/* ラボ機能ボトムシート */}
        {isMobileLabOpen && (
          // 背景クリック・Escapeキーで閉じる（項目を選ばずに閉じる唯一の手段のため、
          // 他の背景オーバーレイと違いここは実際にキーボード操作可能にする）
          <div
            className="animate-overlay"
            style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)" }}
            onClick={() => setIsMobileLabOpen(false)}
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") setIsMobileLabOpen(false); }}
          >
            {/* イベントバブリング防止用のラッパー（クリックしても何も起きない） */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 10px" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.05em" }}>
                  {t("layout.lab.sheetTitle")}
                </span>
                {/* バージョン表示（控えめ・自然に置ける場所としてこのシートのタイトル行に添える） */}
                <VersionBadge onClick={() => { setIsMobileLabOpen(false); setIsVersionHistoryOpen(true); }} />
              </div>
              {[
                { icon: "🏢", label: t("layout.lab.structure.label"), desc: t("layout.lab.structure.desc"), onClick: () => { openLabView("structure"); setIsMobileLabOpen(false); } },
                { icon: "🕸️", label: t("layout.lab.graph.label"), desc: t("layout.lab.graph.desc"), onClick: () => { openLabView("graph"); setIsMobileLabOpen(false); } },
                { icon: "🗓️", label: t("layout.lab.calendar.label"), desc: t("layout.lab.calendar.desc"), onClick: () => { openLabView("calendar"); setIsMobileLabOpen(false); } },
                { icon: "🧩", label: t("layout.lab.mypage.label"), desc: t("layout.lab.mypage.desc"), onClick: () => { openLabView("mypage"); setIsMobileLabOpen(false); } },
                // 招待コードを入力（Phase 4・v3.68）：モバイルヘッダーは既にアイコンが
                // 密集しているため、既存のラボシート（縦に余裕がある）に置く（ゲストは除く）。
                ...(!isGuest ? [{ icon: "🎫", label: t("layout.acceptInvite.title"), desc: t("layout.acceptInvite.desc"), onClick: () => { setIsMobileLabOpen(false); setIsAcceptInviteOpen(true); } }] : []),
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
          <AppModeToggle mode={appMode} onToggle={handleToggleAppMode} compact />
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
              <option value="">{mineOnly ? t("layout.mobile.myPj") : t("layout.mobile.allPj")}</option>
              {visibleProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {/* AI相談ボタン */}
          {/* 検索（コマンドパレット。モバイルはCtrl+Kが使えないためボタンが唯一の起動手段） */}
          <button
            onClick={() => setIsPaletteOpen(true)}
            title={t("layout.mobile.searchTitle")}
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              cursor: "pointer", fontSize: "13px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            🔍
          </button>
          <button
            onClick={() => setIsConsultOpen(prev => !prev)}
            title={t("layout.mobile.consultTitle")}
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: isConsultOpen ? "var(--gradient-ai-deep)" : "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))",
              border: "none", cursor: "pointer", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AIIcon />
          </button>
          {/* 設定ボタン（ゲストは非表示） */}
          {!isGuest && (
          <button
            onClick={() => setIsAdminOpen(true)}
            title={t("layout.mobile.settingsTitle")}
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
          )}
          {/* テーマ切り替え */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? t("layout.theme.toLight") : t("layout.theme.toDark")}
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
          {/* 言語切り替え（🌐 日本語 | English） */}
          <LangToggle variant="icon" />
          {/* ラボボタン */}
          <button
            onClick={() => setIsMobileLabOpen(true)}
            title={t("layout.mobile.labTitle")}
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
          {/* カレンダー（ラボ） */}
          <button
            onClick={() => openLabView("calendar")}
            title={t("layout.calendar.title")}
            style={{
              width: "32px", height: "32px", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              cursor: "pointer", fontSize: "15px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >🗓️</button>
          <button
            onClick={onLogout}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px", flexShrink: 0 }}
            title={t("layout.logout.title")}
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
          prefillInput={consultPrefill ?? undefined}
        />

        {mainContent}

        {/* モバイル：FAB（計画モードのみ。タスク・マイルストーンの追加はゲストにも開放済み） */}
        {appMode === "plan" && canGuestEdit(isGuest, "task") && (<>
          {isFabMenuOpen && (
            // 背景クリックで閉じる（マウス操作の補助）。FABボタン自体がキーボードで開閉トグル
            // 可能なため、背景要素をフォーカス可能にする必要はない
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
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
                onClick={() => { setIsFabMenuOpen(false); setConsultDefaultMode("consult"); setIsConsultOpen(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "10px 16px",
                  background: "linear-gradient(135deg,#8b5cf6,#a78bfa)",
                  border: "none", borderRadius: "var(--radius-full)",
                  color: "#fff", fontSize: "13px", fontWeight: "600",
                  boxShadow: "var(--shadow-lg)", cursor: "pointer",
                  whiteSpace: "nowrap", animationDelay: "0.12s",
                }}
              >💬 {t("layout.fab.consult")}</button>
              <button
                className="fab-item-in"
                onClick={() => { setIsFabMenuOpen(false); setIsMilestoneAddOpen(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "10px 16px",
                  background: "linear-gradient(135deg,#f59e0b,#d97706)",
                  border: "none", borderRadius: "var(--radius-full)",
                  color: "#fff", fontSize: "13px", fontWeight: "600",
                  boxShadow: "var(--shadow-lg)", cursor: "pointer",
                  whiteSpace: "nowrap", animationDelay: "0.06s",
                }}
              >◆ {t("layout.fab.milestone")}</button>
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
              >＋ {t("layout.fab.task")}</button>
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
            title={t("layout.fab.menuTitle")}
          >＋</button>
        </>)}

        {/* モバイル：ボトムナビ。OKRモードは個人OKR1画面のみになり、切り替える先が
            無くなったため、このバー自体を出さない（2026-08-10。旧「管理／なぜなぜ／計画」
            の3ボタンはOKRモードのグループ側アーカイブに伴い撤去。mainContentの
            paddingBottomも appMode==="plan" の時だけ確保する） */}
        {appMode === "plan" && (
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
        )}
        {shortcutsButton}
        {isShortcutsOpen && <ShortcutsPanel currentView={shortcutsCurrentView} onClose={closeShortcuts} />}
        <ErrorBar />
      </div>
    );
  }

  // PC レイアウト（height: 100% = #root に追従。100vh だと body padding 分だけ下部がはみ出てクリップされる）
  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {onboardingOverlay}
      {tourInviteDialog}
      {okrIntroModal}

      {isQuickAddOpen && (
        <QuickAddTaskModal currentUser={currentUser} projects={projects} onClose={() => setIsQuickAddOpen(false)} />
      )}
      {isMilestoneAddOpen && (
        <MilestoneAddModal currentUser={currentUser} projects={projects} defaultProjectId={selectedProject?.id} onClose={() => setIsMilestoneAddOpen(false)} />
      )}
      {isPjCreateOpen && (
        <ProjectCreateModal
          currentUser={currentUser}
          onClose={() => setIsPjCreateOpen(false)}
          onCreated={id => { handleSelectProject(id); }}
        />
      )}
      {/* PC FAB（計画モードのみ） */}
      {appMode === "plan" && isFabMenuOpen && (
        // 背景クリックで閉じる（マウス操作の補助）。FABボタン自体がキーボードで開閉トグル
        // 可能なため、背景要素をフォーカス可能にする必要はない
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
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
          transition: isConsultResizing ? "none" : "right 0.3s ease",
          zIndex: 59,
          display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end",
        }}>
          <button
            className="fab-item-in"
            onClick={() => { setIsFabMenuOpen(false); setConsultDefaultMode("consult"); setIsConsultOpen(true); }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "9px 16px", height: "38px",
              background: "linear-gradient(135deg,#8b5cf6,#a78bfa)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap",
              animationDelay: "0.12s",
            }}
          >
            <span>💬</span> {t("layout.fab.consult")}
          </button>
          <button
            className="fab-item-in"
            onClick={() => { setIsFabMenuOpen(false); setIsMilestoneAddOpen(true); }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "9px 16px", height: "38px",
              background: "linear-gradient(135deg,#f59e0b,#d97706)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap",
              animationDelay: "0.06s",
            }}
          >
            <span>◆</span> {t("layout.fab.milestone")}
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
            <span style={{ fontSize: "16px", lineHeight: 1 }}>＋</span> {t("layout.fab.task")}
          </button>
        </div>
      )}
      {/* PC FABボタン本体（計画モードのみ。タスク・マイルストーンの追加はゲストにも開放済み） */}
      {appMode === "plan" && canGuestEdit(isGuest, "task") && (
        <button
          data-tour-id="fab"
          onClick={() => setIsFabMenuOpen(prev => !prev)}
          style={{
            position: "fixed", bottom: "24px",
            right: isConsultOpen ? `${consultPanelWidth + 24}px` : "24px",
            transition: isConsultResizing ? "background 0.2s, transform 0.2s" : "right 0.3s ease, background 0.2s, transform 0.2s",
            zIndex: 60,
            width: "48px", height: "48px", borderRadius: "50%",
            background: isFabMenuOpen ? "var(--color-text-secondary)" : "var(--color-brand)",
            color: "#fff",
            border: "none", fontSize: "22px",
            boxShadow: "var(--shadow-lg)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transform: isFabMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
          }}
          title={t("layout.fab.menuTitle")}
        >＋</button>
      )}
      <Sidebar
        viewMode={viewMode}
        setViewMode={navSetViewMode}
        projects={visibleProjects}
        mineOnly={mineOnly}
        onToggleMineOnly={toggleMineOnly}
        showCompletedAndArchived={showCompletedAndArchived}
        onToggleShowCompletedAndArchived={toggleShowCompletedAndArchived}
        mineOnlyProjectsCount={projects.filter(p => myProjectIds.has(p.id)).length}
        projectsCount={projects.length}
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
        onOpenGraph={() => openLabView("graph")}
        onOpenCalendar={() => openLabView("calendar")}
        onOpenStructure={() => openLabView("structure")}
        onOpenMyPage={() => openLabView("mypage")}
        activeLabView={activeLabView}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onOpenGuide={() => setIsGuideOpen(true)}
        onCreateProject={() => setIsPjCreateOpen(true)}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        width={sidebarWidth}
        isResizing={isSidebarResizing}
        onResizeMouseDown={handleSidebarResizeMouseDown}
        onResizeDoubleClick={handleSidebarResizeDoubleClick}
        onResizeKeyDown={handleSidebarResizeKeyDown}
        appMode={appMode}
        onToggleMode={handleToggleAppMode}
        onOpenPalette={() => setIsPaletteOpen(true)}
        accessibleGroups={accessibleGroups}
        currentGroupId={currentGroupId}
        onSelectGroup={handleSelectGroupNav}
        onOpenVersionHistory={() => setIsVersionHistoryOpen(true)}
        onOpenAcceptInvite={() => setIsAcceptInviteOpen(true)}
      />
      {isAcceptInviteOpen && (
        <AcceptInviteModal currentUser={currentUser} onClose={() => setIsAcceptInviteOpen(false)} />
      )}
      {isVersionHistoryOpen && (
        <Suspense fallback={null}>
          <VersionHistoryModal onClose={() => setIsVersionHistoryOpen(false)} />
        </Suspense>
      )}
      {mainContent}
      {/* GraphView・CalendarLabView・ProjectStructureView・MyPageView はすべて mainContent 内
          （labOverlay）に埋め込み済み（CLAUDE.md Section 20・v3.33）。KrReportPanel・KrWhyPanel・
          KrJointSessionFlowは2026-08-10にOKRモードのグループ側アーカイブに伴い撤去した。 */}
      {graphEditTaskId && (
        <TaskEditModal
          taskId={graphEditTaskId}
          currentUser={currentUser}
          onClose={() => setGraphEditTaskId(null)}
        />
      )}
      {/* カレンダーからのタスク編集：zIndex:300 でカレンダー(250)の上に出す */}
      {calendarEditTaskId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          <TaskEditModal
            taskId={calendarEditTaskId}
            currentUser={currentUser}
            onClose={() => setCalendarEditTaskId(null)}
          />
        </div>
      )}
      {/* カレンダーの日付セルからのタスク追加：同じくzIndex:300 でカレンダー(250)の上に出す */}
      {calendarQuickAddDate && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          <QuickAddTaskModal
            currentUser={currentUser}
            projects={projects}
            defaultDueDate={calendarQuickAddDate}
            onClose={() => setCalendarQuickAddDate(null)}
          />
        </div>
      )}
      {/* マイページからのタスク編集：zIndex:300 でマイページ(250)の上に出す（カレンダーと同じ流儀） */}
      {myPageEditTaskId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          <TaskEditModal
            taskId={myPageEditTaskId}
            currentUser={currentUser}
            onClose={() => setMyPageEditTaskId(null)}
          />
        </div>
      )}
      {aiEditTaskId && (
        <TaskEditModal
          taskId={aiEditTaskId}
          currentUser={currentUser}
          onClose={() => setAiEditTaskId(null)}
        />
      )}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        tasks={paletteTasks}
        projects={projects}
        canCreate={canGuestEdit(isGuest, "task")}
        onOpenTask={setAiEditTaskId}
        onSelectProject={id => { setAppMode("plan"); handleSelectProject(id); }}
        onSwitchView={v => { setAppMode("plan"); setViewMode(v); }}
        onQuickAdd={() => setIsQuickAddOpen(true)}
        onOpenConsult={() => { setConsultDefaultMode("consult"); setIsConsultOpen(true); }}
      />
      {shortcutsButton}
      {isShortcutsOpen && <ShortcutsPanel currentView={shortcutsCurrentView} onClose={closeShortcuts} />}
      <ErrorBar />
      {/* AIパネルをインライン横並びで配置。width遷移でコンテンツ幅が自然に縮む */}
      <div data-tour-id="ai-panel" style={{
        width: isConsultOpen ? `${consultPanelWidth}px` : "0",
        flexShrink: 0,
        overflow: "hidden",
        transition: isConsultResizing ? "none" : "width 0.3s ease",
      }}>
        <ConsultationPanel
          isOpen={isConsultOpen}
          onClose={() => setIsConsultOpen(false)}
          currentUser={currentUser}
          inline
          defaultMode={consultDefaultMode}
          onWidthChange={setConsultPanelWidth}
          onResizingChange={setIsConsultResizing}
          onOpenTask={setAiEditTaskId}
          demoRequest={consultDemoRequest ?? undefined}
          prefillInput={consultPrefill ?? undefined}
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
  /** プロジェクト表示フィルタ：自分が参加しているPJのみ */
  mineOnly: boolean;
  onToggleMineOnly: () => void;
  /** フィルタ切替ボタンのバッジ表示用 */
  mineOnlyProjectsCount: number;
  projectsCount: number;
  /** 「完了・アーカイブも表示」トグル（既定OFF）。CLAUDE.md参照：completed/archivedを既定で隠す */
  showCompletedAndArchived: boolean;
  onToggleShowCompletedAndArchived: () => void;
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
  onOpenCalendar: () => void;
  onOpenStructure: () => void;
  onOpenMyPage: () => void;
  /** 現在開いているラボ系ビュー（同時に1つだけ）。ラボサブメニューのアクティブ表示に使う
   *  （CLAUDE.md Section 20・v3.34）。 */
  activeLabView: LabViewId | null;
  onOpenAdmin: () => void;
  onOpenGuide: () => void;
  onCreateProject: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** サイドバー展開時の幅（px）。v3.66・境界のドラッグ／キーボードで変更できる */
  width: number;
  /** ドラッグ中：trueの間はwidthのtransitionを止める（カーソル追従の遅延を防ぐ。
   *  ConsultationPanelのisConsultResizingと同じ考え方） */
  isResizing: boolean;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onResizeDoubleClick: () => void;
  onResizeKeyDown: (e: React.KeyboardEvent) => void;
  appMode: AppMode;
  onToggleMode: () => void;
  onOpenPalette: () => void;
  /** アクセス可能な部署一覧（2件以上のときだけ切替UIを表示）。super-adminは全部署、
   *  それ以外は自分のgroup_ids（兼務先含む）。1件以下ならSidebarは何も描画しない。 */
  accessibleGroups: Group[];
  currentGroupId: string | null;
  onSelectGroup: (id: string) => void;
  /** バージョン履歴モーダルを開く（v3.61。VersionBadgeクリック時） */
  onOpenVersionHistory: () => void;
  /** プロジェクト招待：招待コードを手入力して参加するモーダルを開く（Phase 4・v3.68）。
   *  AdminView（部署管理者限定）の外に置くため、Sidebar自身がボタンを持つ。 */
  onOpenAcceptInvite: () => void;
}

function Sidebar({
  viewMode, setViewMode, projects,
  mineOnly, onToggleMineOnly,
  showCompletedAndArchived, onToggleShowCompletedAndArchived,
  selectedProjectId, onSelectProject,
  keyResults, selectedKrId, onSelectKr,
  currentUser, onLogout, isConsultOpen, onOpenConsult,
  theme, onToggleTheme, onOpenGraph, onOpenCalendar, onOpenStructure, onOpenMyPage, activeLabView,
  onOpenAdmin, onOpenGuide, onCreateProject, collapsed, onToggleCollapsed,
  width, isResizing, onResizeMouseDown, onResizeDoubleClick, onResizeKeyDown,
  appMode, onToggleMode, onOpenPalette,
  accessibleGroups, currentGroupId, onSelectGroup,
  onOpenVersionHistory, onOpenAcceptInvite,
}: SidebarProps) {
  const [labOpen, setLabOpen] = useState(false);
  const isGuest = isGuestMember(currentUser);
  const t = useT();
  const NAV_ITEMS = useMemo(() => buildNavItems(t), [t]);
  // サイドバーのセクション開閉（PJが増えても省略できるように）。localStorage で記憶。
  const [pjOpen, setPjOpen] = useState<boolean>(() => { try { return localStorage.getItem(KEYS.SIDEBAR_PJ_OPEN) !== "0"; } catch { return true; } });
  const togglePjOpen  = () => setPjOpen(v => { const n = !v; try { localStorage.setItem(KEYS.SIDEBAR_PJ_OPEN, n ? "1" : "0"); } catch { /* ignore */ } return n; });
  const c = collapsed; // 省略形

  // ===== PJ行の「⋮」メニュー（v3.54） =====
  // 権限判定はPJ設定画面（ProjectSettingsModal）の基本情報編集と同じ条件
  // （lib/project/projectEditPermission.ts に切り出し済み・判定ロジックの複製はしない）。
  const allMembers = useAppStore(s => s.members);
  const allProjectsRaw = useAppStore(s => s.projects);
  const saveProject = useAppStore(s => s.saveProject);
  const canEditProjects = useMemo(() => canEditProjectBasicInfo(allMembers, currentUser), [allMembers, currentUser]);
  const [settingsModalProjectId, setSettingsModalProjectId] = useState<string | null>(null);
  // sidebarに出ているprojects（既定でcompleted/archivedを隠すフィルタ済み）からではなく、
  // 未絞り込みのstoreから直接探す。モーダルを開いた後にPJ設定画面内の別のクイック操作で
  // status（completed/archived）を変えても、pinnedProjectId（=selectedProjectId）と無関係に
  // モーダル自体が閉じてしまわないようにするため。
  const settingsModalProject = settingsModalProjectId != null
    ? allProjectsRaw.find(p => p.id === settingsModalProjectId) ?? null
    : null;

  // 完了・アーカイブ・活性化はトーストで即フィードバック＋Undo（B3自動リスケ等と同じ流儀。
  // CLAUDE.md参照）。確認ダイアログは挟まない（Undoで戻せるため、bulkUpdateStatus等の
  // 一括操作トーストと同じ考え方）。
  const handleProjectRowMenuAction = async (pj: Project, actionId: ProjectRowMenuActionId) => {
    if (actionId === "settings") { setSettingsModalProjectId(pj.id); return; }
    const nextStatus: Project["status"] = actionId === "complete" ? "completed" : actionId === "archive" ? "archived" : "active";
    const prevStatus = pj.status;
    const toastKey = actionId === "complete" ? "layout.sidebar.pjRowMenu.toastComplete"
      : actionId === "archive" ? "layout.sidebar.pjRowMenu.toastArchive"
      : "layout.sidebar.pjRowMenu.toastRestore";
    try {
      await saveProject({ ...pj, status: nextStatus, updated_by: currentUser.id });
      showToast(t(toastKey, { name: pj.name }), "success", {
        label: t("layout.sidebar.pjRowMenu.undo"),
        isUndo: true,
        onClick: () => {
          const latest = useAppStore.getState().projects.find(p => p.id === pj.id);
          if (latest) saveProject({ ...latest, status: prevStatus, updated_by: currentUser.id });
        },
      });
    } catch (e) {
      showToast(formatErrorForUser("更新に失敗しました", e), "error");
    }
  };

  return (
    <>
    <div data-tour-id="sidebar" style={{
      position: "relative",
      width: c ? SIDEBAR_WIDTH_COLLAPSED : `${width}px`,
      flexShrink: 0,
      background: "var(--color-bg-secondary)",
      borderRight: "1px solid var(--color-border-primary)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      transition: isResizing ? "none" : "width 0.2s ease",
    }}>
      {/* 境界のドラッグでサイドバー幅を変更（v3.66）。折りたたみ中（48px）は非表示＝ドラッグ不可。
          キーボード操作：フォーカスして左右矢印キーで変更。ダブルクリックで既定幅(196px)に戻す。
          ConsultationPanel.tsx / PersonalOkrAiPanel.tsx の左端ドラッグハンドルと同じ流儀
          （position:absoluteの細い帯・window mousemove/mouseup）だが、キーボード操作対応の
          ためこのハンドルだけ role="separator" + tabIndex を持つ（判断理由はCLAUDE.md
          Section 20参照）。 */}
      {!c && (
        // role="separator"はjsx-a11yの既定「インタラクティブロール」一覧に無いため警告が出るが、ARIAの仕様上separatorはfocusable+キー操作可能にしてよい（window-splitter相当）。矢印キーでの幅変更に必須のためtabIndexを付ける
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("layout.sidebar.resizeHandle.label")}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role="separator"に矢印キー操作を持たせるため必須
          tabIndex={0}
          onMouseDown={onResizeMouseDown}
          onDoubleClick={onResizeDoubleClick}
          onKeyDown={onResizeKeyDown}
          title={t("layout.sidebar.resizeHandle.title")}
          style={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: "6px",
            cursor: "col-resize", zIndex: 5,
            background: "transparent",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-brand)"; (e.currentTarget as HTMLDivElement).style.opacity = "0.4"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
        />
      )}

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
              {t("layout.sidebar.appName")}
            </div>
          </div>
        )}
        <button
          onClick={onToggleCollapsed}
          title={c ? t("layout.sidebar.expand") : t("layout.sidebar.collapse")}
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

      {/*
        【設計意図】ズーム率や画面高さによってサイドバー全体の合計高さが
        コンテナ高さを超えると、外枠の overflow:hidden がヘッダー以外の
        末尾要素（フッターのボタン等）を不可視・クリック不可にしてしまう
        （CustomSelect/MainLayout で過去に踏んだ overflow 設計ミスと同種）。
        モードトグル〜ラボサブメニューまでを1つの flex:1 + overflow-y:auto
        領域にまとめ、はみ出た場合は必ずスクロールで到達可能にする。
      */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>

      {/* モードトグル */}
      <div style={{ padding: c ? "6px 4px" : "8px 8px 4px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
        <AppModeToggle mode={appMode} onToggle={onToggleMode} compact={c} />
      </div>

      {/* 表示部署の切替（アクセス可能な部署が2件以上のときだけ表示。折りたたみ時は非表示＝
          セレクタのラベル文言が入らないため）。CLAUDE.md Section 1.6参照：super-adminは
          currentGroupIdでダッシュボード等の表示部署そのものを切り替えられる。非super-adminの
          兼務者は選択してもselectScopedが絞り込みをしない（自部署＋兼務先が常に全部見える）ため、
          ここでの選択は「新規作成時のデフォルト所属部署」を選ぶ程度の意味にとどまる。 */}
      {!c && accessibleGroups.length >= 2 && (
        <div style={{ padding: "8px 8px 4px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "4px", letterSpacing: "0.03em" }}>
            {t("layout.sidebar.groupLabel")}
          </div>
          <CustomSelect
            value={currentGroupId ?? ""}
            onChange={onSelectGroup}
            options={accessibleGroups.map(g => ({ value: g.id, label: g.name }))}
            placeholder={t("layout.sidebar.groupPlaceholder")}
          />
        </div>
      )}

      {/* 検索（コマンドパレット起動）。Ctrl+K だけでは気づけないため常設ボタンを置く */}
      <div style={{ padding: c ? "6px 4px 0" : "8px 8px 0", flexShrink: 0 }}>
        <button
          onClick={onOpenPalette}
          title={t("layout.sidebar.searchTitle")}
          style={{
            display: "flex", alignItems: "center", gap: c ? 0 : "8px",
            padding: c ? "8px 0" : "7px 10px",
            width: "100%", boxSizing: "border-box",
            justifyContent: c ? "center" : "flex-start",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
          }}
        >
          <span style={{ fontSize: c ? "14px" : "12px", flexShrink: 0, lineHeight: 1 }}>🔍</span>
          {!c && (
            <>
              <span style={{ flex: 1, textAlign: "left", fontSize: "11px" }}>{t("layout.sidebar.searchPlaceholder")}</span>
              <kbd style={{
                fontSize: "9px", padding: "1px 5px",
                border: "1px solid var(--color-border-primary)", borderRadius: "3px",
                background: "var(--color-bg-secondary)", color: "var(--color-text-tertiary)",
              }}>Ctrl+K</kbd>
            </>
          )}
        </button>
      </div>

      {/* AI ツール（モード共通） */}
      <div style={{ borderBottom: "1px solid var(--color-border-primary)", padding: c ? "6px 4px" : "8px 6px", flexShrink: 0 }}>
        <button
          data-tour-id="ai-tool-btn"
          onClick={onOpenConsult}
          title={t("layout.sidebar.aiToolTitle")}
          style={{
            display: "flex", alignItems: "center", gap: c ? 0 : "10px",
            padding: c ? "10px 0" : "10px 12px",
            width: "100%", boxSizing: "border-box",
            justifyContent: c ? "center" : "flex-start",
            background: isConsultOpen
              ? "var(--gradient-ai)"
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
              <div style={{ fontSize: "12px", fontWeight: "700", color: isConsultOpen ? "#fff" : "var(--color-ai-from)", lineHeight: 1.3 }}>
                {t("layout.sidebar.aiToolLabel")}
              </div>
              <div style={{ fontSize: "10px", color: isConsultOpen ? "rgba(255,255,255,0.8)" : "var(--color-text-tertiary)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t("layout.sidebar.aiToolSub")}
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
        <div data-tour-id="nav-items" style={{ padding: c ? "6px 0" : "8px 0 4px" }}>
          {!c && <SectionLabel>{t("layout.sidebar.menuLabel")}</SectionLabel>}
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

        {/* 計画管理：プロジェクト一覧（スクロールは親の flex:1 ラッパーが担う） */}
        <div style={{ padding: c ? "6px 0" : "4px 0" }}>
          {!c && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 14px 4px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1, minWidth: 0 }}>
                <button
                  onClick={togglePjOpen}
                  aria-expanded={pjOpen}
                  title={pjOpen ? t("layout.sidebar.pjSectionCollapse") : t("layout.sidebar.pjSectionExpand")}
                  style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    background: "transparent", border: "none", cursor: "pointer", padding: 0,
                    fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em",
                    color: "var(--color-text-tertiary)", textTransform: "uppercase",
                  }}
                >
                  <span style={{ fontSize: "8px", display: "inline-block", transform: pjOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                  {t("layout.sidebar.pjSectionLabel")}
                </button>
                <button
                  onClick={onCreateProject}
                  title={t("layout.sidebar.pjCreateTitle")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 16, height: 16, flexShrink: 0,
                    background: "transparent", border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-sm)", cursor: "pointer",
                    fontSize: "12px", lineHeight: 1, color: "var(--color-text-tertiary)",
                    padding: 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-bg-tertiary)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-tertiary)"; }}
                >＋</button>
              </div>
              <button
                onClick={onToggleMineOnly}
                title={mineOnly ? t("layout.sidebar.mineOnlyToAll") : t("layout.sidebar.mineOnlyToMine")}
                style={{
                  display: "flex", alignItems: "center", gap: "3px",
                  padding: "2px 7px",
                  fontSize: "10px", fontWeight: 500,
                  background: mineOnly ? "var(--color-brand-light)" : "transparent",
                  color: mineOnly ? "var(--color-brand)" : "var(--color-text-tertiary)",
                  border: `1px solid ${mineOnly ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-full)",
                  cursor: "pointer", lineHeight: 1.4,
                }}
              >
                <span style={{ fontSize: "9px" }}>{mineOnly ? "👤" : "🌐"}</span>
                {mineOnly ? t("layout.sidebar.mineLabel") : t("layout.sidebar.allLabel")}
              </button>
            </div>
          )}
          {!c && pjOpen && (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 14px 4px" }}>
              <button
                onClick={onToggleShowCompletedAndArchived}
                title={showCompletedAndArchived ? t("layout.sidebar.showArchivedOff") : t("layout.sidebar.showArchivedOn")}
                style={{
                  display: "flex", alignItems: "center", gap: "3px",
                  padding: "2px 7px",
                  fontSize: "10px", fontWeight: 500,
                  background: showCompletedAndArchived ? "var(--color-bg-tertiary)" : "transparent",
                  color: showCompletedAndArchived ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                  border: `1px solid ${showCompletedAndArchived ? "var(--color-border-primary)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-full)",
                  cursor: "pointer", lineHeight: 1.4,
                }}
              >
                <span style={{ fontSize: "9px" }}>🗄</span>
                {t("layout.sidebar.showArchivedLabel")}
              </button>
            </div>
          )}
          {(c || pjOpen) && (<>
          <NavItem
            active={selectedProjectId === null && selectedKrId === null}
            icon={<span style={{ width: 8, height: 8, borderRadius: "50%", background: "#888780", display: "inline-block" }} />}
            label={t("layout.sidebar.allPjLabel")} tooltip={t("layout.sidebar.allPjLabel")}
            onClick={() => onSelectProject(null)} collapsed={c}
          />
          {projects.map(pj => {
            const isArchived = pj.status === "archived";
            const isCompleted = pj.status === "completed";
            const isDimmed = isArchived || isCompleted;
            const isSelected = selectedProjectId === pj.id;
            const icon = (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: pj.color_tag, display: "inline-block", opacity: isDimmed ? 0.5 : 1 }} />
                {isArchived && <span style={{ fontSize: "8px" }}>🗄</span>}
                {isCompleted && <span style={{ fontSize: "8px" }}>✅</span>}
              </span>
            );
            const tooltip = isArchived ? `${pj.name}（アーカイブ済み）` : isCompleted ? `${pj.name}（完了）` : pj.name;
            // 折りたたみ時は「⋮」の表示領域が無いため既存のNavItem（単体ボタンの行）を使う。
            // 展開時は「⋮」を右端に置くため、NavItemが持つ「行全体=1個の<button>」構造をやめ、
            // [選択ボタン][⋮トリガー]の2つを並べたラッパーdivに変える（<button>の中に<button>は
            // 置けない・置くとクリックイベントが競合するため）。
            if (c) {
              return (
                <NavItem key={pj.id} active={isSelected}
                  icon={icon} label={pj.name} tooltip={tooltip}
                  color={isDimmed ? "var(--color-text-tertiary)" : undefined}
                  onClick={() => onSelectProject(pj.id)} collapsed={c}
                />
              );
            }
            return (
              <div key={pj.id} className="pj-row" style={{
                display: "flex", alignItems: "center",
                margin: "1px 4px", overflow: "hidden",
                borderRadius: "var(--radius-md)",
                background: isSelected ? "var(--color-bg-primary)" : "transparent",
              }}>
                <button
                  onClick={() => onSelectProject(pj.id)}
                  title={tooltip}
                  style={{
                    flex: 1, minWidth: 0,
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "6px 4px 6px 10px",
                    background: "transparent", border: "none",
                    borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
                    fontSize: "11px", fontWeight: isSelected ? 500 : 400,
                    color: isDimmed ? "var(--color-text-tertiary)" : (isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)"),
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.6 }}>{icon}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pj.name}</span>
                </button>
                <ProjectRowMenu
                  projectName={pj.name}
                  projectStatus={pj.status}
                  canEdit={canEditProjects}
                  isGuest={isGuest}
                  forceVisible={isSelected}
                  onSelectAction={id => void handleProjectRowMenuAction(pj, id)}
                />
              </div>
            );
          })}
          {projects.length === 0 && !c && mineOnly && (
            <div style={{
              padding: "12px 14px", fontSize: "11px",
              color: "var(--color-text-tertiary)", lineHeight: 1.5,
            }}>
              {t("layout.sidebar.noMineProjects1")}<br />
              {t("layout.sidebar.noMineProjects2")}
            </div>
          )}
          </>)}
          {/* 【2026-08-12・v3.54】計画モードの「OKRタスク」セクション（KR一覧でGantt/Kanban/List
              をselectedKrId絞り込みする入口）は、山本さんの指示（「あまり使われないので一旦非表示。
              PJがTFと紐づけられる仕様になっていれば十分」）により描画を停止した。
              絞り込みロジック（selectedKrId/krTaskIds）・DBテーブル・project_task_forces
              （PJ↔TF紐づけ）には一切触れていない。復帰手順は src/components/layout/ARCHIVED.md
              参照（okr/ARCHIVED.mdとは対象ドメインが異なるため別ファイルにした）。 */}
        </div>

        {/* ラボ サブメニュー（🧪ボタンで開閉）。activeプロップはNAV_ITEMSと同じNavItemを使い、
            現在開いているラボビューを強調表示する（CLAUDE.md Section 20・v3.34）。 */}
        {labOpen && (
          <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "4px 0" : "4px 6px" }}>
            <NavItem active={activeLabView === "structure"} icon={<span style={{ fontSize: "13px" }}>🏢</span>} label={t("layout.lab.structure.label")} tooltip={t("layout.lab.structure.desc")} onClick={onOpenStructure} collapsed={c} />
            <NavItem active={activeLabView === "graph"} icon={<GraphIcon />} label={t("layout.lab.graph.label")} tooltip={t("layout.lab.graph.tooltip")} onClick={onOpenGraph} collapsed={c} />
            <NavItem active={activeLabView === "calendar"} icon={<span style={{ fontSize: "13px" }}>🗓️</span>} label={t("layout.lab.calendar.label")} tooltip={t("layout.lab.calendar.tooltip")} onClick={onOpenCalendar} collapsed={c} />
            <NavItem active={activeLabView === "mypage"} icon={<span style={{ fontSize: "13px" }}>🧩</span>} label={t("layout.lab.mypage.label")} tooltip={t("layout.lab.mypage.desc")} onClick={onOpenMyPage} collapsed={c} />
          </div>
        )}
      </>) : null}
      {/* 【2026-08-10】OKRモードの「OKR管理：KR一覧」（フィルター用）は、OKRモードが個人OKR
          1画面だけになりKR選択の受け手が無くなったため撤去した。sidebar上はappMode==="okr"の
          間、このスクロール領域には何も表示しない（下のラボ/AI相談/設定ボタン列は常時表示のまま）。 */}

      </div>
      {/* ↑ モードトグル〜ラボサブメニューまでのスクロール領域はここまで */}

      {/* AI相談・設定・ユーザー情報（常にクリック可能な位置に固定表示） */}
      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: c ? "6px 4px" : "8px 6px", flexShrink: 0 }}>
        {/* 📖 ガイド（全モード共通・全画面オーバーレイ） */}
        <button
          data-tour-id="guide-btn"
          onClick={onOpenGuide}
          title={t("layout.guide.buttonTitle")}
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
          <span style={{ fontSize: "13px", lineHeight: 1 }}>📖</span>
          {!c && <span>{t("layout.guide.title")}</span>}
        </button>
        {/* 設定（歯車）ボタン（ゲストは非表示） */}
        {!isGuest && (
        <button
          onClick={onOpenAdmin}
          title={t("layout.admin.title")}
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
          {!c && <span>{t("layout.admin.title")}</span>}
        </button>
        )}
        {/* 招待コードを入力（Phase 4・v3.68）：部署管理者かどうかに関わらず全メンバーが
            開けるよう、AdminView（管理者限定）とは別にここに置く（ゲストは非表示）。 */}
        {!isGuest && (
        <button
          onClick={onOpenAcceptInvite}
          title={t("layout.acceptInvite.title")}
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
          <span style={{ fontSize: "13px", lineHeight: 1 }}>🎫</span>
          {!c && <span>{t("layout.acceptInvite.title")}</span>}
        </button>
        )}
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
              title={theme === "dark" ? t("layout.theme.toLight") : t("layout.theme.toDark")}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          )}
          {/* 言語切り替え（🌐 日本語 | English） */}
          {!c && <LangToggle variant="text" />}
          <button
            onClick={() => setLabOpen(o => !o)}
            style={{ fontSize: "13px", color: labOpen ? "var(--color-text-primary)" : "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: "2px", flexShrink: 0 }}
            title={t("layout.lab.toggleTitle")}
          >🧪</button>
          {/* カレンダー（サイドバー：折りたたみ時もアイコンで表示） */}
          <button
            onClick={onOpenCalendar}
            style={{ fontSize: "14px", color: "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: "2px", flexShrink: 0 }}
            title={t("layout.calendar.title")}
          >🗓️</button>
          {!c && (
            <button
              onClick={onLogout}
              style={{ fontSize: "10px", color: "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}
              title={t("layout.logout.title")}
            >
              ⏏
            </button>
          )}
        </div>
        {/* バージョン表示（控えめ・折りたたみ時は非表示。既存フッター行とは別の細い1行に
            分けている＝196px幅が既に詰まっているため。CLAUDE.md参照） */}
        {!c && (
          <div style={{ padding: "1px 10px 4px", textAlign: "right" }}>
            <VersionBadge onClick={onOpenVersionHistory} />
          </div>
        )}
      </div>
    </div>
    {/* PJ行「⋮」→「⚙ このPJの設定」。PJカルテの「⚙ このPJの設定」と同じ
        ProjectSettingsModalをそのまま開く（新しい設定画面は作らない）。 */}
    {settingsModalProject && (
      <ProjectSettingsModal
        project={settingsModalProject}
        currentUser={currentUser}
        onClose={() => setSettingsModalProjectId(null)}
      />
    )}
    </>
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
  const t = useT();
  if (compact) {
    return (
      <button
        onClick={onToggle}
        title={mode === "plan" ? t("layout.appModeToggle.toOkr") : t("layout.appModeToggle.toPlan")}
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
    <div data-tour-id="app-mode" style={{
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
          {m === "plan" ? t("layout.appModeToggle.planFull") : t("layout.appModeToggle.okrFull")}
        </button>
      ))}
    </div>
  );
}

function ComingSoon({ view }: { view: ViewMode }) {
  const t = useT();
  const labels: Record<ViewMode, string> = {
    dashboard: t("layout.nav.dashboard.label"),
    kanban: t("layout.nav.kanban.label"),
    gantt: t("layout.nav.gantt.label"),
    list: t("layout.nav.list.label"),
    admin: t("layout.nav.admin.label"),
    workload: t("layout.nav.workload.label"),
  };
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: "8px", color: "var(--color-text-tertiary)",
    }}>
      <div style={{ fontSize: "24px" }}>🚧</div>
      <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-secondary)" }}>
        {labels[view]}{t("layout.comingSoon.viewSuffix")}
      </div>
      <div style={{ fontSize: "12px" }}>{t("layout.comingSoon.planned")}</div>
    </div>
  );
}

// 【v3.54】サイドバーの「OKRタスク」セクション描画停止（ARCHIVED.md参照）により現在どこからも
// 呼ばれていないが、復帰時にそのまま使えるよう削除していない。
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
