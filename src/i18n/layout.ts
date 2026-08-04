// src/i18n/layout.ts
//
// 【設計意図】
// App Shell（src/App.tsx）と MainLayout（src/components/layout/MainLayout.tsx）の文言辞書。
// Phase 1（i18n-plan.md）。ShortcutsPanel.tsx の SECTIONS データ（common.shortcuts.*）は
// src/i18n/common.ts 側に置く（あのパネル自体が components/common/ 配下のため）。

export const layoutJa = {
  // ----- App.tsx -----
  "layout.app.configError.title": "⚠️ 設定エラー",
  "layout.app.configError.body": "Vercel の Environment Variables に以下を設定してください",
  "layout.app.loading.preparing": "準備しています...",
  "layout.app.loading.dataLoading": "データを読み込み中...",
  "layout.app.error.retry": "再試行",

  // ----- ナビゲーション項目 -----
  "layout.nav.dashboard.label": "ダッシュボード",
  "layout.nav.dashboard.tooltip": "OKRの進捗・今週のタスク・期限アラートをまとめて確認できます",
  "layout.nav.kanban.label": "カンバン",
  "layout.nav.kanban.tooltip": "タスクを「未着手／進行中／完了」の列でドラッグ&ドロップ管理できます",
  "layout.nav.gantt.label": "ガント",
  "layout.nav.gantt.tooltip": "プロジェクトの期間とタスクの期日をカレンダー形式で一覧できます",
  "layout.nav.list.label": "リスト",
  "layout.nav.list.tooltip": "タスクを一覧形式で表示・絞り込み・CSV出力できます",
  "layout.nav.workload.label": "ワークロード",
  "layout.nav.workload.tooltip": "メンバー別のタスク件数・負荷を一目で確認できます",
  "layout.nav.admin.label": "管理画面",

  // ----- 設定パネル・ガイドパネル -----
  "layout.admin.title": "設定",
  "layout.admin.helpTitle": "設定パネルの使い方を開く",
  "layout.guide.title": "ガイド",
  "layout.guide.buttonTitle": "このアプリの使い方ガイドを開きます",

  // ----- ツアー招待ダイアログ -----
  "layout.tourInvite.title": "ようこそ。ツアー（約90秒）を見ますか？",
  "layout.tourInvite.body1": "4つのビュー・AI機能・OKR管理モードの場所と使い方を、画面上の吹き出しでご案内します。",
  "layout.tourInvite.body2": "後から「📖 ガイド」内の「👋 オンボーディングを見直す」ボタンでいつでも再生できます。",
  "layout.tourInvite.skip": "スキップ",
  "layout.tourInvite.start": "ツアーを開始 →",

  // ----- オンボーディングオーバーレイ -----
  "layout.onboarding.title": "👋 オンボーディング（運用開始の3ステップ）",

  // ----- ショートカットaffordance -----
  "layout.shortcuts.buttonTitle": "ショートカット一覧を表示（全ビュー共通・画面右下）",
  "layout.shortcuts.buttonLabel": "ショートカット",

  // ----- ゲストバナー -----
  "layout.guestBanner": "👁 ゲストモード（閲覧のみ）— 編集はできません",

  // ----- モバイル：ラボ ボトムシート -----
  "layout.lab.sheetTitle": "🧪 ラボ機能",
  "layout.lab.structure.label": "体制図",
  "layout.lab.structure.desc": "PJの役割・担当体制を図示",
  "layout.lab.graph.label": "関係グラフ",
  "layout.lab.graph.desc": "PJ・タスクの関係を可視化",
  "layout.lab.graph.tooltip": "プロジェクト・タスクフォース・タスクの関係をグラフで可視化",
  "layout.lab.calendar.label": "カレンダー",
  "layout.lab.calendar.desc": "タスクの期日を月カレンダーで表示",
  "layout.lab.calendar.tooltip": "タスクの期日を月カレンダーで表示（ラボ）",
  "layout.lab.mypage.label": "マイページ",
  "layout.lab.mypage.desc": "自分専用のウィジェット画面（ラボ）",
  "layout.lab.krSession.label": "KRセッション記録",
  "layout.lab.krSession.desc": "文字起こしからチェックイン・ウィン記録",
  "layout.lab.krReport.label": "KRレポート生成",
  "layout.lab.krReport.desc": "議事メモからKRレポートをAI生成",
  "layout.lab.krWhy.label": "KRなぜなぜ分析",
  "layout.lab.krWhy.desc": "AIとの対話で根本原因を5Whys形式で掘り下げ",
  "layout.lab.toggleTitle": "ラボ（実験的機能）",

  // ----- モバイルヘッダー -----
  "layout.mobile.myPj": "自分のPJ",
  "layout.mobile.allPj": "全PJ",
  "layout.mobile.searchTitle": "タスク・プロジェクトを検索",
  "layout.mobile.consultTitle": "AIに変更を相談",
  "layout.mobile.settingsTitle": "設定",
  "layout.mobile.labTitle": "ラボ機能",

  // ----- テーマ・カレンダー・ログアウト（共通） -----
  "layout.theme.toLight": "ライトモードに切替",
  "layout.theme.toDark": "ダークモードに切替",
  "layout.calendar.title": "カレンダー（タスクの期日を月表示）",
  "layout.logout.title": "ログアウト",

  // ----- FAB -----
  "layout.fab.consult": "AIに相談する",
  "layout.fab.milestone": "マイルストーン追加",
  "layout.fab.task": "タスクを追加",
  "layout.fab.menuTitle": "メニューを開く",

  // ----- OKRモード：モバイルボトムナビ -----
  "layout.okrMobileNav.manage": "OKR管理",
  "layout.okrMobileNav.why": "なぜなぜ",
  "layout.okrMobileNav.plan": "計画",

  // ----- AIチャット下書きプレフィル -----
  "layout.tourDemo.withData": "今登録されているタスクの中で、優先的に進めるべきものと、遅れそうなものを教えて。次の一手も教えてください。",
  "layout.tourDemo.noData": "これから計画管理を始めます。最初にどんな単位でプロジェクトやタスクを作ると、後で管理しやすいですか？",
  "layout.aiProjectCreate.prefill": "新しいプロジェクトを立ち上げたいです。目的・ゴールの案と初期タスクのたたき台を提案してください。（決まっている目的・期限・担当があればこの文に書き足してください）",

  // ----- サイドバー（PC） -----
  "layout.sidebar.appName": "グループ計画管理",
  "layout.sidebar.expand": "メニューを開く",
  "layout.sidebar.collapse": "メニューを閉じる",
  "layout.sidebar.groupLabel": "表示部署",
  "layout.sidebar.groupPlaceholder": "部署を選択",
  "layout.sidebar.searchPlaceholder": "検索...",
  "layout.sidebar.searchTitle": "タスク・プロジェクトを横断検索（Ctrl+K）",
  "layout.sidebar.aiToolTitle": "AI相談・PJ/タスク登録・会議読み込みをまとめて使えます",
  "layout.sidebar.aiToolLabel": "AIツールを開く",
  "layout.sidebar.aiToolSub": "相談 · PJ/タスク登録 · 会議読み込み",
  "layout.sidebar.menuLabel": "メニュー",
  "layout.sidebar.pjSectionCollapse": "プロジェクト一覧を省略",
  "layout.sidebar.pjSectionExpand": "プロジェクト一覧を展開",
  "layout.sidebar.pjSectionLabel": "プロジェクト",
  "layout.sidebar.pjCreateTitle": "新規プロジェクトを作成",
  "layout.sidebar.mineOnlyToAll": "クリックで全タスクを表示",
  "layout.sidebar.mineOnlyToMine": "クリックで自分が担当のタスクのみに絞り込み",
  "layout.sidebar.mineLabel": "自分",
  "layout.sidebar.allLabel": "全件",
  "layout.sidebar.allPjLabel": "全PJ表示",
  "layout.sidebar.noMineProjects1": "自分が担当するタスクを持つPJはまだありません。",
  "layout.sidebar.noMineProjects2": "「全件」に切り替えると全PJが表示されます。",
  "layout.sidebar.okrSectionCollapse": "OKRタスクを省略",
  "layout.sidebar.okrSectionExpand": "OKRタスクを展開",
  "layout.sidebar.okrSectionLabel": "OKRタスク",
  "layout.sidebar.allKrLabel": "全KR",
  "layout.sidebar.allKrTooltip": "全KRを表示",
  "layout.sidebar.noKr": "KRが登録されていません",

  // ----- AppModeToggle -----
  "layout.appModeToggle.toOkr": "OKR管理モードに切り替え",
  "layout.appModeToggle.toPlan": "計画管理モードに切り替え",
  "layout.appModeToggle.planFull": "📋 計画",
  "layout.appModeToggle.okrFull": "🎯 OKR",

  // ----- ComingSoon -----
  "layout.comingSoon.viewSuffix": "ビュー",
  "layout.comingSoon.planned": "実装予定",
} as const;

