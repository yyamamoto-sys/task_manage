# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v2.3
#
# 変更履歴：
# v1.0 Phase 1〜3の設計を反映（データモデル・削除設計・競合制御・画面一覧）
# v2.0 Phase 4の設計を反映（AI連携・システムプロンプト・APIコール・画面反映）
#      追加：Section 6-6〜6-22（AI連携設計の全仕様）
#      追加：Section 13（ファイル構成）
#      更新：Section 10（未解決論点からPhase 4解決済み分を削除）
# v2.1 ToDo層追加・Task設計変更・GraphView追加（2026年3月）
#      追加：3-2b（ToDoデータモデル）
#      更新：2（6層構造に変更）・3-3（Task.project_id NULL許可・todo_ids配列化）
#      更新：13（ファイル構成にGraphView追加）
# v2.2 UI/UX大幅改善・機能追加・ホスティング確定（2026年4月）
#      更新：1（ホスティングをVercelに確定）
#      更新：3-1（TaskForce.tf_numberをドロップダウン選択に変更）
#      更新：8（画面一覧を現状に合わせて更新）
#      更新：13（ファイル構成にMainLayout.tsx追加）
# v2.3 zustand 状態管理移行・楽観ロック実装・ErrorBoundary・AIIntent ガード（2026年5月）
#      追加：Section 1.5（状態管理アーキテクチャ）
#      更新：Section 5（楽観ロック実装の現状）
#      更新：Section 6-1（AIIntent 型ガード）
#      追加：Section 13（appStore.ts / ErrorBoundary.tsx）
# v2.4 OKR freeform セッション追加・テスト基盤導入・ESLint/jsx-a11y 導入（2026-05-08）
#      更新：Section 8（画面一覧に「その他のOKR議論」セッションタイプを追加）
#      追加：kr_sessions テーブルに summary/decisions/kr_mentions 3列・session_type='freeform' を許可
#      テスト基盤：vitest 3 + 4 テストファイル（sanitize / payloadBuilder / applyProposal / krSessionExtractor）合計 69 テスト
#      ESLint：v9 flat config + jsx-a11y recommended（npm run lint）
# v2.5 グランドルール「エラー表示」追加・メンバータグ Phase Tag-1（2026-05-08）
#      追加：Section 15（formatErrorForUser 必須化）
#      追加：member_tags / member_tag_members テーブル
#      追加：管理画面に「メンバータグ」タブ
#      追加：lib/__tests__/errorMessage.test.ts（10テスト・合計 71 テスト）
# v2.6 タスク詳細を常時編集可能化・AI使用量計測の全機能カバー（2026-05-08）
#      変更：TaskEditModal が常時編集可能・自動保存（600ms デバウンス）
#      追加：lib/ai/usageLog.ts と invokeAI への組み込みで全 AI 機能が自動計上
#      追加：Section 16（AI 使用量計測ルール・新機能は invokeAI 経由必須）
#      追加：lib/ai/__tests__/usageLog.test.ts（5テスト・合計 76 テスト）
# v2.7 saveWithLock を多人数運用対応に再昇格（2026-05-12）
#      変更：saveWithLock に expectedUpdatedAt 引数を追加・新しい updated_at を返す
#      変更：全 upsertX が expectedUpdatedAt を受け取り Promise<string> を返す
#      変更：zustand の全 saveX がフォーム時点の updated_at を expectedUpdatedAt
#             として渡し、保存後の新しい updated_at で store を同期
#      変更：クライアント側の `updated_at: new Date()` 上書きを全て撤去
# v2.8 ダッシュボードのPJ連動・プロジェクトカルテ・PJごとのAI分析（2026-05-13）
#      変更：DashboardView がサイドバーのPJ選択に連動し絞り込み＋バナー表示
#      追加：ProjectKarte（PJ選択中のサマリーカード）
#      追加：PJごとのAI分析（projectAnalysisClient / AIIntent="project-analysis"。
#             PJ/Task/Milestone/メンバー名のみ送信）。結果は project_analyses テーブルに
#             保存し最新2件まで保持・最新は全員で共有
#      追加：project_analyses テーブル（migrations/20260513_add_project_analyses.sql）
#      追加：common/MarkdownLite（AI出力の軽量マークダウン描画）
#             （TaskEditModal/KanbanView/AdminView/MeetingImportPanel）
# v2.9 OKR循環ワークフロー：履歴に宣言詳細表示・設計doc・TF会議ノート(Phase A)（2026-05-13）
#      追加：docs/okr-cycle-design.md（①TF会議ノート→②セッション→③分析→④レポートの循環設計）
#      変更：セッション履歴で宣言（誰が何を宣言・結果・学び・文字起こし）を展開表示
#      追加：TF会議ノート（OKRモードの新タブ）。tf_meeting_notes テーブル
#             （migrations/20260513_add_tf_meeting_notes.sql）・tfMeetingNoteStore・TfMeetingNotePanel。
#             TF×週で1件・前週から下書き引き継ぎ可
#      Phase B（分析結果ページ）・C（レポート確認・確定制）・D（循環の見える化）は未着手
# v2.10 会議ノートを TF単位→KR単位（中にTFごとのセクション）に再構成（2026-05-13）
#      変更：tf_meeting_notes → kr_meeting_notes + kr_note_tf_entries
#             （migrations/20260513b_restructure_kr_meeting_notes.sql）。tfMeetingNoteStore→krMeetingNoteStore、
#             TfMeetingNotePanel→KrMeetingNotePanel。OKRタブ「会議ノート」：KR選択→そのKRのTFを順に入力→作成
#      追加：TFエントリに tf_theme（TF説明・その期のテーマ）・todo（その時期のToDo）欄
#      修正：TF選択でKR横断の同番号TFが重複して見えていた問題（KR選択でフィルタ＋id重複除去）
# v2.11 OKR分析結果ページ（Phase B）・会議ノートのカレンダー週選択（2026-05-13）
#      追加：OKRモードに「📊 分析結果」タブ。okr_tf_analyses テーブル
#             （migrations/20260513c_add_okr_tf_analyses.sql）・okrTfAnalysisStore・OkrTfAnalysisPanel・
#             okrTfAnalysisClient（AIIntent="okr-analysis"）。会議ノート履歴＋KRセッション・宣言＋TFタスクを
#             AIが分析、履歴保存（過去分も残す）・遡り・手書き編集可
#      変更：会議ノートの対象週を <input type="date">（その週の月曜にスナップ）に。状態(draft/ready)の説明文を表示
# v2.12 OKRモードを2階層に再構成・分析をKR単位に（2026-05-13）
#      変更：OKRモードの上位タブを「OKR管理 / なぜなぜ / 計画」の3本に。OKR管理配下に
#             サブタブ「概要 / ① 会議ノート / ② セッション記録 / ③ 分析 / ④ レポート作成」を持つ
#             （旧：会議ノート/セッション記録/分析結果/なぜなぜ/計画/概要 のフラット6タブ）
#      変更：AI分析を TF単位→KR単位 に（okr_tf_analyses → okr_analyses。
#             migrations/20260513d_restructure_okr_analyses_to_kr.sql）。OkrTfAnalysisPanel/okrTfAnalysisClient →
#             OkrKrAnalysisPanel/okrKrAnalysisClient。AIIntent "okr-tf-analysis" → "okr-analysis"。
#             そのKRに紐づく全TFの会議ノート＋KRセッション・宣言＋各TFタスクを束ねて分析。レポート作成の素材になる
#      変更：旧「セッション記録」内の「レポート生成」サブモードを廃止し、④レポート作成を独立サブタブに
#      補足：会議ノートのカレンダー週選択・状態(draft/ready)の説明文表示は v2.11 で済
# v2.13 AI境界ルール改定：OKR関連情報（O/KR/TF/ToDo・contribution_memo）もAIに渡してよい（2026-05-13）
#      変更：Section 2「情報の6層構造」から「AIの境界線」を撤廃。Section 2「AI境界ルール」・
#             Section 6-1「絶対的な禁止事項」・6-1b「AIIntent」を改定（残る絶対禁止は APIキー露出・invokeAI直叩きのみ）
#      変更：invokeAI.ts のヘッダコメントを新ルールに合わせて書き換え。AIIntent は「漏洩防止」ではなく
#             「呼び出し目的・渡しているデータのラベル＋使用量計測」の位置づけに
#      補足：社内確認の結果。各 AI 機能が実際に何を渡すかは個別の prompt builder のコメント参照
# v2.14 OKRレポートを確認・確定制に（Phase C）（2026-05-13）
#      追加：kr_reports テーブル（migrations/20260513e_add_kr_reports.sql）・krReportStore
#      変更：KrReportPanel を「AI下書き(draft)→人が確認・編集(HTML直接編集も可)→確定(finalized、確定者/日時を記録、
#             取り消し可)」に。レポート保存先を localStorage → Supabase（kr_reports）へ移行。
#             レポート生成時に③分析（okr_analyses）の最新結果を素材として議事メモに添える＋バナー表示
#      補足：OKR循環ワークフロー Phase A〜C 完了。残りは Phase D（循環の見える化＋④③→①の自動引き継ぎ）
# v2.15 OKR会議記録にWord/PDF対応・Phase D一次（サイクル進捗バー）（2026-05-13）
#      追加：src/lib/docxText.ts（.docx本文抽出、fflate 依存追加）。MeetingImportPanel が Word/PDF を受け付け
#             （PDFはdocumentブロックでAIに添付、Wordはテキスト抽出）。FileAttachButton も .docx 対応。
#             meetingExtractor.extractMeetingData が optional attachment を受け取る
#      追加：OKR管理に「サイクル進捗バー」（選択中KR×今週で①会議ノート→②セッション→③分析→④レポートの状態・各ステップへジャンプ）
#      追加：会議ノート画面に「💡 前回の振り返り（③分析）を見ながら書く」折りたたみ（最新AI分析を参照）
#      残：Phase D の ④③→①自動prefill（確定レポートの学び・分析示唆を翌週ノートに自動投入）はまだ手動（参照表示まで）
# v2.17 OKR分析にObjectiveスコープを追加・合同セッションモード（2026-05-13）
#      追加：okr_analyses に scope/objective_id 列（migrations/20260513h_okr_analyses_objective_scope.sql）。
#             KR/Objective 両対応の1テーブル設計（CHECK でデータ整合性確保）
#      追加：okrObjectiveAnalysisClient（O+配下KRの最新KR分析・直近セッション・タスク状況を束ねた横断分析）。
#             AIIntent は "okr-analysis" を流用
#      変更：OkrKrAnalysisPanel を「対象＝Objective全体 or KR個別」の単一セレクタに改修。
#             Objective分析は配下KRの最新KR分析を素材にして横断的に分析する
#      追加：合同セッションモード（KrJointSessionFlow / extractJointCheckinData / extractJointWinSessionData）。
#             ② セッション記録の対象トグルで「合同（複数KR一括）」「単一KR」を切替（既定＝合同）
# v2.16 OKR循環ワークフロー Phase D 完了：④③→① 自動prefill（2026-05-13）
#      追加：kr_meeting_notes.carry_memo 列（migrations/20260513f_add_kr_note_carry_memo.sql）
#      追加：krMeetingNoteStore.buildCarryMemo（前週確定レポートのHTML→テキスト要点＋最新③分析の「次の一手」「レポート作成のための要点」を抽出して引き継ぎマークダウンを生成）
#      追加：krReportStore.fetchLatestFinalizedKrReport
#      変更：KrMeetingNotePanel に「📋 前回からの引き継ぎメモ」エディタ（折りたたみ・編集可・保存）。
#             「前週から引き継いで作成」と「↻ 引き継ぎメモを自動生成」で自動入力。これで OKR循環ワークフロー
#             ①→②→③→④→翌週の① が閉じる
#      追加：Section 5 を多人数運用版に書き直し
#      追加：lib/supabase/__tests__/store.test.ts に多人数対応テスト追加（合計 84 テスト）
# v2.18 リスト画面の子タスク追加をモーダルに統一・親タスク表記の統一（2026-06-02）
#      変更：ListView の「＋子タスク」をインライン入力 → QuickAddTaskModal（親タスク追加と同じ
#             モーダル）を開く方式に統一。親IDを固定して開き、PJは親に追従。これで親タスク（FAB）と
#             子タスクの登録フォーマットが同一になった（インラインの簡易入力は廃止）
#      追加：QuickAddTaskModal に defaultParentId プロップ（親を初期選択。保存時の project_id 追従・
#             display_order 採番は従来どおり handleSave 側に一元化）
#      変更：親タスク欄の空選択肢の表記を「（なし＝大タスク）」→「（なし＝親タスク）」に統一
#             （QuickAddTaskModal / TaskEditModal / TaskSidePanel）。UI語彙は親/子で統一
#             （データモデル層の 大/小 タスクという呼称は内部コメントに残置）
# v2.19 タスク追加モーダルに 開始日・メモ・子タスク一括入力を追加／AI相談の二重表示修正（2026-06-02）
#      追加：QuickAddTaskModal に「開始日(start_date)」「メモ(comment)」入力欄。
#             さらに最上位タスク作成時のみ「子タスク（1行に1つ）」欄を表示し、保存時に
#             parent_task_id=作成した親・project_id=親のPJ で子タスクを一括作成（2階層固定のため
#             親選択中＝子作成モードでは非表示）
#      修正：AI相談で最新のやりとりが「送信した相談／最新の提案」と「会話履歴」で二重表示される不具合。
#             会話履歴から現在のやりとりを除外（ConsultationPanel）
# v2.20 マルチテナンシー（部署／グループ）のドキュメント化漏れを解消（2026-07-03）
#      追記：Section 1.6（マルチテナンシー・ロール・RLS・権限昇格ガード・過去の事故と教訓）
#      補足：実装自体は2026-06-26〜07-02に本番導入済みだったが、CLAUDE.mdへの反映が漏れていた
#             （groups テーブル・group_id 分離・is_admin/is_super_admin ロール・RLSのNULL抜け穴修正
#             （20260626_add_multitenancy.sql／20260702b_fix_multitenancy_rls.sql／
#             20260702c_add_super_admin_and_department_governance.sql）が未記載のままだった）
#      注意：この期間に入った他の変更（i18n Phase 0-1・期限通知のTeams週次レポート化等）は
#             docs/dev/i18n-plan.md・docs/dev/deadline-notifications.md 側で個別管理されており、
#             今回のCLAUDE.md追記はマルチテナンシーの一件に限定。他の抜け漏れが無いかは未確認。
# v2.21 カンバンビュー内蔵のタスク追加フォームをQuickAddTaskModalに統一（2026-07-06）
#      変更：KanbanViewが独自実装していたAddTaskModal（工数・複数TF紐づけ・追加プロジェクト紐づけ対応）
#             を削除し、ListView/FABと同じQuickAddTaskModalを使うように統一。列の「＋タスクを追加」
#             ボタンは押した列のステータスをdefaultStatusとしてQuickAddTaskModalに渡す
#      追加：QuickAddTaskModalに「優先度（任意）」欄を追加（旧カンバンフォームにあり、統一に伴い移植）
#      仕様変更（意図的）：旧カンバンフォームにあった「工数」入力・「複数のタスクフォース／追加プロジェクトへの
#             一括紐づけ」は統一に伴い廃止。必要な場合はタスク作成後にTaskEditModalで設定する
#      補足：KanbanViewから約300行の重複UIコードを削除（バンドルサイズ約19KB→10KB）
# v2.22 UX改善3点：Undo・スケルトン・コマンドパレット（2026-07-06）
#      追加①：タスク削除（TaskEditModal）・一括削除／一括ステータス変更／一括担当者変更（ListView）に
#             「元に戻す」ボタン付きトーストを追加。Toast.tsxがアクションボタン対応（アクション付きは6秒表示）。
#             復元用に restoreTask（ソフト削除の取り消し）をSupabase層・appStoreに新設。
#             一括変更のUndoは「Undo時点の最新タスクに旧フィールドだけ適用」する方式
#             （古いスナップショット全体を保存すると楽観ロックと衝突するため）
#      追加②：ビュー切替（lazyチャンク読込中）のスピナーをスケルトンUI（common/Skeleton.tsx の
#             ViewSkeleton）に置換。初回ロードは既存の決定的プログレスバーを継続使用
#      追加③：Ctrl+K / Cmd+K のコマンドパレット（common/CommandPalette.tsx）。
#             タスク・PJの横断検索＆ジャンプ、ビュー切替・新規タスク・AI相談のクイックアクション。
#             タスク選択は aiEditTaskId 経由で TaskEditModal を開く。ゲストには作成系アクション非表示。
#             起動手段はショートカットのほか、PCサイドバーの検索ボタン（Ctrl+Kヒント付き）と
#             モバイルヘッダーの🔍ボタン（モバイルはボタンが唯一の起動手段）を常設
# v2.23 ガント完了タスクの取り消し線＋サイドパネル階層UIの選択式再設計（2026-07-07）
#      追加：ガントビューのラベル列（PJ別/ToDo別/人別の全3種）で、完了（done）タスク名に
#             取り消し線＋薄表示（opacity 0.6）を適用。リスト/カンバン/モバイルガントと表現を統一
#      変更：TaskSidePanel（ガント右側のタスク詳細パネル）の親子関係UIを再設計。
#             従来は「親タスク」セレクタと「子タスク」ピッカーが常時両方表示され、どちらも
#             操作できて混乱を招いていた（山本さんフィードバック）。「階層」セグメント
#             （単独／子タスク／親タスク）でモードを選び、選んだモード専用のUIだけを表示する方式に変更：
#             ・子タスク＝親を1つ選ぶCustomSelect（未選択時はヒント文表示）
#             ・親タスク＝子チップ一覧＋複数チェックピッカー（従来の子タスクUIを流用）
#             ・単独＝何も表示しない。子タスクモードから切り替えると親設定を自動クリア
#             ・子が付いている間は「親タスク」以外のセグメントを無効化（先に子を外す運用。孫禁止／2階層固定は不変）
# v2.24 担当者の複数選択UIをチェックボックス方式に変更（2026-07-07）
#      変更：TaskEditModal・TaskSidePanelの「担当者を追加」CustomSelectが、1人選ぶと
#             パネルが閉じてしまい2人目を選ぶには再度開き直す必要があった（山本さんフィードバック）。
#             CustomSelectに multi モードを新設：各行の左にチェックボックスを表示し、
#             選択してもパネルは閉じない（閉じるのは外側クリック／Escapeのみ）ため、
#             続けて複数人をチェック/解除できる。トリガーボタンは選択中のチップ一覧＋
#             「＋ 担当者を追加...」プレースホルダのまま、選択済み人数を表示するのみに変更
#      補足：CustomSelect本体は既存の単一選択呼び出し（他12箇所）に影響しないよう
#             multi=false をデフォルトとし後方互換を維持。QuickAddTaskModalは作成時の
#             単一担当者フローのため対象外（設計どおり。複数人が必要な場合は作成後に編集）
# v2.25 fix: ListViewドラッグ移動中の激しいカクつき・フリーズの根本原因を修正（2026-07-07）
#      原因（レイアウトの再帰的シフト＝reflowフィードバックループ）：ListTaskRowの
#             border-top/border-bottomが、通常時は1px（またはborder-top無し=0px）、
#             ドロップ位置ハイライト時だけ2pxに「幅」が変わる実装になっていた。
#             幅が変わると行の高さ自体がズレるため、ホバーで枠が太くなった瞬間に
#             マウスが行の外に出てdragleaveが発火→枠が戻って行の高さも戻る→
#             マウスが再び行の内側に戻りdragoverが再発火→…という自己誘発的な
#             往復ループが発生し、ドラッグ移動中ずっとレイアウト再計算が回り続けて
#             カクつき・フリーズしていた（KanbanViewの列ドロップ枠は元から
#             「2px固定・色だけ変更」で実装されており同じ問題は無かった＝比較の決め手）。
#      修正：border-top/border-bottomは常に1px固定（色も固定）のまま変えず、ドロップ位置
#             ハイライト・親子ライン等の強調表示は全てbox-shadowのinset（レイアウトに
#             一切影響しないペイントのみの表現）に統一。複数の強調を重ねる場合は
#             box-shadowを複数レイヤー（カンマ区切り）で合成する
#      副次要因（1件）：PJ見出し行の「↑ ここに落とすと最上位タスクになります」ラベルが
#             ドラッグ開始の瞬間に全PJ見出しへ同時出現し、その分だけ見出し行の横幅が
#             一瞬で変わっていた（継続的なループではなく開始時の単発の揺れ）。
#             常時マウントしvisibility切替に変更し、幅を最初から確保することで解消
#
# 最終更新：2026-07-07（v2.25）

