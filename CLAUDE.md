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
# v2.26 アニメーション未設定箇所の洗い出し＋出現アニメーション統一（2026-07-07）
#      経緯：「AI相談パネルの出現・カンバンのホバーは滑らかだが、タスク詳細を開く時など
#             未設定の動きがある」という指摘を受け、position:fixed inset:0のオーバーレイ・
#             パネル系21箇所を全数調査。結果、①完全に無アニメーション＝13箇所、
#             ②本体だけアニメーションがあり背景（暗幕）が瞬間表示＝6箇所、が判明
#      最優先対応：TaskSidePanel（ガント/リスト/カンバン右側のタスク詳細パネル）に
#             新規keyframe sidePanelSlideIn（右へ16pxオフセット+フェード）を追加。
#             ドッキング型で背景暗幕を持たないため専用のkeyframeとした。taskId切替では
#             パネルが再マウントされないため、パネルを開いた瞬間だけ再生される
#      次点対応：ConfirmModal（削除確認。17箇所から呼び出される最頻出モーダル）の背景に
#             animate-overlayを追加。本体も直書きinline animationから共通クラス
#             animate-fadeInへ統一（inline animationはCSSクラス経由のreduced-motion
#             指定の対象外だったため）
#      残り一括対応：ConfirmationDialogModal・ChangeHistoryModal・ProjectCreateModal・
#             TodoDecomposeModal・DashboardView/ProjectKarteの全PJ AI分析モーダル・
#             KrQuarterPlanPanel・KrReportPanel（フローティング時）・MeetingImportPanel・
#             MainLayoutのオンボーディングオーバーレイ/モバイルラボボトムシート・
#             MilestoneAddModal・MilestoneEditModal・GuideOverlay・KrWhyPanel（同）・
#             TaskEditModal・OkrDashboardView（概要・履歴の2オーバーレイ）・
#             GraphView・CalendarLabView・ProjectStructureView（全画面ラボ系3つ）に
#             animate-overlay（背景）＋animate-fadeInまたはpanel-slide-up（本体）を適用
#      補足：prefers-reduced-motion（動きを減らす設定）のガード対象を、従来ツアー機能
#             のみだった範囲から既存の出現アニメーション全般（animate-fadeIn/
#             modalEnter/overlay/slideDown/dropdown/toast-in・panel-slide-up/
#             chat-bubble-in/fab-item-in）に拡大し、今回追加したsidePanelSlideInも含めた
# v2.27 fix: TaskSidePanelのスライドインを「幅0→実幅」に強化（体感できる動きに）（2026-07-07）
#      経緯：v2.26で追加したsidePanelSlideIn（右へ16pxオフセット+フェード）は、パネルが
#             最初から最終的な幅で表示され中身がわずかに動くだけだったため、「動きが
#             見えない/弱すぎる」と山本さんからフィードバック。OSの「動きを減らす」設定は
#             ONで他のアニメーションは動作しており原因ではないと確認済み
#      修正：keyframeを「幅0→フェードイン」に変更。to側でwidthを指定しないことで、
#             CSS Animationsの仕様どおりパネルの実際の（JSのpanelWidthで決まる可変の）
#             幅へ自然に収束させる。ルート要素は元々overflow:hiddenなので幅が狭い間の
#             中身は自動的にクリップされる。AI相談パネル（幅をtransitionで0→実幅にする
#             手法）と同じ「広がって出てくる」体感に統一。所要時間も0.22s→0.3sに調整
# v2.28 feat: メンバー別ワークロードビューを新規追加（プロマネ特化の第一歩）（2026-07-17）
#      背景：本アプリを単なるタスク管理から「プロジェクトマネジメント特化」へ進化させる
#             方針の第一段。PMツール調査（PMBOK10知識エリア基準）で、資源管理（リソース／
#             ワークロード）が未UI化のギャップとして高優先と判定された。集計ロジック自体は
#             AI相談用にbuildMemberWorkloadとして既に存在したが画面が無い状態だった
#      追加：src/lib/workload/computeWorkload.ts（computeMemberWorkloadRows。件数・工数・
#             期限超過集計の単一の真実源）＋ __tests__/computeWorkload.test.ts（6テスト）
#      追加：src/components/workload/WorkloadView.tsx。ViewModeに"workload"追加・NAV_ITEMS・
#             lazyWithRetry登録・CommandPalette（Ctrl+K）クイックアクションにも追加
#      変更：payloadBuilder.tsのbuildMemberWorkloadを共有関数を呼ぶだけに変更。AI相談
#             ペイロード出力（member_workload）は完全に不変（既存テスト全グリーンで担保）
#      仕様：部署スコープはselectScopedTasks/selectScopedMembersを厳守（過去の越境漏洩の教訓）。
#             主軸はアクティブ件数（未着手+進行中）、工数は補助表示、期限超過をバッジ表示。
#             突出負荷（平均1.5倍以上かつ3件以上）を赤強調。PJ絞り込みフィルタ・未割当バッジあり
#      DBマイグレ不要（既存フィールドのみ使用）。コミット 2bf7659
# v2.29 feat: タスク依存関係 フェーズB1（依存モデル＋先行タスクピッカー＋完了ハードゲート＋
#      着手ソフト警告）を新規追加（2026-07-17）
#      背景：プロマネ特化ツール化の2本目の柱（project_task_manage.md「機能B」参照）。
#             山本さんの実需＝手続きの順番を踏ませたい（手戻り事故が実際に発生）。
#             段階リリースの1段目（B1）のみ。B2＝ガント矢印可視化／B3＝自動リスケ連鎖／
#             B4＝ベースライン差分は今回未着手（次フェーズ）
#      追加：task_dependencies テーブル（migrations/20260717_add_task_dependencies.sql）。
#             predecessor_task_id/successor_task_id/group_id/監査列（is_deleted等）。
#             既存 task_task_forces/task_projects と違い is_deleted による論理削除の監査証跡を
#             持たせるため milestones/kr_reports と同じ「独立id・soft delete」流儀にした。
#             自己依存はCHECK制約・同一ペア重複は部分ユニークインデックス（is_deleted=falseのみ）で防止。
#             RLSはtasks/projects/membersと同じgroup_idスコープ（NULL猶予条項なし。group_id自体をNOT NULLに）。
#             Realtime購読対象にも追加（11テーブル目）
#      追加：src/lib/localData/types.ts に TaskDependency 型
#      追加：src/lib/dependencies/cycleCheck.ts（wouldCreateCycle・canAddDependency＝
#             自己依存/重複/循環のクライアント側DFSチェック）・gate.ts（getIncompletePredecessors・
#             formatBlockerNames）。それぞれ__tests__に単体テスト（10件・8件）
#      追加：appStore.ts に taskDependencies state・addTaskDependency/removeTaskDependency・
#             selectScopedTaskDependencies。task_dependencies はOKR系(Phase2)ではなくPhase1
#             （fetchCriticalData）で取得し、初回描画時点からゲート判定できるようにした
#      変更：saveTask（唯一のchoke point）に依存ゲートを統合。status="done"への遷移時、
#             未完了(done以外・非削除)の先行タスクが1件でもあればハードブロック（トースト＋例外・
#             楽観更新やDB書き込みは一切行わない）。todo→in_progressへの遷移時は非ブロッキングの
#             ソフト警告トーストのみ（着手は止めない）。カンバンD&D・ステータスDD・インライン編集・
#             ListViewの一括ステータス変更は全てsaveTask経由のためこの1箇所で全経路をカバーする
#             （AI相談のapplyProposalは現状status変更経路を持たないため対象外・将来追加時は要確認）
#      追加：TaskEditModal・TaskSidePanelに「⏱ 先行タスク」ブロックを新設。親子関係（階層セグメント/
#             親タスクセレクタ）とは枠線で囲んだ別ブロックとして視覚的に分離。チップ+CustomSelectで
#             複数設定可（既存の追加プロジェクト/タスクフォースと同型のUI）。候補は自分自身・循環を
#             作る組み合わせ・選択済みを除外。後続タスク（このタスクを待っているタスク）も読み取り専用で表示
#      DBマイグレ要：supabase/migrations/20260717_add_task_dependencies.sql をSupabase SQL Editorで
#             手動適用（山本さん）。schema.sqlにも同一定義を反映済み（drift防止）
# v2.30 feat: ワークロードビューにメンバー行のドリルダウン（状況詳細パネル）を追加（2026-07-17）
#      背景：v2.28で追加したワークロードビューは負荷の一覧表示のみで、「誰が何を抱えているか」
#             の中身を見るには結局リストビュー等を開き直す必要があった。山本さんの実需
#             「ワークロード画面の中で人をクリックすると、その人の状況詳細が確認できるようにしたい」
#      追加：src/lib/workload/computeWorkload.ts に getMemberActiveTasks（メンバーの現在アクティブ
#             タスク一覧を返す）を追加。computeMemberWorkloadRows 内の集計もこの関数経由に統一
#             （件数集計と詳細パネルの中身が乖離しない単一の真実源）。既存6テスト・回帰なし
#      追加：src/components/workload/MemberDetailPanel.tsx（新規）。TaskSidePanel（List/Gantt/Kanban
#             共通の右サイドパネル）と同じ視覚言語（animate-side-panel-in）をデスクトップで採用し、
#             モバイルはMainLayoutのラボボトムシートと同型（animate-overlay背景＋panel-slide-up本体）
#             に切り替える完全レスポンシブ設計。ヘッダー（アバター・氏名・管理者/全社スーパー管理者
#             バッジ）・サマリー（未着手/進行中内訳・期限超過件数・工数合計）・タスク一覧（PJ別
#             グルーピング、期限超過のPJ/タスクを上に並べ替え＋赤強調）で構成
#      追加（任意仕様・B1連携）：各タスク行に、B1（task_dependencies）で先行未完了のタスクがある
#             場合「⏳先行未完了」バッジを表示（getIncompletePredecessors流用。ホバーで先行タスク名）。
#             判定は必ずPJ絞り込み前の全スコープタスク（allTasks）で行う（PJ絞り込みで先行タスクが
#             除外されるとブロック判定を誤るため、詳細パネル表示用のtasksとは別に受け取る）
#      変更：WorkloadView の各メンバー行をクリック可能に（role="button"・tabIndex・onKeyDown で
#             Enter/Space対応）。クリックでMemberDetailPanelを開き、行のPJ絞り込み（pjFilter）は
#             パネルの中身にもそのまま適用される（同じfilteredTasksを渡すため一覧の件数と一致する）。
#             各タスク行のクリックは MainLayout の aiEditTaskId（onOpenTask props経由）に委譲し、
#             既存の TaskEditModal をそのまま開く（DashboardViewと同じ配線パターン）
#      DBマイグレ不要（既存フィールド・既存テーブルのみ使用）
#
# v2.31 feat: タスク依存関係 フェーズB2（ガント上に依存の矢印を可視化）を追加（2026-07-17）
#      背景：B1（依存モデル・完了ゲート）は「守らせる」機能だったが、「見える化」がまだなかった。
#             ガント上で先行→後続の矢印が見えないと、依存の全体像を俯瞰できない。
#             段階リリースの2段目（B2）。B3＝自動リスケ連鎖／B4＝ベースライン差分は次フェーズ
#      設計方針：行のY座標を数式で再計算せず、描画済みバー（TaskBarRow の実バー要素に
#             data-task-id 属性を付与）の getBoundingClientRect() をボディコンテナ基準で実測する。
#             PJ別/ToDo別/人別の3グルーピング×折りたたみ×フィルタ（自分のみ/完了を隠す）の
#             全組合せをレイアウトロジックの二重化なしで堅牢に扱うための判断（数式再計算は壊れやすい）
#      追加：src/components/gantt/ganttDependencyArrows.ts（純粋関数のみ）。
#             buildDependencyElbowPoints＝先行バー右端→後続バー左端を結ぶ直角エルボーの頂点列
#             （後続が先行より前から始まる逆方向ケースは右→縦→左→後続のS字迂回に切替、最終区間が
#             必ず右向き＝矢印が正しい向きで後続に入るようにする）。pointsToPathD＝SVG path文字列化。
#             computeDependencyRenders＝依存リストとタスク矩形Mapから「両端が実測できたペア＝矢印」
#             「片端だけ実測できたペア＝見えている側にバッジ」「両端とも実測できない＝何も出さない」
#             を判定。__tests__/ganttDependencyArrows.test.ts に9テスト
#      追加：GanttView.tsx に依存矢印レイヤー。ボディdiv（position:relative）内にSVGオーバーレイを
#             配置（バーと同じスクロール文脈に載るためスクロールリスナー不要）。zIndexはバー(2)より
#             下(1)・矢印はpointerEvents:noneでバーのクリックを一切邪魔しない。ホバー中の
#             hoveredTaskId（既存state）に接続する矢印だけ太く・濃く強調。先行タスクが未完了の
#             依存線はごく僅かに点線化（任意仕様）
#      追加：画面外バッジ（⏱・TaskBarRow内、native title属性でツールチップ）。依存の相手タスクが
#             フィルタ除外・別グループ・折りたたみで非表示のとき、見えている側のバー端に表示。
#             「存在するが今は見えていない（フィルタ除外）」と「削除済みで存在しない」は区別し、
#             後者は矢印もバッジも出さない（scopedTaskDependencies を mineOnly/krTaskIds 等の表示
#             フィルタより広いスコープ＝activeTaskById で判定するのがポイント）
#      追加：ガントツールバーに「🔗依存」トグル（既定ON・localStorageで状態保持＝
#             KEYS.GANTT_SHOW_DEPS）。矢印が煩雑なときのエスケープハッチ
#      再計算タイミング：useLayoutEffect（ズーム・折りたたみ・並び順・ビュー切替・データ変更・
#             ドラッグリサイズ中のプレビュー）＋ ResizeObserver（ウィンドウ／コンテナのリサイズ）
#      スコープ：デスクトップ GanttView のみ。GanttMobileView は対象外（B1の依存バッジのみで
#             情報は伝わる。データ属性・SVGとも追加していないため既存モバイル表示への影響ゼロ）。
#             isPreview（AI提案プレビュー）時は矢印レイヤーごと非表示（プレビュー用の仮タスク集合と
#             依存の整合性を保証できないため。GanttPreviewPanel は isPreview=true で呼ぶ既存挙動のまま）
#      DBマイグレ不要（B1のtask_dependenciesテーブルをそのまま使用）
#
# v2.32 feat: タスク依存関係 フェーズB4（ベースライン差分＝当初計画 vs 実際）を追加（2026-07-17）
#      背景：B1（依存ゲート）・B2（ガント矢印）に続く段階リリースの3段目。B3（自動リスケ連鎖）は
#             今回もスコープ外のまま。「当初いつ終わる予定だったか」と「実際どうなっているか」を
#             両方見えるようにし、遅延の蓄積に気づけるようにする
#      捕捉タイミング（確定設計）：タスクの start_date と due_date の**両方が初めて揃った時点**で
#             baseline_start_date/baseline_due_date にその時の値を凍結する。以後は自動更新しない
#             （一度setされたら二度と上書きしない。set後に日付をクリアしても凍結値は残る）。暦日計算
#             （土日祝を飛ばさない）。手動での再ベースライン用UIは今回入れない（自動捕捉のみ）
#      追加：tasks.baseline_start_date / baseline_due_date（nullable date列。
#             migrations/20260717b_add_task_baseline.sql）。既存タスクで両日付が既に揃っている行は
#             マイグレ適用時点の現在値をbaselineとしてバックフィル（＝以後の変更だけが遅延として計測される）
#      追加：src/lib/baseline/baselineCapture.ts（resolveBaselineFields。既存のbaseline値と
#             保存しようとしている候補の日付から「凍結すべきか／既存の凍結値を維持すべきか」を
#             1箇所で判定する純粋関数）。__tests__に8テスト
#      変更：appStore.saveTask（B1のゲートと同じ choke point）で保存直前に resolveBaselineFields を
#             通す。全経路（インライン編集・モーダル・カンバン・AI提案の反映）でこの1箇所がカバーする
#      追加：src/components/gantt/ganttUtils.ts に calcGhostBar（baseline日付を差し込んでcalcTaskBarを
#             呼ぶだけ＝座標計算ロジックの二重化を避ける）・computeDelayDays（現在due−baseline due の
#             暦日差。正=遅延・負=前倒し・null=ベースライン未凍結）・formatDelayLabel（「遅延◯日」/
#             「◯日前倒し」/差分ゼロはnullで非表示）。__tests__に12テスト
#      追加：GanttParts.tsx TaskBarRow に ghostBar/delayLabel/isDelayedの3プロップ。ゴーストバーは
#             実バーより下の層（zIndex 1・破線アウトライン・opacity 0.55）に描き、実バーと座標が
#             完全一致するときは呼び出し側が渡さない（重複要素を増やさない）。遅延ラベルはバー／
#             ゴーストバーいずれか右端の外側に小さく表示（B2の⏱バッジと衝突しないようオフセット調整）
#      追加：GanttView.tsx にツールバー「▤ベースライン」トグル（既定ON・localStorage
#             KEYS.GANTT_SHOW_BASELINE・B2の「🔗依存」と同じ流儀）。PJ別/ToDo別/人別の3ビュー全てで
#             baseline計算はタスク自身のbaseline_start_date/due_dateを使う（PJ別の親タスク行は子の
#             最早〜最遅で実バーを合成するeffectiveTaskを使うが、baselineは親タスク自身の凍結値を使う
#             ＝集計値と混同しない）
#      追加（任意仕様）：MemberDetailPanel（ワークロードのメンバー詳細）の各タスク行に
#             「遅延◯日（当初比）」バッジ。formatDelayLabel/computeDelayDaysをgantt/ganttUtilsから
#             共有（新規の集計ロジックを増やさない）
#      スコープ外（今回やらない）：自動リスケジュール（B3）・手動での再ベースラインUI・
#             GanttMobileViewへのゴーストバー描画（対象外のまま。遅延テキストも今回は追加していない）
#      DBマイグレ要：supabase/migrations/20260717b_add_task_baseline.sql をSupabase SQL Editorで
#             手動適用（山本さん・prod/dev両方）。schema.sqlにも同一定義を反映済み（drift防止）
#
# v2.33 fix: エラー履歴パネルがマウス操作を一切受け付けない不具合を修正（2026-07-17）
#      原因：globals.css で body { pointer-events: none }・#root { pointer-events: auto }
#             というグローバル設定（アプリ外周の余白帯のクリック透過対策）があるところ、
#             ErrorBar.tsx の HistoryPanel（履歴パネル）が createPortal(..., document.body) で
#             #root の外・body直下に描画されており、オーバーレイdiv・パネル本体divの両方に
#             pointerEvents:"auto" が設定されていなかったため、body の none を打ち消せず
#             パネル全体（背景クリック閉じ・全コピー/クリア/×/各行コピー）が操作不能だった
#      修正：HistoryPanel のオーバーレイdivとパネル本体divに pointerEvents: "auto" を追加
#      横展開調査：createPortal(..., document.body) を使う他の箇所（CustomSelect・
#             MentionTextarea・ConsultationPanel経由のGanttPreviewPanel）を全数確認。
#             CustomSelect・MentionTextaraは既に pointerEvents:"auto" を持っていたが、
#             GanttPreviewPanel（AI提案のガントプレビュー。ConsultationPanelがbody直下に
#             portalする）に同じ漏れを発見・同様に修正（ルートdivに pointerEvents: "auto" 追加）
#      DBマイグレ不要（CSSプロパティの修正のみ）
#
# v2.34 fix: TaskEditModal で「保存中…」の間に✕を押すと直前の編集が失われる不具合を修正（2026-07-17）
#      原因：フォーム編集は useEffect([form]) が600msデバウンス後に handleAutoSaveRef.current()
#             （saveTask 発火）を呼ぶ設計。✕押下→onClose()でモーダルがアンマウントされると、
#             その useEffect のクリーンアップ（clearTimeout(timer)）が「まだ発火していないデバウンス
#             保存」を握り潰していた。saveTask 自体は store層で直列化された非同期処理のため、
#             既に発火済みの保存はモーダルを閉じても背景で完走する＝問題はデバウンス待ち600msの
#             窓の間に✕を押した場合のみ
#      修正：src/lib/taskEditPayload.ts（NEW）に buildTaskUpdatePayload（フォーム→Task変換の
#             純粋関数）を抽出し、autosave と close時フラッシュの両方から呼ぶ単一の真実源にした。
#             TaskEditModal に formDirtyRef（最後の成功保存以降にformが変更されているか）・
#             saveInFlightRef（デバウンス発火済みでsaveTaskのPromiseが未解決か）の2つのrefを追加。
#             handleClose で「dirty かつ in-flight でない」場合のみ、閉じる直前にフォーム全項目＋
#             finalized_mentions（メンション確定通知。既存仕様＝閉じた時のみ確定）を1回の saveTask
#             にまとめて fire-and-forget 発火（await せず即 onClose）。既に発火済み（in-flight）の
#             場合は二重発火せず、finalized_mentionsの変化があればそれだけ1回送る。close時の
#             saveTask呼び出しはどの分岐でも最大1回（二重保存を作らない設計）
#      追加：src/lib/__tests__/taskEditPayload.test.ts（buildTaskUpdatePayloadの単体テスト7件。
#             trim・親PJ追従・estimated_hours/priority空値処理・担当者0人時の単数フィールド等）
#      スコープ外：自動保存のデバウンス方式自体（600ms）は変更しない。閉じる時のフラッシュのみ追加
#      DBマイグレ不要（フロントのみの変更）
#
# v2.35 fix: 画面下部の一時エラー帯（ErrorBar）の「コピー」ボタンが無反応に見える不具合を修正（2026-07-17）
#      原因：ヒットテスト構造自体は正常（コンテナ pointerEvents:none・各行 pointerEvents:auto で
#             子が正しくクリック可能）。真因は copyError() がコピー成功後に一切状態更新しない
#             ＝押しても見た目が変わらないため「反応しない」ように見えていた（実際はコピー自体は
#             成功していた可能性が高い）。HistoryPanel の copyOne/copyAll は setCopied で
#             「済」表示を出しており対照的だった
#      修正：src/components/common/ErrorBar.tsx に共通ヘルパー copyText()（clipboard API →
#             execCommand フォールバック、成功/失敗を boolean で返す）を追加し、一時バーの
#             copyError・HistoryPanel の copyOne/copyAll の3箇所を同じヘルパーに統一（二重実装解消）。
#             各ボタンは CopyStatus（{id, ok}）で押下後1.5秒「コピーしました」（一時バー）/
#             「済」「コピー済」（履歴パネル）を表示し、フォールバックも失敗した場合は
#             「コピー失敗」を表示する
#      DBマイグレ不要（フロントのみの変更）
#
# v2.36 feat: タスク依存関係 フェーズB3（自動リスケジュール連鎖）を追加（2026-07-17）
#      背景：B1（依存ゲート）・B2（ガント矢印）・B4（ベースライン差分）に続く段階リリースの
#             最終段。先行タスクの期日が後ろ倒しになった時、後続タスクの日付を自動で
#             追随させる。依存機能の中で最も重量・最もデリケート（既存の日付を自動で
#             書き換えるため）。統括Claudeとの壁打ちで確定した設計に厳密に従って実装
#      モデル＝制約充足プッシュ（constraint-only push）：後続を動かすのは「先行の
#             （更新後の）期日が、後続の開始日を追い越した時だけ」。余裕があるなら
#             動かさない（同日開始は可＝ギャップ強制なし）。動かす量は「ぶつからない
#             位置まで」だけ：delta = 先行.due − 後続.start、新start = 先行.due、
#             新due = 後続.due + delta（作業期間を保持）。押す方向のみ（先行の前倒しで
#             後続を自動で引き寄せない・delta<=0なら無変更）。複数先行は全先行の期日の
#             最大値で判定。後続に開始日・期日のどちらか無いタスクはスキップ（FS計算・
#             作業期間保持ができないため）。先行に期日が無ければその先行からの制約は
#             無視。暦日計算（土日祝を飛ばさない）。FS依存1種のみ
#      追加：src/lib/dependencies/reschedule.ts（computeCascadeShifts。純粋関数）。
#             origin（編集されたタスク）から辿れる後続タスク群をBFSで収集し、
#             Kahnのアルゴリズムでトポロジカル順に並べてから1回のパスで全シフトを
#             一括計算する（保存が保存を呼ぶ無限ループを避けるため。各タスクの新startは
#             「max(自身の元start, 全先行の確定due)」で1回だけ確定）。B1の
#             canAddDependencyでは通常発生しないが、循環データが紛れ込んでも
#             トポロジカル順が全ノードを網羅できなければ安全側に倒して空配列を返す防御あり
#      変更：appStore.saveTask（B1ゲート・B4ベースライン捕捉と同じ choke point）。
#             ローカル編集の永続化後、due_date が実際に変化した場合のみ
#             computeCascadeShifts を呼ぶ（renameなど無関係な編集でのサプライズ発火を
#             防ぐ）。シフトが1件以上あれば各タスクを { skipCascade: true } 付きで
#             saveTask 経由で保存（Promise.allSettled・多人数の割り切りとして
#             楽観ロック競合はskip+reloadで整合回復・トランザクションにはしない）。
#             成功件数をまとめて1つのトースト「N件のタスクの日付を自動調整しました」＋
#             「元に戻す」アクションで通知。Undoは動いた全タスクを { skipCascade: true }
#             で旧start/dueに復元する（Undo自体は再cascadeを起こさない）
#      追加：saveTask の第2引数に options?: { skipCascade?: boolean }（省略時=false）。
#             既存の呼び出し箇所は全て省略のままで後方互換
#      トリガの限定：cascadeはローカルユーザーの編集（saveTask起点）でのみ発火する。
#             realtimeで他クライアントの変更を受信したとき（applyRemoteChange）は
#             state を直接更新する別経路のため、cascadeは一切発火しない（各クライアントが
#             多重にcascadeすると混乱するため）
#      永続化・可視化：DBマイグレ不要・新規列も作らない。「自動調整された」ことは
#             既存のB4（ゴーストバー＋「遅延◯日」表示）で十分可視化されるため、
#             B3専用の永続フラグは作らない
#      テスト：src/lib/dependencies/__tests__/reschedule.test.ts（純粋関数の網羅テスト
#             13件：単一リンクで押す／余裕があれば押さない／複数先行は最大値判定／
#             A→B→C連鎖伝播／前倒しでは動かさない／開始日・期日の無い後続はスキップ／
#             作業期間保持／循環の防御／delta<=0で無変更 等）＋
#             src/stores/__tests__/cascadeReschedule.test.ts（appStore配線の統合テスト
#             6件：saveTask経由でDBまで反映／余裕があればDBも動かない／トーストUndoで
#             元に戻り再cascadeしない／realtime受信では発火しない／due_date不変では
#             計算自体が起きない／A→B→C連鎖がDBまで一括反映）。既存テスト237件も
#             全通過（合計 243 テスト）
#      DBマイグレ不要（フロントのみの変更）
#
# v2.37 feat: タスク依存関係 フェーズB5（ガント上でドラッグして依存を直接結線）を追加（2026-07-17）
#      背景：B1〜B4（依存ゲート・矢印可視化・自動リスケ連鎖・ベースライン差分）は依存を
#             「守る／見る／活かす」機能だったが、依存自体を作るにはTaskEditModal/
#             TaskSidePanelの「⏱先行タスク」ピッカーを開く必要があった。山本さんの要望
#             「タスクにカーソルを当てるとバーの両端に点が出て、点を他のバーの点に
#             ドラッグ＆ドロップすると依存が成立する」を実装。段階リリースの最終段
#      向きの規約（FS依存固定）：期日(due)側の端点＝先行（predecessor）、開始(start)側の
#             端点＝後続（successor）。どちらのハンドルから引き始めても、ドロップ先が
#             具体的なハンドルでなくバー本体（側未確定）のときはドラッグ元の側から
#             自動的に逆側を補って解決する。start同士・due同士など側が一致する組み合わせは
#             FS依存として表現できないためNG
#      追加：src/lib/dependencies/linkDirection.ts（resolveLinkDirection。純粋関数のみ。
#             DOM・store非依存でテストしやすくするための分離）。__tests__に8テスト
#             （明示ハンドル同士・バー本体への漠然としたドロップ・自己参照・両側未確定等）
#      追加：src/components/gantt/GanttParts.tsx TaskBarRow に linkUi プロップ（ghostBarと
#             同じ「1つの任意オブジェクトにまとめてmemoの比較は各フィールド直接比較」の
#             流儀）。バー端の外側9px（右端リサイズのヒット領域＝barX+barWidth-4〜+4とは
#             重ならない位置）に開始/期日の2つの結線ハンドル（円）を描画。表示条件は
#             🔗依存トグルON＋非プレビュー＋（ホバー中 or 自分がドラッグ元 or 自分が
#             現在のドロップ候補）。ドロップ候補になっているときはバー全体にリング
#             （具体的なハンドルが対象なら該当ハンドルの縁）を緑/赤で強調表示
#      追加：GanttView.tsx にドラッグ結線の状態管理（B4リサイズドラッグと同じ
#             window mousemove/mouseup 流儀）。ハンドルmousedown位置をganttBodyRef基準に
#             変換して始点とし、以後は document.elementFromPoint で
#             data-link-handle-task-id（具体的ハンドル）→data-task-id（バー本体）の
#             優先順でドロップ候補を判定。頻繁に変わる現在位置・候補は ref に逐次書き込みつつ
#             state にも反映し、mouseup では ref を正として読む（useEffectの古い
#             クロージャに惑わされないため）。drag開始・終了のみをeffectの依存にして
#             mousemoveのたびにlistenerを貼り直さない設計。Escでキャンセル
#      追加：SVGオーバーレイにドラッグ中のカーソル追従プレビュー線（B2矢印より上のzIndex）。
#             ドロップ候補が無効な組み合わせのときは赤色に変化しリアルタイムでフィードバック
#             （canAddDependencyをstoreの実チェックと同じtaskDependenciesで先読み判定）
#      抑制：ドラッグ結線中は他のバー操作（編集モーダルを開く・右端リサイズ開始）を
#             guardedHandleRowEdit/guardedHandleResizeDragStartで無効化。ハンドルの
#             mousedownはstopPropagation/preventDefaultで既存操作への伝播を止める
#      検証・作成：ドロップが自己参照・start同士/due同士・重複・循環のいずれかで弾かれた
#             場合は addTaskDependency 内の既存トースト表示（B1実装済み）がそのまま効く。
#             OKなら作成→B2の矢印が自動描画される（新規テーブル・新規state不要）
#      スコープ：デスクトップ GanttView のみ。GanttMobileView は対象外（未変更・影響なし）。
#             キーボード代替は入れない（B1の先行ピッカーがキーボード操作の担い手のまま）
#      テスト：src/lib/dependencies/__tests__/linkDirection.test.ts（8件）追加。
#             既存243テストも全通過（新規8件込み・合計251テスト）
#      DBマイグレ不要（既存task_dependencies・addTaskDependencyをそのまま使用）
#
# v2.38 feat: ガントビュー ヘッダーを週ラベル（8月W1形式）に変更＋バー左端ドラッグで開始日を変更（2026-07-17）
#      背景：①ガント上部の日付数字行は小ズームでほぼ読めず、大局（今どの週か）が掴みにくかった。
#             ②既存の右端ドラッグ（期日変更）に対し、開始日を変えるには編集モーダルを開く必要があった
#      週の数え方＝月内日数ブロック（山本さん確定）：W1=1〜7日／W2=8〜14日／W3=15〜21日／
#             W4=22〜28日／W5=29日〜月末。各週は必ずその月に属し、月をまたいだ瞬間に翌月のW1から
#             数え直す（暦週・ISO週とは異なる独自定義）。ラベルは「8月W1」形式（月プレフィックス付き）
#      追加：src/components/gantt/ganttUtils.ts に computeWeekBlocks（days配列を年+月+週番号が
#             変わる境界で区切る純粋関数。days は getDaysInRange の連続日付前提のため、この境界検出
#             だけで月内日数ブロックの定義が自然に成立する）。__tests__に4テスト（通常月5ブロック・
#             月またぎで区切られる・範囲先頭が週の途中でも部分ブロックとして扱う・dayWidth比例）
#      変更：GanttView.tsx のヘッダー第2行（旧：日付数字を1日1マスで描画・小ズームでは月初/月曜/
#             今日のみに間引き）を、weekBlocks を1週間隔（4〜5個/月・ズーム非依存でDOM量一定）で
#             描画する行に置き換え。第1行（月ラベル）・ボディの月初/月曜境界線・今日線・土日シェーディング
#             は無変更。月の最初の週（W1＝月境界）は区切り線をやや強めて月の大局を掴めるようにした
#      追加：バー左端ドラッグによる開始日変更（右端＝期日変更と対称）。src/components/gantt/
#             GanttParts.tsx TaskBarRow に onResizeStart プロップを追加、左端（barX-4〜+4）に
#             右端と同型のハンドルを新設（カーソルは両ハンドルとも ew-resize に統一。B5結線ハンドル
#             は端の外側±9pxのため位置的に重ならない＝バー端そのもの=リサイズ／端の外側の浮いた点=
#             結線、の区別を維持）。開始日が未設定のタスクは期日を起点にドラッグでき、そこから
#             新規に開始日を作れる
#      追加：ganttUtils.ts に clampStartDate（開始日が期日を超えたら期日にクランプ。同日は許可）・
#             applyResizePreview（ドラッグ中のプレビュー日付をタスクにマージする純粋関数。start/due
#             どちらか片方だけの上書きにも対応）。resizePreviewDates の型を Record<string,string>
#             （期日のみ）から Record<string, {start?, due?}> に拡張し、PJ別/ToDo別/人別の3ビュー
#             全てで同じマージ関数を使う（ロジックの二重化を避ける）。__tests__に7テスト
#             （プレビュー無し/start上書き/due上書き・クランプ3ケース）
#      変更：draggingResizeTask state に edge:"start"|"due" を追加した1つの状態に統合（右端用に
#             新しい状態を増やさず、mousemove/mouseup の1つのuseEffectで両エッジを扱う）。確定は
#             どちらのエッジも既存のsaveTask経由（期日変更時のB3自動リスケ連鎖・両日付が初めて揃った
#             時のB4ベースライン凍結は、この1箇所を通ることでこれまで通り自動的に発動する。左端＝
#             開始日のみの変更はB3のトリガー条件（due_dateの変化）に該当しないため連鎖は発生しない、
#             という既存ロジックの挙動をそのまま踏襲）
#      スコープ：デスクトップ GanttView のみ。GanttMobileView は元々日単位グリッドを持たず対象外
#             （未変更・影響なし）
#      テスト：新規10テスト（computeWeekBlocks 4件・applyResizePreview 3件・clampStartDate 3件）
#             追加。既存251テストも全通過（合計261テスト）。
#             eslint新規0（baseline比較=36問題で完全一致）・tsc/build一発グリーン
#      DBマイグレ不要（フロントのみの変更）
#
# v2.39 feat: 依存関係を作成したタスクを、同じ親タスク内で依存関係順（先行→後続）に上下並べる（2026-07-17）
#      背景：B1（依存モデル・完了ゲート）は先行未完了での完了をブロックするが、画面上の並び順は
#             従来どおり display_order／日付順のままだった。「先行タスクが画面でも上に来る」という
#             見た目の直感と実際の制約を一致させたいという要望
#      並び順ルール（確定設計）：同じ親タスクの子同士に限り、依存関係（先行→後続）を最優先の順序とし、
#             依存で縛られていない兄弟同士は既存の並び（display_order・日付順等）をそのまま保つ
#             「安定トポロジカルソート」。チェーン（A→B→C）・複数先行（全先行より後続が下）にも対応。
#             親をまたぐ依存エッジ・トップレベルタスクの並びは対象外（今回変えない）。表示のみの
#             非破壊処理（display_order 自体は書き換えない・都度描画時に計算）。循環（B1で防止済みだが
#             念のための防御）が残っている場合は例外を投げず display_order（渡された元の並び）へ
#             フォールバックする
#      追加：src/lib/taskHierarchy.ts に orderSiblingsWithDependencies（同じ親の兄弟配列＋依存配列→
#             安定トポロジカルソート済み配列を返す純粋関数。Kahn法を「入次数0のノードのうち元の並びで
#             最も手前のものを毎回選ぶ」方式にすることで安定性を実現）・
#             applyDependencyOrderWithinSiblings（親子混在のフラット配列で、同じparent_task_idを
#             共有する要素同士の相対順序だけを並べ替え、他要素の位置・トップレベルの位置は変えない。
#             GanttView人別ビュー・ToDo別ビュー・GanttMobileViewの「親子混在の1本のリスト」向け）
#      変更：childrenOf(tasks, parentId, dependencies?) に第3引数を追加（省略時は従来どおり
#             display_order順のみ＝既存呼び出し全箇所は無変更で後方互換）。ListView（PJ別ツリー表示の
#             子差し込み箇所）はこの第3引数にスコープ済みtask_dependenciesを渡す形に変更
#      変更：GanttView.tsx の orderTasksHierarchically（PJ別ビューの親子並び。ラベル列・バー列で
#             共有する唯一の並び順計算）で、子（kids）をsortTasksした後にorderSiblingsWithDependencies
#             を通す。人別ビュー（personGroups）・ToDo別ビュー（新設のtodoGroupSortedMapで
#             ラベル列・バー列を統一・二重計算を解消）にもapplyDependencyOrderWithinSiblingsを適用。
#             GanttMobileViewにも新規propとしてtaskDependenciesを渡し、PJ別・ToDo別の各タスク一覧に
#             同じ関数を適用（人別ビューはGanttViewから並べ替え済みのpersonGroupsをそのまま受け取るため
#             追加対応不要）
#      対象外：TaskSidePanelのchildrenOf呼び出し（子の有無判定のみで表示順に影響しないため変更なし）・
#             カンバン（列＝ステータスの横並びで縦の親子並びではないため対象外）
#      仕様として明記：表示のみの安定トポロジカルソートのため、依存で縛られたペアは常に依存順が勝つ
#             （後続を先行の上へドラッグしても再描画で依存順に戻る＝意図した挙動）。依存の無いタスク
#             同士の手動ドラッグ並べ替え（ListViewのdisplay_order）は従来どおり効く
#      テスト：src/lib/__tests__/taskHierarchy.test.ts に13テスト追加（orderSiblingsWithDependencies
#             9件＝先行が上/チェーン/安定性/混在/親またぎ無視/循環フォールバック/複数先行/論理削除依存
#             無視/0-1件・childrenOfの依存引数2件・applyDependencyOrderWithinSiblings2件）。
#             既存261テストも全通過（合計274テスト）。eslint新規0（baseline比較=36問題で完全一致）・
#             tsc/build一発グリーン
#      DBマイグレ不要（表示ロジックのみ・既存task_dependenciesをそのまま使用）
#
# v2.40 feat: ガントビューに週コラムの淡いグリッド線＋PJ内マイルストーン帯を追加（2026-07-17）
#      背景：①週ラベル（8月W1〜W5）を導入した後も、本文側に週コラムの境界が無く、今どの週の
#             範囲かをバーの位置から目で辿るのが難しかった。②マイルストーン◆はPJ行にしか
#             無いため、PJの行数が多く下にスクロールすると印が画面外に出て見えなくなっていた
#      追加1（週コラムの淡いグリッド線）：src/components/gantt/ganttUtils.ts に
#             computeWeekGridLines(weekBlocks)（週ブロックのうち月初=W1を除いた開始x座標一覧を
#             返す純粋関数。月初は既存の月初境界線＝borderDaysの2px線が既にあるため対象外にして
#             二重線を避ける）。GanttView.tsx のボディに、borderDays（月初・月曜線）の直後・
#             今日線の直前として、weekGridLinesの各x座標に1px・opacity 0.35の縦線を
#             pointerEvents:none・zIndex:1で描画。全ズーム（dayWidth 14〜48）で
#             computeWeekBlocks依存のため自動的に破綻しない
#      追加2（PJ内マイルストーン帯）：ganttUtils.ts に getMilestoneBandColor(ms)（帯色を1箇所から
#             取得する関数。現状は全マイルストーン共通のMS_COLORを返すのみだが、将来マイルストーンに
#             個別色が付いたらここだけ変更すれば◆印・帯の色が揃う設計）・
#             computeMilestoneBands(pjMilestones, rangeStart, dayWidth)（PJ内マイルストーンから
#             帯を描く日付のx座標一覧を計算する純粋関数。同一日に複数マイルストーンがあっても
#             日付で重複除去し帯は1本だけ＝重ねて濃くなりすぎない）。GanttView.tsx のPJ別ビュー・
#             PJコンテナ（`<div key={pj.id}>`）にposition:relativeを付与し、その最初の子として
#             msBandsの各x座標にwidth=dayWidthの縦帯div（background=マイルストーン色・opacity
#             0.12・top:0/bottom:0でコンテナの高さいっぱい・pointerEvents:none）を描画。
#             DOM実測は不要（position:relativeのコンテナ基準の絶対配置で、コンテナの高さは
#             通常フローの子＝PJ行＋タスク行で自然に決まるため、帯が自動的にPJの行ブロック内
#             だけに収まる）。zIndexは明示的にband=1・週グリッド線=1・既存のタスクバー本体=2
#             （既存のまま）とし、「行の背景色（position:relativeだがz-index:auto）より確実に
#             前面・タスクバー本体より確実に背面」という重ね順をz-index:autoの暗黙の解決に
#             頼らず固定した。対象はPJ別ビューのみ（人別・ToDo別はPJが飛び飛びになり
#             「PJ内の帯」が成立しないため今回は対象外・従来のマイルストーン表示のまま）
#      既存のマイルストーン◆印（名前付きマーカー・ホバーツールチップ・クリック編集）は無変更で
#             そのまま残る。帯はスクロールしても埋もれない視認補助として追加するだけ
#      テスト：src/components/gantt/__tests__/ganttUtils.test.ts に20テスト追加
#             （computeWeekGridLines2件・getMilestoneBandColor1件・computeMilestoneBands4件、
#             ほか関連ケース含む）。既存281テストのうち261件は無変更で全通過（合計281テスト）。
#             eslint新規0（baseline比較=36問題で完全一致）・tsc/build一発グリーン
#      スコープ：デスクトップ GanttView のみ。GanttMobileView は元々日単位グリッドを持たず対象外
#             （未変更・影響なし）
#      DBマイグレ不要（フロントのみ・Milestoneに色フィールドは追加していない＝将来の個別色対応は
#             getMilestoneBandColorの中身を変えるだけで済む設計にとどめた）
#
# v2.41 feat: ガントビューに「完了を隠す（🙈）」フィルタトグルを追加（2026-07-17）
#      背景：山本さんの要望「ガントビューで表示するタスクを絞り込みできるようにしたい。
#             未完了のみで絞るなど」。単純に status==="done" を消すと、未完了の子を持つ
#             親タスクまで一緒に消えてしまい子だけが孤立表示される不整合が起きるため、
#             taskHierarchy.ts の buildParentDerivedMap（親子ロールアップ）を使って判定する
#      追加：src/lib/taskHierarchy.ts に filterHideCompletedTasks（純粋関数）。
#             親＝子から算出した実効ステータス（ロールアップ）・葉＝自身のstatusで判定し、
#             未完了（done以外）なら残す。完全に完了した枝（親も全子もdone）だけが消える。
#             渡された配列内で親子関係が完結する前提（呼び出し側が既に mineOnly 等の表示
#             スコープを適用した配列を渡す＝GanttViewのallTasksがそれに当たる）。
#             __tests__/taskHierarchy.test.ts に5テスト追加
#      追加：src/lib/localData/localStore.ts に KEYS.GANTT_HIDE_DONE（localStorage永続化）
#      変更：GanttView.tsx にツールバー「🙈完了を隠す」トグル（既定OFF・B2「🔗依存」・
#             B4「▤ベースライン」と同じ流儀）。allTasks の算出パイプラインの最後
#             （mineOnly適用後・並べ替え/グルーピングより前段）で filterHideCompletedTasks を
#             適用するため、PJ別・ToDo別（PJ未選択時にPJ一覧の後に並ぶToDoグループ）・人別の
#             3グルーピング全て、および mineOnly（自分のみ）との併用に自動的に対応する
#             （pjOrderedTasksMap・todoGroupSortedMap・personGroups・parentEffectiveDates・
#             日付レンジ計算が全て allTasks から派生する既存構造のため、二重実装なし）。
#             マイルストーン・マイルストーン帯・週グリッド線・依存矢印の画面外⏱バッジロジックは
#             対象外のまま無変更で機能する（依存矢印はactiveTaskById＝mineOnly/hideCompletedより
#             広いスコープで相手の存在有無を判定する既存設計のため、隠れた相手には⏱バッジが出る）
#      追加：GanttMobileView.tsx にも同じ state を props 経由で反映（hideCompletedTasks /
#             onToggleHideCompletedTasks）。allTasks/todoGroups/personGroups は既に GanttView 側で
#             フィルタ済みのものが渡るため自動反映、モバイルヘッダーにも🙈アイコンのみの
#             コンパクトなトグルボタンを追加（画面幅が狭いため文言は付けずアイコンのみ）
#      DBマイグレ不要（表示ロジックのみ・既存フィールドのみ使用）
#
# v2.42 feat: ガントビューにバー中央ドラッグでタスク全体を移動する機能を追加（2026-07-18）
#      背景：既存プロマネツール調査（PMBOK10基準）で高優先と判定された改善5件の1件目（他4件＝
#             複数選択一括シフト／クリティカルパス／進捗率バー塗り／過負荷可視化は後続で別途実装）。
#             従来はバー端±4pxのリサイズ（開始日／期日を個別に変更）しかできず、タスク全体を
#             同じ日数だけずらすには編集モーダルを開いて両方の日付を手打ちする必要があった
#      追加：src/components/gantt/ganttUtils.ts に computeMoveShift（純粋関数）。
#             origStartDate/origDueDate/deltaDays を受け取り、両方あれば両方を同じ日数シフト
#             （duration保持）、開始日が無い（期日のみ）タスクは期日だけシフトする。deltaDays===0
#             または期日が無効なら {}（no-op）。プレビュー・保存の両方で同じ関数を使う。
#             __tests__/ganttUtils.test.ts に5テスト追加（既存の resizePreviewDates/
#             applyResizePreview の型（Record<string, {start?, due?}>）をそのまま流用できる設計
#             にしたため、move専用の新しいプレビュー状態は増やしていない）
#      追加：GanttParts.tsx TaskBarRow に onMoveStart/isMoving プロップ。バー本体（data-task-id
#             を持つ要素そのもの）に onMouseDown を追加。左右端のリサイズハンドル（zIndex 3）・
#             外側±9pxの結線ハンドル（B5・zIndex 9）は元からバー本体（zIndex 2）より前面に
#             重なっているため、ブラウザの通常のヒットテストだけで「バー中央＝リサイズでも
#             結線でもない領域」が自然に定義される（新しい当たり判定用の要素は増やしていない）。
#             isDone のタスクは無効（リサイズハンドルが非表示になるのと同じ扱い）
#      追加：GanttView.tsx に draggingMoveTask state（saveTask経由の確定は右端/左端リサイズと
#             同じ choke point。B3自動リスケ連鎖・B4ベースライン凍結がここでも自動的に効く）。
#             プレビューは新しい state を増やさず既存の resizePreviewDates にそのまま
#             {start, due} を書き込む（move とリサイズは同一タスクに対して排他利用のため衝突しない）
#      クリックとドラッグ移動の区別：水平4px以下の移動はクリック（従来どおり詳細パネルを開く）、
#             4pxを超えたら移動ドラッグと判定する。判定は moveHasShiftedRef（レンダーを介さない
#             ref）で行い、mouseup 時に超えていれば suppressNextClickRef を1回だけ立てて、
#             直後に発火する React の onClick（guardedHandleRowEdit）側で消費・リセットする
#             （mousedown→mouseup→clickが同期的に発火するブラウザの標準順序に依拠した判定）
#      3操作の相互ガード：中央ドラッグ開始（guardedHandleMoveDragStart）はリサイズ中・結線中なら
#             発火せず、逆にリサイズ開始（guardedHandleResizeDragStart/guardedHandleStartResizeDragStart）
#             と結線開始（handleLinkHandleDown）は移動ドラッグ中なら発火しない。カーソルも
#             body側で明確に分離（結線=crosshair／移動中=grabbing／リサイズ中=col-resize、
#             バー内部の通常時ホバーは grab、端は ew-resize、外側の結線ハンドルは crosshair）
#      スコープ：実タスクバー（data-task-id を持つ行）のみ。PJ/担当者/ToDoのヘッダー帯バーは
#             元々 TaskBarRow を使わない別コンポーネントのため対象外のまま。PJ別/ToDo別/人別の
#             3グルーピング全てで同じ TaskBarRow 経由のため自動的に対応。デスクトップ GanttView
#             のみ（GanttMobileView は対象外・未変更）
#      DBマイグレ不要（フロントのみ。既存の saveTask 経路をそのまま使用）
#
# v2.43 feat: ガントビューに複数タスクを選択して一括で日付シフトする機能を追加（2026-07-18）
#      背景：既存プロマネツール調査（PMBOK10基準）で高優先と判定された改善5件の2件目
#             （1件目＝v2.42のバー中央ドラッグ単体移動。他3件＝クリティカルパス／進捗率
#             バー塗り／過負荷可視化は後続で別途実装）。v2.42の単体移動を選択集合に拡張する
#      複数選択：Ctrl/Cmd+クリックでタスクバーの選択をトグル（選択中は水色アウトライン表示）。
#             修飾キー無しの通常クリック（かつ移動していない）は従来どおり詳細を開く＋選択を
#             クリア。空白（バー以外）クリック・Escapeでも選択クリア。選択はタスクidベース
#             （人別ビュー等で同一タスクが複数行に出てもid単位で扱う）。ラベル列（PJ名/ToDo名/
#             人名の行クリック）は対象外（既存のguardedHandleRowEditのまま）・実タスクバー
#             （data-task-idを持つ要素）のみ新設のguardedHandleBarEditが担う
#      追加：GanttParts.tsx TaskBarRowにisSelectedプロップ（選択中は
#             outline:2px solid var(--color-text-info)。isChanged/isStagnantの outline と
#             排他で優先順位をつけて合成）。onEditの型をReact.MouseEvent|React.KeyboardEventの
#             union に拡張（Ctrl/Cmd判定のためevent自体を渡す必要があったため。ラベル行用の
#             既存onEditは型変更していない＝別ハンドラに分離）
#      追加：src/components/gantt/ganttUtils.ts に computeBulkMoveShifts（純粋関数）。
#             複数タスク＋deltaDaysから各タスクの新旧日付をまとめて計算。内部でcomputeMoveShift
#             を1件ずつ適用するだけ（ロジックの二重化なし）。done・削除済み・期日未設定タスクは
#             対象外にする判定をここ1箇所に集約（単体移動と同じ「doneはシフト対象外」ルール）。
#             __tests__/ganttUtils.test.ts に6テスト追加
#      追加：src/lib/dependencies/reschedule.ts に computeCascadeShiftsMulti（純粋関数）。
#             複数origin（一括シフトで直接動いたタスク群）から辿れる後続への自動リスケ連鎖
#             （B3）を1回のトポロジカル順パスで合成計算する。既存computeCascadeShiftsは
#             `computeCascadeShiftsMulti([originTaskId], ...)` に委譲するリファクタに変更
#             （既存の単一origin呼び出し・テスト18件は無改造で全通過＝後方互換）。
#             設計上の要注意点：BFS/トポロジカルソート自体はorigin集合を特別扱いせず素直に
#             走らせる（単一origin時の循環データ安全網＝Kahnデッドロック検出を複数origin版でも
#             完全に同じ形で保つため。最初origin自体をBFSから除外する実装を試したところ、
#             既存の「循環が無限ループにならない」防御テストを壊した＝原点への逆流エッジが
#             見えなくなり安全網が働かなくなっていた）。origin同士が直接の依存で繋がっている
#             場合（例：AとBを両方選択してドラッグ、A→Bの依存あり）だけ、ループの中で
#             origin自身へのshift適用をスキップする（bulk側で既に同じdeltaだけ直接シフト済み
#             のため、他originからの制約で二重にカスケードシフトしない）。__tests__に5テスト追加
#      追加：appStore.ts に bulkShiftTasks(taskIds, deltaDays, updatedBy) アクション＋
#             module levelのrunBulkShiftヘルパー（runCascadeと同じ流儀）。1つの論理操作として
#             扱う：①computeBulkMoveShiftsで対象全ての移動前後日付を算出 ②各対象に
#             { skipCascade: true } でsaveTaskを呼び直接シフトを永続化（per-taskのB3カスケードは
#             発火させずトースト嵐を防ぐ。Promise.allSettledで多人数の割り切り） ③直接シフトが
#             成功した全タスクidを使いcomputeCascadeShiftsMultiでB3カスケードを1回だけ計算・
#             適用（同じく{ skipCascade: true }） ④1つのトースト「N件のタスクを移動しました
#             （＋自動調整M件）」＋Undo（直接シフト分＋カスケード分の全タスクの旧日付を
#             { skipCascade: true } で復元。Undo自体は再カスケードしない＝B3の既存Undo
#             パターンを踏襲）。__tests__/bulkShiftTasks.test.ts に7テスト追加
#             （Supabaseクライアントをモックしstores/__tests__/cascadeReschedule.test.tsと
#             同じ方式でDB書き込みまで検証）
#      変更：GanttView.tsx のバー中央ドラッグ（v2.42）を選択集合に拡張。ドラッグ元のバーが
#             選択中（selectedTaskIds）かつ選択が2件以上のときだけdraggingMoveTask.bulkTargets
#             を持たせ（1件以下・非選択なら従来どおり単体移動のまま）、プレビュー
#             （resizePreviewDates）は対象全件についてcomputeMoveShiftを回して書き込む。
#             確定はbulkShiftTasks（複数）またはsaveTask（単体）に分岐。movingTaskIds
#             （useMemoのSet）でisMovingプロップを対象全件に一括反映
#      追加：ツールバーに選択件数インジケータ（「N件選択中 ✕」）。選択が空のときは非表示
#      スコープ：実タスクバー（data-task-id）のみ・デスクトップGanttViewのみ
#             （GanttMobileViewは対象外・未変更）。既存の単体移動・リサイズ・B5結線・
#             クリック詳細・B2矢印・B4ゴーストバー・列グリッド・MS帯・依存順並べ替え・
#             完了フィルタ・ズーム・折りたたみ・3グルーピングは無改造（回帰テスト309件全通過）
#      DBマイグレ不要（フロントのみ。既存の saveTask 経路をそのまま使用）
#
# v2.44 feat: ガントビューにクリティカルパス表示を追加（2026-07-18）
#      背景：既存プロマネツール調査（PMBOK10基準）で高優先と判定された改善5件の3件目
#             （1件目＝v2.42のバー中央ドラッグ単体移動／2件目＝v2.43の複数選択一括シフト。
#             他2件＝進捗率バー塗り／過負荷可視化は後続で別途実装）
#      定義（採用・厳守）：プロジェクトごとに、FS依存グラフ上でタスク期間（duration=
#             due-start、暦日、最小1日）を重みとした最長パス（longest path）を求める。
#             依存エッジは両端が同じプロジェクトのタスクであるものだけを使う（プロジェクトを
#             またぐ依存はどちらのプロジェクトのCP計算にも含めない。プロジェクト単位で完全に
#             独立して計算）。project_id が無いタスク（ToDo系タスク）はCP計算の対象外
#      追加：src/lib/gantt/criticalPath.ts（NEW）に computeCriticalTaskIds(tasks, dependencies)
#             → Set<taskId>（純粋関数）。CPM（Critical Path Method）と同じ考え方で実装：
#             forward[t]=tで終わる最長パスの長さ、backward[t]=tから始まる最長パスの長さを
#             トポロジカル順（Kahnのアルゴリズム）で計算し、forward[t]+backward[t]-weight[t]が
#             プロジェクト全体の最大値と一致するタスクを「フロート0＝クリティカル」とする。
#             同じ長さの最長パスが複数ある場合は全ての和集合を返す（山本さん確定仕様）。
#             日付欠けタスクはduration=0として安全に処理（クラッシュしない）。全タスクの
#             durationが0（日付が全て欠けている等）のプロジェクトは何も強調しない（ノイズ防止）。
#             循環データが紛れ込んだプロジェクトは判定をスキップ（空集合。例外は投げない。
#             reschedule.tsのトポロジカルソート安全網と同じ流儀）。__tests__に12テスト
#             （単一チェーン全件クリティカル／分岐で長い方が選ばれる／複数最長パスの和集合／
#             日付欠けタスクの安全処理／全欠けはノイズ防止で空／プロジェクト跨ぎ依存の除外
#             （2パターン）／循環フォールバック／project_id無しは対象外／削除済み無視／
#             空配列／単一タスクの計8観点）
#      追加：ganttUtils.ts に CRITICAL_COLOR（"#dc2626"。既存の期限超過の塗り色
#             （var(--color-border-danger)＝淡いくすみ色）やホバー強調（filter:brightness）とは
#             混同しないよう、彩度の高い単色を"太い枠線"という別の視覚要素として使う。固定hex
#             はstagnantの#f97316と同じ流儀でライト/ダーク両対応）
#      変更：GanttParts.tsx TaskBarRow に isCritical プロップ。isSelected（青）>isChanged
#             （ブランド紫）>isCritical（赤2.5px太枠）>isStagnant（オレンジ）の優先順でoutlineを
#             出しつつ、isCritical時は独立した外側ハロー（box-shadow）も常に重ねる設計にした
#             （「選択中かつクリティカル」でも両方の情報が視覚的に共存する。単一プロパティの
#             outlineの奪い合いにしない）。B5結線ドロップ候補リングとハローは別レイヤーとして
#             カンマ結合で共存可能
#      変更：GanttView.tsx にツールバー「🎯クリティカルパス」トグル（既定OFF・localStorage
#             KEYS.GANTT_SHOW_CRITICAL・既存トグルと同じ流儀）。criticalTaskIds は
#             activeTaskById（部署スコープ済み・論理削除のみ除外、mineOnly/hideCompletedTasks
#             等の表示フィルタは未適用の広いスコープ）を入力に使う（表示フィルタで隠れている
#             タスクのバー自体が描画されないため自然に何も起きず、フィルタでクリティカル判定が
#             歪まない）。トグルOFF・プレビュー中は計算自体を省略
#      追加：依存矢印（B2）に3つ目の見た目（gantt-dep-arrowhead-critical マーカー）。両端が
#             クリティカルなタスクの矢印だけ CRITICAL_COLOR・太さ2.2px（ホバー時3px）・
#             不透明度0.95で強調。通常（灰・1px）／ホバー（ブランド色・2px）と色・太さ・
#             マーカーの3点で判別可能。先行未完了の点線化（既存仕様）とは独立に併用可
#      追加：PJ別/人別/ToDo別の全3ビューのタスクツールチップに「🎯 クリティカルパス」を
#             条件付きで追記（isStagnantの⚠と同じ場所に併記）
#      スコープ：デスクトップ GanttView の3ビュー全て対応（GanttMobileView は対象外・未変更）。
#             isPreview（AI提案プレビュー）時は計算・表示ともスキップ（B2矢印レイヤーと同じ扱い）
#      DBマイグレ不要（フロントのみ。既存フィールドのみ使用）
#
# v2.45 feat: ガントビューのタスクバーに進捗率の部分塗り（進捗フィル）を追加（2026-07-18）
#      背景：既存プロマネツール調査（PMBOK10基準）で高優先と判定された改善5件の4件目
#             （1件目＝v2.42のバー中央ドラッグ単体移動／2件目＝v2.43の複数選択一括シフト／
#             3件目＝v2.44のクリティカルパス。5件目＝過負荷可視化は別途）
#      前提（マイグレ無し方針）：タスクには status(todo/in_progress/done) はあるが
#             0〜100%の進捗率フィールドは無い（今回もDB列を追加しない）。算出は：
#             ・親タスク（子を持つ）＝子からのロールアップ（完了した子の割合）
#             ・葉タスク（子なし）＝ステータス由来の慣例値（todo=0% / in_progress=50% /
#               done=100%。実測%が無いための代替表現）
#      追加：src/lib/taskHierarchy.ts に taskProgressFraction(task, tasks) → 0〜1（純粋関数。
#             既存 parentProgress の pct を再利用し正規化するだけ＝新しい集計式を作らない）と、
#             一覧描画向けの一括版 buildProgressFractionMap(tasks) → Map<taskId, 0〜1>
#             （buildParentDerivedMap と同じ「行ごとに個別関数を呼ぶとO(n²)になるためO(n)一括版を
#             分離する」既存パターンを踏襲）。__tests__に9テスト追加（taskHierarchy.test.ts：
#             44→53テスト）
#      変更：GanttParts.tsx TaskBarRow に progressFraction プロップ（0〜1、undefined/0は
#             何も描画しない＝既存のバー表現を一切変えない）。バー内側の左からその割合だけ
#             半透明の黒（rgba(0,0,0,0.24)）を重ねるオーバーレイ方式にした。barColor自体を
#             計算し直さず「地の色の上に暗いオーバーレイを重ねる」だけなので、PJ色・期限超過の
#             赤・TODO_COLOR等どのbarColorでも自動的に「地の色より少し濃いシェード」になり、
#             ダークモードでも視認できる（色を個別に暗くする計算が不要）。フィルの右端に薄い
#             縦線（rgba(255,255,255,0.4)）を添えて未着手部分との境界を明確にした。既存の
#             isCritical外側ハロー・isSelected/isChanged/isStagnantのoutline・B4ゴーストバー・
#             B2依存バッジ・doneの取り消し線/opacity0.5とは独立したレイヤー（バー本体の内側の
#             オーバーレイのみ）のため、既存表現と混同・不可視化しない。常時表示（トグルなし。
#             控えめな標準的ガント表現のため既存トグル群🔗🎯▤🙈は増やさない）
#      変更：GanttView.tsx にO(n)一括算出のprogressFractionMap（useMemo、parentEffectiveDatesと
#             同じ場所に配置）を追加し、PJ別/ToDo別/人別の全3ビューのTaskBarRow呼び出しに
#             progressFraction propを追加（3箇所とも同じMapから引くだけ）
#      追加（簡易反映）：GanttMobileView.tsx にも taskProgressFraction をそのまま使い、カードの
#             名前/期日表示の下に薄いトラック＋フィルを1本追加（専用のバー要素が無いため、
#             デスクトップと同じ関数だけ再利用する最小限の反映にとどめた）
#      スコープ外（将来課題）：葉タスクに実際の0〜100%進捗を持たせる場合はDB列＋入力UIの追加が
#             必要（今回は明示的にスコープ外。ステータス由来の慣例値で代替）
#      DBマイグレ不要（フロントのみ。既存フィールドのみ使用）
#
# v2.46 feat: ガントビューに人別ビュー限定でメンバーの過負荷（オーバーアロケーション）を
#      タイムライン上に可視化する機能を追加（2026-07-18）
#      背景：既存プロマネツール調査（PMBOK10基準）で高優先と判定された改善5件の5件目・最終
#             （1件目＝v2.42バー中央ドラッグ単体移動／2件目＝v2.43複数選択一括シフト／
#             3件目＝v2.44クリティカルパス／4件目＝v2.45進捗フィル）
#      定義：あるメンバーについて、同時に抱えるアクティブ（done以外）タスクの重なりが
#             閾値（既定=3、`OVERLOAD_THRESHOLD_DEFAULT`）を超える日を「過負荷日」とする。
#             工数（estimated_hours）は入力が疎なため、件数ベース（同時アクティブタスク数）を
#             判定の主軸にした（山本さん方針）。タスクは start_date〜due_date の期間その日を
#             占有、開始日なし（期日のみ）は due_date の1日だけ占有。
#      追加：`src/lib/gantt/overload.ts`（NEW）：`computeOverloadRanges(memberActiveTasks,
#             rangeStart, rangeEnd, threshold?)` → 過負荷日の連続区間配列（純粋関数。
#             `computeWorkload.getMemberActiveTasks` と同じ「アクティブ＝done以外」判定基準を
#             共有する前提で呼び出す）。`__tests__/overload.test.ts` 新規10テスト
#             （単純重なり検出／閾値以下は非過負荷／連続区間の結合／期日のみの1日占有／
#             done除外／担当者フィルタ（getMemberActiveTasksとの結合）／表示範囲外クランプ／
#             カスタム閾値／due_date欠落の除外／rangeStart>rangeEnd）
#      追加：`ganttUtils.ts` に `OVERLOAD_COLOR`（マイルストーンamber・クリティカルパスredとは
#             別のオレンジ固定hex）と `overloadRangesToBands(ranges, rangeStart, dayWidth)`
#             （日付区間→ピクセルx/widthへの変換。既存 `computeMilestoneBands` と同じ
#             「メンバー行ブロック内・position:relativeコンテナへの絶対配置」に使う変換）
#      表示：**対象は人別グルーピングのみ**（PJ別/ToDo別はメンバーが飛び飛びに並ぶため帯が
#             成立せず何もしない＝崩さない）。ガントツールバーに「⚠過負荷」トグル追加
#             （既定OFF・`gantt_show_overload` にlocalStorage保持、既存🔗▤🙈🎯と同じ流儀）。
#             ONのときだけ、人別ビューの各メンバー行ブロック（`position:relative`コンテナ）内に
#             過負荷日の列を`OVERLOAD_COLOR`・opacity 0.14の縦帯で高さいっぱいに塗る
#             （zIndex:1＝マイルストーン帯と同じ層。バー本体zIndex:2より背面）。連続する過負荷日は
#             1本の帯にまとめる（computeOverloadRangesが既に区間化済み）。メンバーヘッダー行に
#             「⚠過負荷N日」の小さな要約テキストも追加（トグルON・該当日ありの時のみ）
#      入力データ：`overloadRangesByMember`（useMemo）が `personGroups`（krTaskIds/mineOnly/
#             hideCompletedTasks反映後の部署スコープ済みallTasksから派生）の各メンバーに対し
#             `getMemberActiveTasks(m.id, allTasks)` → `computeOverloadRanges` を適用。
#             isPreview・showOverload=OFF・viewMode≠"person" のときは計算自体を省略する
#      DBマイグレ不要（フロントのみ）
#
# v2.47 feat: ガントビューに「ショートカット」常設ポップアップを追加（見えない操作の発見可能性）（2026-07-18）
#      背景：Ctrl+クリックでの複数選択・バー中央/端のドラッグ・端の外側の点での結線など、表示だけでは
#             分からない操作が増えたため、一覧で確認できるようにしたいという要望
#      追加：src/components/gantt/GanttShortcutsPanel.tsx（NEW）。マウス操作（Ctrl/Cmd+クリック＝複数選択・
#             選択中バー中央ドラッグ＝一括シフト・バー中央ドラッグ＝タスク全体移動・バー左端/右端ドラッグ＝
#             開始日/期日変更・端の外側の点ドラッグ＝依存結線・バークリック＝詳細を開く・空白クリック＝
#             選択解除）・キーボード（Esc＝選択解除／結線キャンセル）・ツールバートグル（🔗依存/▤ベースライン/
#             🙈完了を隠す/🎯クリティカルパス/⚠過負荷）の3セクションで構成。実装済みの実挙動
#             （guardedHandleBarEdit・guardedHandleRowEdit・handleGanttBodyClick・各ドラッグハンドラ）を
#             正として記述
#      追加：GanttView.tsx 凡例バー（右端）に薄い文字「⌨ ショートカット」リンクを追加
#             （marginLeft:"auto"で右寄せ・既存凡例ラベルと同じトーン）。クリックで
#             showShortcutsPanel（セッション内state・既定=閉じ・localStorage永続化なし）をトグル
#      **非モーダル設計（要件の核）**：GanttShortcutsPanelは全画面バックドロップを持たない
#             （背景を一切塞がない）。閉じるのは✕ボタンのみ実装し、クリックアウトサイド・Escapeでは
#             閉じない。Escapeは既存のガント側処理（選択解除／結線キャンセル）とバインドが競合するため
#             絶対に併用しない設計とした。パネルを開いたままバーのドラッグ・クリック等ガント本体の
#             操作が行える（オーバーレイが存在しないため自動的に満たされる）
#      **ポータルのpointer-events罠**：createPortal(..., document.body)で#root外（bodyの直下）に
#             描画するため、globals.cssのbody{pointer-events:none}を打ち消すべくパネルのルート要素に
#             pointerEvents:"auto"を明示（v2.33で発見・修正したErrorBar/GanttPreviewPanelと同じ罠）
#      スコープ：デスクトップ GanttView のみ（GanttMobileView は対象外・未変更）
#      DBマイグレ不要（フロントのみ）
#
# v2.48 feat: ガントビューにキーボードショートカット（安全な操作系5つ）を追加（2026-07-18）
#      背景：PMツール調査で高優先と判定したショートカット追加の1/2件目（2件目のCtrl+Zは別途実装）。
#             ガントには既に複数選択・一括シフト・ズーム・今日へスクロール等の下地機能があったが
#             マウス操作限定で、キーボードから素早く扱えなかった
#      追加：T＝今日へジャンプ（既存scrollToToday）／+ ・ =＝ズームイン／- ・ _＝ズームアウト
#             （既存zoomIn/zoomOutを流用）／Ctrl(Cmd)+A＝現在の表示順（折りたたみ・PJ別/人別・
#             ToDoグループ反映後）で見えている全タスクバーを選択（既存selectedTaskIdsに乗せる）／
#             Enter＝選択が1件のときそのタスクの詳細を開く（複数選択時は何もしない）
#      追加：Shift+クリックで範囲選択。直近クリック/選択したタスク（アンカー・selectionAnchorRef）
#             〜Shift+クリックしたタスクまでを現在の表示順で選択に追加する（既存選択はクリアしない）。
#             アンカーはCtrl/Cmd+クリック・通常クリックの単一選択でも更新し、選択が丸ごとクリアされる
#             操作（背景クリック・Escape）では clearTaskSelection に集約してリセットする
#      追加（純粋関数・ganttUtils.ts）：clampZoom（ZOOM_LEVELS配列上の1段階ズームin/out・既存の
#             zoomIn/zoomOutインラインロジックをここに集約）／computeVisibleOrderedTaskIds
#             （PJ別＝PJ→親→子→ToDoグループ／人別＝担当者→タスクの表示順にidを並べる。折りたたみ
#             （PJ・ToDoグループ・担当者・親タスク）を全て考慮しJSXレンダー順と対応させる。Ctrl+Aと
#             Shift+クリックの両方がこの1関数の出力=visibleOrderedTaskIdsを共有）／
#             computeRangeSelection（表示順配列上でアンカー〜ターゲットの間のidを両端含めて返す。
#             アンカー無し／どちらかが配列に存在しない場合はターゲット単体にフォールバック）。
#             ganttUtils.test.ts に17件テスト追加（既存40件→57件）
#      **最重要ガード**：①入力中（document.activeElementがinput/textarea/select/contenteditable）
#             は一切ハイジャックしない（タイピングを壊さないため）。②GanttView自身のモーダル相当
#             （TaskEditModal・TaskSidePanel＝editingTaskId、MilestoneEditModal＝editingMs）が
#             開いている間は発火しない。③ T・+-・Enter は ctrlKey/metaKey/altKey 押下時は反応しない
#             （ブラウザのCtrl++/Ctrl+-拡大縮小・その他ブラウザショートカットと衝突しないため）
#      追加：GanttView に `enableKeyboardShortcuts?: boolean`（既定true）prop。isPreview中は
#             常に無効化に加え、AI相談のガントプレビュー（GanttPreviewPanelが1画面に2つの
#             GanttViewを同時オーバーレイ表示する）の両方の埋め込みで明示的に false を渡し無効化
#      変更：GanttShortcutsPanel.tsx にキーボードセクション4件（T/+-/Ctrl+A/Enter）・
#             マウスセクションにShift+クリックを追記
#      スコープ：デスクトップ GanttView のみ（GanttMobileView は対象外・未変更）
#      DBマイグレ不要（フロントのみ）
#
# v2.49 feat: Ctrl/Cmd+Z で直前の操作を元に戻すショートカットを追加（2026-07-18）
#      背景：PMツール調査で高優先と判定したショートカット追加の2/2件目（1件目はv2.48の
#             ガント個別ショートカット）。既存のUndoは「削除・一括操作・タスク移動・自動リスケ
#             連鎖・複数選択一括シフト」等でトースト「元に戻す」ボタンを押す方式のみだった
#      方針：本格的な多段Undo履歴（スタック）は作らず、「直前に出たUndoトースト1件」だけを
#             Ctrl/Cmd+Zで発火する軽量版。対象はアプリ全体（トースト機構自体がアプリ全体で
#             使われているため、ガント限定にしない）
#      追加：`src/lib/lastUndoStore.ts`（NEW）：直前のUndoアクション1件を保持する最小限のモジュール
#             （setLastUndoAction/consumeLastUndoAction/clearLastUndoAction/peekLastUndoAction）。
#             consumeは取り出すと同時にクリア（二重発火防止）。より新しい登録は自動的に古い登録を
#             上書きする。テスト`lastUndoStore.test.ts`（6件・純粋ロジックを直接assert）
#      変更：`Toast.tsx`：`ToastAction`に`isUndo?: boolean`を追加。`showToast()`は
#             `action.isUndo`が真のときだけ`setLastUndoAction(action.onClick)`を呼ぶ
#             （＝一般の通知トーストは登録されない）。`dismissUndoToasts()`（NEW export）で
#             Ctrl+Z実行後に画面に残っているUndoトーストを閉じられるようにした。トースト内の
#             「元に戻す」ボタンを直接クリックした場合も`clearLastUndoAction()`を呼び、
#             後からCtrl+Zを押しても同じUndoが二重発火しないようにした
#      変更：`isUndo:true`を付与した6箇所（Undo付きトースト全て）：
#             `appStore.ts`のrunCascade（自動リスケ連鎖）・runBulkShift（ガント複数選択の
#             一括シフト）／`ListView.tsx`の一括ステータス変更・一括担当者変更・一括削除／
#             `TaskEditModal.tsx`の単体タスク削除。既存のトーストクリックUndoの挙動は無変更
#             （Ctrl+Zは同じUndoを別経路で発火するだけ）
#      追加：`MainLayout.tsx`にwindow keydownリスナー（アプリ全体・トップレベル）。
#             Ctrl/Cmd+Zで`consumeLastUndoAction()`を取り出し実行→`dismissUndoToasts()`。
#      **最重要ガード**：`document.activeElement`がinput/textarea/select/contenteditableの
#             ときは一切ハイジャックしない（`preventDefault`しない・自前Undoも発火しない）。
#             これによりテキスト入力欄では常にブラウザ標準のテキストUndoが優先される
#      未実装（将来課題）：Shift+Ctrl/Cmd+Z（Redo）。Redoスタックの追加設計が必要なため今回は
#             見送り
#      変更：`GanttShortcutsPanel.tsx`のキーボードセクションに
#             「Ctrl / Cmd + Z：直前の操作を元に戻す」を追記
#      DBマイグレ不要（フロントのみ）
#
# v2.50 feat: リストビューにキーボード/修飾キーによる選択ショートカットを追加（2026-07-18）
#      背景：全ビュー横断ショートカット統一の1/3件目。ガント（v2.48）は既にCtrl/Cmd+クリック・
#             Shift+クリック範囲選択・Ctrl+A全選択・Escapeを持っていたが、リストビューには
#             チェックボックスでの複数選択・一括操作しかなくキーボード/修飾キー操作が無かった
#      追加：Ctrl(Cmd)+A＝現在フィルタ後の全タスクを選択（既存の「全選択」ロジック
#             `setSelectedIds(new Set(filteredTasks.map(t=>t.id)))` をそのまま再利用）。
#             Esc＝選択解除（`clearSelection`）。Ctrl/Cmd+クリック（行）＝その行の選択を
#             トグル（詳細は開かない）。Shift+クリック（行）＝アンカー（直近クリック/選択した行）
#             〜クリック先までを現在の表示順で選択に追加（既存選択はクリアしない。アンカー未設定時は
#             単体選択）。修飾キー無しの通常クリックは従来どおり詳細（TaskSidePanel）を開く
#      設計判断（ガントとの差分・意図的）：通常クリックで既存のチェックボックス選択
#             （selectedIds）はクリアしない。ガントの「通常クリックで選択クリア」とは
#             あえて挙動を変えている＝一括選択を保ったまま行を順にプレビューできるようにするため
#             （リストは元々チェックボックスと行クリックが独立した操作として共存していたため、
#             その既存UXを壊さない判断）
#      共有化：`computeRangeSelection`（Shift+クリック範囲選択の純粋関数）を
#             `src/components/gantt/ganttUtils.ts` から `src/lib/selectionRange.ts`（NEW）へ
#             実体を移動し、ganttUtils.ts は re-export のみに変更（既存の呼び出し元・
#             ganttUtils.test.ts の import パスは無変更で動作）。テストも
#             `src/lib/__tests__/selectionRange.test.ts`（NEW・6件）に移動。表示順配列
#             （visibleOrderedTaskIds）は組み立て方がビューごとに異なるため共有せず、リスト側は
#             既存の `groups`→`rowsByGroup`（グルーピング・親子ネスト・折りたたみを反映した
#             描画順そのもの）をそのまま辿って組み立てる専用ロジックのまま（ガントの
#             computeVisibleOrderedTaskIds のような専用関数は不要だった）
#      ガード（最重要）：①入力中（document.activeElementがinput/textarea/select/
#             contenteditable）は一切ハイジャックしない。②タスク詳細
#             （TaskSidePanel=selectedTaskId、モバイルのTaskEditModal=editingTaskId）・
#             子タスク追加モーダル（QuickAddTaskModal=quickAddParentId）のいずれかが開いている間は
#             Ctrl+A/Escとも発火しない（ガントが自身の「詳細/モーダル開いている間は無効化」と
#             同じ設計方針を踏襲）。③モバイル（isMobile）では無効化（GanttViewのisMobile除外と
#             同じ扱い）。④リストビューがアクティブなときのみ発火する点は、MainLayoutで
#             viewMode==="list"のときだけListViewが条件レンダーされる既存構造により
#             コンポーネントのライフサイクルで自然に満たされる（ガントと同じ考え方・追加の
#             view判定コードは不要）
#      既存との非干渉：MainLayoutのCtrl+K（コマンドパレット）・Ctrl+Z（Undo）は本機能と
#             キーの重複が無くそのまま動作。既存のチェックボックス一括選択・一括操作・行クリック
#             詳細・インライン編集・ドラッグ並べ替え・フィルタ・グルーピングは無変更
#      変更：`ListTaskRow` の `<tr onClick>` を直接の `setSelectedTaskId` 呼び出しから
#             `onRowClick`（修飾キー分岐を持つ新ハンドラ）呼び出しに置き換え（プロップ名も
#             `setSelectedTaskId`→`onRowClick`に変更。行コンポーネント内での他の用途は
#             無かったため置き換えのみで完結）
#      ショートカット一覧パネルへの反映は未実施（3件目でGanttShortcutsPanel相当を
#             全ビュー共通化する際にまとめて反映する方針。今回はパネル更新スコープ外）
#      DBマイグレ不要（フロントのみ）
#
# 最終更新：2026-07-18（v2.50）

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

