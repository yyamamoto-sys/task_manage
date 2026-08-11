// src/i18n/layout.ja.ts
//
// 【設計意図】
// App Shell（src/App.tsx）と MainLayout（src/components/layout/MainLayout.tsx）の文言辞書（日本語）。
// Phase 1（i18n-plan.md）。ShortcutsPanel.tsx の SECTIONS データ（common.shortcuts.*）は
// src/i18n/common.ja.ts 側に置く（あのパネル自体が components/common/ 配下のため）。
// ja/en分割の理由は src/i18n/common.ja.ts のコメント参照（v3.19）。

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
  "layout.sidebar.showArchivedLabel": "アーカイブを表示",
  "layout.sidebar.showArchivedOn": "クリックでアーカイブ済みPJも表示",
  "layout.sidebar.showArchivedOff": "クリックでアーカイブ済みPJを非表示",
  "layout.sidebar.okrSectionCollapse": "OKRタスクを省略",
  "layout.sidebar.okrSectionExpand": "OKRタスクを展開",
  "layout.sidebar.okrSectionLabel": "OKRタスク",

  // ----- AppModeToggle -----
  "layout.appModeToggle.toOkr": "個人OKRモードに切り替え",
  "layout.appModeToggle.toPlan": "計画管理モードに切り替え",
  "layout.appModeToggle.planFull": "📋 計画",
  "layout.appModeToggle.okrFull": "🎯 OKR",

  // ----- ComingSoon -----
  "layout.comingSoon.viewSuffix": "ビュー",
  "layout.comingSoon.planned": "実装予定",
} as const;