> このファイルはAIエージェント（Claude Code / Cursor等）がコードを読み書きする際に
> 設計意図・制約・禁止事項を正確に把握するための最重要ドキュメントです。
> コードを変更する前に必ずこのファイルを読んでください。

---

## 0. プロジェクト概要

**アプリ名**：グループ計画管理アプリ（仮）
**開発者**：チームメンバー
**開発手法**：バイブコーディング（Claude Code / Cursor等によるAI支援開発）
**目的**：チーム全員がプロジェクト・タスクの進捗を一元管理し、変更コストの削減とチーム全体の可視性向上を実現する
**利用者**：チームメンバー全員（10名弱）
**利用環境**：PCブラウザ / Microsoft Teams埋め込み

---

## 1. 技術スタック

| 項目 | 選定 | 理由 |
|---|---|---|
| フロントエンド | TypeScript + React | 型安全・AI補助開発との相性 |
| データベース | Supabase（PostgreSQL） | 無料枠で十分・多対多リレーション対応・RLS設定可 |
| AI連携 | Anthropic Claude API（claude-sonnet-4-6） | OKR/PJ/タスクの相談・分析・レポート生成等に使用（2026-05-13以降 OKR関連情報も投入可） |
| AI中継 | Supabase Edge Function（ai-consult） | APIキーをサーバーサイドにのみ保持するため |
| 通知連携 | Microsoft Teams Webhook | タスク完了・期限通知 |
| ホスティング | Vercel | GitHubへのpushで自動デプロイ（main branch） |