### 3-6. タスク依存関係（B1：依存ゲート／B2：ガント矢印可視化／B3：自動リスケ連鎖／B4：ベースライン差分・2026-07-17実装）

PMツール化の第二機能。任意の2タスク間の先行→後続関係（FS依存1種のみ）。親子関係（parent_task_id）
とは完全に独立の別概念で、UI上も別ブロックとして表示する（混同させないことが重要なUX要件）。
段階リリースの詳細・設計判断の経緯は project_task_manage.md「機能B」参照。

```typescript
interface TaskDependency {
  id: string;
  predecessor_task_id: string; // 先に完了すべきタスク
  successor_task_id: string;   // それを待つタスク
  is_deleted: boolean;
  group_id?: string | null;    // マルチテナント（新規テーブルのためDB上はNOT NULL）
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}
```

**ゲートの挙動（appStore.saveTask が唯一の choke point）：**
- **完了（status→"done"）**：未完了（done以外・非削除）の先行タスクが1件でもあればハードブロック。
  トースト表示＋例外を投げ、楽観更新・DB書き込みは一切行わない。
- **着手（todo→"in_progress"）**：未完了の先行タスクがあっても非ブロッキングのソフト警告トーストのみ。
  着手自体は止めない（Human-in-the-loop：完了は硬く、着手は柔らかく）。

