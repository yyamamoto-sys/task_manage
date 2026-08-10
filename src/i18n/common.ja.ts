// src/i18n/common.ja.ts
//
// 【設計意図】
// 複数モジュールで共通に使う文言（アプリ名・汎用ボタン等）と、components/common/ 配下の
// 各共通UI部品が自前で持つ固定文言の辞書（日本語）。
// 【重要】ここに入れるのは「部品自身が持つ固定文言」だけ。Toast/EmptyState等のように
// 呼び出し元がprops経由で渡す文言（メッセージ本文・タイトル等）はここでは翻訳しない
// （呼び出し側はPhase 2以降の対象であり、ここで訳すと二重管理になるため）。
// モジュール固有の文言は各モジュールの辞書ファイル（例：src/i18n/auth.ja.ts）に置く。
//
// 【ja/en分割（v3.19・ダウンロード量最小化）】
// 以前は commonJa/commonEn を同一ファイル（common.ts）に置いていたが、ja は静的import・
// en は動的importにする（英語を使わないユーザーに英語データを持たせないため）都合上、
// 完全に別モジュールへ分割した。commonEn 側は `import type` で commonJa の型だけを
// 参照する（実行時にこのファイルを読み込まない＝バンドルに含めない）。
// 詳細は src/lib/i18n.ts のコメントと docs/dev/i18n-plan.md を参照。