**⚠ 確認が必要な事項（未解決）**
- Supabaseへのデータ保存について社内情報セキュリティポリシーの確認が必要
- Claude APIへのデータ送信について社内ポリシーとの整合性確認が必要
- Teams埋め込みアプリとしての申請手続き確認が必要

---

## 1.5. 状態管理アーキテクチャ（v2.3 で更新）

### zustand ベース・全 selector 化（2026-05-02 完了）

全アプリデータは **`src/stores/appStore.ts` の zustand ストア** に集約。
コンポーネントは selector 形式で必要な state slice のみ subscribe する。

```typescript
// ✅ 正しい使い方：個別 selector
const tasks    = useAppStore(s => s.tasks);
const saveTask = useAppStore(s => s.saveTask);

// ❌ 旧コード（撤去済み）：useAppData() の全 state 購読は使わない
const { tasks, saveTask } = useAppData();
```

`AppDataProvider`（`src/context/AppDataContext.tsx`）は初回 load と Supabase realtime
購読の lifecycle 管理のみを担う薄い Wrapper。`useAppData()` は撤去済み。

### グローバル副作用

- **エラーバウンダリ**：`src/components/common/ErrorBoundary.tsx` を `main.tsx` ルートに配置。
  render 時例外で画面真っ白にならず、fallback UI と再読み込みボタンを表示する。
- **保存エラー通知**：`appStore.ts` の `handleSaveError` が `ConflictError` を判別して
  Toast 通知 + load() で楽観更新前の state に戻す。

---

## 1.6. マルチテナンシー（部署／グループ）とロール（2026-06-26〜07-02 で導入）

> **【重要】このセクションは実装済みだがCLAUDE.mdへの追記が長らく漏れていた（2026-07-03発覚・追記）。**
> 全社展開に向けて、部署（グループ）単位でデータを分離する仕組みが本番導入済み。既存データはすべて `grp-egg`（EGG）グループへ移行済み。

### groups テーブル

```sql
CREATE TABLE groups (
  id         text PRIMARY KEY,   -- 例: 'grp-egg'
  name       text NOT NULL,      -- 例: 'EGG'
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);
```

### 対象テーブルと分離範囲

- `members` / `projects` / `tasks` に `group_id` 列を追加。RLSで自部署のみ参照・操作可能。
- **【対象外】OKR系テーブル（objectives / key_results / task_forces / todos 等）は部署分離されていない。** 新しい部署を追加した場合、その部署にはPJ/タスク管理機能のみを使わせ、OKR機能は使わせないこと（Phase 2で対応予定・Section 9の未解決論点に追記要）。

### ロール（2階層・直交）

| ロール | 列 | 権限範囲 |
|---|---|---|
| 部署管理者 | `members.is_admin` | 自部署内のメンバー・データ管理 |
| 全社スーパー管理者 | `members.is_super_admin` | 部署をまたいだ全データアクセス・部署（groups）の作成／削除 |

一方がもう一方を含意しない。全社スーパー管理者でなくても部署管理者にはなれるし、その逆も可。