**循環防止**：DB制約では「A→B→…→A」を表現できないため、追加操作は必ず
`lib/dependencies/cycleCheck.ts` の `canAddDependency`（DFS）を通す。自己依存・重複も同時に弾く。

**B2：ガント矢印可視化（デスクトップ GanttView のみ）**：先行バー右端→後続バー左端を直角エルボー
（逆方向はS字迂回）で結び、矢じり付きで描画する。行のY座標を数式で再計算せず、`data-task-id` 属性
付きのバー要素を `getBoundingClientRect()` で実測する設計（PJ別/ToDo別/人別×折りたたみ×フィルタの
全組合せに対してレイアウトロジックを二重化しないため）。純粋関数は
`src/components/gantt/ganttDependencyArrows.ts`（`buildDependencyElbowPoints`／`pointsToPathD`／
`computeDependencyRenders`）。依存の相手が画面外（フィルタ除外・折りたたみ・別グループ）のときは
矢印を描かず、見えている側のバーに⏱バッジ（ツールチップで相手タスク名）を出す。`hoveredTaskId`に
接続する矢印だけ強調。ツールバーの「🔗依存」トグル（既定ON・`KEYS.GANTT_SHOW_DEPS`）で表示/非表示
切替可。`GanttMobileView`とAI提案プレビュー（`isPreview`）は対象外。

