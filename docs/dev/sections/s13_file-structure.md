## 13. ファイル構成（実装時の配置先）

```
src/
├── stores/
│   └── appStore.ts               # zustand ストア（全アプリデータの単一真実）
├── lib/
│   ├── ai/
│   │   ├── invokeAI.ts           # AI 呼び出しの唯一のゲート（AIIntent 必須）
│   │   ├── types.ts              # AI連携の全型定義（AIErrorCode含む）
│   │   ├── systemPrompt.ts       # システムプロンプト定数
│   │   ├── apiClient.ts          # Claude API呼び出し（Edge Function経由）
│   │   ├── payloadBuilder.ts     # ペイロード構築・サニタイズ・shortIdMap生成
│   │   ├── responseParser.ts     # AIレスポンスのパース・バリデーション
│   │   ├── proposalMapper.ts     # AIResponse→UI表示用型への変換
│   │   ├── applyProposal.ts      # 提案のDB反映処理
│   │   ├── sessionManager.ts     # 会話セッション管理（DBに保存しない）
│   │   ├── krQuarterPlanPrompt.ts  # クォーター計画AI：クォーター計算・コンテキスト生成・システムプロンプト
│   │   └── krQuarterPlanClient.ts  # クォーター計画AI：対話・計画書生成・JSONパーサー
│   ├── date/
│   │   └── holidays.ts           # 日本の祝日判定の薄いラッパー（isHoliday）。japanese-holidays
│   │                              # を直接あちこちで呼ばず必ずここ経由（v3.05）
│   ├── localData/
│   │   └── localStore.ts         # localStorage キー一元化（KEYS / LS_KEY / migrateLocalStorage / active()）
│   ├── i18n.ts                    # 軽量自前i18n（translate()・ja静的import/en動的import＝loadEnDict()。v3.19）
│   ├── chunkSizeGate.ts           # 閾値超えReact.lazyチャンクのDL確認ゲート判定（resolveChunkGateStatus・
│   │                              # dist/chunk-sizes.json実測を読む。v3.19。Section 19参照）
│   ├── lazyWithRetry.ts           # React.lazyの動的import失敗時に1回だけリロードして復旧させるラッパー
│   ├── dependencies/              # タスク依存関係（B1/B3/B5）の純粋ロジック
│   │   ├── cycleCheck.ts         # wouldCreateCycle / canAddDependency（自己依存・重複・循環のDFSチェック）
│   │   ├── gate.ts               # getIncompletePredecessors / formatBlockerNames（完了ゲート・着手警告）
│   │   ├── reschedule.ts         # B3：computeCascadeShifts（制約充足プッシュの自動リスケ連鎖・純粋関数）
│   │   └── linkDirection.ts      # B5：resolveLinkDirection（ガント上のドラッグ結線の先行/後続解決・純粋関数）
│   ├── dragReorder.ts             # タスクD&D並べ替えの純粋ロジック（computeDropZoneFromRatio /
│   │                              # computeSiblingReorderIds。ListView/GanttView共有。v3.01）
│   └── supabase/
│       ├── client.ts             # Supabaseクライアント初期化
│       ├── auth.ts               # セッション取得（getSession）
│       ├── store.ts              # 低レベル CRUD + saveWithLock（楽観ロック）+ ConflictError
│       └── quarterPlanStore.ts   # クォーター計画保存（kr_quarter_plansテーブル・部署スコープRLS。v3.38でSupabase移行済み）
├── context/
│   └── AppDataContext.tsx        # 初回 load + Supabase realtime 購読の lifecycle 管理（薄い Wrapper）
├── hooks/
│   ├── useAIConsultation.ts      # AI相談機能のReact Hook（唯一の呼び出し口）
│   ├── useBulkTaskActions.ts     # 一括操作（ステータス/優先度/担当者変更・削除）。ListView/KanbanView共有
│   └── useTaskDragReorder.ts     # タスクD&D並べ替え（並び替え・親子付け替え・親解除）。
│                                  # ListView/GanttView（PJ別ビューのラベル列）共有（v3.01）
└── components/
    ├── common/
    │   ├── ErrorBoundary.tsx     # ルート ErrorBoundary（main.tsx で配置）
    │   ├── Card.tsx              # 共通Card/SummaryTile/SummaryRow（DashboardViewのCard/KpiTile表現を
    │   │                         # 他画面向けに抽出。現状はAdminView.tsxが利用）
    │   ├── LangToggle.tsx        # EN/JA切替トグル（isLoadingEn中はスピナー表示。v3.19）
    │   ├── ChunkDownloadGate.tsx # withChunkDownloadGate()：閾値超えReact.lazyチャンクのDL確認UI（v3.19。
    │   │                         # Section 19参照。MainLayout.tsxの全lazyコンポーネントに適用）
    │   └── ShortcutsPanel.tsx    # 全ビュー共通ショートカット一覧パネル（旧gantt/GanttShortcutsPanelを汎用化）。
    │                             # MainLayoutが唯一の描画元・画面右下の常設「⌨ショートカット」ボタンとガント凡例の
    │                             # リンク両方から同じstateで開く
    ├── layout/
    │   └── MainLayout.tsx                 # メインレイアウト・ナビゲーション・QuickAddTaskModal（FAB）
    ├── consultation/
    │   ├── ConsultationPanel.tsx          # 相談パネル本体
    │   ├── ProposalCard.tsx               # 提案カード
    │   ├── ConfirmationDialogModal.tsx    # 日程・担当者変更の確認ダイアログ
    │   ├── ChatHistory.tsx                # 会話履歴表示
    │   ├── FollowUpButtons.tsx            # 次の相談候補ボタン
    │   ├── SimulationBanner.tsx           # シミュレーションモードの警告バナー
    │   ├── LoadingView.tsx                # ローディング表示
    │   └── ErrorView.tsx                  # エラー表示
    ├── gantt/
    │   ├── GanttView.tsx                  # ガントビュー（PJ別・人別の2モード）
    │   └── ganttDependencyArrows.ts       # B2：依存矢印の座標計算（純粋関数のみ。DOM実測はGanttView側）
    ├── kanban/
    │   └── KanbanView.tsx                 # カンバンビュー（ドラッグ&ドロップ）
    ├── graph/
    │   └── GraphView.tsx                  # ラボ機能：関係性グラフビュー（Canvas+物理シミュレーション）
    ├── lab/
    │   ├── KrSessionPanel.tsx             # OKRセッション記録・文字起こし抽出
    │   ├── KrReportPanel.tsx              # OKRレポート生成
    │   ├── KrWhyPanel.tsx                 # なぜなぜ分析AI対話
    │   └── KrQuarterPlanPanel.tsx         # クォーター計画AI対話・計画書生成・編集・保存
    ├── task/
    │   └── TaskEditModal.tsx              # タスク編集モーダル（ToDo紐づけフィールド含む）
    └── admin/
        └── AdminView.tsx                  # 管理画面（カテゴリ分け左ナビ：作業設定/人/組織/レポート。計7項目）

supabase/
└── functions/
    └── ai-consult/
        └── index.ts              # Edge Function（APIキーはここにのみ存在）
```

---

*このドキュメントはClaudeとの設計セッションによって作成されました。*

---