### RLSの要点（3つのSECURITY DEFINER関数）

- `current_member_group_id()` — 自分の所属 `group_id` を返す（membersテーブル自体のRLSを迂回するためSECURITY DEFINER）
- `current_member_is_admin()` — 部署管理者か
- `current_member_is_super_admin()` — 全社スーパー管理者か

いずれも `SET search_path = ''` で固定済み（関数ハイジャック対策）。`members` / `projects` / `tasks` は
`group_id = current_member_group_id() OR current_member_is_super_admin()` で参照制御する。

### groups テーブル自体の書き込み権限

- **参照**：全認証ユーザー可
- **新規作成**：全社スーパー管理者のみ
- **改名・編集**：全社スーパー管理者、または自部署のadmin
- **削除**：全社スーパー管理者のみ。かつ**アクティブメンバーが1人でもいる部署はトリガーで物理的に削除をブロック**（統廃合等でどうしても削除したい場合はスーパー管理者権限で強制削除は可能）

### 権限昇格ガード（`guard_member_privilege_columns` トリガー）

`members.is_admin` / `is_super_admin` / `group_id` はクライアントから自由に書き換えられない。BEFORE INSERT/UPDATEトリガーが以下のルールで守る：

- 既存の（全社／部署）管理者は他人の行を含めて変更可
- **ブートストラップ猶予**：company-wide に `is_super_admin=true` が1人もいない間は、自分自身の行に限り自己昇格を許可（他人の代理昇格は不可）。同様に、対象部署に `is_admin=true` が1人もいない間は、その部署内で自己昇格を許可
- 上記に当たらない変更は、該当列だけ静かに元の値へ巻き戻される（表示名などの他フィールドの保存は妨げない）

**新しいマイグレーションを適用した直後は、company-wide/部署ともに管理者0人＝ブートストラップ窓が開いた状態になる。窓を開けたまま放置せず、適用直後にオーナー自身がアプリの管理画面（MembersSection）から自分の行を昇格させ、窓を閉じること。** SQL Editorはservice roleでRLSを素通りするため、この昇格操作は必ずアプリ経由（クライアント経由のUPDATE）で行う。

### 過去に実際に起きた事故と教訓（重要）

2026-06-26の初回実装（`20260626_add_multitenancy.sql`）には、移行期間の猶予のつもりで
`group_id = current_member_group_id() OR current_member_group_id() IS NULL` という一文が入っていた。
しかし実際には**新規サインアップ直後でmembersにまだ登録されていない全ユーザーに対して、全部署のmembers/projects/tasksを無制限公開してしまう抜け穴**になっていた（`current_member_group_id()`がNULLを返すと猶予条項がtrueになり、group_id一致チェックが素通りする）。2026-07-02のセキュリティ調査で発見し、`20260702b_fix_multitenancy_rls.sql`でNULL抜け穴を除去した。

**教訓：RLSに「移行期間の猶予」を書くときは、それが「未認証・未登録ユーザーに何を許してしまうか」を必ず検証すること。** OR条件でNULL/未登録状態を許可する書き方は特に危険。

### 関連migrationファイル

- `supabase/migrations/20260626_add_multitenancy.sql` — 初回導入（groups/group_id/RLS）
- `supabase/migrations/20260702b_fix_multitenancy_rls.sql` — NULL抜け穴修正・管理者限定化・自己昇格ガード
- `supabase/migrations/20260702c_add_super_admin_and_department_governance.sql` — 全社スーパー管理者・部署ガバナンス強化

---

## 2. 情報の6層構造（最重要）

このアプリの設計原則の核心。コードのどこを触るときも必ずこの構造を意識すること。

### OKR系統（Object > KR > TF > ToDo > Task）

```
Layer 1: Objective（O）          ← ラベル管理・削除不可
Layer 2: Key Result（KR）        ← ラベル管理
Layer 3: Task Force（TF）        ← ラベル管理
Layer 4: ToDo                    ← ラベル管理
Layer 5: Task                    ← AI管理
```

> **【2026-05-13 変更】OKR関連情報（O / KR / TF / ToDo）も AI に渡してよいことになった。**
> 以前あった「AIの境界線（O/KR/TFは一切渡さない）」は撤廃。下記「AI境界ルール」参照。

### プロジェクト系統（独立・OKRと無関係に存在可）

```
Project（PJ）                    ← AI管理・AIに渡す
  └── Task                       ← AI管理・AIに渡す
```

### Taskの紐づきパターン（いずれか、または両方）

```
① Project only:  Task.project_id = "uuid", Task.todo_ids = []
② ToDo only:     Task.project_id = null,   Task.todo_ids = ["uuid"]
③ 両方:          Task.project_id = "uuid", Task.todo_ids = ["uuid"]
```

### AI境界ルール（2026-05-13 改定）

**OKR関連情報（Objective / KR / TF / ToDo）も AI に渡してよい。** かつての「O/KR/TF は一切渡さない／ToDo はタイトルのみ」という制約は撤廃された（社内確認の結果）。`contribution_memo`（PJのKR貢献メモ）も渡してよい。

ただし以下は引き続き守る：
- **APIキーはクライアントに露出させない。** AI呼び出しは必ず `クライアント → Supabase Edge Function（ai-consult） → Anthropic API` の経路（`invokeAI.ts` 経由）。
- **`invokeAI()` の `intent: AIIntent` 引数は必須**（下記 6-1b）。「この呼び出しは何の目的でどんなデータを渡しているか」をコード上で表明し、`ai_usage_logs` に機能別の使用量として記録するため。OKRデータ漏洩防止という主旨ではなくなったが、ラベルとして残す。
- 必要のないデータをむやみに大量に送らない（プロンプトサイズ・コスト・誤読の観点。これは設計上の良識であって禁止事項ではない）。
- payloadBuilder.ts 経由の通常タスク管理AI機能は、当面は従来の PJ/Task 中心のペイロードのまま（OKR情報を足すかは個別判断。足してもルール違反ではない）。

`payloadBuilder.ts` の「ToDo 単位のタスクグループを仮想プロジェクトとして表現する」実装は引き続き有効（ペイロード構造の都合であって境界ルールとは別）。

---

## 3. データモデル（確定版）

### 3-1. OKR層（ラベル管理）

```typescript
interface Objective {
  id: string;
  title: string;
  period: string;          // 例："2026年度"
  is_current: boolean;     // true=現行、false=アーカイブ
  archived_at?: Date;
  created_at: Date;
  updated_at: Date;
  updated_by: string;      // member_id
}

interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  description?: string;
  due_date?: Date;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}

interface TaskForce {
  id: string;
  kr_id: string;
  tf_number: string;       // "1"〜"9" の数値文字列。UI上は1〜9のドロップダウン選択（手動入力廃止）
  name: string;
  description?: string;
  leader_member_id?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

### 3-2b. ToDo層（OKR管理）

ToDoは TF の下に存在する「中タスク」。複数の Task（小タスク）で構成される。
**AIには渡さない。タイトルのみ仮想プロジェクト名としてAIペイロードに含める。**

```typescript
interface ToDo {
  id: string;
  tf_id: string;           // 所属するTaskForceのID
  title: string;           // 複数行入力可（説明的なテキストになることが多い）
  due_date: string | null; // 任意。YYYY-MM-DD形式
  memo: string;            // 任意の備考（デフォルト: ""）
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
}
```

### 3-2. PJ層（AI管理）

```typescript
interface Project {
  id: string;
  name: string;
  purpose: string;          // 必須：何のためのPJか一行で
  contribution_memo?: string; // PJがどのKRにどう貢献するかのメモ（2026-05-13以降 AIに渡してもよい）
  owner_member_id: string;
  start_date?: Date;
  end_date?: Date;
  status: 'active' | 'completed' | 'archived';
  color_tag?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;         // 競合検知に使用
  updated_by: string;
}

// PJ ↔ TF 多対多
interface ProjectTaskForce {
  project_id: string;
  tf_id: string;
  created_at: Date;
}