**B4：ベースライン差分（当初計画 vs 実際）**：`tasks.baseline_start_date`/`baseline_due_date`
（nullable date列）。捕捉タイミングは「`start_date`・`due_date`が初めて両方揃った時点」の1回のみ。
`src/lib/baseline/baselineCapture.ts`の`resolveBaselineFields`（純粋関数）が「凍結すべきか／既存の
凍結値を維持すべきか」を判定し、`appStore.saveTask`（B1と同じ choke point）から呼ぶ。一度セットされ
たら二度と自動上書きしない（日付をクリアしても凍結値は残る）。暦日計算（土日祝を飛ばさない）。既存
タスクで両日付が既に揃っている行はマイグレ適用時点の値をバックフィル済み（＝以後の変更だけが遅延と
して計測される）。可視化は`src/components/gantt/ganttUtils.ts`の`calcGhostBar`（baseline日付を差し
込んで`calcTaskBar`を呼ぶだけ）・`computeDelayDays`（暦日差。正=遅延・負=前倒し）・
`formatDelayLabel`。ガントの`TaskBarRow`が薄い破線アウトラインのゴーストバー（実バーより下の層）と
「遅延◯日」/「◯日前倒し」ラベルを描画。ツールバーの「▤ベースライン」トグル（既定ON・
`KEYS.GANTT_SHOW_BASELINE`）で表示/非表示切替可。`GanttMobileView`は対象外。手動での再ベースラインUI
は無い（自動捕捉のみ）。