export const commonJa = {
  "common.app.name": "グループ計画管理",
  "common.button.cancel": "キャンセル",
  "common.button.save": "保存",
  "common.button.close": "閉じる",
  "common.loading": "読み込み中...",

  // ----- ConfirmModal -----
  "common.confirm.ok": "OK",
  "common.confirm.delete": "削除する",

  // ----- DangerZone -----
  "common.dangerZone.title": "⚠ 危険な操作",
  "common.dangerZone.typeToConfirm": "続行するには「{name}」と入力してください",
  "common.dangerZone.processing": "処理中…",

  // ----- CustomSelect -----
  "common.select.placeholder": "選択...",
  "common.select.searchPlaceholder": "名前で検索...",
  "common.select.noMatch": "該当する候補がありません",
  "common.select.selectedCount": "{count}件選択中",

  // ----- ErrorBoundary -----
  "common.errorBoundary.badge": "予期しないエラー",
  "common.errorBoundary.title": "画面の表示中に問題が発生しました",
  "common.errorBoundary.body": "下のボタンから再読み込みすると復旧することが多いです。繰り返す場合は、開いていたタブと操作内容を控えて山本さんに連絡してください。",
  "common.errorBoundary.detailsSummary": "エラー詳細",
  "common.errorBoundary.dismiss": "閉じて続ける",
  "common.errorBoundary.reload": "再読み込み",

  // ----- ErrorBar -----
  "common.errorBar.entryPrefix": "[エラー]",
  "common.errorBar.entryContext": "操作: {context}",
  "common.errorBar.entryCode": "コード: {code}",
  "common.errorBar.entryMessage": "内容: {message}",
  "common.errorBar.historyPanelTitle": "エラー履歴（最大{max}件）",
  "common.errorBar.copyAll": "全コピー",
  "common.errorBar.copied": "コピー済",
  "common.errorBar.copyFailed": "コピー失敗",
  "common.errorBar.clear": "クリア",
  "common.errorBar.noHistory": "保存されたエラーはありません",
  "common.errorBar.copy": "コピー",
  "common.errorBar.copiedShort": "済",
  "common.errorBar.failedShort": "失敗",
  "common.errorBar.historyButton": "履歴 {count}件",
  "common.errorBar.historyButtonTitle": "エラー履歴を表示",
  "common.errorBar.copyTitle": "エラー情報をコピー",
  "common.errorBar.copiedFull": "コピーしました",

  // ----- FileAttachButton -----
  "common.fileAttach.attach": "添付",
  "common.fileAttach.attachTitle": "PDF・Word(.docx)・画像・テキストを添付",
  "common.fileAttach.removeTitle": "添付を解除",
  "common.fileAttach.docxFailed": "Wordファイルの読み込みに失敗しました。",
  "common.fileAttach.htmlFailed": "HTMLファイルの読み込みに失敗しました。",
  "common.fileAttach.pdfFailed": "PDFファイルの読み込みに失敗しました。",
  "common.fileAttach.unsupported": "非対応の形式です。\n対応: PDF / Word(.docx) / 画像(PNG・JPG・WebP・GIF) / テキスト(TXT・MD・CSV・HTML)",
  "common.fileAttach.dropHint": "📎 ファイルをドロップして添付",

  // ----- InlineEditAssignee / InlineEditDate / InlineEditText -----
  "common.assignee.unassigned": "未担当",
  "common.assignee.editTitle": "クリックして担当者を変更",
  "common.date.dueUnset": "期日未設定",
  "common.date.clearTitle": "日付をクリア",
  "common.date.editTitle": "クリックして日付を編集",
  "common.text.editTitle": "クリックして編集",

  // ----- LoadingTips -----
  "common.loadingTips.heading": "💡 知っていると便利",

  // ----- MentionTextarea -----
  "common.mention.heading": "@ メンション",

  // ----- SaveProgressLoader -----
  "common.saveProgress.title": "データベースに保存しています",
  "common.saveProgress.waiting": "しばらくお待ちください…",
  "common.saveProgress.step": "ステップ {current} / {total}",

  // ----- AIProgressLoader -----
  "common.aiProgress.waiting": "AIが処理中です。しばらくお待ちください…",

  // ----- CommandPalette -----
  "common.commandPalette.viewDashboard": "ダッシュボードを開く",
  "common.commandPalette.viewKanban": "カンバンを開く",
  "common.commandPalette.viewGantt": "ガントを開く",
  "common.commandPalette.viewList": "リストを開く",
  "common.commandPalette.viewWorkload": "ワークロードを開く",
  "common.commandPalette.quickAddTask": "新規タスクを追加",
  "common.commandPalette.consult": "AIに相談する",
  "common.commandPalette.groupAction": "アクション",
  "common.commandPalette.groupProject": "プロジェクト",
  "common.commandPalette.groupTask": "タスク",
  "common.commandPalette.placeholder": "タスク・プロジェクトを検索、またはアクションを選択...",
  "common.commandPalette.noMatch": "「{query}」に一致するものが見つかりません",
  "common.commandPalette.taskDueDate": "期日 {date}",
  "common.commandPalette.hintMove": "↑↓ 移動",
  "common.commandPalette.hintOpen": "Enter 開く",
  "common.commandPalette.hintClose": "Esc 閉じる",

  // ----- ShortcutsPanel -----
  "common.shortcuts.title": "ショートカット一覧",
  "common.shortcuts.closeTitle": "閉じる",
  "common.shortcuts.closeAriaLabel": "ショートカット一覧を閉じる",
  "common.shortcuts.currentViewSuffix": "（今のビュー）",

  "common.shortcuts.section.common.title": "全ビュー共通",
  "common.shortcuts.section.common.kb.label": "キーボード",
  "common.shortcuts.section.common.kb.item1.gesture": "Ctrl / Cmd + K",
  "common.shortcuts.section.common.kb.item1.desc": "コマンドパレットを開く/閉じる（タスク・プロジェクトを横断検索）",
  "common.shortcuts.section.common.kb.item2.gesture": "Ctrl / Cmd + Z",
  "common.shortcuts.section.common.kb.item2.desc": "直前の操作を元に戻す（削除や一括操作などUndo付きトーストが出た直後に有効。入力欄では代わりにブラウザ標準のテキストUndoが働く）",

  "common.shortcuts.section.list.title": "リスト",
  "common.shortcuts.section.list.mk.label": "マウス／キーボード",
  "common.shortcuts.section.list.mk.item1.gesture": "Ctrl / Cmd + A",
  "common.shortcuts.section.list.mk.item1.desc": "現在の絞り込み後の全タスクを選択",
  "common.shortcuts.section.list.mk.item2.gesture": "Ctrl / Cmd + クリック（行）",
  "common.shortcuts.section.list.mk.item2.desc": "タスクを複数選択（トグル。詳細は開かない）",
  "common.shortcuts.section.list.mk.item3.gesture": "Shift + クリック（行）",
  "common.shortcuts.section.list.mk.item3.desc": "直前に選択/クリックした行〜クリックした行までを表示順で範囲選択",
  "common.shortcuts.section.list.mk.item4.gesture": "Esc",
  "common.shortcuts.section.list.mk.item4.desc": "選択を解除",
  "common.shortcuts.section.list.mk.item5.gesture": "クリック（行）",
  "common.shortcuts.section.list.mk.item5.desc": "タスク詳細を開く（既存の選択は解除しない）",
  "common.shortcuts.section.list.toolbar.label": "選択時のツールバー",
  "common.shortcuts.section.list.toolbar.item1.gesture": "一括操作バー",
  "common.shortcuts.section.list.toolbar.item1.desc": "選択1件以上でステータス一括変更・担当者一括変更・一括削除ができる",

  "common.shortcuts.section.kanban.title": "カンバン",
  "common.shortcuts.section.kanban.mk.label": "マウス／キーボード",
  "common.shortcuts.section.kanban.mk.item1.gesture": "Ctrl / Cmd + クリック（カード）",
  "common.shortcuts.section.kanban.mk.item1.desc": "カードを複数選択（トグル。詳細は開かない）",
  "common.shortcuts.section.kanban.mk.item2.gesture": "Shift + クリック（カード）",
  "common.shortcuts.section.kanban.mk.item2.desc": "直前に選択/クリックしたカード〜クリックしたカードまでを表示順（列→列内上から下）で範囲選択",
  "common.shortcuts.section.kanban.mk.item3.gesture": "Ctrl / Cmd + A",
  "common.shortcuts.section.kanban.mk.item3.desc": "表示中の全カードを選択",
  "common.shortcuts.section.kanban.mk.item4.gesture": "Esc",
  "common.shortcuts.section.kanban.mk.item4.desc": "選択を解除",
  "common.shortcuts.section.kanban.mk.item5.gesture": "クリック（カード）",
  "common.shortcuts.section.kanban.mk.item5.desc": "タスク詳細を開く",
  "common.shortcuts.section.kanban.mk.item6.gesture": "選択中カードをドラッグ",
  "common.shortcuts.section.kanban.mk.item6.desc": "選択した複数カードをまとめて別列（ステータス）へ一括移動",
  "common.shortcuts.section.kanban.toolbar.label": "選択時のツールバー",
  "common.shortcuts.section.kanban.toolbar.item1.gesture": "一括操作バー",
  "common.shortcuts.section.kanban.toolbar.item1.desc": "選択1件以上でステータス一括変更・担当者一括変更・一括削除ができる",

  "common.shortcuts.section.gantt.title": "ガント",
  "common.shortcuts.section.gantt.mouse.label": "マウス操作",
  "common.shortcuts.section.gantt.mouse.item1.gesture": "Ctrl / Cmd + クリック",
  "common.shortcuts.section.gantt.mouse.item1.desc": "タスクを複数選択（トグル）",
  "common.shortcuts.section.gantt.mouse.item2.gesture": "Shift + クリック",
  "common.shortcuts.section.gantt.mouse.item2.desc": "直前に選択したタスク〜クリックしたタスクまでを表示順に範囲選択",
  "common.shortcuts.section.gantt.mouse.item3.gesture": "選択中バーの中央をドラッグ",
  "common.shortcuts.section.gantt.mouse.item3.desc": "選択した複数タスクをまとめて日付シフト",
  "common.shortcuts.section.gantt.mouse.item4.gesture": "バー中央をドラッグ",
  "common.shortcuts.section.gantt.mouse.item4.desc": "タスク全体を移動（開始日・期日を同時にずらす）",
  "common.shortcuts.section.gantt.mouse.item5.gesture": "バー左端をドラッグ",
  "common.shortcuts.section.gantt.mouse.item5.desc": "開始日を変更",
  "common.shortcuts.section.gantt.mouse.item6.gesture": "バー右端をドラッグ",
  "common.shortcuts.section.gantt.mouse.item6.desc": "期日を変更",
  "common.shortcuts.section.gantt.mouse.item7.gesture": "バー端の外側の点をドラッグ（🔗依存ON時）",
  "common.shortcuts.section.gantt.mouse.item7.desc": "依存関係（先行→後続）を結線",
  "common.shortcuts.section.gantt.mouse.item8.gesture": "バーをクリック",
  "common.shortcuts.section.gantt.mouse.item8.desc": "タスク詳細を開く",
  "common.shortcuts.section.gantt.mouse.item9.gesture": "空白をクリック",
  "common.shortcuts.section.gantt.mouse.item9.desc": "選択を解除",
  "common.shortcuts.section.gantt.kb.label": "キーボード",
  "common.shortcuts.section.gantt.kb.item1.gesture": "Esc",
  "common.shortcuts.section.gantt.kb.item1.desc": "選択解除、または結線操作のキャンセル",
  "common.shortcuts.section.gantt.kb.item2.gesture": "T",
  "common.shortcuts.section.gantt.kb.item2.desc": "今日の位置へジャンプ",
  "common.shortcuts.section.gantt.kb.item3.gesture": "+ / =　・　- / _",
  "common.shortcuts.section.gantt.kb.item3.desc": "ズームイン／ズームアウト",
  "common.shortcuts.section.gantt.kb.item4.gesture": "Ctrl / Cmd + A",
  "common.shortcuts.section.gantt.kb.item4.desc": "現在表示中の全タスクを選択",
  "common.shortcuts.section.gantt.kb.item5.gesture": "Enter",
  "common.shortcuts.section.gantt.kb.item5.desc": "1件選択中のタスクの詳細を開く（複数選択時は何もしない）",
  "common.shortcuts.section.gantt.toggle.label": "ツールバーのトグル",
  "common.shortcuts.section.gantt.toggle.item1.gesture": "🔗依存",
  "common.shortcuts.section.gantt.toggle.item1.desc": "依存関係の矢印・結線ハンドルの表示/非表示",
  "common.shortcuts.section.gantt.toggle.item2.gesture": "▤ベースライン",
  "common.shortcuts.section.gantt.toggle.item2.desc": "当初計画（ベースライン）とのゴーストバー比較",
  "common.shortcuts.section.gantt.toggle.item3.gesture": "🙈完了を隠す",
  "common.shortcuts.section.gantt.toggle.item3.desc": "完了タスクを非表示（未完了の子を持つ親は残す）",
  "common.shortcuts.section.gantt.toggle.item4.gesture": "🎯クリティカルパス",
  "common.shortcuts.section.gantt.toggle.item4.desc": "所要期間を決める最長の依存連鎖を強調",
  "common.shortcuts.section.gantt.toggle.item5.gesture": "⚠過負荷",
  "common.shortcuts.section.gantt.toggle.item5.desc": "人別ビューで同時アクティブタスクの重なりを強調",

  // ----- ChunkDownloadGate（v3.19） -----
  "common.chunkGate.message": "この画面の表示には約{size}KBのデータのダウンロードが必要です。よろしいですか？",
  "common.chunkGate.approve": "ダウンロードする",
  "common.chunkGate.decline": "キャンセル",
  "common.chunkGate.declinedNotice": "ダウンロードをキャンセルしました。",

  // ----- OkrModeIntroModal（v3.39・OKRモードの初回ゲート） -----
  "common.okrModeGate.title": "OKRモードについて",
  "common.okrModeGate.featuresIntro": "OKRモードでできること",
  "common.okrModeGate.feature1": "個人の四半期KR（Kintoneの個人OKRに対応）をタブで管理",
  "common.okrModeGate.feature2": "KRごとに月を切り替えて「今月の計画」を確認",
  "common.okrModeGate.feature3": "週ごとに「週の目標状態」を書き、◯△✕で自己評価（評価すると週の色が変わります）",
  "common.okrModeGate.feature4": "KRごとにメモを追記・週にタスクを紐づけ（自分だけが見えます）",
  "common.okrModeGate.dataNotice": "この案内は初回のみ表示されます。各機能のデータは、実際に開いたときに読み込まれます。",
  "common.okrModeGate.approve": "開く",
  "common.okrModeGate.decline": "やめる",

  // ----- LangToggle（v3.21・Phase 2凍結中の部分対応注記） -----
  "common.lang.partialNotice": "英語表示は現在アプリの枠組みと共通UIのみ対応しています（各画面の中身は日本語のままです）",

  // ----- VersionBadge（v3.25） -----
  "common.version.tooltip": "v{version}（ビルド {buildTime}）",

  // ----- SchemaHealthBanner（v3.26） -----
  "common.schemaHealth.title": "DBに未適用のマイグレーションがある可能性があります",
  "common.schemaHealth.body": "以下の項目が見つかりませんでした。該当のマイグレーションファイルをSupabaseに適用してください。",
  "common.schemaHealth.rpcUnavailable": "スキーマ検査を実行できません（検査用の関数が未適用の可能性があります）",

  // ----- ゲスト（サンプル閲覧）モード（v3.28・v3.29でAI利用開始失敗時の文言に変更） -----
  "common.guest.aiBlocked": "サンプルでのAI利用を開始できませんでした。しばらくしてから再度お試しください。",

  // ----- GuestAiQuotaNotice（v3.31・使う前に回数を明示） -----
  "common.guest.quota.remaining": "AI機能は1日{limit}回まで試せます。本日の残り：{remaining}回",
  "common.guest.quota.exhausted": "本日のAI利用（{limit}回）を使い切りました。",
} as const;