// PJ ↔ Member 多対多
interface ProjectMember {
  project_id: string;
  member_id: string;
  created_at: Date;
}
```

### 3-3. Task層（AI管理）

```typescript
interface Task {
  id: string;
  name: string;
  project_id: string | null; // ← NULL許可（ToDo単独紐づけの場合はnull）
  todo_ids: string[];        // ← ToDoへの紐づき（複数可・任意）。project_idと併用可
  assignee_member_id: string;
  status: 'todo' | 'in_progress' | 'done';
  priority?: 'high' | 'mid' | 'low';
  start_date?: Date;
  due_date?: Date;
  estimated_hours?: number;
  comment?: string;         // URL・ネットワークパスを含む可能性あり
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;         // 競合検知に使用
  updated_by: string;
}
```

### 3-5. マイルストーン（未実装・設計済み）

PJに紐づく期日マーカー。GanttViewで◆表示する。

```typescript
interface Milestone {
  id: string;
  project_id: string;   // 必須。所属するPJのID
  name: string;         // マイルストーン名（例："設計完了"）
  date: string;         // YYYY-MM-DD形式
  is_deleted: boolean;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}
```

#### Supabase テーブル定義

```sql
CREATE TABLE milestones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  date        DATE NOT NULL,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);
-- RLS: authenticated ユーザーのみ read/write
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON milestones
  FOR ALL USING (auth.role() = 'authenticated');