**B3：自動リスケジュール連鎖（constraint-only push）**：先行タスクの（更新後の）期日が後続タスクの
開始日を追い越した時だけ、後続を「ぶつからない位置まで」後ろ倒しする。余裕があるタスクは動かさない
（同日開始は可＝ギャップ強制なし）。押す方向のみ（先行が前倒しになっても後続を自動で引き寄せない）。
複数先行は全先行の期日の最大値で判定。純粋関数は`src/lib/dependencies/reschedule.ts`の
`computeCascadeShifts`（origin＝編集されたタスクから辿れる後続群をBFSで収集し、Kahnのアルゴリズムで
トポロジカル順に並べてから1パスで全シフトを一括計算。保存が保存を呼ぶ無限ループを避ける）。
後続に開始日・期日のどちらか無いタスクはスキップ（FS計算・作業期間保持ができないため）。
`appStore.saveTask`（B1・B4と同じ choke point）で、ローカル編集の永続化後・due_dateが実際に変化した
時だけ呼ぶ（renameなど無関係編集でのサプライズ発火を防ぐ）。シフトは`{ skipCascade: true }`付きで
saveTask経由で適用（再cascade抑止のガード。第2引数`options?: { skipCascade?: boolean }`は省略時
false＝通常のローカル編集）。動いた件数をまとめて1つのトースト「N件のタスクの日付を自動調整しました」
＋「元に戻す」で通知、Undoも`skipCascade: true`で全タスクを旧日付に復元する（Undo自体は再cascadeしない）。
**トリガはローカルユーザーの編集のみ**：realtimeで他クライアントの変更を受信したとき
（`applyRemoteChange`）はstateを直接更新する別経路のため、cascadeは一切発火しない（各クライアントが
多重cascadeすると混乱するため）。多人数競合は既存の直列化saveTask経由で逐次適用し、途中の楽観ロック
競合はskip+reloadで整合回復する（トランザクションにはしない＝割り切り）。DBマイグレ不要・新規列も
作らない（「自動調整された」ことは既存のB4ゴーストバー＋「遅延◯日」表示で可視化されるため、
B3専用の永続フラグは持たない）。