export const layoutEn: Record<keyof typeof layoutJa, string> = {
  "layout.app.configError.title": "⚠️ Configuration error",
  "layout.app.configError.body": "Please set the following in Vercel's Environment Variables",
  "layout.app.loading.preparing": "Preparing...",
  "layout.app.loading.dataLoading": "Loading data...",
  "layout.app.error.retry": "Retry",

  "layout.nav.dashboard.label": "Dashboard",
  "layout.nav.dashboard.tooltip": "See OKR progress, this week's tasks, and deadline alerts at a glance",
  "layout.nav.kanban.label": "Kanban",
  "layout.nav.kanban.tooltip": "Manage tasks by dragging & dropping between To Do / In Progress / Done columns",
  "layout.nav.gantt.label": "Gantt",
  "layout.nav.gantt.tooltip": "View project timelines and task due dates in a calendar layout",
  "layout.nav.list.label": "List",
  "layout.nav.list.tooltip": "View, filter, and export tasks as a list (CSV)",
  "layout.nav.workload.label": "Workload",
  "layout.nav.workload.tooltip": "See task counts and workload per member at a glance",
  "layout.nav.admin.label": "Settings",

  "layout.admin.title": "Settings",
  "layout.admin.helpTitle": "Open help for the settings panel",
  "layout.guide.title": "Guide",
  "layout.guide.buttonTitle": "Open the guide for how to use this app",

  "layout.tourInvite.title": "Welcome. Would you like a tour (about 90 seconds)?",
  "layout.tourInvite.body1": "We'll walk you through the 4 views, AI features, and OKR management mode with on-screen callouts.",
  "layout.tourInvite.body2": "You can replay it anytime later from the \"👋 Replay onboarding\" button inside \"📖 Guide\".",
  "layout.tourInvite.skip": "Skip",
  "layout.tourInvite.start": "Start tour →",

  "layout.onboarding.title": "👋 Onboarding (3 steps to get started)",

  "layout.shortcuts.buttonTitle": "Show shortcut list (common to all views, bottom right)",
  "layout.shortcuts.buttonLabel": "Shortcuts",

  "layout.guestBanner": "👁 Guest mode (view only) — editing is disabled",

  "layout.lab.sheetTitle": "🧪 Lab features",
  "layout.lab.structure.label": "Structure diagram",
  "layout.lab.structure.desc": "Diagram of project roles and responsibilities",
  "layout.lab.graph.label": "Relationship graph",
  "layout.lab.graph.desc": "Visualize relationships between projects and tasks",
  "layout.lab.graph.tooltip": "Visualize the relationships between projects, task forces, and tasks as a graph",
  "layout.lab.calendar.label": "Calendar",
  "layout.lab.calendar.desc": "Show task due dates on a monthly calendar",
  "layout.lab.calendar.tooltip": "Show task due dates on a monthly calendar (Lab)",
  "layout.lab.mypage.label": "My Page",
  "layout.lab.mypage.desc": "Your own widget screen (Lab)",
  "layout.lab.krSession.label": "KR session log",
  "layout.lab.krSession.desc": "Extract check-ins and wins from a transcript",
  "layout.lab.krReport.label": "KR report generation",
  "layout.lab.krReport.desc": "Generate a KR report from meeting notes with AI",
  "layout.lab.krWhy.label": "KR 5-whys analysis",
  "layout.lab.krWhy.desc": "Dig into root causes with AI in a 5-whys style dialogue",
  "layout.lab.toggleTitle": "Lab (experimental features)",

  "layout.mobile.myPj": "My projects",
  "layout.mobile.allPj": "All projects",
  "layout.mobile.searchTitle": "Search tasks & projects",
  "layout.mobile.consultTitle": "Consult AI about changes",
  "layout.mobile.settingsTitle": "Settings",
  "layout.mobile.labTitle": "Lab features",

  "layout.theme.toLight": "Switch to light mode",
  "layout.theme.toDark": "Switch to dark mode",
  "layout.calendar.title": "Calendar (monthly view of task due dates)",
  "layout.logout.title": "Log out",

  "layout.fab.consult": "Ask AI",
  "layout.fab.milestone": "Add milestone",
  "layout.fab.task": "Add task",
  "layout.fab.menuTitle": "Open menu",

  "layout.okrMobileNav.manage": "OKR management",
  "layout.okrMobileNav.why": "5 Whys",
  "layout.okrMobileNav.plan": "Plan",

  "layout.tourDemo.withData": "Among the tasks currently registered, tell me which ones I should prioritize and which ones look like they might slip. Also suggest the next action.",
  "layout.tourDemo.noData": "I'm about to start managing plans here. What unit of projects and tasks would make this easiest to manage going forward?",
  "layout.aiProjectCreate.prefill": "I want to start a new project. Please propose a draft goal and initial tasks. (If you already know the purpose, deadline, or owner, please add them to this message.)",

  "layout.sidebar.appName": "Group Plan Manager",
  "layout.sidebar.expand": "Open menu",
  "layout.sidebar.collapse": "Collapse menu",
  "layout.sidebar.groupLabel": "Viewing department",
  "layout.sidebar.groupPlaceholder": "Select a department",
  "layout.sidebar.searchPlaceholder": "Search...",
  "layout.sidebar.searchTitle": "Search tasks & projects (Ctrl+K)",
  "layout.sidebar.aiToolTitle": "AI consultation, project/task registration, and meeting import all in one place",
  "layout.sidebar.aiToolLabel": "Open AI tools",
  "layout.sidebar.aiToolSub": "Consult · Register PJ/task · Import meeting",
  "layout.sidebar.menuLabel": "Menu",
  "layout.sidebar.pjSectionCollapse": "Collapse project list",
  "layout.sidebar.pjSectionExpand": "Expand project list",
  "layout.sidebar.pjSectionLabel": "Projects",
  "layout.sidebar.pjCreateTitle": "Create a new project",
  "layout.sidebar.mineOnlyToAll": "Click to show all tasks",
  "layout.sidebar.mineOnlyToMine": "Click to filter to tasks assigned to me",
  "layout.sidebar.mineLabel": "Mine",
  "layout.sidebar.allLabel": "All",
  "layout.sidebar.allPjLabel": "Show all projects",
  "layout.sidebar.noMineProjects1": "You don't have any projects with tasks assigned to you yet.",
  "layout.sidebar.noMineProjects2": "Switch to \"All\" to see every project.",
  "layout.sidebar.okrSectionCollapse": "Collapse OKR tasks",
  "layout.sidebar.okrSectionExpand": "Expand OKR tasks",
  "layout.sidebar.okrSectionLabel": "OKR tasks",
  "layout.sidebar.allKrLabel": "All KRs",
  "layout.sidebar.allKrTooltip": "Show all KRs",
  "layout.sidebar.noKr": "No KRs registered",

  "layout.appModeToggle.toOkr": "Switch to OKR management mode",
  "layout.appModeToggle.toPlan": "Switch to plan management mode",
  "layout.appModeToggle.planFull": "📋 Plan",
  "layout.appModeToggle.okrFull": "🎯 OKR",

  "layout.comingSoon.viewSuffix": " view",
  "layout.comingSoon.planned": "Coming soon",
};