```

#### 実装手順（帰宅後に実施）

1. **Supabase** でテーブル作成（上記SQL）
2. **types.ts** に `Milestone` 型を追加
3. **AppDataContext.tsx** に `milestones` データ・`saveMilestone`・`deleteMilestone` を追加
4. **store.ts** に `fetchMilestones`・`upsertMilestone`・`softDeleteMilestone` を追加
5. **GanttView.tsx** でマイルストーンを◆として描画（PJバー行の上に重ねる）
6. **AdminView.tsx** にマイルストーン管理UI（PJごとにリスト＋追加フォーム）
7. **applyProposal.ts** の milestone ケースを `needs_confirmation` に変更

#### applyProposal の milestone 実装方針

```typescript
// milestone → needs_confirmation を返す（date_changeと同じ確認フロー）
// ConfirmationDialog.action_type に "milestone" を追加する
// confirmedValues: key = milestone.id（新規の場合は仮UUID）, value = 確定した日付
```

---

### 3-4. メンバーマスタ

```typescript
interface Member {
  id: string;
  display_name: string;
  short_name: string;
  initials: string;
  teams_account?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

---

## 4. 削除・アーカイブ設計（確定）

### 基本方針：全層論理削除（is_deleted フラグ）

物理削除は絶対に行わない。

```typescript
// ❌ 物理削除は絶対禁止
await supabase.from('tasks').delete().eq('id', taskId);

// ✅ 論理削除
await supabase.from('tasks')
  .update({ is_deleted: true, deleted_at: new Date(), deleted_by: currentUserId })
  .eq('id', taskId);
```

### 層ごとの挙動

| 層 | 操作 | 挙動 | ダイアログ | 復元 |
|---|---|---|---|---|
| O | 削除不可・期切替 | is_current=false + archived_at記録。新Oを作成してis_current=true | なし | 参照のみ |
| KR | 論理削除 | 非表示。TFはKR欠番で残る | あり | 変更履歴から可 |
| TF | 論理削除 | 非表示。PJの紐づきのみ解除 | あり | 変更履歴から可 |
| PJ | 論理削除 | PJ＋紐づく全タスクを一括論理削除 | あり（件数表示） | 変更履歴からPJ＋タスク一括復元可 |
| Task | 論理削除 | 一覧から非表示 | あり | 変更履歴から可 |
| Member | 論理削除 | 非表示。担当タスクの assignee_member_id を null に変更 | あり（件数表示） | 変更履歴から可 |

### Objectiveの期切替フロー

```
1. 管理画面 > OKR管理 > 「新しい期に切り替える」ボタン
2. 現行のO・KR・TF全体をアーカイブ（is_current=false, archived_at=now）
3. 新しいOのタイトルと期ラベルを入力して作成（is_current=true）
4. 過去の期は管理画面「過去の期を見る」から参照のみ可能
```

---

## 5. 同時編集の競合制御（確定）

### 方針：updated_at による競合検知

対象画面：タスク編集・PJ編集・管理画面（OKR/TF/PJ/Member）・カンバンのステータス変更

```typescript
// 保存時のSQL（Supabase）
const { data, error } = await supabase
  .from('tasks')
  .update({ ...updateData, updated_at: new Date(), updated_by: currentUserId })
  .eq('id', taskId)
  .eq('updated_at', originalUpdatedAt); // 開いた時点のupdated_atと一致する場合のみ更新

// 0件更新 = 競合発生 → 警告を表示
```

### 警告メッセージ

```
⚠ このタスクは保存できません

[更新者名]が[相対時間]前に「[フィールド名]」を変更しました。
最新の内容を確認してから再度編集してください。

[最新の内容を見る]　[それでも上書きする]
```

「それでも上書きする」を選択した場合は updated_at チェックなしで強制保存し、変更履歴に「競合上書き」フラグを残す。

### 実装状況（2026-05-02）

`src/lib/supabase/store.ts` に `saveWithLock()` ヘルパーと `ConflictError` を実装し、
主要エンティティ（tasks/projects/task_forces/todos/key_results/members/milestones/
quarterly_objectives）の upsert を全て楽観ロック経由に変更。

- 競合時：`ConflictError` を投げる
- AppStore の `handleSaveError` で検知 → 「他のメンバーが先に編集していたため最新の内容に戻しました」トースト + load() で整合性回復
- **「それでも上書きする」UI は未実装**（Section 9 で論点化）。現状はリロード前提

### 仕様（2026-05-12 多人数運用対応版）

`saveWithLock` の API：

```typescript
async function saveWithLock<T extends { id: string }>(
  table: string,
  row: T,
  expectedUpdatedAt?: string,  // フォームをロードした時点の updated_at
): Promise<string>             // DB に書き込んだ新しい updated_at を返す
```

**ロック値の優先順位：**
1. `expectedUpdatedAt`（明示的に渡された値・本物のフォーム時点楽観ロック）
2. SELECT で取得した DB の現在値（TOCTOU フォールバック）
3. 両方 null（古い行）→ ロックなし更新

**呼び出し側のルール：**

```typescript
// ❌ クライアント側で updated_at を上書きしない
const updated: Task = {
  ...originalTask,
  // ... fields ...
  updated_at: new Date().toISOString(),  // ← 絶対に書かない
  updated_by: currentUser.id,
};

// ✅ updated_at は触らない。zustand 側で expectedUpdatedAt を渡す
const updated: Task = {
  ...originalTask,
  // ... fields ...
  updated_by: currentUser.id,
};
```

**zustand の各 `saveX` アクションがやること：**
1. set() で楽観更新する前に、store の現在値から `updated_at` を取って `expectedUpdatedAt` とする
2. `upsertX(row, expectedUpdatedAt)` を呼ぶ
3. 成功したら戻ってきた新しい `updated_at` で store を同期（`syncUpdatedAt` ヘルパー）

これにより：
- ✅ ユーザーAがフォームを開いている間にユーザーBが同じ行を更新したら ConflictError で検出
- ✅ 同じユーザーの連続保存も毎回 store の updated_at が更新されるので通る
- ✅ クライアントが間違って `row.updated_at` を新しくしても `expectedUpdatedAt` が別なので影響なし

**【重要】 DB の BEFORE UPDATE トリガーへの対応：**

schema.sql には `trg_*_updated_at` という BEFORE UPDATE トリガーが貼られており、
クライアントが送った `updated_at` 値は `NEW.updated_at = NOW()` で**サーバー側で
強制的に上書きされる**。そのため `saveWithLock` の戻り値（store 同期用）は
クライアントが生成した newUpdatedAt ではなく、`.select("id,updated_at")` で
**DB から返ってきた trigger 適用後の実値**を採用する。

これを怠ると：
- 1回目の保存：成功 → store には client 値、DB には trigger 値（数 μs ずれる）
- 2回目の保存：expectedUpdatedAt = client 値（古い）≠ DB の trigger 値 → **ConflictError**

実際 2026-05-12 にこの問題が顕在化して修正済（コミット参照）。

**回帰防止：** `src/lib/supabase/__tests__/store.test.ts` に 8 本のテスト
（expectedUpdatedAt 明示時のロック・他者書き込み検出・フォールバック挙動・
トリガー上書き後の実値を返すこと等）。

---

## 6. AI連携設計（確定）

### 6-1. 絶対的な禁止事項（2026-05-13 改定）

```typescript
// ❌ 絶対禁止：APIキーをクライアントに露出させる
const response = await fetch("https://api.anthropic.com/v1/messages", {
  headers: { "x-api-key": "sk-ant-..." } // ブラウザに露出する
});

// ✅ 正しい経路（AI呼び出しは必ず invokeAI() を経由）
// クライアント → Supabase Edge Function（ai-consult） → Anthropic API
```

> **【変更】OKR関連情報（O/KR/TF/ToDo）や `contribution_memo` を AI に渡すことは禁止ではなくなった**
> （社内確認の結果。Section 2「AI境界ルール」参照）。残る絶対禁止事項は「APIキーのクライアント露出」と
> 「`invokeAI()` を経由しない直叩き」のみ。

### 6-1b. AIIntent 型ガード（呼び出し目的のラベル＋使用量計測）

`src/lib/ai/invokeAI.ts` の `invokeAI()` は **`intent: AIIntent` パラメータ必須**。
かつては「OKRデータが誤った経路で送られないようコード上で表明させる」目的だったが、現在は
**「この呼び出しは何の機能で、どんなデータを渡しているか」のラベル**として機能する
（そのまま `ai_usage_logs.consultation_type` に保存され、AI使用量タブで機能別集計に使われる）。

```typescript
export type AIIntent =
  | "task-management"      // payloadBuilder 経由・通常のタスク管理相談
  | "kr-report"            // KR レポート生成
  | "kr-quarter-plan"      // クォーター計画
  | "kr-session-extract"   // セッション議事録抽出
  | "kr-why"               // なぜなぜ分析
  | "okr-analysis"         // KR単位のAI分析（会議ノート＋KRセッション・宣言＋TFタスク）
  | "meeting-extract"      // 会議文字起こしからタスク抽出
  | "project-plan"         // AI で PJ 設計
  | "project-analysis"     // 単一PJの健全性分析
  | "todo-decompose";      // ToDo 分解
```

新しい AI 機能を追加するときは、この型に新タグを追加し、当該 prompt builder に
「何のデータを渡しているか」をコメントで明示すること（漏洩防止というより可読性・記録のため）。
タグなしの呼び出しはコンパイルエラー。

### 6-2. APIキーの管理

- APIキーは Supabase の環境変数（ANTHROPIC_API_KEY）にのみ保持する
- .env ファイルを Git にコミットしない（.gitignore に必ず追加）
- クライアントは Supabase Auth トークンで Edge Function に認証する

### 6-3. AIに渡すデータ構造

```typescript
interface AIConsultationPayload {
  context: {
    today: string;                   // 例："2026-03-17"
    today_formatted: string;         // 例："2026年3月17日（火）"
    fiscal_year: { start, end, first_half_end, second_half_start, second_half_end };
    quarters: {
      definition: "1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月";
      current_quarter: string;       // 例："1Q"
      current_quarter_end: string;
      next_quarter: string;
      next_quarter_start: string;
      next_quarter_end: string;
    };
    target_deadline: string | null;  // deadline_checkモードのみ使用
    member_workload: MemberWorkload[]; // メンバーごとの工数状況
  };
  consultation_type: ConsultationType;
  consultation: string;
  scope: "related_pj" | "all_pj" | "member_tasks";
  projects: AIProject[];             // 現状は pj_purpose のみ（contribution_memo は未投入。投入しても可）
  retry_hint?: string;               // リトライ時のみ
}
```

### 6-4. コメントのサニタイズ（必須）

```typescript
// AIに渡す前に必ず呼び出す（payloadBuilder.tsで実装済み）
export function sanitizeComment(comment: string): string {
  return comment
    .replace(/\\\\[^\s]*/g, "[ファイルパス省略]")    // ネットワークパス
    .replace(/\/\/[a-zA-Z0-9._-]+\/[^\s]*/g, "[ファイルパス省略]") // UNCパス
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[メールアドレス省略]")
    .trim();
}
```

### 6-5. shortIdMapの管理

```typescript
// payloadBuilderはshortIdMapと一緒にpayloadを返す
interface BuildPayloadResult {
  payload: AIConsultationPayload;
  shortIdMap: Map<string, string>; // key: "task_001", value: UUID
}

// useAIConsultationのstateで保持し、applyProposalに渡す
const [shortIdMap, setShortIdMap] = useState<Map<string, string>>(new Map());

// セッションリセット時に初期化する
setShortIdMap(new Map());
```

### 6-6. consultation_typeの5種類（厳守）

| 種類 | 説明 |
|---|---|
| `change` | 変更の影響整理（デフォルト） |
| `simulate` | What-If シミュレーション |
| `diagnose` | 現状診断（変更なしでリスクを洗い出す） |
| `deadline_check` | 締め切り逆算（target_deadlineが必須） |
| `scope_change` | PJ停止・スコープ縮小 |

勝手に種類を追加しないこと。追加する場合はsystem_prompt_design_v3.mdも同時に更新する。

### 6-7. マルチターン（会話履歴）の管理

```typescript
// 会話履歴はDBに保存しない。React stateのみ。
// パネルを閉じたら消える設計を崩さないこと。
// セキュリティ上の理由：履歴にはPJ・タスクデータが含まれる。

// トークン上限の管理（ターン数ベース）
// 10ターン → warning（「新しい相談を始める」を表示）
// トークン超過 → truncateOldTurns（直近5ターンを保持して古いターンを削除）
```

### 6-8. date_certaintyの画面表示ルール

| 値 | 表示 | 「反映する」ボタン |
|---|---|---|
| `"exact"` | 特別な表示なし | 活性 |
| `"approximate"` | ⚠ 「日数は要確認」バッジ | 活性 |
| `"unknown"` | ❓ 「日数未定」バッジ | 非活性 |

### 6-9. simulation_stateの画面表示ルール

```typescript
// is_simulation=true の場合：
// - 提案カードに「🔵 シミュレーション」バナーを表示
// - 「反映する」ボタンを非活性にする
// - 「この仮定で確定する」ボタンで通常フローに移行
```

### 6-10. applyProposalのDB操作ルール

```typescript
// date_change・assignee → needs_confirmationを返す
//   確認ダイアログでユーザーが値を確認・入力後にapplyProposalWithConfirmationを呼ぶ
//
// risk・no_tasks・deadline_risk → appendTaskComment（2ステップSELECT+UPDATE）
//   supabase.rpc()は使わない。アプリ側で追記ロジックを実装する。
//
// scope_reduce・pause → 論理削除（is_deleted=true）
//
// milestone → 現在未対応。errorを返す。
//   マイルストーンテーブルの設計完了後にneeds_confirmationに変更する。
```

### 6-11. applyProposalWithConfirmationの引数

```typescript
// shortIdMapは引数に含めない（第3引数は不要）
// 理由：confirmedValuesのキーはDBから取得したUUIDそのものであり、逆引き不要
export async function applyProposalWithConfirmation(
  dialog: ConfirmationDialog,
  confirmedValues: Record<string, string> // key: UUID, value: 新しい日付orメンバーID
): Promise<ApplyResult>
```

### 6-12. useAIConsultationのexportルール

```typescript
// 以下をexportする
return { callState, session, tokenStatus, loadingMessage, shortIdMap, submit, reset };

// useFollowUpはexportしない
// 理由：FollowUpButtonsのonSelectはinputTextへの挿入のみ行う。
//       即APIコールするuseFollowUpは誤用の危険があるため削除済み。
```

### 6-13. システムプロンプトの格納場所

`/src/lib/ai/systemPrompt.ts` に定数として管理する。
直接コード内にインラインで書かない。
変更する場合は system_prompt_design_v3.md のバージョンも上げること。

### 6-14. 四半期定義

```
1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月
年度：1月〜12月
上半期：1〜6月 / 下半期：7〜12月
年度末：12月31日
```

### 6-15. エクスポート仕様（優先度順）

1. **CSV**（最初に実装）
2. **Excel（.xlsx）**（動くものができてから）
3. **PDF**（最後・難易度高・将来検討）

---

## 7. 変更履歴の設計

### 管理画面の変更履歴（2週間保存）

```typescript
interface AdminChangeLog {
  id: string;
  layer: 'objective' | 'kr' | 'tf' | 'project' | 'member';
  action: 'create' | 'update' | 'delete' | 'restore' | 'period_switch';
  target_id: string;
  target_name: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  performed_by: string;
  performed_at: Date;
  is_conflict_override: boolean;
}
// 保存期間：performed_at < NOW() - INTERVAL '14 days' のレコードは定期削除
```

### タスク変更履歴（最低限）

```typescript
interface TaskChangeLog {
  task_id: string;
  updated_at: Date;
  updated_by: string;
}
```

---

## 8. 画面一覧と設計済みの画面

| 画面 | 状態 | 備考 |
|---|---|---|
| セットアップウィザード | ✅ 実装済み | 初回起動時のみ表示 |
| 管理画面 | ✅ 実装済み | タブ構成：タスク / PJ / メンバー / TF / OKR・KR / AI使用量。全員が編集可 |
| ダッシュボード | ✅ 実装済み | OKR進捗・今週タスク・アラート・フィルター付き |
| カンバンビュー | ✅ 実装済み | ドラッグ&ドロップ対応。タスク追加はFABに一本化（右上ボタンは廃止） |
| ガントビュー | ✅ 実装済み | PJ別・人別の2ビューモード。PJバー・マイルストーン・今日線・トグル開閉 |
| リストビュー | ✅ 実装済み | 列カスタマイズ・サイドパネル・エクスポート |
| タスク追加FAB | ✅ 実装済み | 全画面共通・右下固定。TF・ToDo・PJ・担当者・開始日・期日・メモを設定可。最上位作成時は子タスクを一括追加可 |
| PJ作成モーダル | ✅ 実装済み | 3ステップウィザード |
| タスク編集モーダル | ✅ 実装済み | ToDo紐づけフィールド含む |
| AIに変更を相談パネル | ✅ 実装済み | マルチターン・5モード・確認ダイアログ |
| ConfirmationDialogModal | ✅ 実装済み | date_change/assignee確認用 |
| ツアー機能 | ✅ 実装済み | ⚠ 位置指定をpx固定→要素基準に修正が必要（技術的負債） |
| グラフビュー（ラボ機能） | ✅ 実装済み | Canvas+カスタム物理シミュレーション。サイドバーのラボセクションから起動 |
| OKRモード クォーター計画タブ（ラボ機能） | ✅ 実装済み | 翌クォーターのTF計画をAI対話で立案。localStorage保存（Phase 1）。OkrDashboardView「📅 計画」タブ |
| KRセッション freeform モード | ✅ 実装済み（v2.4） | 戦略会議・四半期計画など OKR/TF が議題中心の自由形式会議用。AI が「議論サマリ・決定事項・言及KR・フォローアップ」を抽出して対象 KR にぶら下げ保存。`kr_sessions.session_type='freeform'` + `summary`/`decisions`/`kr_mentions` 列 |

### UI/UX仕様（2026年4月確定）

- **フォント**: M PLUS Rounded 1c（Google Fonts）+ 日本語フォールバックスタック
- **カラー**: すべて `var(--color-*)` CSS変数で管理。ハードコード禁止
- **角丸**: `--radius-sm: 6px` / `--radius-md: 10px` / `--radius-lg: 16px`
- **テキストエリア**: `field-sizing: content` で自動伸縮（Chrome 123+ / Firefox 128+ / Safari 17.4+）
- **フォントサイズ切り替え**: 管理画面に小/中/大（zoom: 0.85/1/1.15）を実装
- **TFアクションボタン**: ToDo・Q移動・編集・解除を2×2グリッドに配置
- **四半期自動判定**: 現在日付から自動的に現在のQを選択（1〜3月=1Q、4〜6月=2Q等）

---

## 9. 未解決の設計論点

| 番号 | 論点 | 優先度 | 備考 |
|---|---|---|---|
| A | KRの進捗率の計算ロジック（手動 vs 自動） | 高 | ダッシュボードのバーに影響 |
| B | ツアー吹き出しの位置指定をpx固定→要素基準に変更 | 中 | Teams埋め込みでズレる |
| D | Teamsへの埋め込みに伴うウィンドウサイズ対応 | 中 | — |
| E | マイルストーン実装（設計完了・帰宅後に実施） | 中 | 下記Section 3-5参照。4ファイル変更が必要 |
| F | PDF出力の実装方法（サーバーサイド vs Print API） | 低 | 将来検討 |
| G | OKR系テーブル（objectives/key_results/task_forces/todos等）が部署分離未対応 | 高 | Section 1.6参照。新しい部署はPJ/タスク管理機能のみ使う運用でしのいでいる。全社展開が進む前にPhase 2で対応要 |

---

## 10. 開発時の注意事項

### TypeScriptの型定義を徹底すること

```typescript
// ❌ any を使わない
const task: any = getTask();

// ✅ 必ず型を定義する
const task: Task = getTask();
```

### コンポーネントと関数に設計意図コメントを必ず書くこと

```typescript
/**
 * 【設計意図】
 * AIへの相談時にデータをサニタイズする関数。
 * ネットワークパスは社内機密情報の漏洩リスクがあるためAIに渡す前に除去する。
 * この関数を経由せずにコメントデータをAIに渡してはいけない。
 */
export function sanitizeComment(comment: string): string { ... }
```

### Supabase の RLS（行レベルセキュリティ）を必ず設定すること

全テーブルに `authenticated` ユーザーのみアクセス可能なRLSポリシーを設定する。

### 物理削除は絶対に実装しないこと（Section 4参照）

### useAIConsultation Hook経由でのみAIを呼ぶこと

```typescript
// ❌ 直接呼ばない
import { callAIConsultation } from "../lib/ai/apiClient";

// ✅ Hookを経由する
const { submit } = useAIConsultation(projectIds);
```

---

## 11. このドキュメントの更新ルール

- 設計変更があった場合は必ずこのファイルを更新すること
- Phase 5（実装）で判明した設計変更は Section 9（未解決論点）に追記してから対応する
- 未解決の論点が解決したら Section 9 から削除して該当Sectionに追記する
- 最終更新：2026-07-07（v2.25）

---

## 12. 関連設計書ファイル一覧

| ファイル | 内容 | バージョン |
|---|---|---|
| `system_prompt_design_v3.md` | AIシステムプロンプト・ペイロード構造・エラー処理 | v3.0 |
| `api_call_design_v1.md` | APIコール設計・型定義・セッション管理 | v1.0 |
| `response_rendering_design_v1.ts` | レスポンス構造化・画面反映設計 | v1.0 |
| `it_dept_consultation.docx` | IT部門向けセキュリティ確認資料 | — |
| `cost_estimation.html` | AIコスト試算書 | — |

---

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
│   ├── localData/
│   │   └── localStore.ts         # localStorage キー一元化（KEYS / LS_KEY / migrateLocalStorage / active()）
│   └── supabase/
│       ├── client.ts             # Supabaseクライアント初期化
│       ├── auth.ts               # セッション取得（getSupabaseSession）
│       ├── store.ts              # 低レベル CRUD + saveWithLock（楽観ロック）+ ConflictError
│       └── quarterPlanStore.ts   # クォーター計画保存（Phase 1: localStorage、Supabase移行準備済み）
├── context/
│   └── AppDataContext.tsx        # 初回 load + Supabase realtime 購読の lifecycle 管理（薄い Wrapper）
├── hooks/
│   └── useAIConsultation.ts      # AI相談機能のReact Hook（唯一の呼び出し口）
└── components/
    ├── common/
    │   └── ErrorBoundary.tsx     # ルート ErrorBoundary（main.tsx で配置）
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
    │   └── GanttView.tsx                  # ガントビュー（PJ別・人別の2モード）
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
        └── AdminView.tsx                  # 管理画面（タスク/PJ/メンバー/TF/OKR・KR/AI使用量の6タブ）

supabase/
└── functions/
    └── ai-consult/
        └── index.ts              # Edge Function（APIキーはここにのみ存在）
```

---

*このドキュメントはClaudeとの設計セッションによって作成されました。*

---

## 14. リファクタリング管理

定期的なコードリファクタリングの記録・ガイドは以下で管理しています。
**リファクタリング作業を始める前に必ずこのファイルを読んでください。**

```
docs/REFACTORING.md  ← 完了済み・未完了・進め方・コスト記録
```

**セッション開始の合言葉**：「リファクタリングをしたい」と言われたら `docs/REFACTORING.md` を読んでから提案すること。

---

## 14.5. ツアー（オンボーディング）改修の必読ルール（必須）

オンボーディングツアー（`src/components/tour/` 配下）の見た目・動き・文面には統一基準があります。

```
docs/dev/tour-guidelines.md  ← 背景の明度・モーション・トンマナ・吹き出し構造・トークンの基準
```

**`src/components/tour/**`（TourProvider・tours/*.ts）や、ツアーの暗幕・吹き出し・アニメ・ステップ文面を
変更する前に、必ず `docs/dev/tour-guidelines.md` を読み、その基準（暗さ・余白・角丸・イージング・
絵文字や番号の付け方・吹き出しテンプレート）に従うこと。** 明度やアニメを個別にハードコードしない。

**セッション中の合言葉**：「ツアーを直したい／ツアーを追加したい」と言われたら、まず
`docs/dev/tour-guidelines.md` を読んでから着手・提案すること。

---

## 15. グランドルール：ユーザー向けエラー表示（必須）

ユーザーに見せるエラーメッセージは「何が起きたか」「次に何をすればよいか」が判別できる粒度で表示する。

### 禁止

```typescript
// ❌ 禁止：何が起きたか分からないため原因究明できない
catch (e) {
  setError("エラーが発生しました");
}

// ❌ 禁止：message だけだとエラーコードが消えるので Supabase 側の原因究明ができない
catch (e) {
  setError(e instanceof Error ? e.message : "エラーが発生しました");
}
```

### 必須：`formatErrorForUser()` を経由する

```typescript
import { formatErrorForUser } from "../../lib/errorMessage";

// ✅ 推奨：エラーコード・details・hint を含めて表示
catch (e) {
  setError(formatErrorForUser("保存に失敗しました", e));
}
```

`formatErrorForUser` は Supabase の `PostgrestError`（code / details / hint）も含めて整形する。

表示例：
- `保存に失敗しました [42703] column "summary" does not exist`
- `保存に失敗しました [23514] new row violates check constraint "kr_sessions_session_type_check"`
- `保存に失敗しました [PGRST116] Cannot find a relationship ...`

### 例外：内部用途で「メッセージ文字列だけ」が必要な場合

`getErrorMessage()` を使う（ログ出力・UI 以外の場所）。

### このルールは新規コードに必ず適用する

既存コードもユーザー操作の起点（保存・削除・AI呼び出し等の catch）から順次 `formatErrorForUser` に置き換える。新規コードで `"エラーが発生しました"` 文字列を直接 setError しているのを見つけたら指摘・修正すること。

---

## 16. グランドルール：AI 使用量の計測（必須）

新しい AI 機能を実装する際は、**必ず ai_usage_logs に使用量が記録される経路を通す**こと。これにより管理画面の「AI使用量」タブで全機能の入出力トークン・コストが見える化される。

### 必須：`invokeAI()` を経由する

```typescript
import { invokeAI } from "../ai/invokeAI";

// ✅ 推奨：invokeAI 経由 → 内部で logAIUsage() が自動的に呼ばれる
const response = await invokeAI(systemPrompt, messages, 4096, "kr-report");
const text = response.content[0].text;
```

`invokeAI` は呼び出し成功後に `logAIUsage(intent, response.usage)` を必ず実行する。**新しい AI 機能を追加するときは何もしなくてよい**——`invokeAI` を経由しているだけで自動的に計上される。

### 禁止：Supabase Edge Function を直接叩く

```typescript
// ❌ 禁止：invokeAI を経由しないと使用量が記録されない
const { data } = await supabase.functions.invoke("ai-consult", { body: {...} });
```

新しい AI 機能で `supabase.functions.invoke("ai-consult", ...)` を直接呼んでいるコードを見つけたら、`invokeAI` 経由に直すこと。

### 例外：`callAIConsultation`（apiClient.ts）

通常のタスク管理相談だけは歴史的経緯で `callAIConsultation` が直接 `supabase.functions.invoke` を呼ぶ別経路になっている。**この経路では `useAIConsultation.submit` 側で個別に `insertAiUsageLog` を呼んで計上している**。

新しい AI 機能でこのパターンを真似ない。必ず `invokeAI` を使う。

### AIIntent タグの追加

新しい AI 機能を追加するときは `src/lib/ai/invokeAI.ts` の `AIIntent` 型に新しいタグを追加する（CLAUDE.md Section 6-1b 参照）。このタグがそのまま `ai_usage_logs.consultation_type` に保存され、AI 使用量タブで機能別の集計に使える。

```typescript
// 例：新機能「会議サマリ生成」を追加するとき
export type AIIntent =
  | "task-management"
  | "kr-report"
  // ... 既存
  | "meeting-summary";  // ← 新規追加
```

### このルールは新規 AI 機能を実装する時に必ず確認する

「AI を呼ぶ → invokeAI 経由か？」「AIIntent に新タグは追加したか？」をレビュー時にチェックする。

## 17. グランドルール：AIと実UIの乖離防止（必須）

### 原則
AIが案内するボタン名・機能説明が実UIと食い違うと、ユーザーが混乱する（例：「確認する」ボタンを案内するが実際は存在しない）。
これを構造的に防ぐために、以下のルールを遵守すること。

### ボタン名は `src/lib/ai/uiGuide.ts` で一元管理する

```typescript
// src/lib/ai/uiGuide.ts
export const BTN_CONFIRM_CREATE = "確認して作成";   // 新規PJ提案カード
export const BTN_APPLY_CONFIRMED = "確定して反映";  // 確認ダイアログ確定ボタン
export const BTN_APPLY = "反映する";               // 一般提案カード
```

**ボタンラベルを変更するとき**：
1. `uiGuide.ts` の定数を変更する → UIコンポーネントとsystemPromptへ自動反映
2. `uiGuide.ts` の `FEATURE_LIST_SECTION` を更新する（機能追加・削除・変更時）

**絶対にやってはいけないこと**：
- `systemPrompt.ts` にボタン名のハードコードを追加する（`uiGuide.ts` の定数を使うこと）
- `ProposalCard.tsx` や `ConfirmationDialogModal.tsx` のラベルを文字列リテラルで書く

### 機能を追加・削除・変更したとき

`uiGuide.ts` の `FEATURE_LIST_SECTION` 定数を必ず更新すること。
この定数がそのまま systemPrompt に埋め込まれ、AIの機能認識の正本となる。

### 更新チェックリスト（機能変更時）

- [ ] UIコンポーネントのボタンラベルを変更した → `uiGuide.ts` の定数を先に変更したか？
- [ ] 新機能を追加した → `uiGuide.ts` の `FEATURE_LIST_SECTION` に追記したか？
- [ ] 機能を削除・変更した → `FEATURE_LIST_SECTION` から該当行を削除・修正したか？
- [ ] AIプロンプトに新しいUIの説明を書いた → ハードコードではなく定数経由か？

## 18. グランドルール：AI Edge Function のセキュリティ最小セット（必須）

AI 機能付き内製アプリを Supabase Edge Function + Vercel 構成で作る場合、以下2点を必ず実装すること。

### ① CORS ドメイン制限

```typescript
// ❌ 禁止：ワイルドカードは誰でも API を叩ける
const corsHeaders = { "Access-Control-Allow-Origin": "*" };

// ✅ 必須：ALLOWED_ORIGINS 環境変数で本番ドメインを限定する
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean),
]);
function getCorsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? "*";
  return { "Access-Control-Allow-Origin": allow, ... };
}
```

**Supabase ダッシュボードで設定する環境変数：**

| 変数名 | 値の例 |
|--------|--------|
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |

### ② ユーザーごとのレート制限

```typescript
// ✅ 認証後にユーザーIDでレート制限（コスト暴走・ループバグ防止）
const RATE_LIMIT = Number(Deno.env.get("RATE_LIMIT_PER_MIN") ?? "20");
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } { ... }

// 超過時は 429 + { error: "RATE_LIMIT_EXCEEDED" } を返す
```

**クライアント側（apiClient.ts）でのハンドリング：**

```typescript
if (errData?.error === "RATE_LIMIT_EXCEEDED") {
  throw new AIError("RATE_LIMIT", errData.message as string);
}
```

### なぜ必要か

| 対策 | 防ぐリスク |
|------|-----------|
| CORS ドメイン制限 | 別サイトの JS から API を叩かれるクロスサイト悪用 |
| レート制限 | ループバグ・悪意ある連打による Anthropic API コスト暴走 |

RLS（認証チェック）は「ログインしていない人」を弾く。CORS + レート制限はその上の「コスト防衛・悪用防止」の層。3つ合わせて AI 機能の最小セキュリティセット。

### このルールは新しい Edge Function を追加するとき必ず確認する

- [ ] CORS が `*` になっていないか？ → `ALLOWED_ORIGINS` 環境変数方式に変える
- [ ] レート制限があるか？ → ユーザーID別・1分N回の in-memory チェックを入れる
- [ ] クライアント側に `RATE_LIMIT_EXCEEDED` ハンドラがあるか？ → ユーザーへの日本語メッセージまで通すこと

---

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