**B5：ドラッグ結線（ガント上でハンドルをドラッグして依存を直接結ぶ）**：タスクバーにホバーすると
バー端の外側（右端リサイズのヒット領域とは重ならない位置）に開始/期日の2つのハンドル（円）が出る
（🔗依存トグルON時のみ）。向きの規約はFS依存固定＝**期日(due)側の端点＝先行、開始(start)側の端点＝
後続**。どちらのハンドルから引き始めても、ドロップ先が具体的なハンドルでなくバー本体（側未確定）の
ときはドラッグ元の側から自動的に逆側を補って解決する（start同士・due同士はNG）。純粋関数は
`src/lib/dependencies/linkDirection.ts`の`resolveLinkDirection`。ドラッグ中はB4リサイズと同じ
window mousemove/mouseup流儀で追従し、`document.elementFromPoint`でドロップ候補を判定・SVGで
プレビュー線を描画（無効な組み合わせは赤色化・`canAddDependency`で先読み判定）。作成自体は既存の
`addTaskDependency`をそのまま呼ぶため、自己依存・重複・循環はB1のゲート＋トーストがそのまま効く。
ドラッグ中は他のバー操作（編集モーダル・リサイズ開始）を抑制。`GanttMobileView`は対象外。

**B1/B2/B3/B4/B5のスコープ外（次フェーズ以降）**：SS/FF/SF等の依存種別・ラグ・クリティカルパス自動計算・
営業日カレンダー（土日祝考慮）は未実装。

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
- 最終更新：2026-07-18（v2.48）

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
│   ├── dependencies/              # タスク依存関係（B1/B3/B5）の純粋ロジック
│   │   ├── cycleCheck.ts         # wouldCreateCycle / canAddDependency（自己依存・重複・循環のDFSチェック）
│   │   ├── gate.ts               # getIncompletePredecessors / formatBlockerNames（完了ゲート・着手警告）
│   │   ├── reschedule.ts         # B3：computeCascadeShifts（制約充足プッシュの自動リスケ連鎖・純粋関数）
│   │   └── linkDirection.ts      # B5：resolveLinkDirection（ガント上のドラッグ結線の先行/後続解決・純粋関数）
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
    │   ├── GanttView.tsx                  # ガントビュー（PJ別・人別の2モード）
    │   ├── ganttDependencyArrows.ts       # B2：依存矢印の座標計算（純粋関数のみ。DOM実測はGanttView側）
    │   └── GanttShortcutsPanel.tsx        # 凡例バー「⌨ショートカット」から開く非モーダルな操作一覧ポップアップ
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
