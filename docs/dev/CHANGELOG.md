# 変更履歴 — グループ計画管理アプリ

このファイルは CLAUDE.md の冒頭にあった変更履歴を分離したものです（2026-07-31）。
CLAUDE.md 本体を薄く保つことが目的です。記法は元のまま（# vX.Y … のコメント形式）を維持しています。

**新しいバージョンの履歴は、このファイルの末尾に追記してください**（既存が古い順＝v1.0が先頭・最新が末尾の並びのため）。

---

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
#      【2026-07-24 v3.09で更新】本節の週の数え方（月内日数ブロック：W1=1〜7日…）は
#             v3.09でカレンダー週（月曜始まり・日曜終わり）に変更された。以下の記述は
#             v3.09時点では旧仕様。現行仕様はv3.09の項を参照。
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
# v2.51 feat: カンバンビューに複数選択＋一括操作を追加（2026-07-18）
#      背景：全ビュー横断ショートカット統一の2/3件目。ガント（v2.48）・リスト（v2.50）は
#             既に複数選択＋一括操作を持っていたが、カンバン（KanbanView）には選択の仕組みが
#             無かった（カードのドラッグで単体ステータス変更のみ）
#      追加：カードのCtrl(Cmd)+クリック＝選択トグル（詳細は開かない）。Shift+クリック＝
#             アンカー（直近クリック/選択したカード・selectionAnchorRef）〜クリック先を
#             表示順（列＝todo→in_progress→doneを左→右、各列内は上→下でフラット化）で
#             範囲選択（既存選択に追加）。Ctrl(Cmd)+A＝表示中の全カードを選択。Esc＝選択解除。
#             修飾キー無しの通常クリックは従来どおり詳細（TaskSidePanel/モバイルはTaskEditModal）
#             を開く＋アンカー更新。カードのrole="button"のKeyboardEventもctrlKey/shiftKey/
#             metaKeyを持つため、Enter/Spaceでのキーボード操作もクリックと同じハンドラ
#             （handleCardClick）で分岐できる（新規イベント型の分岐は不要だった）
#      追加：選択1件以上で一括操作バーを表示（一括ステータス変更・一括担当者変更・一括削除）。
#             リストビューと同一のUI/挙動。各操作はUndoトースト（isUndo:true）を出しCtrl+Zで
#             戻せる
#      追加（カンバンらしい操作）：選択中の複数カードのうち1枚を別列へドラッグしたら、選択中の
#             全カードをまとめてその列（ステータス）へ移動。実装は「ドラッグ中のカードが
#             selectedIdsに含まれ、かつselectedIds.size>1ならbulkUpdateStatus(status)を、
#             そうでなければ従来どおり単体のhandleStatusChangeを呼ぶ」という条件分岐のみで
#             完結（bulkUpdateStatusは元々selectedIds全体を対象にしているため、1つのUndoに
#             自然にまとまる。バルクドラッグ専用の別ロジックは不要だった）
#      共有化（リストと共通化）：一括ステータス変更・一括担当者変更・一括削除のロジックを
#             `src/hooks/useBulkTaskActions.ts`（NEW）へ抽出。元はListView.tsx内にあった
#             3関数（bulkUpdateStatus/bulkUpdateAssignee/bulkDelete）をそのまま移し、
#             ListView側もこのフック呼び出しに置き換え（ListViewから`deleteTask`/`restoreTask`
#             の直接購読・`confirmDialog`の直接importを削除。`useAppStore.getState().tasks`で
#             Undo時点の最新タスクを取る方式もフック内にそのまま踏襲）。KanbanViewは
#             元々`tasks`という変数名で全アクティブタスクを持っていたためそれをそのまま渡す
#      追加：`src/lib/kanbanOrder.ts`（NEW・`computeKanbanOrderedIds`）。カンバンの表示順
#             フラット化ロジックを純粋関数として分離（Shift+クリック範囲選択の
#             `computeRangeSelection`とCtrl/Cmd+Aの選択対象算出で共有）。hideDone（完了を隠す）
#             ONの間はdone列のカードが個別にクリックできなくなるため、done列全体を選択対象
#             から除外する。`src/lib/__tests__/kanbanOrder.test.ts`（NEW・4件）
#      視覚：選択中カードは背景（--color-brand-light）＋2pxのブランド色リング
#             （boxShadow: "0 0 0 2px var(--color-brand)"）でハイライト
#      ガード：①入力中（input/textarea/select/contenteditable）は一切ハイジャックしない。
#             ②タスク詳細（editingTaskId＝PCサイドパネル/モバイルのTaskEditModal共用）・
#             子タスク追加モーダル（QuickAddTaskModal＝addingStatus!==null）のいずれかが
#             開いている間は発火しない。③モバイル（isMobile）では無効化。④カンバンビューが
#             アクティブなときのみ発火する点はMainLayoutでviewMode==="kanban"の間だけ
#             KanbanViewが条件レンダーされる既存構造で自然に満たされる（リスト/ガントと同じ
#             設計方針・追加のview判定コードは不要）
#      既存との非干渉：MainLayoutのCtrl+K（コマンドパレット）・Ctrl+Z（Undo）は本機能と
#             キーの重複が無くそのまま動作。既存のカードドラッグ（単体列移動）・インライン編集
#             （タスク名/担当者/期日）・カードクリック詳細・列の＋追加・完了を隠すトグル・
#             フィルタ・リストの一括操作は無変更
#      ショートカット一覧パネルへの反映は未実施（3件目でGanttShortcutsPanel相当を全ビュー
#             共通化する際にまとめて反映する方針。今回はパネル更新スコープ外。v2.50と同じ扱い）
#      DBマイグレ不要（フロントのみ）
#
# v2.52 feat: ショートカット一覧パネルを全ビュー共通化（2026-07-18）
#      背景：全ビュー横断ショートカット統一の3/3件目（仕上げ）。v2.50（リスト）・v2.51（カンバン）で
#             反映を先送りしていたパネル更新をここでまとめて行う。従来はガント（v2.47）にしか
#             ショートカット一覧が無く、「ガントでしか使えないショートカットは混乱を招く」ため、
#             全ビューから同じ一覧を開けるようにした
#      追加：`src/components/common/ShortcutsPanel.tsx`（NEW）。`src/components/gantt/
#             GanttShortcutsPanel.tsx`を汎用化して置き換え（旧ファイルは削除）。ショートカット定義は
#             本ファイル内の`SECTIONS`配列1箇所（key: "common"|"list"|"kanban"|"gantt"）にまとめ、
#             「全ビュー共通」（Ctrl/Cmd+K・Ctrl/Cmd+Z）→「リスト」→「カンバン」→「ガント」の
#             見出し付きセクションで表示。開いているビューに対応するセクションは「全ビュー共通」の
#             直後に並べ替えた上で（"（今のビュー）"ラベル＋brand色の左ボーダー＋background:
#             var(--color-brand-light)で）軽く強調する。非モーダル・✕のみで閉じる・Escでは閉じない・
#             createPortal(...,document.body)＋pointerEvents:"auto"（body{pointer-events:none}を
#             打ち消す。CLAUDE.md v2.33の罠）は旧GanttShortcutsPanelからそのまま踏襲
#      追加：MainLayoutに画面右下常設の「⌨ ショートカット」affordance（全ビュー共通・PC/モバイル
#             両方）。isShortcutsOpen state を1つだけ持ち、クリックでShortcutsPanelをトグル。
#             配置はfixed・bottom:100px（PC）/128px（モバイル）・right:16px（PCはAI相談パネルが
#             開いている間consultPanelWidth+16pxへ退避＝FABと同じ考え方）・zIndex:140。
#             Toast（bottom:24/right:24, z10000）・ErrorBar（bottom:0全幅, z9000）の通常時の
#             占有域より上に置くことで重ならないようにし、zIndexはモーダル類（z200以上）より低く
#             保つ（モーダル表示中はこのボタンがモーダルの上に浮いて見えないようにするため）。
#             Toast/ErrorBarは元々モーダルより上に出る設計のため、位置がまれに重なった場合はそちらが
#             上に見える＝トーストは数秒で自動消去されるため実害は小さい、という考え方を採用
#      変更：ガント凡例バーの既存「⌨ ショートカット」リンクは、同じ共通パネルを開くように繋ぎ替え
#             （パネルを2つ作らない）。GanttViewに任意prop `shortcutsOpen`/`onToggleShortcuts`を追加し、
#             渡された場合（MainLayoutからの通常利用）は開閉stateをMainLayout側に委譲しGanttView自身は
#             パネルを描画しない。渡されない場合（AI相談のガントプレビュー`GanttPreviewPanel`が2画面を
#             同時表示するケース）は従来どおり内部stateで完結し、GanttView自身がShortcutsPanelを描画する
#             （後方互換・GanttPreviewPanel側の変更は不要）
#      削除：`src/components/gantt/GanttShortcutsPanel.tsx`（ShortcutsPanel.tsxへ統合のため）
#      DBマイグレ不要（フロントのみ）
# v2.53 fix: ショートカット一覧パネルが現在のビューで使えないショートカットまで表示していた不具合を修正（2026-07-18）
#      不具合：v2.52で全ビュー共通化した際、SECTIONS配列の全セクション（common/list/kanban/gantt）を
#             常に表示し現在のビューのセクションを強調するだけの実装だったため、ダッシュボード等
#             list/kanban/gantt のどれでもないビューでもガントのツールバートグル（🔗依存・🎯クリティカル
#             パス等）まで表示され混乱を招いていた
#      修正：`src/components/common/ShortcutsPanel.tsx`。表示するセクションを「全ビュー共通」＋
#             「現在のビューに対応するセクション（あれば）」のみに限定。list/kanban/gantt以外の
#             ビュー（ダッシュボード・ワークロード・管理画面・OKR・カレンダー等）では
#             currentSectionが見つからず「全ビュー共通」だけが表示される。ガント凡例リンクから開く
#             場合はcurrentView="gantt"固定のため従来通り「共通＋ガント」の2セクション表示
#      DBマイグレ不要（フロントのみ・表示フィルタのみの変更）
#
# v2.54 refactor+feat: ダッシュボード改善第2弾（① 期限アラート最上部化＋② KPIサマリー行追加）（2026-07-18）
#      ①（既存commit 1eb3135・v2.53公開前の作業分の記録漏れを本entryでまとめて記載）：
#             `DashboardView.tsx` のグリッドで「期限アラート」カードを最優先セクションとして
#             最上部（order:1）に並び替え。以前は「今週のタスク」等より下にあり見落としやすかった
#      ②：ダッシュボード最上部（固定ヘッダー帯の直下・カード群グリッドより上）に
#             KPIサマリー行（5タイル）を追加。`KpiTile` コンポーネント新設
#             - 期限超過：`alertTasks`（due_date<=今日 && 未完了）のうち due_date<今日
#             - 今日締切：`alertTasks` のうち due_date===今日
#             - 今週締切：既存 `thisWeekTasks`（今日〜7日以内・未完了）をそのまま件数表示
#             - 進行中：`filteredTasks`（PJ選択／自分のみのスコープ適用済み）のうち status==="in_progress"
#             - 今週の完了率：`filteredTasks` から今週締切のタスク（完了済みも含む）を抽出し
#               done/total の割合（新設 `kpiWeekCompletion`。既存 `calcProgressPct` を再利用）
#             いずれも既存の `filteredTasks`/`alertTasks`/`thisWeekTasks`（PJ選択・mineOnlyスコープ適用済み）
#             を流用し、新規の重い集計は追加していない。数値は22px tabular-nums・ラベルは10px。
#             セマンティック色（危険=danger赤／警告=warning／情報=info／アクセント=brand／成功=success緑）
#             で統一、期限超過タイルのみ左4pxストライプで強調。全てdesign token（`var(--color-...)`）使用で
#             ダークモード自動対応。表示のみ（クリック不可）
#      DBマイグレ不要（フロントのみ）
#
# v2.55 refactor: ダッシュボード改善第3弾（③ KR進捗のTF内訳を折りたたみ化＋④ 色の意味の統一＋
#      ⑤ ProjectKarteの進捗バー/ステータスチップの重複整理）（2026-07-18）
#      ③：`DashboardView.tsx` の「KR 進捗サマリー」カードで、各KRの進捗バー＋%は既定表示のまま、
#             下位の「今期のTF」内訳（TFごとの進捗バー・件数）を既定で折りたたみに変更。
#             `▸ 今期のTF（n）`ボタンクリックで展開（▸→90度回転）。KrMeetingNotePanelの
#             TF折りたたみ（Set<string>で開閉管理・▶/▼トグル）と同じパターンを流用し、新規の
#             汎用Collapsibleコンポーネントは作らなかった。KRボックス自体のクリック（PJ絞り込み）と
#             競合しないようトグルボタンで`e.stopPropagation()`。新state `expandedKrTfIds`
#      ④：ダッシュボード内の色の意味をKPIサマリー行（v2.54）の配色に統一
#             - 未定義トークン `var(--color-brand-primary)`（存在しないCSS変数）を使っていた
#               メンションアイコンの既定背景色を `var(--color-brand)` に修正
#             - リマインダーカードの「今日」バッジ・期限アラートの「滞留」バッジが生の16進数
#               （`#fff4e0`/`#f59e0b`/`#b45309`/`#fff7ed`/`#c2410c`/`#fed7aa`）で警告色を
#               ハードコードしていたのを `var(--color-bg-warning)`/`var(--color-border-warning)`/
#               `var(--color-text-warning)` に統一（「明日」バッジは元々同トークン使用）
#             - `ProjectKarte.tsx` のステータスチップも同様に生の16進数（進行中=`#2563eb`・
#               滞留=`#ca8a04`・期限超過=`#dc2626`・今週期限=`#ca8a04`）を廃止し、
#               進行中=`var(--color-brand)`（accent）・滞留/今週期限=`var(--color-text-warning)`〜
#               `var(--color-text-info)`・期限超過=`var(--color-text-danger)` に統一
#               （今週期限はKPIサマリー行の「今週締切」＝infoに合わせ、以前の警告色から変更）
#      ⑤：`ProjectKarte.tsx` のステータスチップから「完了」チップを削除（進捗バー直下の
#             `{done}/{total} 完了（{pct}%）`と同じ情報の二重表現だったため）。件数自体は
#             進捗バー側の表示に一本化されており情報は減っていない
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 367件全通過／
#             `npx eslint src` 新規エラーなし（DashboardView.tsx/ProjectKarte.tsxは変更前と同じ
#             3件の既存tabIndex警告のみ・エラー0）／`npm run build` 成功
#      DBマイグレ不要（フロントのみ）
#
# v2.56 feat: ダッシュボード改善第4弾（「締切の見通し」棒グラフを追加）（2026-07-18）
#      追加：`src/lib/computeDueForecast.ts`（純粋関数）。スコープ済みタスク（filteredTasks＝
#             PJ選択/自分のみを尊重）から未完了タスクを due_date で日別集計。先頭に「超過」
#             （today より前・未完了）の合計バケット、続けて today〜13日後の14バケットを返す。
#             done除外・is_deleted除外・due_date なしタスクは除外。today は呼び出し側から渡す
#             （Date.now()に依存しない純粋関数・テスト容易性のため）
#      追加：`src/components/dashboard/DueForecastChart.tsx`（インラインSVG・外部ライブラリ
#             不使用）。マグニチュード表現のため単一色相（`var(--color-brand)`=accent）でバーを
#             描画。超過バケットのみ状態色（`var(--color-text-danger)`）で意味を分離。土日は
#             opacity 0.45で淡く、今日はハイライト帯（`var(--color-brand-light)`）＋太字ラベルで
#             強調。0基準の薄い基線（`var(--color-border-primary)`）を表示。最多の日（山場）には
#             「▲山場」ラベル。各バーに`<title>`ツールチップ（「日付：n件」）
#      変更：`DashboardView.tsx` に「締切の見通し」カードを1枚追加（今週のタスク/KR進捗の近く、
#             グリッドの直前＝配置は既存レイアウトに馴染む位置とした）。バッジは超過込みの
#             合計件数。既存セクション（並び順・KPI行・各カード）は変更なし
#      テスト：`src/lib/__tests__/computeDueForecast.test.ts`（7テスト・超過集計／当日／土日／
#             期日なし除外／完了除外／論理削除除外／既定14日範囲の検証）
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 374件全通過（新規7件）／
#             `npx eslint src` 新規エラーなし（DashboardView.tsxは変更前と同じ3件の既存
#             tabIndex警告のみ・新規ファイル2件はエラー0）／`npm run build` 成功
#      DBマイグレ不要（フロントのみ）
#
# v2.57 feat: ダッシュボード改善第5弾＝最終（「完了ペース」週次折れ線グラフを追加）（2026-07-19）
#      追加：`src/lib/computeWeeklyVelocity.ts`（純粋関数）。スコープ済みタスク（filteredTasks＝
#             PJ選択/自分のみを尊重）から完了(done)タスクを completed_at の週（月〜日）で集計し、
#             直近8週分（古い週→今週の順）を返す。completed_at の日付部分の切り出しは
#             payloadBuilder.ts 等の既存コードと同じ流儀で `slice(0, 10)` を使用（toDate()による
#             ローカルタイムゾーン変換の日付跨ぎズレを回避）。is_deleted除外・done以外除外・
#             completed_at なしの done タスクは（クラッシュせず）その週にカウントしないだけで除外。
#             today は呼び出し側から渡す（Date.now()に依存しない純粋関数・テスト容易性のため）
#      追加：`src/components/dashboard/VelocityChart.tsx`（インラインSVG・外部ライブラリ不使用）。
#             単一系列（`var(--color-text-success)`）で面フィル（`fillOpacity:0.14`）＋2px線。
#             薄い水平グリッド線3本＋Y目盛、x軸に週ラベル（各週の月曜日=M/D）。最終点（今週）は
#             大きめの丸（半径4、他は2.5）＋「今週n件」の強調ラベルで表示。各点に`<title>`
#             ツールチップ（「週：n件完了」）。viewBox＋`width:100%`でレスポンシブ
#      変更：`DashboardView.tsx` の「締切の見通し」カードの隣に2カラムグリッド（モバイルは1カラム）
#             で「完了ペース」カードを追加。バッジは今週の完了件数。既存セクション（並び順・KPI行・
#             各カード・締切グラフ）は変更なし
#      テスト：`src/lib/__tests__/computeWeeklyVelocity.test.ts`（7テスト・既定8週範囲／週内集計／
#             週の切れ目（月曜0時）での分割／completed_atなしdone除外／範囲外除外／未完了除外／
#             論理削除除外の検証）
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 381件全通過（新規7件）／
#             `npx eslint src` 新規エラーなし（DashboardView.tsxは変更前と同じ3件の既存
#             tabIndex警告のみ・新規ファイル2件はエラー0）／`npm run build` 成功
#      DBマイグレ不要（フロントのみ）
#      補足：ダッシュボード改善①〜⑤（期限アラート最上部化／KPIサマリー行／KR内訳折りたたみ・
#             色統一／締切の見通し棒グラフ／完了ペース折れ線グラフ）はこれで一区切り
# v2.58 fix: ガントを開くと過去日付が表示される不具合を修正（常に今日中心に）（2026-07-19）
#      原因：handleGanttScrollがスクロールのたびに中心日付を localStorage(GANTT_CENTER_DATE) に保存し、
#             初回マウントの初期化effectがその保存値を復元していた（今日はフォールバックのみ）。
#             一度スクロールすると次回以降は前回位置（多くは過去）に戻り、毎回「今日」ボタン/手動
#             スクロールが必要だった。
#      修正：初期化effectを「常に todayX を画面中央に」に変更（保存値の読み出しを撤去・依存も整理）。
#             handleGanttScroll から横スクロール位置の保存（GANTT_CENTER_DATE書き込み）と scrollSaveTimer
#             を削除（縦スクロールのラベル列同期は維持）。ズーム時の中心維持（別effect）・「今日」ボタン
#             （scrollToToday）・PJ切替時の今日リセットは不変。GANTT_CENTER_DATEキー定義は無害な死蔵として残置。
#      検証：tsc エラー0／eslint 新規0（既存tabIndex/autoFocus警告のみ）／build 成功。DBマイグレ不要。
# v2.59 fix: PCテーブルの期日セルに期限超過の赤字強調を追加（モバイルカード行と表現を統一）（2026-07-19）
#      背景：`ListMobileTaskRow`は`isOverdue`（due_date < 今日 かつ 未完了）で期日を赤字強調していたが、
#             `InlineEditDate`（PC/カンバン共通の期日インライン編集コンポーネント）は完了ステータスを
#             考慮せず期限超過を判定していたため、完了済みタスクの過去日付まで赤字強調される
#             不整合があった（未完了/完了で表現が食い違っていた）。
#      修正：`InlineEditDate`に`isDone?: boolean`を追加し、`isOverdue = !isDone && !!value && value < todayStr()`
#             に変更（日付比較を`new Date().toISOString()`のUTC基準から`lib/date.ts`の`todayStr()`
#             ＝ローカルタイムゾーン基準に統一。モバイル側`ListView.tsx`と同じ関数を流用）。
#             `ListView.tsx`のPCテーブル行（`ListTaskRow`）から`isDone`を渡すよう変更。
#             `isDone`未指定の既存呼び出し元（`KanbanView.tsx`）は完了判定こそ従来どおり考慮しないが、
#             today基準がUTCからローカルタイムゾーンに変わる（JSTでは最大1日分、境界日の判定が是正される）。
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 381件全通過／`npx eslint src` 新規エラーなし／
#             `npm run build` 成功。DBマイグレ不要（フロントのみ）。
# v2.60 feat: リストビューのグループ見出し（PJ別/担当者別/状態別/タグ別）を折りたたみ可能に（リストビュー改良第2弾）（2026-07-19）
#      追加：`collapsedGroupKeys`（折りたたみ集合）を`collapsedIds`（既存の親子ツリー折りたたみ）と同じ
#             設計で新設。localStorage（`LIST_VIEW_SETTINGS`内`collapsedGroups`キー）に永続化。
#             キーは`${groupBy}:${group.label}`とし、グルーピングモードを切り替えても別モードの
#             折りたたみ状態と衝突しない（新規グループは既定で展開表示）。
#      変更：グループ見出し（PC表の見出し行・モバイルカードの見出し）を`<button>`化し、クリックで
#             `toggleGroupCollapse`。開閉インジケータ（▶/▼）を追加。折りたたみ中も件数バッジ
#             （`{group.tasks.length}件`）は常時表示（badgeはgroup.tasksから直接算出のため影響なし）。
#             PJ別見出しの既存ドラッグ&ドロップ（子タスクをPJ見出しに落として親解除）は`<tr>`側の
#             onDragOver/onDropのまま維持し、ボタンはクリックのみをハンドルするため非競合。
#      変更：`rowsByGroup`（グループ→描画行）が折りたたみ中のグループには空配列を返すようにし、
#             既存の親子ツリー折りたたみ（子行を`buildRows`内でスキップ）と同じ「非表示中は行を
#             描画自体しない」方式に統一（CSSでの見た目非表示ではない）。
#      不変：ソート・選択・一括操作・並べ替え・フィルタ・親子ツリー折りたたみ・期限超過赤字表示。
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 381件全通過／`npx eslint src` 新規エラーなし
#             （ListView.tsx単体でも baseline比較=0件）／`npm run build` 成功。DBマイグレ不要（フロントのみ）。
# v2.61 feat: リストビューのグループ見出しに完了率・工数合計の集計を追加（リストビュー改良第3弾）（2026-07-19）
#      追加：`src/lib/list/groupSummary.ts`（`computeGroupSummary`純粋関数・新規）。
#             `computeWorkload.ts`と同じ流儀で、工数入力済みタスクのみ合算・未入力は0扱いしない・
#             1件も入力が無ければ`totalHours=null`（見出しでは非表示）。ユニットテスト4件追加。
#      追加：`GroupStatsBadge`（`ListView.tsx`内の小さな表示専用コンポーネント）。完了率は
#             幅28pxの小さな進捗バー＋「done/total（%）」テキスト、工数は「計 ◯h」を控えめな
#             フォントサイズで表示。PC表の見出し行・モバイルカードの見出し両方の件数バッジ
#             （`{group.tasks.length}件`）の直後に追加。
#      集計対象：`group.tasks`（表示中＝フィルタ適用後のそのグループのタスク）をそのまま渡すため、
#             折りたたみ状態に関係なく常に算出・表示される（畳んだ状態の重いPJ/滞留PJでも見出しで分かる）。
#      不変：ソート・選択・一括操作・並べ替え・フィルタ・親子/グループ折りたたみ・期限超過赤字表示。
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 385件全通過（新規4件含む）／
#             `npx eslint src` 新規エラーなし（ListView.tsx・src/lib/list単体でも0件）／
#             `npm run build` 成功。DBマイグレ不要（フロントのみ）。
# v2.62 feat: 一括操作に「優先度の一括変更」を追加（リストビュー改良第4弾＝最終）（2026-07-19）
#      追加：`src/hooks/useBulkTaskActions.ts`に`bulkUpdatePriority(priority)`を追加
#             （既存`bulkUpdateStatus`と同じ流儀＝変更前priorityをUndo用に控え、
#             `saveTask`経由・楽観ロック整合・Undoトーストは`isUndo:true`でCtrl+Zに乗る）。
#      追加：`ListView.tsx`の一括操作バーに優先度セグメントボタン（なし/高/中/低）を追加。
#             既存の一括ステータス変更ボタンと同じ見た目・配置（担当者セレクトの前）。
#      追加：`KanbanView.tsx`の一括操作バーにも同じ優先度ボタンを追加（フック共有のため
#             自然に対応可能と判断。バーの`maxHeight`を60px→100pxに拡張し折返しに対応）。
#      不変：既存の一括ステータス/担当者/削除・選択・折りたたみ・グループ集計・
#             期限超過赤字表示・リストビュー改良①〜③（本シリーズはこれで一区切り）。
#      検証：`npx tsc --noEmit` エラー0／`npx vitest run` 385件全通過／
#             `npx eslint src` 新規エラーなし（ListView.tsx・KanbanView.tsx・
#             useBulkTaskActions.ts単体でも0件）／`npm run build` 成功。
#             DBマイグレ不要（`priority`列は既存カラムの一括更新のみ・フロントのみ）。
#
# v2.63 refactor: 設定/管理画面の刷新 第1弾（フラット7タブ→カテゴリ分け左ナビ。骨組みのみ）（2026-07-19）
#      背景：管理画面（AdminView.tsx・3000行超）は7つのフラットな横並びタブ（プロジェクト/Task
#             Force/Objective・KR/メンバー/メンバータグ/グループ/AI使用量）のままで、機能が
#             増えるにつれ関連性の薄い項目が並び見通しが悪かった。今回は承認済みモックに沿って
#             「ナビの骨組み」だけを置き換える第1弾（各セクション内部のCard化・件数サマリー行・
#             Danger Zone隔離等は次の②で対応・今回はスコープ外）
#      追加：ナビをカテゴリ分けした左ナビ（サイドバー）に再編。
#             作業設定＝プロジェクト／Task Force／Objective・KR、人＝メンバー／メンバータグ、
#             組織＝グループ・部署、レポート＝AI使用量、の4カテゴリ×計7項目（既存タブと1:1対応・
#             tab自体のkey/localStorage永続化キーは無変更のため既存の「前回タブを復元」動作を継承）。
#             各カテゴリ見出しは10px・uppercase風の控えめなラベル。各項目に件数バッジ
#             （PJ数=`pjCount`・TF数=`active(taskForces).length`・KR数=`krCount`・
#             メンバー数=`active(members).length`・タグ数=`active(memberTags).length`・
#             部署数=`groups.filter(!is_deleted).length`。AI使用量のみ件数なし）。アクティブ項目は
#             `--color-bg-info`背景＋強調文字色、非アクティブはtransparent（既存の管理者アクセス
#             ゲート・フォントサイズ切替は不変のまま最上部ヘッダーに残置）
#      変更：デスクトップは「左ナビ188px固定＋右コンテンツ」の2カラム（`display:flex`、ナビは
#             `overflowY:auto`でカテゴリが増えても独立スクロール）。モバイル（`useIsMobile`）は
#             左ナビを描画せず、ヘッダー直下に`<optgroup>`でカテゴリ見出し付きの`<select>`
#             （既存`inputStyle`流用）に畳む方式にした（要件の「横並び or セレクト」のうちセレクト
#             を採用。狭い画面幅でカテゴリ見出し付き横並びボタン群を組むより実装・可読性ともに
#             堅牢なため）。モバイルではヘッダーの「管理」タイトル横に現在のセクション名も追記
#             （セレクトを閉じた状態でも今どこにいるか分かるように）
#      変更：各セクション（OKRSection/TFSection/PJSection/MembersSection/GroupsSection/
#             TagsSection/AIUsageSection）は無改造でそのまま描画（内部のフォーム・作成/編集/削除/
#             展開/マイルストーン/AI分解/権限ロジックは一切触っていない）。タブ切替時のコンテンツ
#             領域に`key={tab}`＋`className="animate-fadeIn"`を追加し、セクション切替のたびに
#             既存の出現アニメーション（`globals.css`定義済み・`prefers-reduced-motion`対応済み）が
#             再生されるようにした（旧フラットタブには出現アニメーション自体が無かった）
#      不変：アクセス権限ゲート（is_admin/is_super_admin、ブートストラップモード）・
#             未保存変更の確認ダイアログ（`changeTab`の`isDirty`ガード）・フォントサイズ切替
#             （小/中/大）・KR0件/PJ0件時の推奨ステップバナー（配置をヘッダー内に据え置き、
#             文言中の「Objective / KR」「プロジェクト」タブ名表記のみ新ラベルに合わせて微修正）。
#      スコープ外（②で対応）：各セクション内のCard化・件数サマリー行・Danger Zone隔離・
#             TFタスクフォーム統一・文言/色トークン是正
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 385件全通過（無改造につき新規テストなし）／
#             `npx eslint src` 新規エラーなし（AdminView.tsx単体でbaseline比較=9件で完全一致）／
#             `npm run build`成功。DBマイグレ不要（フロントのみ・ナビ構造の置換のみ）。
#
# v2.64 refactor: 設定/管理画面の刷新 第2弾（件数サマリー行＋モダンCard体裁への統一）（2026-07-19）
#      背景：①（v2.63・左ナビのカテゴリ分け）に続く第2弾。各セクション内部は素のインラインstyleの
#             寄せ集めのままだったため、承認済みモックに沿って「件数サマリー行＋Card枠」に揃える
#      追加：`src/components/common/Card.tsx`（NEW）。DashboardView.tsx で確立済みの
#             「タイトル＋バッジ＋区切り線＋本文」カード表現を`Card`として、KPIサマリー行の
#             `KpiTile`表現を`SummaryTile`（＋横並びコンテナ`SummaryRow`）として、他画面から使える
#             共通コンポーネントに抽出（DashboardView.tsx側の既存ローカル`Card`/`KpiTile`は
#             無改造のまま据え置き。他画面の移行は今回のスコープ外）。`SummaryTile`のtoneは既存の
#             danger/warning/info/accent/successに加え、メンバーの「全社管理者」表示に使う
#             `purple`（`var(--color-text-purple)`・TF番号バッジ等で既に使われている確立済み
#             トークン）を追加
#      追加（件数サマリー行・各セクション先頭）：
#             OKR＝Objective（期）・KR数／TF＝TF総数・選択中QのTF数／PJ＝PJ総数・進行中数／
#             メンバー＝総メンバー・管理者・全社管理者・所属部署（要件どおりの4タイル）／
#             タグ＝タグ数／グループ＝部署数・Webhook設定済み数。いずれも各セクションが既に
#             持っているstate/配列（`krs`/`tfs`/`projects`/`members`/`groups`/`activeTags`等）
#             から`.length`/`.filter().length`で算出するのみ（新規の重い集計・新規フェッチなし）。
#             AI使用量は指示どおり変更なし（既存の「メンバー別内訳（今月）」表がその役割を
#             既に果たしているため流用）
#      変更（Card化）：OKR（Objective編集フォーム／Key Results一覧+追加行）・PJ（プロジェクト
#             一覧）・メンバー（メンバー一覧）・グループ（全部署の概要／グループ一覧）・タグ
#             （タグ一覧）の各セクション本体を`Card`で包む形に変更。旧`SectionHeader`（タイトル+
#             バッジ+actionのみの素のヘッダー行）を、該当箇所は`Card`のtitle/badge/headerExtraに
#             置き換え（`SectionHeader`自体はAI使用量セクションで引き続き使用するため未削除）。
#             追加・編集フォーム／マイルストーンパネル／マイルストーン編集モーダルはCardの外側の
#             まま据え置き（機能・入力項目・保存挙動は一切変更していない）
#      変更（追加ボタンのトーン統一）：各セクションのヘッダー「＋ 追加」系ボタンを、従来の
#             `primaryBtnStyle`（淡いinfo色）から、TagsSectionで先行して使われていた
#             ブランド色塗りつぶしの新規`addBtnStyle`定数に統一（モックのトーンに合わせる）。
#             フォーム内の「保存」「キャンセル」ボタンは`primaryBtnStyle`/`ghostBtnStyle`のまま
#             不変（機能ボタンの見た目は変えない）
#      スコープ外（意図的に見送り）：TFSection内部の2カラム・KR別・独立スクロールのグリッド
#             （`flex:1 minHeight:0`のレイアウト）は、Card枠で包むと高さ計算・スクロール挙動の
#             回帰リスクが高いため、件数サマリー行の追加のみに留め、内部のTFRow/ToDoパネル構造は
#             無改造のまま。Danger Zone隔離・TFタスクフォーム統一・文言/色トークン是正は引き続き
#             次回以降のスコープ
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 385件全通過（無改造につき新規テストなし。
#             既存機能への回帰なし）／`npx eslint src` 新規エラーなし（AdminView.tsx単体で
#             baseline比較=9件で完全一致・新規`Card.tsx`はエラー0）／`npm run build`成功。
#             DBマイグレ不要（フロントのみ・見た目の変更のみ）。
#
# v2.65 refactor: 設定/管理画面の刷新 第3弾（削除操作を「⚠ 危険な操作（Danger Zone）」に隔離）（2026-07-19）
#      背景：①（左ナビ）②（Card化）に続く第3弾。削除（グループ強制削除・PJ削除・メンバー削除・
#             KR/TF削除・タグ削除）が通常の✕/編集ボタンの隣にニュートラルな見た目で並んでいた
#             （GitHub方式で赤枠の別ブロックに隔離する）。ToDo削除・マイルストーン削除は今回のスコープ外
#             （後者は Gantt/ProjectKarte 等 AdminView 外の3画面でも使われる共有モーダルのため、
#             見た目変更の影響範囲が本刷新の対象外に及ぶのを避けて据え置いた）
#      追加：`src/components/common/DangerZone.tsx`（NEW）。`DangerZone`（赤枠＋「⚠ 危険な操作」見出し
#             のコンテナ）と`DangerAction`（個々の削除アクション。label/description/buttonLabel＋
#             `requireNameMatch`を渡すと対象名の完全一致入力がない限りボタンを無効化するガード付き）。
#             `src/lib/dangerZoneConfirm.ts`（NEW）に判定の純粋関数`isNameConfirmed`を分離し
#             `__tests__/dangerZoneConfirm.test.ts`（7テスト）でユニットテスト
#      変更（Danger Zoneへの移設。既存の削除ロジック・権限ゲート・confirmDialogは無改造のまま
#             呼び出し導線と見た目だけ変更）：
#             ・KR（OKRSection）：一覧行の✕は即削除→「危険な操作」トグルに変更。押すと行の下に
#               DangerZoneが展開表示（confirmDialogは従来どおりdeleteKr内で発火）
#             ・TF（TFRow編集フォーム）：フォーム下部の「TFを削除」ボタンをDangerZoneで包む
#               （Save/Cancel行から独立させ、内部の確認ロジックは無改造）
#             ・プロジェクト（PJSection）：一覧行の✕を廃止し、編集フォームを開いた時だけ末尾に
#               DangerZoneを表示（`editId !== "new"`）。削除後はフォームを閉じるよう`deletePJ`に
#               `setEditId(null)`を追加
#             ・メンバータグ（TagsSection）：一覧行の「削除」ボタンを廃止し、編集フォーム末尾に
#               DangerZoneを表示（新規作成中は非表示）。削除後は`setEditingId(null)`でフォームを閉じる
#      変更（確認強度の引き上げ・不可逆かつ影響が大きい2操作のみ）：
#             ・メンバー削除（MembersSection）：一覧行の✕を廃止。編集フォーム末尾のDangerZoneで
#               `requireNameMatch`にそのメンバーの`display_name`を渡し、対象名を再入力しないと
#               削除ボタンが有効化されない方式に変更。既存の`confirmDialog`ポップアップは廃止
#               （名前再入力の方が強い確認のため、二重確認にはしない）。自分自身は従来どおり削除不可
#               （DangerZone自体を表示せず、代わりに「自分自身は削除できません」の注記を表示）
#             ・グループ（部署）削除（GroupsSection）：一覧行の✕を廃止。編集フォーム末尾のDangerZoneで
#               `requireNameMatch`にグループ名を渡す方式に変更（通常削除・メンバーがいる部署の
#               全社スーパー管理者による強制削除の両方が対象。`confirmDialog`は廃止）。部署管理者が
#               メンバーがいる部署を削除しようとするブロック（`alertDialog`案内）はDangerZone内の
#               案内文として維持し無改造。削除成功時は`setEditId(null)`でフォームを閉じる
#      スコープ外（今回やらない）：ToDo削除・マイルストーン削除のDanger Zone化、TFタスクフォーム統一、
#             古い文言/直書き色の是正（④⑤は引き続き次回以降）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 392件全通過（新規7件＋既存385件回帰なし）／
#             `npx eslint src` AdminView.tsx単体でbaseline比較=9件（7 error・2 warning）で完全一致・
#             新規`DangerZone.tsx`/`dangerZoneConfirm.ts`ともエラー0／`npm run build`成功。
#             DBマイグレ不要（フロントのみ・削除ロジック自体は無改造）。
#
# v2.66 refactor: 設定/管理画面の刷新 第4弾（TFセクションToDoパネルのタスク簡易追加を
#             QuickAddTaskModalへ統一・機能重複の解消）（2026-07-19）
#      背景：調査で見つかった唯一の明確な機能重複。TFセクション→ToDoパネル内の「＋タスクを追加」が、
#             タスク名・担当者・期日の3項目のみの簡易フォームの独自実装で、通常ビューの
#             `QuickAddTaskModal`（PJ/TF/ToDo紐づけ・担当者・開始日・期日・メモ・優先度・子タスク
#             一括まで対応）の劣化した別実装になっていた
#      変更：`ToDoPanel`（AdminView.tsx）の簡易フォーム（`taskForm`state・`saveNewTask`）を削除し、
#             「＋タスクを追加」ボタンで`QuickAddTaskModal`を開く方式に統一。`addingTaskForTodoId`は
#             「開いているモーダルの対象ToDo ID」として役割を変えて再利用
#      追加：`QuickAddTaskModal`に`defaultTfId`/`defaultTodoId`prop（ToDo→TF紐づけの既定選択用）。
#             ToDoパネル側は`defaultTfId={tfId}`（TFは確実に正しい）と`defaultTodoId={todo.id}`の
#             両方を渡し、todoIds初期値・krId/tfId初期値（TF→KR逆引き）に反映
#      設計判断：ToDoパネルはクォーターセレクタで選んだ`selectedQuarter`のTFを表示するのに対し、
#             `QuickAddTaskModal`のKR/TF絞り込みは常に「実際の今日時点のクォーター」基準
#             （`currentQuarter()`固定）で行っている。過去/未来クォーターのTFにあるToDoから開いた場合、
#             既定選択したKR/TFが絞り込みリストから漏れて選択が消える不整合がありうるため、
#             `filteredKrs`/`filteredTfs`に「既定のKR/TFは絞り込み条件を満たさなくても選択肢の先頭に
#             強制的に含める」フォールバックを追加（union方式）。紐づけ自体（保存される`todo_ids`）は
#             このuseState初期値のみで決まり選択肢の表示問題とは独立なので、通常の同一クォーター利用では
#             見た目の変化なし
#      整理：`ToDoPanel`に`projects`propを追加（`AdminView`本体→`TFSection`→`TFRow`→`ToDoPanel`と
#             `selectScopedProjects`をpropで縦流し）。未使用になった`taskForm`state・`CustomSelect`の
#             簡易フォーム内呼び出しを削除
#      スコープ外：AI自動分解（🤖）・ToDo本体のCRUD等、ToDoパネルの他機能は無改造
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 392件全通過（既存回帰なし・本変更にテスト
#             追加なし＝UI配線のみのため）／`npx eslint src`をAdminView.tsx・QuickAddTaskModal.tsx単体で
#             baseline（HEAD時点）比較＝AdminView.tsxはむしろ1件減（削除した簡易フォームのautoFocus警告
#             が消えた分）・QuickAddTaskModal.tsxは完全一致（新規0件）／`npm run build`成功。
#             DBマイグレ不要（フロントのみ）。
#
# v2.67 fix: 設定/管理画面の刷新 第5弾＝最終（古い文言の是正＋直書き色のトークン化）（2026-07-19）
#      背景：①〜④で構造（左ナビ＋カテゴリ・7セクション・DangerZone・QuickAddTaskModal統一）を刷新した後、
#             文言と直書き色が実態と乖離したまま残っていた最後の仕上げ
#      修正①（文言）：ヘッダーの権限バッジ「全員が編集できます」→「部署管理者・全社スーパー管理者が
#             編集できます」に修正（`canAccessAdmin = isCurrentUserAdmin || isCurrentUserSuperAdmin`という
#             実際のアクセス制御と一致させた。用語はCLAUDE.md Section 1.6の「部署管理者」「全社スーパー
#             管理者」に統一）。ファイル冒頭コメントも「OKR/KR・Task Force・PJ・メンバーの4セクション。
#             全員が編集可（管理者権限なし）。AppDataContext経由」という旧説明（4セクション・権限なし・
#             存在しないAppDataContext）を、現状（左ナビ4カテゴリ・7セクション・is_admin/is_super_admin
#             ゲート・ブートストラップモード・appStore経由）に書き換え
#      修正②（直書き色→トークン化）：マイルストーン日付マーカー`◆`の`#f59e0b`（2箇所）を
#             `var(--color-signal-yellow)`へ。全社スーパー管理者バッジ背景とそのチェックボックス
#             `accentColor`の`#7c3aed`（計2箇所）を、Card.tsxの`tone="purple"`（本画面の「全社管理者」
#             サマリータイルで既に使用）と同じ`var(--color-text-purple)`へ統一
#      判断（意図的に変更しなかった直書き色）：
#             ・`color_tag: "#7F77DD"`（PJ新規作成時の初期値・2箇所）→ `<input type="color">`で
#               ユーザーが自由選択するデータ値であり、UIのテーマ色ではないためトークン化対象外
#             ・`color: "#fff"`（ブランド色ボタン/バッジの白文字・計4箇所）→ 他13ファイルでも
#               同一パターン（`background: var(--color-brand)` + `color: "#fff"`）が使われている
#               アプリ全体の確立済みイディオムであり、AdminView単体で新規トークンを作ると
#               かえって他画面と不整合になるため据え置き（新規CSS変数を増やさない方針とも整合）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 392件全通過／`npx eslint src/components/admin/
#             AdminView.tsx`をHEAD時点とdiff比較＝完全一致8件（新規0件、既存のno-irregular-whitespace
#             5件・label-has-associated-control 2件・autoFocus警告1件は行番号がずれただけ）／
#             `npm run build`成功。DBマイグレ不要（フロントのみ）。これで設定/管理画面刷新シリーズ
#             （①骨組み→②Card統一→③DangerZone→④タスク追加統一→⑤文言・色是正）完了。
#
# v2.68 feat: カンバンビューの刷新 第1弾（カードのビジュアル洗練＋優先度の左ストライプ）（2026-07-19）
#      対象：`src/components/kanban/KanbanView.tsx`・`src/lib/taskMeta.ts`。機能追加は無し（既存の
#             インライン編集・カードクリック詳細・列間ドラッグ・複数選択ハイライト・バルクドラッグ・
#             タグ/優先度表示・「＋タスクを追加」はすべて不変。見た目の再構成のみ）
#      追加①：優先度の左ストライプ（カード左端3px）。high=danger赤／mid=warning橙／low=info青／
#             未設定=border色（無彩色）。`taskMeta.ts`に`TASK_PRIORITY_STRIPE_COLOR`を新設
#             （既存の`TASK_PRIORITY_STYLE`＝バッジ色とは別配列。バッジのlow=success緑とストライプの
#             low=info青は意図的に別基準）。旧・親子の位置づけを示していた左罫線色（子=グレー太罫線／
#             親=ブランド色罫線）はストライプに役割を譲り、親子の視覚化はマージンインデント（子のみ
#             14px）と既存の「子N」バッジに一本化（情報は失っていない）
#      追加②：タグチップ（タスク名の下・タグがあれば表示。ListViewの `#tag` チップと同一体裁）
#      追加③：サブタスク進捗ミニバー（親タスクのみ・`taskHierarchy.buildParentDerivedMap`を
#             `KanbanView`で1回算出しTaskCardへ渡す。done/total・幅36pxの細いバー。ListViewの
#             グループ見出し集計バッジと同じ意匠に統一）。葉タスクには出さない
#      追加④：期日を「チップ」化（フッター内、値がある時のみ背景・枠を付与）。期限超過は
#             danger色、完了タスクはsuccess色＋✓アイコン。`InlineEditDate`に既存の`isDone`propを
#             渡し（コンポーネント自体は無改修）内部の赤字ロジックと二重にならないようにした
#      整理：フッターの並びを「担当者→期日チップ→(スペーサー)→工数→コメント→優先度バッジ→
#             ステータスボタン」に統一（旧：期日が`flex:1`で右側要素を押し出す構成→スペーサーを
#             明示的に分離し、期日チップ自体は内容幅に）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 392件全通過（既存回帰なし・本変更に
#             テスト追加なし＝UI配線のみのため）／`npx eslint src`をHEAD時点と比較＝KanbanView.tsx・
#             taskMeta.tsに新規エラー0件（既存の他ファイル24エラー・11警告はいずれも本変更と無関係の
#             ベースライン）／`npm run build`成功。DBマイグレ不要（フロントのみ）
#      スコープ外（後続②〜⑤）：列ヘッダ集計・滞留バッジ・WIP制限・ドロップ位置プレースホルダ
#
# v2.69 feat: カンバンビューの刷新 第2弾（列ヘッダに完了率バー＋工数合計を追加）（2026-07-19）
#      対象：`src/components/kanban/KanbanView.tsx`のみ。DBマイグレ不要。既存のカード・ドラッグ・
#             選択・一括操作・インライン編集・「＋タスクを追加」は不変
#      追加：各ステータス列（未着手/進行中/完了）のヘッダーに、既存の件数バッジに加えて
#             ①その列の色ドット（ステータス色）②細い完了率バー（列内のdone/total比率、
#             ホバーで`n/total（pct%）`をtitle表示）③工数合計「計◯h」（`estimated_hours`入力済み
#             タスクのみ合算・1件も入力が無い列は非表示）を追加。列が空（total===0）の場合は
#             バー行自体を出さない
#      流用：新しい集計ロジックは作らず、ListViewのグループ見出しで使っている
#             `computeGroupSummary`（`src/lib/list/groupSummary.ts`）をそのまま列タスク配列に適用。
#             見た目もListViewの`GroupStatsBadge`と同じ意匠（トラック＝`rgba(255,255,255,0.6)`、
#             塗り＝ステータス色、テキストは`var(--color-*)`）に揃えた。ダークモードは既存の
#             `TASK_STATUS_STYLE`のCSS変数をそのまま使うため追加対応不要
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 392件全通過（既存回帰なし・本変更に
#             テスト追加なし＝UI配線＋既存関数の呼び出しのみのため）／`npx eslint src`をHEAD時点と
#             比較＝24エラー・11警告で完全一致（KanbanView.tsxに新規エラー0件）／`npm run build`成功
#      スコープ外（後続③〜⑤）：滞留バッジ・WIP制限・ドロップ位置プレースホルダ
#
# v2.70 feat: カンバンビューの刷新 第3弾（長く動いていない進行中タスクに「滞留」バッジを追加）（2026-07-19）
#      対象：`src/components/kanban/KanbanView.tsx`のみ。DBマイグレ不要。既存のカード・ドラッグ・
#             選択・一括操作・インライン編集・②列ヘッダ集計は不変
#      流用：新しい滞留判定ロジックは作らず、ガントが既に持つ`src/components/gantt/ganttUtils.ts`の
#             `isTaskStagnant`（status==="in_progress" かつ updated_at から `STAGNANT_THRESHOLD_DAYS`
#             ＝既定5日以上経過）と`STAGNANT_THRESHOLD_DAYS`をそのままimportしてカードに適用（判定
#             ロジックの二重化を避ける。閾値変更時もganttUtils.ts側1箇所を直せば両ビューに反映される）
#      追加：`TaskCard`内で`stagnant = isTaskStagnant(task)`・経過日数`stagnantDays`
#             （DashboardView.tsxの滞留タスク表示と同じ`Math.floor(diffMs/日)`計算を踏襲。新規の
#             共有ヘルパーは作らず、既存コードベースの慣例に合わせた）を算出し、フッターの期日チップの
#             直後に「🕒 ◯日停滞」バッジを表示。進行中以外・閾値未満（`isTaskStagnant`がfalseを返す
#             ケース）は何も描画しない
#      配色：DashboardView/ProjectKarteの既存「滞留」バッジと同じ`var(--color-bg-warning)`/
#             `var(--color-text-warning)`/`var(--color-border-warning)`（stale系のオレンジ茶トーン）に
#             統一（新規トークンは作らず、アプリ内で既に確立している「滞留」の配色語彙をそのまま踏襲。
#             ダークモードは既存トークンのため自動対応）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 392件全通過（既存回帰なし・`isTaskStagnant`
#             自体は`ganttUtils.test.ts`で既にテスト済みのため新規テスト追加なし）／`npx eslint src`を
#             HEAD時点と比較＝24エラー・11警告で完全一致（KanbanView.tsxに新規エラー0件）／
#             `npm run build`成功
#      スコープ外（後続④〜⑤）：WIP制限・ドロップ位置プレースホルダ
#
# v2.71 feat: カンバンビューの刷新 第4弾（進行中列にWIP上限のソフト警告を追加）（2026-07-19）
#      対象：`src/components/kanban/KanbanView.tsx`・`src/lib/kanbanWip.ts`（NEW）・
#             `src/lib/__tests__/kanbanWip.test.ts`（NEW）。DBマイグレ不要。既存のカード・ドラッグ
#             （ブロックしない）・選択・一括操作・インライン編集・②列ヘッダ集計・③滞留バッジは不変
#      追加：進行中（in_progress）列のヘッダーの件数バッジを「WIP ◯ / 上限N」表示に変更。
#             上限値は`src/lib/kanbanWip.ts`の`WIP_LIMIT_DEFAULT`（既定4、10名弱の運用で
#             「進行中の抱えすぎ」を検知する値として設定。将来ユーザー設定化する際もこの1箇所を
#             差し替えれば済むよう定数化）。超過判定は純粋関数`isOverWipLimit(count, limit)`に
#             切り出しテスト済み（`kanbanWip.test.ts`4件）
#      挙動：**ソフト警告のみ**（Human-in-the-loop）。上限を超えてもカードのドラッグ移動は
#             一切ブロックしない。超過時はバッジを赤系（`--color-bg-danger`/`--color-text-danger`/
#             `--color-border-danger`。ダーク/ライト両トークン対応）＋「⚠」表示に切り替えるのみ。
#             件数はスコープ（PJ選択/自分のみ等の既存フィルタ）適用後の`visibleTasks`から算出する
#             `colTasks.length`をそのまま使用（②③と同じ集計対象）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 396件全通過（新規4件）／`npx eslint src`を
#             HEAD時点と比較＝24エラー・11警告で完全一致（KanbanView.tsx・kanbanWip.tsに新規
#             エラー0件）／`npm run build`成功
#      スコープ外（後続⑤）：ドロップ位置プレースホルダ
#
# v2.72 feat: カンバンビューの刷新 第5弾＝最終（ドラッグ中のドロップ位置プレースホルダを追加）（2026-07-19）
#      対象：`src/components/kanban/KanbanView.tsx`のみ。DBマイグレ不要。既存のカード・ドラッグ確定
#             （列間ステータス変更・バルクドラッグ）・選択・一括操作・インライン編集・②列ヘッダ集計・
#             ③滞留・④WIP警告は不変
#      実装方式（既存D&Dへの上乗せ）：既存はHTML5ネイティブdrag events（`draggable`＋
#             `onDragStart`/`onDragOver`/`onDrop`）で列（ステータス）単位のドロップのみを扱い、
#             列内の並び順（display_order等）は元々持たない実装だった。今回もドロップの確定ロジック
#             （`handleDrop`）は一切変更せず、**見た目のフィードバックだけ**を追加：列コンテナの
#             `onDragOver`（既存は`e.preventDefault()`のみ）を`handleColumnDragOver`に差し替え、
#             ドラッグ中のマウスY座標と各カード（`data-kanban-card`属性）の`getBoundingClientRect()`
#             中点を比較して「何番目のカードの前に入るか」（`dropIndicator: {status, index}`）を算出。
#             rAFで間引き（dragoverの高頻度発火によるレイアウト計測のしすぎを防止。ListViewの
#             reflowループ事故＝v2.25の教訓を踏まえた設計判断）。算出した位置に破線枠＋薄いaccent
#             背景・カード高さ相当（58px）の`DropPlaceholder`をカード配列の間（Fragment key=task.id）
#             または列末尾に描画する。列内に並び順の永続化が無いため「その列のどこに視覚的に
#             入りそうか」を示すだけの純粋な表示要素で、ドロップ確定後の実際の並びには影響しない
#             （仕様どおり＝並び替えを新規実装したわけではない）
#      消去タイミング：ドロップ成功は`handleDrop`内で`setDropIndicator(null)`。ドラッグの
#             キャンセル（列外での離脱・Esc等）は、ドロップの成否によらず必ず発火するネイティブ
#             `dragend`イベントを新規に拾う`handleDragEnd`（`draggingId`/`dragOverStatus`/
#             `dropIndicator`を一括リセット）で消える。列を離脱した場合（`onDragLeave`の
#             `contains`判定）もその場でクリア
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 396件全通過（既存回帰なし・本変更に
#             テスト追加なし＝UI配線のみのため）／`npx eslint src`をHEAD時点と比較＝24エラー・
#             11警告で完全一致（KanbanView.tsxに新規エラー0件）／`npm run build`成功
#      補足：カンバンビュー刷新シリーズ（①ビジュアル洗練＋優先度ストライプ→②列ヘッダ集計→
#             ③滞留バッジ→④WIP上限ソフト警告→⑤ドロップ位置プレースホルダ）はこれで一区切り
#
# v2.73 feat: ガントビューの週ラベルに日付範囲ツールチップを追加（2026-07-21）
#      背景：v2.38で導入した週ラベル（「8月W1」形式・月内日数ブロック方式）は、実際に何月何日〜
#             何月何日を指すかが見た目だけでは分からなかった（山本さんの要望）
#      追加：`src/lib/date.ts`に`formatMDWithWeekday`（Date→「M月D日(曜)」・半角括弧・曜日は
#             漢字1文字）・`formatDateRangeWithWeekday`（開始日〜終了日→「M月D日(曜)〜M月D日(曜)」）
#             の2つの純粋関数を追加。`src/lib/__tests__/date.test.ts`（NEW・4テスト）
#      変更：`src/components/gantt/ganttUtils.ts`の`WeekBlock`インターフェースに
#             `startDate`/`endDate`（Date。ブロック内の最初/最後の日）を追加。`computeWeekBlocks`は
#             元々ブロック区切りの走査で`days[i]`（開始）・`days[j-1]`（終了）を経由済みのため、
#             新しい集計ロジックを増やさずそのまま2フィールドに格納するだけで済んだ
#      変更：`GanttView.tsx`ヘッダー第2行（週ラベル行）の`title`属性を、従来の`wb.label`
#             （見た目のラベルと同じ文字列を重複表示していただけ）から
#             `formatDateRangeWithWeekday(wb.startDate, wb.endDate)`に変更。既存のマイルストーン◆・
#             画面外⏱バッジ（B2）と同じネイティブ`title`属性方式を踏襲（新規ツールチップ
#             ライブラリ・CSSは追加していない）
#      テスト：`ganttUtils.test.ts`に1テスト追加（startDate/endDateの値検証）。既存401テストも
#             全通過（合計406テスト）
#      スコープ：デスクトップGanttViewのみ。GanttMobileViewは週ラベル自体を持たないため対象外
#             （変更前に確認済み・無変更）
#      DBマイグレ不要（フロントのみ）
#
# v2.74 feat: タスクステータスに「保留(on_hold)」「中止(cancelled)」を追加（2026-07-21）
#      背景：過去に登録したタスクが方針転換で実施しなくなる（中止）・状況変化で一旦保留し将来また
#             検討する可能性がある（保留）、というケースにステータスを付与できるようにしたい
#             （山本さんの要望）。`Task.status`は`'todo'|'in_progress'|'done'`の3値のみだった
#      変更：`Task.status`を`'todo'|'in_progress'|'done'|'on_hold'|'cancelled'`の5値に拡張
#             （`src/lib/localData/types.ts`）
#      DBマイグレ必要：`supabase/migrations/20260721_add_task_status_hold_cancelled.sql`
#             （山本さんの手動適用。`tasks.status`のCHECK制約を動的に探して落とし、5値許可の
#             制約を再作成するDOブロック方式。`schema.sql`のCHECK制約も同期反映済み）
#      追加：`src/lib/taskMeta.ts`に`isActiveTaskStatus`（アクティブ＝todo/in_progressのみ）・
#             `isPausedOrCancelledStatus`（中止・保留か）・`suppressOverdue`（期限超過の赤字強調を
#             抑制すべきか＝done/cancelled/on_hold）の3判定関数を新設。`TASK_STATUS_LABEL`/
#             `TASK_STATUS_STYLE`に保留（オレンジ系warningトークン）・中止（グレー系secondary/
#             tertiaryトークン＋取り消し線）を追加
#      変更（依存ゲートB1）：`lib/dependencies/gate.ts`の`getIncompletePredecessors`。先行タスクが
#             cancelledなら「完了扱い」として後続の完了ブロックに使わない（doneと同じ扱い）。
#             on_holdは引き続き「未完了扱い」（後続をブロックする＝再開されるまで先行が終わって
#             いないのと同じ）
#      変更（ワークロード・過負荷・クリティカルパス）：「アクティブ＝done以外」の判定基準を
#             「アクティブ＝done・cancelled・on_holdのいずれでもない」に統一。
#             `computeWorkload.getMemberActiveTasks`・`overload.computeOverloadRanges`は
#             `isActiveTaskStatus`を使用。`criticalPath.computeCriticalTaskIds`はcancelled/on_hold
#             をノード集合から除外（is_deletedと同じ扱い＝依存グラフ上「無かったこと」）。doneは
#             従来通りノードに含める（実績としてパス長に寄与させる。cancelled/on_holdとは異なる扱い）
#      変更（カンバンビュー）：既存3列（未着手/進行中/完了）のレイアウト・WIP制限・D&D・一括操作は
#             無変更。「保留・中止を表示」トグル（既定OFF・🙈完了を隠すの逆発想）で開閉する追加列
#             （on_hold/cancelled）を新設。トグルON時は既存のD&D基盤（`handleColumnDragOver`/
#             `handleDrop`）をそのまま流用でき、任意の列からドラッグで保留・中止にできる。カードは
#             中止のみdoneと同じ取り消し線・グレーアウト表示、保留・中止カードは期限超過表示を抑制し
#             「ToDoに戻す」ボタンを表示。一括ステータス変更ツールバーにも保留・中止ボタンを追加。
#             `lib/kanbanOrder.ts`の`computeKanbanOrderedIds`に`showPaused`引数を追加（Ctrl+A・
#             Shift範囲選択の対象算出）
#      変更（リスト/ガント/編集UI）：`ListView`（状態フィルタ・グループ化・並び順STATUS_ORDER・
#             行の取り消し線・期限超過表示）、`GanttView`/`GanttMobileView`/`GanttParts`（バー・
#             カードの期限超過表示・完了扱いの取り消し線・`StatusDot`）、`TaskEditModal`/
#             `TaskSidePanel`（ステータス選択肢に保留・中止を追加・先行タスクチップのアイコンを
#             ✅/🚫/⏸/⏳の4種に・期限超過表示）に反映。中止はdoneと同じ「終わった見た目」に、
#             保留・中止いずれも期限超過の赤字強調は出さない
#      変更（ダッシュボード）：期限超過・今日締切・今週締切・自分のリマインダー・今週の完了率の
#             集計から on_hold/cancelled を除外（中止・保留になったタスクを期限超過として騒がない）。
#             `computeDueForecast`（締切の見通し）も同様。**スコープ外**：「親タスクの自動完了」
#             「期限アラートの親子並列表示改善」は別セッションで後続対応（今回はステータス追加と
#             その波及のみ）。`taskHierarchy.ts`の親子ロールアップ（`rollupStatus`/
#             `buildParentDerivedMap`）はcancelled/on_hold混在時の表示精緻化を今回は未対応
#             （既知の残課題。子にcancelled/on_holdが混じっても例外的な誤表示はしないが、
#             「全done」以外は一律in_progress扱いのまま）
#      変更（AI連携）：`payloadBuilder.ts`のpj_progress・`allProjectsAnalysisClient.ts`の
#             task_stats にon_hold/cancelled件数を追加（doneまでの内訳合計がtotalと一致しない
#             状態を解消）。`ai/types.ts`（AITask.status・AIProject.pj_progress）・
#             `projectAnalysisClient.ts`・`okrKrAnalysisClient.ts`のstatus型を5値に拡張。
#             `systemPrompt.ts`にステータス5種の説明と「保留・中止は催促しない」指針を追記。
#             会議メモAI抽出（`meetingExtractor.ts`のstatus_updates経路。applyProposal.tsとは別の
#             既存のAI起点ステータス変更経路）が「中止になった」「一旦保留」等の発言から
#             on_hold/cancelledを提案できるように拡張。コマンドパレットも中止タスクをdoneと同様に
#             下位ソート・取り消し線表示
#      テスト：`gate.test.ts`・`computeWorkload.test.ts`・`overload.test.ts`・`criticalPath.test.ts`・
#             `kanbanOrder.test.ts`・`computeDueForecast.test.ts`に新ステータスの回帰テストを追加
#             （既存401テスト全通過を確認した上で計9テスト追加・合計410テスト）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 410件全通過／`npx eslint src`は変更前と
#             同じ35件（24エラー・11警告、いずれも既存の無関係な指摘。新規エラー0件）／
#             `npm run build`成功
# v2.75 feat: 子タスク完了で親タスクを自動完了・期限アラートの親子並列表示を解消（2026-07-21）
#      背景：v2.74でステータスを5値化した際の残課題2点（山本さんの要望）。①子タスクを持つ
#             親タスクは、子タスクが全て完了したことをもって完了とする ②期限アラートに
#             親タスクと子タスクが並列表示される違和感を解消する。孫は存在しない（2階層固定）
#             ため再帰は不要、直下の子だけを見ればよい
#      追加（A：親タスクの自動完了。`src/lib/taskHierarchy.ts`）：`computeParentAutoStatus`
#             （純粋関数）。全ての子がdone/cancelledになった時点で親をdoneに、逆に
#             done済みの親の子が未完了（todo/in_progress/on_hold）へ戻された場合は
#             親を明示的にin_progressへ差し戻す（rollupStatusの値をそのまま流用せず、
#             一貫性のため常にin_progress固定）。それ以外（親がdone以外・子も全終了でない）
#             はnull＝手動管理を尊重し何もしない。cancelledはdoneと同じ「終わった」扱い、
#             on_holdは「まだ動く可能性がある」ため終了とみなさない（on_holdの子が1件でも
#             残っていれば親は完了にならない）
#      変更（choke point統合。`src/stores/appStore.ts` saveTask）：子タスク保存のDB書き込み
#             成功後、`existing?.status !== taskToSave.status`（statusが実際に変化した時）
#             のみ兄弟を含めて`computeParentAutoStatus`を判定し、変更が必要なら
#             `get().saveTask({ ...parent, status: nextStatus }, { skipCascade: true })`で
#             親を更新（B3の cascade 適用パターンを踏襲。親の自動更新自体が新たなB3連鎖・
#             再帰探索を誘発しない＝2階層固定なので1段で止まる）。親のB1ゲート（先行タスク
#             未完了等）で自動完了が失敗した場合は子の保存自体を失敗させないようtry/catchで
#             握りつぶし`reportError`のみ行う。加えて、子を持つ親タスクを手動で「完了」に
#             した際、子がまだ全部done/cancelledでなければソフト警告のみ（B1の着手時ソフト
#             警告と同じ非ブロッキング方式。強制完了は可能）
#      変更（表示用ロールアップとの整合。`taskHierarchy.ts`）：`rollupStatus`・
#             `buildParentDerivedMap`の「全done→done」判定を「全done/cancelled→done」に
#             統一する共通ヘルパー`allChildrenTerminal`を新設（v2.74の既知残課題「子に
#             cancelled/on_hold混在時の粗い扱い」を今回で整合。rollup関数自体のシグネチャ・
#             他の分岐（全todo→todo／それ以外→in_progress）は無変更、Gantt完了フィルタ・
#             ListView集計等の既存依存箇所は壊さない）
#      追加（B：期限アラートの親子並列表示改善。`src/components/dashboard/DashboardView.tsx`）：
#             `alertTasks`・`stagnantTasks`（同じ「期限アラート」カード内の2リスト）の
#             フィルタ条件に`!isParentTask(t, allTasks)`を追加し、子タスクを持つ親タスク
#             自体を一覧から除外（既存パターン踏襲。この判定は絞り込み前のallTasksで行い、
#             mineOnly等で子だけが除外された場合に親を誤って残さないようにする）。
#             `TaskRow`に`parentLabel?: string`を追加し、子タスクの行にはPJ名に加えて
#             所属する親タスク名（`↳ 親タスク名`）を併記。KPIサマリー（期限超過・今日締切
#             件数）はalertTasksから算出済みのため自動的に整合
#      スコープ外：Teams週次通知（`supabase/functions/notify-deadlines/index.ts`）は同様の
#             親子並列表示課題を抱えるが未対応（Deno Edge Functionの別デプロイが必要・
#             今回は任意対応と位置づけ）。次回候補として記録するのみ
#      テスト：`taskHierarchy.test.ts`に`computeParentAutoStatus`の回帰テスト6件＋
#             `rollupStatus`のcancelled関連3件を追加（既存410テスト全通過を確認した上で
#             計9テスト追加・合計419テスト）。DashboardView.tsxは既存どおり専用テスト
#             ファイルを持たない設計（フィルタは既存テスト済みの`isParentTask`の組み合わせ）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 419件全通過／`npx eslint src`は
#             変更前と同じ35件（24エラー・11警告、既存の無関係な指摘のみ。新規エラー0件）／
#             `npm run build`成功
#
# v2.76 fix: 進捗%集計のcancelled非対称を一括解消（M33）（2026-07-22）
#      背景：A計画ビューの巡回（23〜31回目）で繰り返し発見された同型の設計課題（`docs/REFACTORING.md`
#             中優先度表M33）。進捗%の分母（全体件数）にはon_hold/cancelledを含めるが、分子（完了
#             扱い件数）は`status==="done"`限定という非対称があり、中止・保留タスクが分母に残り
#             続けて達成率を実際より低く見せていた。今回、方針を確定：**cancelled（中止）はdoneと
#             同様に「完了扱い」として進捗%の分子にも含める。on_hold（保留）は引き続き「未完了」
#             扱いのまま**（既存の依存ゲート・v2.75親タスク自動完了の`allChildrenTerminal`共通コア
#             判定と完全に同じ基準）
#      追加：`src/lib/taskMeta.ts`に`isCompletedForProgress(status)`（`status==="done" ||
#             status==="cancelled"`。`allChildrenTerminal`と同じ判定基準を進捗%集計向けに切り出した
#             共有ヘルパー）を新設。`src/lib/__tests__/taskMeta.test.ts`（NEW・5テスト）
#      変更（対象4箇所を`isCompletedForProgress`経由に統一。分母・全体件数の集計ロジックは無変更）：
#             ①`GanttView.tsx`：PJ別ビューのPJグループ進捗%（`viewMode==="pj"`のPJバー行）・ToDo別
#             グループ進捗%（`todoGroups`のバー）の2箇所の`done`算出 ②`DashboardView.tsx`：
#             `pjProgress`（PJ進捗一覧）・`tfTaskStats`（TF内訳。`krProgress`のTFサマリーと共有）・
#             `krProgress`（KR進捗サマリー）・`todoProgress`（ToDo進捗一覧）の4箇所の`done`算出
#             ③`src/lib/list/groupSummary.ts`の`computeGroupSummary`：`doneCount`算出
#             （`ListView.tsx`のグループ見出し・`KanbanView.tsx`の列ヘッダー集計の両方に自動反映）
#      変更（葉タスクの進捗率フィル。`src/lib/taskHierarchy.ts`）：`leafProgressFraction`
#             （v2.45導入・ガントのバー内進捗フィル用ステータス由来慣例値）の判定を
#             `status==="done"`単独から`isCompletedForProgress`経由に変更し、cancelledもdoneと
#             同じ1（100%）扱いに統一（「実施しないと決めて終わった」＝もう動かないため、進捗
#             フィルの表現上も完了扱いに揃える判断）。on_holdは引き続き0のまま（まだ動く可能性が
#             あるため）。`taskProgressFraction`/`buildProgressFractionMap`のシグネチャ・親タスクの
#             ロールアップ経路（`parentProgress`・`buildParentDerivedMap`の`done`算出自体は
#             `status==="done"`単独のまま無変更）には手を入れていない
#      スコープ外（意図的に据え置き）：`taskHierarchy.ts`の`parentProgress`/`buildParentDerivedMap`
#             が算出する親タスク自身の`done`（ガントの個別タスクバー進捗フィル・ListViewの親行
#             `derivedByParentId`表示で使用）は、`docs/REFACTORING.md`のM33が対象化した4箇所には
#             含まれておらず、M11（親子ステータス・進捗集計の一元化・2026-07-06完了）の残課題として
#             別管理されている集計のため、今回は変更していない（同じ非対称が理論上残るが、対象を
#             広げると影響範囲がM33の指示スコープを超えるため今回は見送り。次回の巡回候補として記録）
#      テスト：`taskHierarchy.test.ts`に`taskProgressFraction`のcancelled/on_hold回帰テスト2件、
#             `groupSummary.test.ts`にcancelled/on_hold回帰テスト2件、`taskMeta.test.ts`（NEW）に
#             `isCompletedForProgress`の単体テスト5件を追加（計9テスト追加）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 446件全通過（新規9件込み）／
#             `npx eslint src`は変更前と同じ35件（24エラー・11警告、既存の無関係な指摘のみ。
#             新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（フロントのみの変更）
#
# v2.77 fix: カレンダービューをステータス5値化(v2.74〜76)に追従（実バグ修正・刷新第1弾①）（2026-07-22）
#      背景：strategistによる調査（`docs/dev/calendar-improvement-research.md`）で判明した実バグ。
#             `CalendarLabView.tsx`は`docs/REFACTORING.md`巡回台帳の正式なユニット対象外（module-map.md
#             未登録のラボ系ファイル）として扱われ続けたため、v2.74（保留/中止ステータス追加）に
#             他ビュー（ガント・ダッシュボード・リスト・カンバン）が是正済みの中、唯一未追従のまま
#             残っていた。保留・中止にしたタスクが「🙈完了を隠す」ONでも表示され続け、かつ過去日付
#             なら期限超過の赤字強調が付いてしまう状態だった
#      変更：`hideDone`フィルタを`t.status === "done"`単独判定から`isPausedOrCancelledStatus`併用に
#             拡張（完了・保留・中止をまとめて隠す）。トグルボタンの文言を「🙈 完了を隠す」→
#             「🙈 完了・保留・中止を隠す」に変更（title属性・備考欄下部の凡例テキストも同様に修正）。
#             タスク行の期限超過判定を独自の`isDone`変数から`suppressOverdue(status)`経由に変更
#             （done・cancelled・on_holdはいずれも赤字強調の対象外）。表示上の扱いは他ビューと統一：
#             中止(cancelled)はdoneと同じ淡色(opacity 0.5)＋取り消し線、保留(on_hold)は通常表示のまま
#             （赤字にはしない）
#      対象：`src/components/lab/CalendarLabView.tsx`のみ（`src/lib/taskMeta.ts`の既存ヘルパー
#             `isPausedOrCancelledStatus`/`suppressOverdue`をimportして使うだけ。新しい判定関数は
#             作らない）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 446件全通過（既存テストのみ・回帰なし。
#             純粋関数の新規切り出しは無いためユニットテスト追加なし）／`npx eslint src`は変更前と
#             同じ35件（24エラー・11警告、既存の無関係な指摘のみ。新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（フロントのみの変更）
#      補足：strategist調査レポートの高優先3件のうち①。②優先度ストライプ・滞留バッジ（v2.78）・
#             ③日付セルから直接タスク作成（v2.79）は別コミットで実施
#
# v2.78 feat: カレンダービューに優先度ストライプ・滞留バッジを追加（刷新第2弾②）（2026-07-22）
#      背景：strategist調査レポート（`docs/dev/calendar-improvement-research.md`）の高優先②。
#             カレンダーのタスク行はPJカラードット1つのみで視覚差が乏しく、カンバン（v2.68優先度
#             ストライプ・v2.70滞留バッジ）・ダッシュボードで確立した「色に意味を持たせる」設計が
#             カレンダーだけ手薄だった
#      変更：`src/components/lab/CalendarLabView.tsx`のタスク行に、カンバンの
#             `TASK_PRIORITY_STRIPE_COLOR`（`src/lib/taskMeta.ts`）をそのまま流用した左3px枠線の
#             優先度ストライプ（高＝danger赤／中＝warning橙／低＝info青／未設定＝border-primaryで無彩色）
#             を追加。ガントの`isTaskStagnant`/`STAGNANT_THRESHOLD_DAYS`（`src/components/gantt/
#             ganttUtils.ts`）をそのまま流用した滞留バッジ「🕒N日」をタスク名の右側に追加
#             （in_progressかつ`STAGNANT_THRESHOLD_DAYS`日以上`updated_at`が動いていない場合のみ表示。
#             日数計算もカンバンの表示と同じ`Math.floor`ベース）。判定ロジックの二重化を避けるため、
#             新しい配色定数・滞留判定は作らずカンバン/ガントの既存exportをimportするのみ
#      設計判断：モックはセル1行の高さを増やさない方針のため、タスク行の`padding`・行間`gap`は
#             一切変更していない（ストライプはborderLeftの3px追加のみ、滞留バッジはタスク名と同じ
#             10px行の中にflexShrink:0で収める8pxの小さいテキストとして実装。カンバンの
#             丸ピル型バッジ（`padding:"2px 7px"`＋`border-radius:full`）はセル内の縦スペースが
#             無いため踏襲せず、素のテキストラベルに簡略化）
#      対象：`src/components/lab/CalendarLabView.tsx`のみ
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 446件全通過（既存テストのみ・回帰なし。
#             純粋関数の新規切り出しは無いためユニットテスト追加なし）／`npx eslint src`は変更前と
#             同じ35件（24エラー・11警告、既存の無関係な指摘のみ。新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（フロントのみの変更）
#
# v2.79 feat: カレンダービューの日付セルから直接タスク作成（刷新第3弾③＝高優先3件 完結）（2026-07-22）
#      背景：strategist調査レポート（`docs/dev/calendar-improvement-research.md`）の高優先③。
#             従来のカレンダーは完全な読み取り専用ビューで、Notion／ClickUp／Google Calendarで
#             共通の最重要導線（カレンダー上で見つけた空き日にそのまま予定を入れる）が無かった
#      追加：`QuickAddTaskModal`に`defaultDueDate?: string`propを新設（既存の`defaultParentId`/
#             `defaultStatus`/`defaultTfId`/`defaultTodoId`と同じ「初期値を渡すだけ」パターン。
#             `dueDate`stateの初期値に採用するのみ）
#      変更：`CalendarLabView.tsx`に`onRequestQuickAdd(dateStr)`propを追加。日付セルを
#             `role="button" tabIndex={0} onClick onKeyDown`でクリック可能にし（Enter/Spaceにも対応）、
#             クリックでその日を期日初期値としたQuickAddTaskModalを開くよう`MainLayout.tsx`から配線。
#             PCではセルホバー時のみ右上に「＋」ボタン（`cal-print-hide`で印刷除外）を表示する
#             アフォーダンスを追加（ホバーが無いタッチ端末では出さず、セル自体のクリックで同じ動作に
#             フォールバック）。タスク行の`onClick`・「＋」ボタンの`onClick`はいずれも
#             `e.stopPropagation()`でセルのクリックへの伝播を止め、タスク詳細を開く操作／追加操作が
#             セルクリック（タスク追加）と二重発火しないようにした
#      配線：`MainLayout.tsx`は既存の`calendarEditTaskId`（TaskEditModalをカレンダー(zIndex 250)より
#             前面のzIndex 300で重ねる仕組み）と全く同じ流儀で`calendarQuickAddDate` stateを新設し、
#             QuickAddTaskModalを同じくzIndex 300のラッパーdivで包んで描画。CalendarLabViewは
#             `MainLayout.tsx`の唯一の呼び出し元（PCレイアウトのreturnブロック側の1箇所のみ。
#             モバイル側は既存コメントの通りCalendarLabView自体を描画しないためこの配線も不要）
#      a11y：日付セルは`role="button"`のためjsx-a11yのerror級ルール
#             （`no-static-element-interactions`/`click-events-have-key-events`）に抵触しない
#      対象：`src/components/lab/CalendarLabView.tsx`／`src/components/task/QuickAddTaskModal.tsx`／
#             `src/components/layout/MainLayout.tsx`
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 446件全通過（既存テストのみ・回帰なし）／
#             `npx eslint src`は変更前と同じ35件（24エラー・11警告、既存の無関係な指摘のみ。
#             新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（フロントのみの変更）
#      補足：これでstrategist調査レポートの高優先3件（①ステータス5値化追従＝v2.77／②優先度
#             ストライプ・滞留バッジ＝v2.78／③日付セルから直接タスク作成＝本v2.79）が完結。
#             中優先4件〜6件（週表示・期間バー・週末トグル）は別セッションで第2弾として実施予定
#
# v2.80 feat: カレンダービューに「週末を淡く」トグルを追加（刷新第2弾⑥）（2026-07-22）
#      背景：strategist調査レポート（`docs/dev/calendar-improvement-research.md`）の中優先⑥。
#             monday.com・Outlookの「週末の表示/非表示切替」相当だが、月間の「暦の形」自体を保つ
#             このビューの性質上、土日の列を消すとレイアウトが崩れる（調査でOutlookも月表示では
#             非対応と裏付け済み）ため、列は残したままトーンだけ落とす軽量な実装にとどめた
#      追加：`src/components/lab/CalendarLabView.tsx`にツールバー「🗓 週末を淡く」トグル（既定OFF）。
#             ONで土曜・日曜のセル背景を`var(--color-bg-secondary)`にする。優先順位は
#             「今日の強調（isToday）＞週末ダイマー＞表示月外（inMonth）の淡色」の順（今日が土日でも
#             今日の強調を優先）。土日の列・セル自体は消さない（暦の形を維持）
#      追加：`src/lib/localData/localStore.ts`のKEYSに`CAL_VIEW_MODE`（v2.81で使用）・
#             `CAL_DIM_WEEKENDS`を追加。localStorage直書きを禁止するルールに従い、必ずKEYS経由で
#             永続化する（既存の`cal_note_text`は直書きのまま残る旧実装だが、今回のスコープでは
#             修正していない＝既知の技術的負債として据え置き）
#      対象：`src/components/lab/CalendarLabView.tsx`／`src/lib/localData/localStore.ts`。
#             併せて`src/lib/calendar/calendarUtils.ts`（v2.81週表示・v2.82期間バーで使う純粋関数
#             `chunkIntoWeeks`/`assignBarLanes`/`computeWeekBarSegments`）とそのユニットテスト18件を
#             このコミットで先行実装（次コミット以降でCalendarLabView.tsxから実際に呼び出す）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 464件全通過（既存446件＋
#             `calendarUtils.test.ts`新規18件。CalendarLabView.tsx自体は本コミット時点では
#             まだ未使用のためCalendarLabView側の回帰なし）／`npx eslint src`は変更前と同じ35件
#             （24エラー・11警告、既存の無関係な指摘のみ。新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（フロントのみの変更）
#      補足：strategist調査レポートの中優先3件（④週表示・⑤期間バー・⑥週末を淡く）のうち⑥。
#             ④週表示（v2.81）・⑤期間バー（v2.82）は別コミットで実施
#
# v2.81 feat: カレンダービューに週表示を追加（刷新第2弾④）（2026-07-22）
#      背景：strategist調査レポート（`docs/dev/calendar-improvement-research.md`）の中優先④。
#             月表示は1セル最大4件（5件目以降は「+N件」で内訳が見えない）ため、月末や繁忙期に
#             締切が集中すると内訳を見るために結局リストビューを開き直す状況があった
#      追加：`src/components/lab/CalendarLabView.tsx`のツールバーに「月／週」セグメント切替
#             （既定=月）。`viewMode`は`KEYS.CAL_VIEW_MODE`でlocalStorage永続化。切替時は
#             「今どのあたりを見ていたか」を引き継ぐ（月→週：月表示の1日を含む週へ／週→月：
#             週表示の週が属する月へ）設計とし、唐突に無関係な期間へ飛ばないようにした
#      設計判断（グリッド構造は変えずに対応）：既存の月間グリッド計算（`cells`/`gridRange`）は
#             月表示専用の`monthCells`として温存し、新設の`weekCells`（weekAnchorを含む週の
#             日曜〜土曜7日）と合わせて`cells = viewMode==="week" ? weekCells : monthCells`に
#             一本化。`gridRange`は`cells`の先頭・末尾から導出するよう変更（従来はym直算出）。
#             CSS Gridの行数を`repeat(${cells.length / 7}, 1fr)`と動的にしただけで、月=6行・週=1行
#             いずれも同じ1つのグリッド実装で描画できるため、⑤期間バーで予定していた
#             「週ごとのposition:relativeコンテナへの分割」はこの時点ではまだ導入していない
#             （⑤のコミットで導入する）
#      週表示の内容：週表示では月表示の「1セル最大4件・5件目以降+N件」の上限を外し全件を縦に
#             並べる（`viewMode==="week"`のときのみ`dayTasks.slice(0,4)`を素通しする）。曜日見出しは
#             週表示のときだけ日付も併記（「日 19」の形）。前後ナビ（‹/›）は表示モードに応じて
#             月送り／週送りを切り替え、「今日」ボタンは両モード分のstate（ym・weekAnchor）を同時に
#             リセットするため常にどちらのモードでも機能する。週表示では「表示月の外（inMonth）」
#             という概念自体が無い（7日全てが対象週の主役）ため常にinMonth=true扱いにし、月表示
#             特有の淡色表示は適用しない
#      追加（セル内スクロール＋印刷対応）：週表示はタスク数に応じてセルの中身が伸びうるため、
#             日付セルに`className="cal-cell"`を付与し、週表示時のみ`overflow:"auto"`にした
#             （月表示は既存どおり`overflow:"hidden"`で無変更）。`globals.css`の`@media print`に
#             `.cal-cell { overflow: visible !important; }`を追加し、印刷時はスクロールという
#             操作が成立しないため必ず全件がクリップされずそのまま出力されるようにした
#             （既存の`.cal-grid`向け印刷ルールはそのまま・無変更）
#      対象：`src/components/lab/CalendarLabView.tsx`／`src/styles/globals.css`
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 464件全通過（既存テストのみ・回帰なし。
#             本コミットで新規に切り出した純粋関数は無いためユニットテスト追加なし）／
#             `npx eslint src`は変更前と同じ35件（24エラー・11警告、既存の無関係な指摘のみ。
#             新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（フロントのみの変更）
#      補足：strategist調査レポートの中優先3件（④週表示・⑤期間バー・⑥週末を淡く）のうち④。
#             ⑥週末を淡く（v2.80）は先に完了。⑤期間バーは別コミット（v2.82）で実施
#
# v2.82 feat: カレンダービューに期間バー（開始日〜期日）を追加（刷新第2弾⑤＝カレンダー刷新 完結）（2026-07-22）
#      背景：strategist調査レポート（`docs/dev/calendar-improvement-research.md`）の中優先⑤。
#             従来カレンダーは`due_date`しか参照しておらず`start_date`は完全に未使用で、複数日に
#             わたるタスクの「いつからいつまで」が暦の文脈で全く見えなかった。Google Calendar／
#             Asana／ClickUp／Notionいずれも複数日イベントの帯表示は標準機能
#      グリッド構造の変更（v2.81の申し送りどおり）：フラットな42セル（週表示は7セル）のCSS Gridを、
#             `chunkIntoWeeks`で週ごとに分割し「週行コンテナ（position:relative）＞7つの日付セル」の
#             2段構造に変更。帯は各週行コンテナ基準の絶対配置レイヤーに描く。ガントのような
#             DOM実測（getBoundingClientRect）は不要＝CSS Gridの列幅が均等なため、週内の
#             「何日目から何日分か」の%計算だけで座標が確定する
#      追加（純粋関数・v2.81時点で先行実装済みだった分を本コミットでUIに接続）：
#             `src/lib/calendar/calendarUtils.ts`の`assignBarLanes`（区間スケジューリングの貪欲法で
#             重ならない表示レーンを割り当てる。**レーン番号はタスク単位でグローバルに1つ**決めるため、
#             週をまたいで描画しても同じタスクの段が週ごとにずれない）と`computeWeekBarSegments`
#             （1週間分のleft%/width%を算出。週をまたぐタスクは週ごとに呼ぶだけで自然に分割され、
#             月の端で切れるケースもクランプで吸収される）。`chunkIntoWeeks`も本コミットで初めて使用
#      設計判断①（同日タスクは帯にしない）：`start_date`と`due_date`が同じ日のタスクは帯を描かない
#             （`s >= due`で除外）。1日分の帯は同じセルに出るタスク行と情報が重複するうえ、帯の
#             レーンだけ消費して他の複数日タスクを押し出すため
#      設計判断②（月表示のレーン上限）：月表示は`MONTH_MAX_BAR_LANES=2`で表示レーン数を制限する。
#             月表示のセルは高さが限られ、帯が増えるほどその日のタスク行を押し出してしまうため。
#             上限超過分は帯を描かないが、そのタスクは期日セルにタスク行として従来どおり出るため
#             情報は失われない。週表示はセルが十分高く縦スクロールも効くため上限なし
#      設計判断③（表示範囲の判定）：帯の対象タスクは「due が表示範囲内」ではなく「表示範囲と
#             重なるか」（`s > gridRange.end || due < gridRange.start`で除外）で判定する。表示範囲より
#             前に始まって途中まで続くタスクも帯として見せる必要があるため（タスク行の判定とは異なる）
#      絞り込みの一貫性：帯の対象は`tasksByDate`と同じ絞り込み（👤自分のみ／🙈完了・保留・中止を隠す／
#             📁PJ）を通す。中止・完了の帯は取り消し線＋淡色（タスク行の扱いと統一）
#      クリック衝突の回避：帯レイヤー自体は`pointerEvents:"none"`にして③のセルクリック（その日に
#             タスク追加）を邪魔せず、帯そのものだけ`pointerEvents:"auto"`＋`stopPropagation`で
#             タスク詳細を開く
#      印刷：印刷CSSはクラスセレクタ（`.cal-grid`/`.cal-cell`）で書かれており子孫結合子を使っていない
#             ため、週行コンテナを1段挟んでも既存ルールはそのまま効く（`globals.css`は無変更）。
#             帯は`.cal-print-hide`を付けていないため印刷にも出力される（意図どおり）
#      対象：`src/components/lab/CalendarLabView.tsx`のみ（`calendarUtils.ts`・そのテストはv2.81までに追加済み）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 464件全通過（`calendarUtils`の既存テストを含む・
#             回帰なし。本コミットは既存純粋関数のUI接続のため新規テスト追加なし）／`npx eslint src`は
#             変更前と同じ35件（24エラー・11警告、既存の無関係な指摘のみ。新規エラー0件）／
#             `npm run build`成功
#      DBマイグレ不要（`start_date`は既存カラム・フロントのみの変更）
#      補足：**これでカレンダー刷新6件（①ステータス5値化追従＝実バグ修正／②優先度ストライプ・滞留
#             バッジ／③日付セルから直接タスク作成／④週表示／⑤期間バー／⑥週末を淡く）が完結。**
#             非推奨として見送った機能（ドラッグでの日付変更＝ガントと役割重複／日表示・タイム
#             ブロッキング／外部カレンダー同期／AI自動スケジューリング／ワークロード統合表示）と
#             その理由は調査レポートに記録済み。位置づけは当面ラボ機能のまま据え置き（実機で
#             使ってみた上で正式ビューへの格上げを判断する）
#
# v2.83 feat: プロジェクト作成時に他PJ（過去含む）からタスクを引き継げるように（2026-07-22）
#      背景：山本さんの要望「全く新たに作成するか、過去を含む他のプロジェクトを選択し、そのPJの
#             タスクをチェックボックスで不要なものを外して新規PJに引き継げるようにしたい」。
#             フォーラム運営・定例調査など同じ段取りで回す案件を毎回ゼロから作らずに済む
#             「テンプレート的な再利用」が目的
#      確定仕様4点（統括Claudeとの壁打ちで山本さんが選択）：
#             ①日付＝新PJの開始日を基準にスライド（元PJ開始日からの相対日数を保ったまま平行移動。
#             start_date/due_date両方が対象。暦日計算・土日祝は飛ばさない＝既存B3自動リスケ連鎖と
#             同じ流儀）②ステータス＝引き継いだタスクは全てtodoにリセット（completed_at等はsaveTaskの
#             choke pointが自動でクリア）③担当者＝引き継ぐ（assignee_member_id/idsとも）④依存関係
#             （task_dependencies）＝先行・後続の両方がチェックされている組だけ引き継ぐ（片方だけなら
#             その依存は作らない）
#      UI（`ProjectCreateModal.tsx`）：既存の単一ステップフォームの先頭に「作成方法」セグメント
#             （まっさらな新規作成／他のPJから引き継ぐ）を追加。「まっさらな新規作成」を選んだ場合の
#             挙動・保存内容は完全に無変更（既存フローを壊さない）。「他のPJから引き継ぐ」を選ぶと
#             引き継ぎ元PJセレクタ（`CustomSelect`。`status`が completed/archived、または終了日が
#             過去のPJも候補に含め、過去のものは一覧上でdim表示＋ステータスmeta表示。is_deletedのみ
#             除外）→ 選択PJのタスクチェックリスト（親の下に子をインデント表示・既定は全チェックON、
#             ただし元PJでdone/cancelledのタスクは既定OFF＝`isCompletedForProgress`を流用・
#             全選択/全解除ボタン・スクロール領域maxHeight 220pxでモーダルが縦に伸びすぎないように）
#             が出る。チェック状態は引き継ぎ元PJを切り替えた時だけ既定値に再初期化する
#             （`useAppStore.getState()`の直接読みで、rawTasksの参照変化＝他人の無関係な編集では
#             リセットされないようにした）
#      純粋関数（新規 `src/lib/project/`。全てユニットテスト付き）：`dateSlide.ts`の
#             `computeSlidedDate`（日付スライド計算。元タスク日付なし→null、元PJ開始日なし→
#             スライドせず元の日付のままを返す、の2つの境界ケースを明示的に処理）／
#             `taskInheritance.ts`の`defaultCheckedTaskIds`（`isCompletedForProgress`基準の既定
#             チェック集合）・`buildInheritedTasks`（チェック済みタスク→新規Taskオブジェクト一式。
#             親子は「両方チェック時のみ」新IDで張り替え、親が未チェック／親が引き継ぎ元PJの範囲外
#             〈他PJの親を持つタスク〉のいずれの場合も、idMapに親が無いという同じ経路で自然に
#             「親なしのトップレベルタスク」に解決される＝特別扱い不要）・`buildInheritedDependencies`
#             （先行・後続の両方がidMapに存在する組だけを新ID同士のペアで返す）。ID採番は
#             `generateId: () => string`を呼び出し側から注入する設計にし、テストは決定的な
#             採番関数で検証（純粋関数としてテストしやすくするため）
#      引き継がない設計（意図的）：`baseline_start_date`/`baseline_due_date`（新PJで新たに凍結される
#             べきため明示的にコピーしない。`saveTask`のchoke pointが新しい日付から自動的に凍結する）・
#             `finalized_mentions`（誤通知防止）・`todo_ids`（OKR紐づけ。OKRモード全面刷新方針
#             〈2026-07-22決定〉のため引き継がない）・マイルストーン／PJのTF紐づけ／member_roles等の
#             PJ属性（今回はタスクの引き継ぎに絞り、スコープ外）
#      choke pointへの配慮：タスク作成は全て`appStore.saveTask`/`addTaskDependency`経由（直接
#             Supabaseを叩かない）。大量タスクの連続作成でB3自動リスケ連鎖を誤発火させないよう
#             全件`{ skipCascade: true }`を付ける（依存関係はタスク作成後にまとめて張るため、作成
#             時点では対象タスクに依存の相手がまだ存在せずcascade自体は元々no-opだが、安全側かつ
#             無駄な計算を避けるため明示的にskip）。保存順序は「親を先に保存→子を保存→依存関係を
#             追加」（FK制約対応。既存`QuickAddTaskModal`の子タスク一括作成と同じ順序）。B1（依存
#             ゲート）・B4（ベースライン捕捉）・v2.75（親自動完了）は新規作成時の通常の`saveTask`
#             経路をそのまま通るため無改造で自動的に効く（親自動完了は新規子タスクが全てtodoのため
#             実質発火しない）
#      失敗時の割り切り：個々の`saveTask`/`addTaskDependency`が失敗しても他は止めない
#             （`Promise.allSettled`。B3カスケード等と同じ「最善努力＋失敗はトースト」方針）。親の
#             保存が失敗した子は、ダングリングした`parent_task_id`のままだとFK違反で確実に失敗する
#             ため親なしとして保存を試みる。1件以上失敗した場合は「PJは作成されたが、タスクはN/M件
#             しか引き継げなかった」旨をエラートーストで通知（不足分は編集画面から手動追加を案内）。
#             `group_id`は他の新規作成同様`saveTask`/`addTaskDependency`が現在のグループを自動注入
#      Section 8是正：「PJ作成モーダル」の実態が「3ステップウィザード」のまま古かった記述を
#             「単一ステップフォーム（作成方法トグルで他PJからのタスク引き継ぎに対応）」に修正
#      テスト：`src/lib/project/__tests__/dateSlide.test.ts`（7件）・`taskInheritance.test.ts`
#             （13件）を新規追加（計20件）。既存テストも全通過（合計484件）。`npx tsc --noEmit`
#             エラー0／`npx eslint src`は変更前と同じ35件（24エラー・11警告、既存の無関係な指摘の
#             み。新規エラー0件）／`npm run build`成功
#      DBマイグレ不要（既存テーブル・既存カラムのみ使用）
#
# v2.84 fix: 部署拡大に向けたオンボーディング経路の是正（M25対応）（2026-07-22）
#      背景（既知課題M25。第12回リファクタ巡回2026-07-21で発見）：RLS（20260702b/c）は
#             「自分のgroup_idと一致するか、super-adminか」でしか可視性を判定できないため、
#             まだmembersに登録されていない認証ユーザーにはmembers/projects/tasksが0件に
#             見える（current_member_group_id()がNULLを返し、比較がNULL=偽になるだけ）。
#             ところがApp.tsx側は「DBにmembersが0件＝初回セットアップ（システムが空）」と
#             誤認し、SetupWizardを表示していた。これは「システムに他の誰かが既にいるが、
#             自分がまだ登録されていないだけ」のケースと区別がつかない、クライアント側だけ
#             では解決不能な問題（RLSを迂回するサーバー側判定が必須）。
#      ①未登録ユーザーをSetupWizardに入れない：新規マイグレーション
#             `20260722_add_onboarding_bootstrap.sql`で`is_system_bootstrapped()`
#             （SECURITY DEFINER・SET search_path=''・真偽値のみ返す・
#             GRANT EXECUTE TO authenticated）を追加。App.tsxの`AuthenticatedApp`は
#             `isWizardDone`がfalseになるケースに限りこの関数を呼び、
#             false（本当に空）→SetupWizard／true（既に誰かいる）またはerror
#             （関数呼び出し失敗＝マイグレ未適用等）→新設`AccessDeniedScreen`
#             （ログイン中のメールアドレス表示・管理者への登録依頼案内・ログアウトボタン）
#             を表示。**安全側の判断**：populated/errorのいずれも一律アクセス拒否側に倒した。
#             理由＝ここで誤ってSetupWizardを出すと、未登録の第三者がgroup_id無しの宙に
#             浮いたメンバー行を作ろうとする経路を開いてしまう（実際にはRLSのWITH CHECKで
#             `group_id = current_member_group_id() OR is_super_admin()`が両辺NULLで
#             弾くため保存自体は失敗するが、ユーザーに不親切な失敗を見せるより最初から
#             正しく案内する方が安全かつ親切）
#      ②本当の初回セットアップ（membersが0件）でgroup_idを正しく設定：同マイグレーションに
#             `bootstrap_first_group_and_member(p_group_name, p_display_name, p_short_name,
#             p_initials, p_color_bg, p_color_text)`（SECURITY DEFINER）を追加。
#             「membersが0件のときに限り」部署（groups）作成＋最初のメンバーを
#             is_admin=true かつ is_super_admin=true として作成する。emailはクライアント
#             引数からではなく必ずauth.email()から取得（なりすまし防止）。
#             **安全性の要**：関数内の「membersが0件」ガードが、2回目以降にこの関数が
#             呼ばれて誰でもsuper_adminになれてしまう穴を防ぐ唯一の防波堤（0件でなければ
#             例外を投げて何もしない）。同時呼び出しのTOCTOUレースは
#             `pg_advisory_xact_lock`で直列化。`SetupWizard.tsx`は部署名入力欄を追加、
#             メンバーリストの先頭（有効な）1件を「あなた」として上記関数に渡し、
#             残りは通常の`saveMember`（ブートストラップ後はcurrentGroupIdが設定され
#             自分がsuper-adminのため通常のRLSで通る）。既存の入力項目・体裁は維持
#             （多人数登録・アバター選択等は無改造）
#      ③運用手順のドキュメント化：`docs/guides/05_admin/departments-and-members.md`
#             新設（URLを送るだけでは使えない・先にメンバー登録してから本人がサインアップ
#             する順序・メールアドレス一致が紐づけの鍵・新部署追加はAdminViewの既存
#             「＋部署を追加」機能で可能、を明記）。`docs/guides/03_roles/admin.md`の
#             ダングリング参照（存在しない`admin.members`モードキー）を是正し新ページへ
#             リンク、実態と乖離していた「全テーブルauthenticated full access方針」の
#             記述も是正（members/projects/tasks/groups/task_dependenciesは部署分離済み、
#             それ以外のOKR系テーブルのみ未対応、と正確化）
#      Section 1.6追記：新しいオンボーディング経路（is_system_bootstrapped /
#             AccessDeniedScreen）とブートストラップ関数（bootstrap_first_group_and_member）
#             の説明を追加
#      既存ユーザーへの影響：EGG等、既にmembersが1件以上ある環境は
#             `is_system_bootstrapped()`が常にtrueを返すため`SetupWizard`には到達せず、
#             `bootstrap_first_group_and_member()`もmembers非0件で必ず拒否される
#             （既存ログイン・自動マッチングへの影響なし）
#      マイグレ適用要（山本さんが手動でSupabase SQL Editorに全文貼付）：
#             `supabase/migrations/20260722_add_onboarding_bootstrap.sql`
#             （`supabase/schema.sql`にも同内容を反映済み・drift防止）
#      テスト：既存テスト全484件が無改造で通過（新規ロジックはRPC呼び出し・UI分岐が
#             中心でありSupabase実インスタンス無しに意味のある単体テストが組みにくいため
#             新規テストは追加していない。`npx tsc --noEmit`エラー0／`npx eslint src`は
#             変更前と同じ35件（新規エラー0件）／`npm run build`成功
#
# v2.85 feat: 複数部署アクセス（メンバーの兼務・プロジェクトの部署横断）フェーズ1＝DBマイグレーションのみ（2026-07-22）
#      背景：山本さん自身がAID・EGGの2部署を掛け持ちする中、新部署作成時にメールアドレスの
#             重複エラー（`23505 members_email_unique`）に遭遇。members/projects/tasksが
#             いずれも「1つの部署（group_id）」しか持てない設計のため。プラン正本＝
#             `quirky-exploring-sundae.md`（2026-07-03山本さん承認済み）。今回はプランの
#             「⑤ロールアウト順序」に従い、フロントエンド（appStore.ts/AdminView.tsx/部署
#             切替UI等）には一切手を入れず、DBマイグレーションのみを先行適用する
#      追加：`members.group_ids`/`projects.group_ids`/`tasks.group_ids`（text[]。既存の
#             `group_id`＝ホーム部署は不変・並存）。バックフィル済み。CHECK制約
#             （`group_id IS NULL OR group_id = ANY(group_ids)`、members/projectsのみ）。
#             `current_member_group_ids()`（新設ヘルパー）。RLS（members_group/
#             projects_group/tasks_group）を単一値比較→配列オーバーラップ(`&&`)に置き換え
#             （super-admin全部署アクセスの条項は維持）。`tasks.group_ids`はDBトリガー
#             （`sync_task_group_ids`）が唯一の真実（プロジェクト紐づきはPJのgroup_idsを
#             継承・独立タスクはホーム部署のみ）。`projects.group_ids`変化時は配下タスクへ
#             カスケード反映（`cascade_project_group_ids_to_tasks`）。`guard_member_privilege_columns`
#             拡張（group_idsの直接付与・剥奪はsuper-admin限定。非super-adminのホーム部署
#             付け替え時はgroup_idsを新ホームのみへリセット）。`guard_group_deletion`拡張
#             （追加部署アクセスとしてのみ所属するメンバーも非空判定に含める）
#      マイグレ適用要（山本さんが手動でSupabase SQL Editorに全文貼付）：
#             `supabase/migrations/20260722b_add_multi_department_access.sql`
#             （`supabase/schema.sql`にも同内容を反映済み・drift防止）
#      次フェーズ（未着手）：appStore.ts（selectScopedTasks/selectScopedProjectsの
#             super-admin以外フィルタなし化）・AdminView.tsx（複数部署選択UI・部署切替UI）・
#             生のDBエラーを分かりやすい文言に変換、を別セッションで実施
#      DBマイグレ未適用（山本さんの手動適用待ち）。フロントエンドは無変更のため
#             `npx tsc --noEmit`／`npm run build`とも影響なし（確認済み）
#
# v2.86 feat: 設定画面に部署絞り込みセレクタ＋「＋追加」フォームのポップアップ化（2026-07-23）
#      背景：2026-07-22〜23の一連のRLS是正（v2.85直後・本ファイル未反映分）で
#             members/projects/tasks等が実効的に部署スコープ化された結果、全社スーパー管理者
#             （山本さん）には設定画面上で全部署のメンバー・PJ・タグ・AI使用量が横断表示され、
#             逆に見づらくなった。加えて「＋追加」ボタンがセクション最下部にインライン展開される
#             UIのため、メンバー追加フォームの表示に気づきにくいという指摘も受けた
#      追加：AdminView.tsxの設定画面ローカル部署セレクタ（`selectedGroupId`・useState）。
#             **アプリ全体の`currentGroupId`（ダッシュボード/ガント等の表示部署）とは独立**
#             （連動させない設計）。表示条件＝現在のユーザーがアクセス可能な部署が2つ以上
#             （super-adminなら全部署／それ以外は`group_ids`保有部署）。既定値＝自分の
#             ホーム部署（`group_id`）。1部署のみのユーザーには表示しない（従来どおり自部署のみ）
#      絞り込み対象：メンバー（`group_ids`にその部署を含む人。`scopedMembers`）・
#             プロジェクト（同様。`selectScopedProjects`＝アプリ全体currentGroupId基準の依存を外し
#             `s.projects`を素で取得→ローカル`selectedGroupId`で絞り込みに変更）・
#             AI使用量（ログを打ったメンバーが選択部署に属するかで`scopedLogs`にフィルタ）・
#             タグの「メンバー選択」ピッカーのみ（タグ実体`member_tags`は部署概念のない全社共通
#             マスタのため、タグ一覧自体は従来どおり全社共通表示のまま・意図的にスコープ外）
#      絞れない：TF・OKR（`TaskForce`/`Objective`/`KeyResult`はいずれも`group_id`列を持たず、
#             KRの下にTF・全社共通のOKR構造という設計のため技術的にスコープ不可能。方針どおり
#             全社共通表示のまま・無理に絞らない）
#      新規追加時の所属部署：メンバー・PJとも新規作成の初期`group_id`を選択中の部署
#             （`selectedGroupId`）に変更（従来は`groups[0]`固定、またはPJはアプリ全体の
#             `currentGroupId`＝自分のホーム部署に暗黙補完される実装だったため、他部署を見ながら
#             追加したPJが自分の部署に紛れ込む事故になり得た。PJ新規作成時は`group_id`を明示送信
#             するよう修正。members/projectsとも`group_ids`はDBトリガーが`group_id`から自動正規化
#             するためフロントから明示送信不要）
#      追加：`src/components/admin/AdminFormModal.tsx`（マイルストーン追加モーダルと同じ
#             演出＝`position:fixed inset:0`＋`animate-overlay`＋`panel-slide-up`＋
#             `var(--color-*)`の汎用モーダルシェル。バリデーション・保存ロジックは一切持たない）
#      モーダル化した「＋追加」フォーム：メンバー・プロジェクト・Task Force・メンバータグの
#             新規登録フォーム（`MemberFormFields`/`ProjectFormFields`/TF新規作成フィールド/
#             `TagFormFields`として各既存インラインJSXをそのまま抽出→編集用インラインパネルと
#             追加用モーダルの両方から呼ぶ共通部品化。バリデーション・保存・DangerZone・
#             権限ゲートのロジックは一切変更せず、見た目の器だけを分離）。既存の「クリックして
#             編集」の編集フォームは従来どおりインライン表示のまま（対象は「＋追加」の新規登録）
#      補足：今回の絞り込みロジックが依拠する`group_ids`（複数部署アクセス・migration
#             20260722b）は、v2.85時点では「DBマイグレのみ・未適用」だったが、本日
#             （2026-07-22〜23）の一連のRLS是正作業で既に本番適用済みと確認済み（詳細は
#             本セクション上部「複数部署アクセス＝フェーズ1」の追記を参照）
#      DBマイグレ不要（フロントのみ）。テスト：既存テスト全484件が無改造で通過（部署絞り込みは
#             UI分岐が中心でSupabase実インスタンス無しに意味のある単体テストが組みにくいため
#             新規テストは追加していない）。`npx tsc --noEmit`エラー0／`npx eslint src`は
#             変更前と同じ35件（新規エラー0件）／`npm run build`成功
# v2.87 fix: 初回ログイン時のテーマ初期値をライトモード固定に（2026-07-23）
#      背景：`src/hooks/useTheme.ts`の`getInitialTheme()`が、localStorage未設定時（＝初回ログイン）に
#             `window.matchMedia("(prefers-color-scheme: dark)")`でOS設定に従っていたため、OSが
#             ダークモードの人は本人の意思に関わらず初回からダーク表示になっていた
#      変更：未設定時は常に`"light"`を返すよう修正（`prefers-color-scheme`の参照を撤去）。
#             一度でも手動でテーマを切り替えた人（＝localStorageに`"light"`/`"dark"`が保存済み）は
#             従来どおりその値を尊重するため、既存ユーザーの設定への影響は無い
#      補足：ヘッダーコメントの「OSのカラースキーム設定を初期値として使用する」も実態に合わせて修正
#      DBマイグレ不要。既存テスト全484件が無改造で通過。`npx tsc --noEmit`エラー0
# v2.88 fix: 初回ログインのガイドツアーを最新化・7〜9ステップに整理（M19/M20対応）（2026-07-23）
#      背景：`src/components/tour/tours/first-time.ts`（旧11ステップ）が実際のアプリと乖離していた：
#             ①「4つのビュー」と説明していたが実際はワークロードビューを含め5つ ②OKR管理モードの
#             説明（①会議ノート→②セッション→③レポートの3ステップ運用）が、全面刷新方針決定
#             （[[project_task_manage]]参照）により近く無くなる内容のまま残っていた ③`docs/REFACTORING.md`
#             のM19（`tour-guidelines.md` §9の上限7〜9ステップを超過）・M20（タイトル絵文字の
#             付け方が§4基準からズレ）が未解消のまま
#      変更：「sidebar」＋「nav」の2ステップを1ステップに統合（左メニュー概要＋5ビュー
#             〈ダッシュボード／カンバン／ガント／リスト／ワークロード〉をまとめて説明）。
#             「ai-mode-meeting」（資料インプットタブの個別スポットライト）は「ai-tool-btn」の
#             説明文（元々2モードに言及済み）に統合し独立ステップを削除。「okr-mode」ステップは
#             全面刷新方針決定済みのため削除（「作り直し予定の機能をツアーで大々的に説明しない」
#             方針）。最終ステップ「done」の振り返り文からもOKR言及を削除
#      結果：welcome〜doneの**9ステップ**に整理（tour-guidelines.md §9の上限7〜9の範囲内）。
#             各ステップが説明する機能は実装コードと突き合わせて実在確認済み
#      M20対応：統合後の「sidebar」タイトルに絵文字1個（🗂️）を付与、「pj-karte-btn」
#             （旧「📊 ここが「✨ AI分析」ボタンです」＝絵文字2個）を「📊 ここが「AI分析」
#             ボタンです」に修正し1個に統一。`docs/REFACTORING.md`のM19/M20を解消済みに更新
#      DBマイグレ不要。既存テスト全484件が無改造で通過。`npx tsc --noEmit`エラー0
# v2.89 feat: AI体験デモを実データ活用型に（未登録部署はフォールバックあり）（2026-07-23）
#      背景：`MainLayout.tsx`のツアー実演（`demo-ai-consult`）が送る質問が「計画管理を始めます。
#             タスクはどれくらいの細かさで登録すると管理しやすいですか？」という一般論固定で、
#             保存済みのPJ・タスクを一切活かせていなかった。AI相談は実際のPJ・タスクを踏まえた
#             回答が本来の価値だが、デモでその価値が伝わっていなかった
#      変更：`MainLayout.tsx`に`tasksRef`（`selectScopedTasks`ベース・非削除）を新設し、既存の
#             `projectsRef`（`selectScopedProjects`ベース）と合わせて`demo-ai-consult`実行時に
#             部署スコープ済みのPJ/タスクが1件でもあるか判定。ある場合は「今登録されているタスクの
#             中で、優先的に進めるべきものと、遅れそうなものを教えて。次の一手も教えてください。」
#             という既存データの分析を促す質問に、無い場合（できたての部署・未登録）は従来どおり
#             「これから計画管理を始めます。最初にどんな単位でプロジェクトやタスクを作ると、
#             後で管理しやすいですか？」という始め方の質問にフォールバック
#      仕組み：AI相談パネル（`ConsultationPanel`→`payloadBuilder.buildPayload`）はデモかどうかに
#             関わらず元々スコープ済みのPJ/タスクをコンテキストとして常に送信済み。今回の変更は
#             「送る質問文」をそのコンテキストが活きる内容に出し分けるのみで、コンテキストの
#             渡り方自体は無改造
#      判定はハードコードの分岐（`projects.length > 0 || tasks.length > 0`）。凝った出し分けはしない
#      ツアー側：`first-time.ts`の`ai-consult-demo`ステップの本文を実データ有無どちらにも
#             触れる内容に更新（v2.88で実施済み）
#      DBマイグレ不要。既存テスト全484件が無改造で通過。`npx tsc --noEmit`エラー0
# v2.90 fix: ユーザー選択画面の不要表示抑止＋一覧のスクロール収め（2026-07-23）
#      問題①：`App.tsx`の`AuthenticatedApp`は`autoMatch()`（Auth emailで`members.email`と照合する
#             **非同期**処理）でログインユーザーを自動特定するが、描画側は`!currentUser && !loading`
#             の一発判定でUserSelectScreenを出していたため、メールが一致するユーザーでも
#             「データロード完了〜autoMatchの非同期判定が終わるまでの一瞬」に選択画面が
#             チラつく／出てしまっていた
#      変更①：`matchState`（"matching"|"matched"|"unmatched"）を新設。autoMatchのeffectが
#             走るたびに"matching"にリセットし、①email一致 or ②localStorage復元のどちらかが
#             成立したら"matched"（同時にonLogin）、どちらも不成立と判明した時点でのみ
#             "unmatched"に確定する。描画側は`matching`中はローディングスピナー、
#             `unmatched`確定後にのみUserSelectScreenを出すよう分岐を追加
#      結果①：メールが`members.email`と一致するユーザー（山本さん含む）はUserSelectScreenが
#             二度と表示されなくなる。email/localStorageのどちらも一致しない人だけが対象のまま
#      問題②：`UserSelectScreen.tsx`はカードに`min-height:100vh`のみでメンバー一覧に
#             スクロール領域が無く、部署横断RLS対応後はsuper_admin（全部署の全メンバーが
#             一覧表示）で人数が多いと一覧が画面外にはみ出し、下部のユーザーやゲストボタンが
#             クリックできなくなっていた
#      変更②：カードを`display:flex; flex-direction:column; max-height:calc(100vh - 48px);
#             overflow:hidden`にし、メンバー一覧（`others.map`のコンテナ）のみ
#             `overflow-y:auto; min-height:0`のスクロール領域に。ロゴ・前回ユーザー・
#             「あなたはどなたですか？」・空メンバー時の回復オプション・ゲストボタン・注記は
#             すべて`flexShrink:0`でスクロール対象から除外し、常に画面内に表示され続ける
#      結果②：一覧が多くてもカード自体は画面内に収まり、一覧部分だけが内部スクロール。
#             ゲストボタン・区切り線・見た目（余白・角丸・影・トークン）は無改造
#      厳守事項：Auth email自動マッチング・localStorage復元・ゲストモード・
#             SetupWizard/AccessDeniedScreenの分岐（bootstrapStatus・M25対応）は無改造
#      DBマイグレ不要。既存テスト全484件が無改造で通過。`npx tsc --noEmit`／`npx eslint src`エラー0
#
# v2.91 feat: 複数部署アクセス（メンバーの兼務・プロジェクトの部署横断）フェーズ2＝フロント対応（2026-07-23）
#      背景：v2.85でDBマイグレーション（`group_ids`列・RLS配列化・トリガー）のみ先行適用済み
#             だったフェーズ2。プラン正本＝`quirky-exploring-sundae.md`。今回appStore.tsのコア部分は
#             統括Claudeが先行実装（`currentUserIsSuperAdmin` state/setter・`selectScopedTasks`等
#             4セレクタの分岐）し、developerがApp.tsx配線・部署切替UI・回帰テストの続きを担当した
#      appStore.ts（統括が先行実装・今回コミットに含める）：`currentUserIsSuperAdmin: boolean`
#             state・`setCurrentUserIsSuperAdmin`を新設。`selectScopedTasks`/`selectScopedProjects`/
#             `selectScopedTaskDependencies`/`selectScopedMembers`を「super-adminは従来通り
#             `group_id===currentGroupId`で絞る、非super-adminは一切フィルタせず元配列を同一参照で
#             返す」に分岐。理由：非super-adminはRLSが既に「自部署＋兼務先」だけを返しているため、
#             クライアントで単一値比較を重ねると兼務2部署目がUIから消えてしまう（新機能が画面上
#             機能しなくなる）ため
#      変更：`App.tsx`の`AuthenticatedApp`内`autoMatch()`（Auth email一致・localStorageフォールバックの
#             2箇所）で`setCurrentGroupId`と併せて`setCurrentUserIsSuperAdmin(matched.is_super_admin
#             === true)`を呼ぶよう配線。これを怠るとセレクタが常に非super-adminパスになり、
#             super-adminでも複数部署のデータが混在表示されてしまう
#      追加：サイドバー（`MainLayout.tsx`の`Sidebar`）に「表示部署」切替UI（`CustomSelect`）。
#             アクセス可能な部署（super-adminは全部署、それ以外は自分の`group_ids`。無ければ
#             `group_id`にフォールバック）が2件以上のときだけ表示（AdminViewのローカル部署絞り込み
#             セレクタと同じ判定ロジックを踏襲）。選択で`currentGroupId`を切り替える。折りたたみ時は
#             非表示（ラベル文言が入らないため）。リロードで揮発（永続化しない）＝App起動時の
#             autoMatchで毎回ホーム部署に戻る既存挙動をそのまま利用
#      設計判断（割り切り）：super-adminはこの切替でダッシュボード/ガント/カンバン/リストの表示
#             部署そのものが切り替わる（selectScopedがcurrentGroupIdで絞るため）。非super-adminの
#             兼務者は選択してもselectScopedが絞り込みをしないため、この切替UIは「新規作成時の
#             デフォルト所属部署を選ぶ」程度の意味にとどまり、表示（自部署＋兼務先が常に全部見える）
#             は変わらない。兼務2部署目が消えないことを最優先した意図的な割り切り
#      AdminViewには手を入れていない（v2.86で追加済みのローカル部署絞り込みセレクタ`selectedGroupId`
#             とは別物・非連動のまま。同一画面に両方出て紛らわしくなる懸念はあるが今回は変更しない）
#      確認：`store.ts`の`upsertProject`/`upsertMember`は`group_ids`をペイロードから除外していない
#             ことを確認済み（`owner_member_ids`除外の既知バグと同種の罠を警戒したが該当なし。
#             `upsertProject`は`owner_member_ids`のみ除外、`upsertMember`は無加工でそのまま送信）
#      テスト：`scopedSelectors.test.ts`に回帰テストを追加。①非super-adminで`selectScopedTasks`が
#             `s.tasks`と同一参照を返す（`toBe`）②非super-adminで`currentGroupId`と異なる`group_id`の
#             タスクが除外されずに含まれる（兼務2部署目が消えない直接防止）③super-adminは従来通り
#             `currentGroupId`一致＋`group_id==null`のみに絞られる。既存の`selectScopedMembers`絞り込み
#             テストは`currentUserIsSuperAdmin`分岐の影響を受けるため`currentUserIsSuperAdmin: true`を
#             明示するよう更新（更新しないと新しい分岐で非super-adminパスに落ちて失敗する）
#      DBマイグレ不要（v2.85で適用済みの`20260722b_add_multi_department_access.sql`のみ）。
#             `npx tsc --noEmit`／`npx eslint src`（既存35件のまま新規エラー0）／`npm run build`成功。
#             テスト全487件（既存484件＋今回追加した回帰テスト3件）通過
# v2.92 feat: KintoneのOKR（PDF/テキスト）を読み込んでObjective/KR/TFを自動登録（2026-07-23）
#      背景：山本さんの要望「OKRの登録が面倒。Kintoneで記録しているOKR画面をPDF化して読み込ませる
#             だけで、計画ビューの設定に必要なObjective/KR/TFを自動登録したい」。既存の「資料インプット」
#             （`MeetingImportPanel.tsx`＋`meetingExtractor.ts`）と同じ作法（PDFはdocumentブロックで
#             添付・AI抽出→人が確認・編集→登録のHuman-in-the-loop）を踏襲。OKRモードは将来「全面刷新」
#             予定だが、KR/TFの骨組み自体は刷新後も必要なため、今回の実装は刷新時にも活きる想定
#      マッピング（Kintoneの器→現行アプリのエンティティ）：年度・範囲・Purpose・設定の意図/背景→
#             Objective（1件）／KR1,KR2...→KeyResult（複数）／KR1-TF1,TF2...→TaskForce（複数、
#             description/backgroundにTFの目的・検証プロセス要約を格納）／担当OM・リーダーの氏名→
#             TaskForce.leader_member_id（メンバー突合）。評価基準バンド・ロジックモデル・5W1H・
#             月次タスク/ToDoレベルは今回のスコープ外（刷新時に別設計）
#      追加：`lib/ai/okrImportExtractor.ts`（AIIntent="okr-import"を新設・invokeAI.tsに追記）。
#             SYSTEM_PROMPTでKintoneのフィールド→Objective/KeyResult/TaskForce構造への抽出ルールを
#             明示、抽出しないもの（評価基準バンド等）も明記。meetingExtractor.tsと同じ手書き
#             バリデーション（`validateOkrImportAnalysis`）。テスト`__tests__/okrImportExtractor.test.ts`
#             （invokeAIをモック化・8件）
#      追加：`lib/okr/okrImportMatch.ts`の`matchMemberByName`（氏名ヒント→既存メンバーの純粋関数）。
#             完全一致（display_name/short_name）→部分一致（1件のみヒット時のみ採用、複数ヒットは
#             曖昧としてnull）の順で判定し、未登録者を勝手に新規メンバー登録しない設計。
#             テスト`lib/okr/__tests__/okrImportMatch.test.ts`（6件）
#      追加：`components/admin/OkrImportModal.tsx`（AdminViewのOKRセクション最上部に「📄 PDFから
#             取込」ボタンを新設し起動）。入力（PDF/Word/テキスト）→AI解析→確認・編集→登録の4ステップ。
#             確認画面で「登録先」を選択（既定＝新しい期のObjectiveとして作成／既存のObjectiveに追記）、
#             既存追記時はKRごとに「新規KRとして追加」または既存KR（同一Objective配下）への紐づけを
#             選べる。KR/TFはチェックボックスで取捨選択・全項目編集可（TF番号/名称/詳細/背景/
#             クォーター/担当リーダー）。担当リーダーはmatchMemberByNameの自動マッチ結果を初期選択
#             （曖昧・不一致時は空欄＝CustomSelectで手動選択 or 未設定のままスキップ）
#      二重登録防止：「新しい期のObjectiveとして作成」を選ぶと、新規Objective（is_current:true）を
#             作成すると同時に、既存の現在Objectiveがあれば`is_current:false`に更新する（appStoreは
#             `is_current`な1件だけを「現在のObjective」として扱う設計のため、旧Objectiveを残したまま
#             is_currentを外さないと「現在のObjective」が不定になる）。既存の`saveObjective`/
#             `saveKeyResult`/`saveTaskForce`をそのまま使用（スキーマ・保存ロジックは無改造）
#      機微情報対応：山本さんのサンプルPDF（経営確認事項・熊野メッセージ等を含む）は一切コミット
#             していない。テストは架空メンバー名・架空OKRタイトルの最小データのみ使用
#      DBマイグレ不要（既存のobjectives/key_results/task_forcesテーブルをそのまま使用。列の追加なし）。
#             `npx tsc --noEmit`／`npx vitest run`（全501件通過）／`npx eslint src`（既存35件のまま
#             新規エラー0）／`npm run build`成功
#
# v2.93 fix: OKR PDF取込のJSON解析を堅牢化（実データで解析失敗が発生したため）（2026-07-23）
#      症状：実際のKintone OKR資料を読ませたところ「AI解析に失敗しました Expected ',' or '}'
#             after property value in JSON at position 75」。エラー位置が冒頭のため出力切れ
#             （truncation）ではなく、AIが文字列値内の引用符をエスケープし損ねた不正JSONが主因。
#             OKR原文は「」や"が多くJSON破壊が起きやすい（会議取込より顕在化しやすい）
#      修正1（プロンプト・`okrImportExtractor.ts` SYSTEM_PROMPT）：JSONの厳格な作法を明記
#             （二重引用符は\\"でエスケープ／日本語引用は「」を使いASCII"を値に含めない／生改行禁止
#             ／末尾カンマ禁止／不明はnull）。source_quoteを30→20字に短縮し引用符混入源を減らす
#      修正2（`parseJsonSafe`）：フェンス除去後、最初の { 〜 最後の } を切り出してからパースする
#             （前後に説明文が混じっても本体だけを取り出せる）
#      修正3（`extractOkrImportData`）：パース/検証失敗時に1回だけ自己修正リトライ（直前の不正出力を
#             assistantロールで渡し、エラー理由を添えて厳密JSONで出し直させる）。リトライも同じ
#             `okr-import` intentで使用量計測に乗る。max_tokensも4096→8192に拡大（大きなOKRの出力切れ対策）
#      テスト：`okrImportExtractor.test.ts`に2件追加（前後に説明文が混じっても本体抽出／1回目不正JSONでも
#             リトライで救済され計2回invokeAIが呼ばれる）。計503件通過。eslint既存35件のまま新規0・build成功
#      DBマイグレ不要（フロントのみ）
#
# v2.94 feat: OKR/TFの部署別表示（2026-07-23）
#      背景：設定画面で表示部署を変えても、TF/OKRは全社共通のまま表示されていた
#             （objectives/key_results/task_forcesがgroup_id非対応だったため。v2.86で
#             既知の制約として記録済み・Section 1.6のG課題）
#      データモデル：objectives.group_id（text・nullable）を追加。KR/TFはgroup_id列を
#             追加せず、KR→objective_id、TF→kr_id→KRを辿ってObjectiveの部署を継承する
#             （src/lib/okr/deptScope.ts の pickCurrentObjectiveForGroup /
#             keyResultsInGroup / taskForcesInGroup に一元化）。既存Objectiveは全て
#             grp-eggへバックフィル（migrations/20260723b_add_objective_group_id.sql・
#             要適用）。RLSは今回変更しない（objectives/key_results/task_forcesは
#             引き続き「authenticated full access」のまま＝表示の絞り込みのみ）
#      is_currentの部署別化：`appStore.ts`の`objective`は「currentGroupId（表示中の
#             部署）の現在Objective」を表す派生値に変更（旧：`objectives.find(o=>o.is_current)`
#             というグローバル1件抽出）。`objectives`配列（全部署・全期分）を新設し、
#             load()のPhase2完了時・setCurrentGroupId()・saveObjective()のたびに
#             pickCurrentObjectiveForGroupで再導出する。OkrDashboardView等のOKRモード
#             画面群・useAIConsultation.tsは`s.objective`を今まで通り読むだけで部署
#             スコープの恩恵を受ける（個別変更不要。OKRモードは全面刷新まで現状維持の方針）
#      スコープ絞り込み：AdminView「Objective・KR」「Task Force」タブは設定画面ローカルの
#             `selectedGroupId`で、そのObjective配下のKR/TFだけ表示（左ナビのバッジ数・
#             初期タブ選択も追従）。`key={selectedGroupId}`で部署切替時に両セクションを
#             再マウントし、編集中フォームが前の部署の内容を引きずらないようにした。
#             MainLayoutサイドバー「OKRタスク」KR一覧は`currentGroupId`（表示中の部署）で
#             スコープ。新規Objective/KR/TF作成時のgroup_idもそれぞれの部署コンテキストを使う
#      OKR PDF取込：`OkrImportModal`に`targetGroupId`props新設（AdminViewの
#             selectedGroupIdを渡す）。ctxObjをアプリ全体のcurrentGroupIdからではなく
#             targetGroupIdから導出するよう変更（設定画面で別部署を見ながら取り込む
#             ケースを想定）。新規Objectiveのgroup_id=targetGroupId。is_currentフリップ
#             （旧Objectiveをfalseにする）は対象がtargetGroupIdの現在Objective1件に
#             限定されるため、他部署を巻き込まない
#      回帰テスト：`lib/okr/__tests__/deptScope.test.ts`（8件・純粋関数の部署絞り込み網羅）・
#             `stores/__tests__/objectiveDeptScope.test.ts`（4件・Supabaseモックで
#             setCurrentGroupId/saveObjectiveの部署スコープとis_currentフリップの
#             部署限定を検証）。計515件通過。eslint既存35件のまま新規0・build成功
#      Section 1.6・Section 9のG課題を本変更に合わせて更新（下記参照）
#      未対応（今回のスコープ外）：PJセクションの「紐づけるKR/TF」ピッカー（PJ編集
#             フォーム内）は部署絞り込みをまだ入れていない（全社共通表示のまま）。
#             OKR系テーブルのRLS部署分離もOKR全面刷新時にまとめて対応する方針のまま
#             【2026-07-24追記】この「PJ編集フォームのピッカー未対応」およびタスク側の
#             同種ピッカー（TaskEditModal等）はv3.02で対応済み（詳細はv3.02 changelog参照）。
#             OKR系テーブルのRLS部署分離は引き続き未対応・別フェーズのまま
#
# v2.95 feat: メンバー編集に「アクセス可能な部署（複数可）」group_ids欄を追加（2026-07-23）
#      背景：山本さんが自分を2部署目（AID＋EGG）に入れようとして同じメールでもう1メンバーを
#             作ろうとし members_email_unique（23505）に衝突。正しくは既存メンバーの
#             group_idsに部署を追加（兼務）すべきだが、そのUIが無かった（DB・フロントの
#             スコープ/切替UIはv2.85/v2.91で実装済み。編集フォームだけ未対応だった）
#      UI：`AdminView.tsx`のMemberFormFieldsに「アクセス可能な部署（複数可）」欄を新設。
#             PJ編集フォームのオーナー／メンバー欄と同じ「チップ＋CustomSelectの
#             ＋追加」パターンを踏襲（新しいUIは発明していない）。ホーム部署
#             （「グループ」欄）のチップは×ボタンを出さず外せない。ホーム部署
#             （group_id）を変更すると自動的にgroup_idsにも追加する
#      権限分岐：この欄はDBトリガー guard_member_privilege_columns（migration
#             20260722b）がgroup_idsの直接付与・剥奪をsuper_admin限定にしているのと
#             一致させ、`currentUser.is_super_admin===true`のときのみチップの追加・削除
#             UIを表示し、それ以外は読み取り専用のバッジ表示（「複数部署の付与・変更は
#             全社スーパー管理者のみ行えます」の注記）にした。無駄な保存失敗を避ける
#      保存時の正規化：`MembersSection.save()`で`group_id`が`group_ids`に含まれない
#             場合は自動的に追加してから`saveMember`に渡す（DBのCHECK制約
#             members_group_id_in_group_idsと一致させる最終防波堤）
#      エラー文言：`members_email_unique`（23505）違反時、生のPostgrestエラーではなく
#             「このメールアドレスは既に別のメンバーに登録されています。同じ人を複数
#             部署に所属させたい場合は、そのメンバーを編集して『アクセス可能な部署』に
#             部署を追加してください」と案内するよう`isMemberEmailUniqueViolation()`
#             ヘルパーを新設し`MembersSection.save()`のcatchで検知（制約名＋コード
#             23505の両方一致を条件にし、他の一意制約違反を巻き込まない）
#      表示：メンバー一覧でgroup_ids.length>=2（兼務）のメンバーに「兼務（N部署）」
#             バッジを追加（軽微な視認性向上）
#      DBマイグレ不要（group_ids列・CHECK制約・トリガーは全てv2.85/20260722bで適用済み）。
#             検証：tsc/eslint（新規0・既存8件は変更前から存在）/vitest 515件全通過/build成功
#
# v2.96 fix: TaskForceの担当リーダー未設定でFK違反になるバグを修正（2026-07-23）
#      症状：OKR PDF取込で「登録する」を押すと途中で
#             「insert or update on table "task_forces" violates foreign key constraint
#             "task_forces_leader_member_id_fkey" — Key is not present in table members」。
#      原因：`task_forces.leader_member_id` はDB上 nullable（FK: members(id)）で「担当者未設定」が
#             正当な状態だが、型定義が `string`（非null）で、UI/取込が未設定時に空文字 "" を送っていた。
#             空文字はメンバーIDとして存在しないためFK違反になる。OKR取込（`OkrImportModal` 200行目
#             `matchMemberByName(...)?.id ?? ""`＝氏名突合失敗時）で顕在化したが、AdminViewの通常の
#             TF新規作成・編集でも担当者未選択なら同じFK違反になる潜在バグだった。
#      修正：`TaskForce.leader_member_id` を `string | null` に変更（DBの実態に合わせる）。保存経路で
#             空文字を null に正規化：OkrImportModal（TF作成）・AdminView（TF新規作成 line751・編集
#             保存 line774）の3箇所を `leader_member_id || null` に。編集フォーム初期化は
#             `tf.leader_member_id ?? ""`（フォーム内は空文字・保存時にnull変換で一貫）。
#             読み取り側（AdminView `members.find(m => m.id === tf.leader_member_id)`／
#             payloadBuilder同）は元から `.find` でnull/空でもundefinedになり安全＝無改造。
#      DBマイグレ不要（列は既にnullable）。検証：tsc 0/vitest 515件全通過/eslint 既存35件のまま新規0/build成功
#
# v2.97 fix: FAB展開時に「⌨ショートカット」ボタンと重なる問題を修正（2026-07-23）
#      症状：右下のFAB（＋ボタン）を押して展開すると、展開項目（AI相談/マイルストーン追加/
#             タスク追加の3つ）が、常設の「⌨ショートカット」ボタン（v2.52・zIndex140）と視覚的に重なる。
#      原因：ショートカットボタンのzIndex(140)がFAB展開項目(59)より高く、通常位置（PC:bottom100px/
#             モバイル:128px）のままだとFABの上に積み上がる展開項目に覆い被さっていた。
#      修正：`MainLayout.tsx`のショートカットボタンを、`isFabMenuOpen`中だけ展開項目の積み上げ範囲より
#             上（PC:bottom216px/モバイル:270px）へ退避させ、閉じたら元位置に戻す（bottomに0.2s
#             トランジション付き）。right退避（AI相談パネル開時）・Toast/ErrorBarとの非干渉は既存のまま維持。
#      DBマイグレ不要（`MainLayout.tsx`のみ）。検証：tsc 0/vitest 515件全通過/eslint 新規0/build成功
#
# v2.98 fix: TF「解除」でクォーターがDBに反映されない不具合＋DangerZone削除の防御強化（2026-07-23）
#      症状：設定画面のTaskForceタブで「不要なTFを削除しようとしても反応がない」と報告。
#      調査：TF行の見た目上の削除系操作は2つ（①「解除」＝現在のクォーターからTF.quarterを
#             未設定に戻すだけの操作、②編集フォームを開いた先のDangerZone「削除する」＝is_deleted論理削除）。
#             ②の削除自体のクリック連鎖（DangerAction→confirmDialog→appStore.deleteTaskForce→
#             is_deletedフラグ）はロジック上正しく、確認ダイアログ・楽観更新・エラートースト
#             （handleSaveError）も揃っていることをコード追跡で確認。
#      原因①（実バグ・確定）：①「解除」で `saveTaskForce({ ...existing, quarter: undefined, ... })`
#             としていたが、`JSON.stringify` は値が`undefined`のキーを丸ごと落とす
#             （`@supabase/postgrest-js`は`JSON.stringify(this.body)`でPATCH bodyを作るため、
#             quarter列がUPDATE文から抜け落ちてDBのquarterが古い値のまま変わらない）。
#             選択中のクォーターが「現在の四半期」のときは`effectiveTfQuarter`の
#             フォールバック（未設定=今期扱い）でローカル表示上も変化がなく、
#             「解除ボタンを押しても何も起きない」ように見える一因と判断。
#             同型のバグがTF編集保存の`description`/`background`クリア、ToDoの`name`クリアにも存在。
#      原因②（構造的な非対称・是正）：DangerZoneを使う削除6箇所（KR/PJ/メンバー/グループ/タグ/TF）のうち
#             TFの`onDeleteTF`だけが子コンポーネント(TFRow)へのprop経由で
#             `() => { void deleteTF(editId!); }`という fire-and-forget 形になっており、
#             DangerActionの`await onConfirm()`が実際の削除完了を待たずに解決していた
#             （他の5箇所は`() => deleteXxx(id)`で素直にPromiseを返す一貫した形）。
#             deleteTaskForce自体はappStore内でエラーを捕捉しトースト表示するため無反応の直接原因では
#             ないが、busy状態の不整合・将来の例外握りつぶしリスクがあるため是正。
#      修正：`quarter`/TFの`description`/`background`/ToDoの`name`を、クリア時は`undefined`ではなく
#             `null`で送るよう統一（型を`Quarter|null`等に拡張）。`TFRow.onDeleteTF`の型を
#             `() => Promise<void>`にし、呼び出し側を`() => deleteTF(editId!)`に変更（他5箇所と同型に統一）。
#      横断調査：AdminViewの主要削除・保存ボタン（メンバー/PJ/KR/TF/タグ/グループ・DangerZone全6箇所、
#             マイルストーン、ToDo）を全数点検。stopPropagation誤用・zIndex競合・
#             確認ダイアログ非表示（v2.33のポータルpointer-events罠）・requireNameMatchによる
#             disabled固着は該当なし（ConfirmModalは#root配下の通常子要素でポータル不使用のため
#             pointer-events罠の対象外）。TF以外のDangerAction・削除フローに同型バグは見つからず。
#      DBマイグレ不要。検証：tsc 0/vitest 515件全通過/eslint 新規0（既存8件はAdminView.tsx内の
#             全角スペース正規表現・label関連付けで変更前から存在）/build成功
# v2.99 設定画面の左ナビ件数バッジをselectedGroupIdでスコープ（2026-07-23）
#      修正：AdminViewの左ナビ「プロジェクト」「メンバー」件数バッジが、既に部署スコープ済みの
#             KR/TF（v2.94）と異なり全部署合計のままだった（pjCountはアプリ全体のcurrentGroupId
#             基準selectScopedProjects・memberCountは無絞り込み）。PJSection/MembersSectionが
#             実際に表示する一覧と同じprojectInGroup/memberInGroup関数でselectedGroupIdに
#             揃え、krCount/tfCountと同じuseMemoパターンに統一。タグ件数（全社共通マスタ・
#             絞らない方針）・グループ件数（部署一覧そのもの）は既存どおり変更なし（コメントで明記）。
#      DBマイグレ不要。検証：tsc 0/vitest 519件全通過/eslint 新規0/build成功
# v3.00 四半期OKR（QuarterlyObjective）の部署別化＋OKR取込の通期/四半期選択（2026-07-23）
#      追加：`quarterly_objectives.group_id`列（migrations/20260723c_add_quarterly_objective_group_id.sql・
#             既存行はobjective_id経由の親Objectiveからバックフィル）。`QuarterlyObjective.group_id`型・
#             `lib/okr/deptScope.ts`に`quarterlyObjectivesInGroup`/`quarterlyObjectivesInGroupForQuarter`を追加
#             （既存のobjectivesInGroup等と同型。テスト4件追加）。
#      追加：OKR PDF取込（OkrImportModal）に「この資料は通期OKR／四半期OKRのどちらか」トグルを
#             入力ステップに新設。四半期選択時はクォーターセレクタ（1Q〜4Q）も表示し、TFドラフトの
#             既定クォーターをその選択値にする。登録時、四半期OKRの場合はQuarterlyObjectiveを
#             1件作成（group_id=取込先部署・quarter=選択値）。通期OKRの場合は既存挙動のまま無改造。
#      🔴 **重要な発見（実装前調査）**：QuarterlyObjective / QuarterlyKrTaskForceは2026-05-26の
#             TF四半期判定モデル移行（quarterly_kr_task_forcesテーブル→task_forces.quarter列）以降、
#             フロントエンドのどの画面からも参照されない死蔵データと判明済み（docs/REFACTORING.md
#             M24・2026-07-21のD OKR11回目巡回で既に指摘）。今回のgroup_id追加・取込時の
#             QuarterlyObjective作成は、この事実を踏まえた上で「取込元が四半期版であったという
#             記録」の骨組みに留めている（KR/TFをQuarterlyObjective配下に紐づける処理は行わない。
#             四半期の実体は既存どおりTF.quarter列で表現され、通期Objective配下のKR/TFとして
#             通常どおり作成・表示される）。表示画面が存在しないため③-C（表示絞り込み）は対象外
#             （QuarterlyObjectiveを表示する画面自体がゼロ件のため）。
#      DBマイグレ要：20260723c_add_quarterly_objective_group_id.sql（dev→prod手動適用）。
#      検証：tsc 0/vitest 519件全通過/eslint 新規0/build成功
#
# v3.01 feat: ガントビューに「タスク名インライン編集」「開始日・期日の直接入力」
#      「D&D並べ替え（ラベル列）」を追加（2026-07-24）
#      背景：山本さんから「ガントチャート内に直接タスク・日付を入力する方法はあるか」
#             「子タスクを子タスク間・親タスク間で前後・上下入れ替えることがチャート内操作で
#             可能か」の質問。既存はどちらも未対応（タスク名・日付はバークリック→サイドパネル/
#             モーダル経由のみ・子タスクの並び順は依存関係が無い場合に手動並べ替え手段が無い）。
#             3点セットで実装。
#      追加1（タスク名インライン編集）：GanttParts.tsx の GanttPjLabelRow / GanttTodoLabelRow /
#             GanttPersonLabelRow の3行コンポーネント全てで、タスク名テキストを既存の
#             common/InlineEditText（ListView/KanbanViewで使用中の汎用コンポーネント。変更なしで
#             そのまま再利用）に置き換え。行クリック（詳細を開く）と競合しないよう、名前を包む
#             div に onClick=stopPropagation（既存のPJ名インライン編集・InlineEditAssignee
#             ラッパーと同じ流儀）。保存は各行が新設の onSaveName プロップ経由で
#             GanttView.tsx の handleSaveRowName（＝saveTask choke point）を呼ぶ。
#      追加2（開始日・期日の直接入力）：GanttParts.tsx に GanttRowDateEdit（内部専用コンポーネント）
#             を新設。開始日・期日それぞれに common/InlineEditDate を使う。InlineEditDate に
#             placeholder プロップを追加（既定"期日未設定"＝後方互換。開始日用に"開始日未設定"を
#             渡す軽微な拡張。ListView/KanbanViewの既存呼び出しは無変更で従来どおり動作）。
#             **設計判断**：バー本体（TaskBarRow）は既にリサイズ/移動/B5結線ハンドルで当たり判定が
#             ぎっしりのため、日付編集UIはラベル列側に置き、バー本体には一切手を入れない。
#             常時表示すると煩雑になるため、行ホバー時のみ表示（既存の hoveredTaskId 由来の
#             「ホバーで見える系」UIと同じ流儀。GanttPjLabelRow/GanttTodoLabelRow/
#             GanttPersonLabelRowの3行全てに追加）。保存は onSaveStartDate/onSaveDueDate 経由で
#             saveTask choke point を通るため、B1依存ゲート・B3自動リスケ連鎖・B4ベースライン凍結が
#             自動的に効く。手入力の開始日>期日のクロスフィールド検証は行わない（TaskEditModal/
#             TaskSidePanelの既存の手動日付入力と同じ、現状無検証の挙動に揃えた。新規に導入した
#             制約ではない）。
#      追加3（D&D並べ替え。最重要・最大工数）：兄弟タスクの並び順は既存どおり
#             「依存関係（先行→後続）があれば常にそれが優先される安定トポロジカルソート」
#             （taskHierarchy.ts の orderSiblingsWithDependencies。v2.39の仕様を変更しない＝
#             依存で縛られたペアをドラッグで入れ替えても再描画で依存順に戻るのは意図した挙動）。
#             依存の無い兄弟同士だけ display_order を書き換えられるようにする。
#             ListView.tsx（182〜372行目にあった handleTaskDrop/handleUnparentDrop/
#             computeDropZone のロジック）を、重複実装を避けるため純粋関数＋フックへ抽出：
#             - src/lib/dragReorder.ts（新規）：DOM非依存の純粋関数のみ。
#               computeDropZoneFromRatio(ratio, allowNest)＝行内のドロップ位置比率から
#               DropZone（before/after/nest）を判定（ListViewの旧computeDropZoneの分岐を
#               そのまま抽出。allowNest=falseなら常に50%でbefore/afterのみ＝GanttViewは
#               常にこちらを使う）。computeSiblingReorderIds(allTasks, visibleTasks,
#               draggedId, targetId, zone)＝ドロップ先と同じ階層（parent_task_id・
#               project_id一致）に挿入した場合の新しいid配列を計算（隠れた兄弟は
#               display_order順で末尾維持）。ユニットテスト8件
#               （src/lib/__tests__/dragReorder.test.ts）。
#             - src/hooks/useTaskDragReorder.ts（新規。useBulkTaskActions.tsと同じ抽出
#               パターン）：draggingId/dropZoneのstateを一元管理し、handleTaskDrop
#               （nest=親子変更／before・after=computeSiblingReorderIdsを使った並べ替え。
#               子を持つタスクを子にしようとするとエラートースト等、ListViewの検証ロジックを
#               完全温存）・handleUnparentDrop（PJ見出しへのドロップで親解除）を提供。
#               「並べ替え成功時の呼び出し側固有の副作用」は onReordered コールバックに
#               委譲する設計（ListViewは「手動ソートモードへの切替」を渡す。GanttViewには
#               手動ソートという概念が無いため渡さない）。
#             - ListView.tsx：ローカルの draggingId/dropZone state・handleTaskDrop/
#               handleUnparentDrop の実装（旧・約75行）を削除し、上記フック＋薄いラッパー
#               （filteredTasksをvisibleTasksとして渡すだけ）に置き換え。挙動は完全に同一
#               （回帰なし。既存の手動テストシナリオはコード変更前後で差が無いことをロジック
#               レベルで確認済み）。
#             - GanttView.tsx（PJ別ビュー＝viewMode==="pj"のラベル列のみ対象）：
#               useTaskDragReorder を呼び、taskIdToPjVisibleTasks（taskId→そのPJの
#               「今表示されている順」タスク配列のMap。pjOrderedTasksMapから1回だけ構築する
#               O(1)ルックアップ）を新設。GanttPjLabelRowに⠿ドラッグハンドル（既存のListView
#               ハンドル列と同じ見た目・挙動）を追加し、行のonDragOver/onDragLeave/onDropで
#               受け止める。ドロップ位置の強調は box-shadow の inset のみで表現し border/padding
#               を変えない（ListTaskRowのコメントにある「レイアウトが動くとdragover/dragleaveが
#               高頻度往復してカクつく」教訓をそのまま踏襲）。
#             **スコープ判断（今回やらないこと）**：①nest（ドロップ先の子にする＝親子付け替え）は
#             GanttViewでは提供しない。GanttViewのゾーン判定は常にallowNest=falseで固定し、
#             before/afterの並べ替えのみに限定（要望が「並べ替え」であったこと、ラベル列の
#             当たり判定を増やしすぎないことを優先）。②「PJ見出しへドロップして親を解除する」
#             （ListViewのhandleUnparentDrop相当）もGanttViewでは未提供：ラベル列の幅が狭く
#             PJ名表示自体が14文字省略という制約下で、ドロップ可能を示すヒント文言を置く余白が
#             無いため。親子付け替えが必要な場合はListViewを使う想定。③人別ビュー・ToDo別ビューの
#             D&D並べ替えは対象外（要望どおりPJ別ビューに限定。名前インライン編集・日付直接入力の
#             2機能は3ビュー全てに対応済み）。④GanttMobileViewは既存の多くのガント新機能と同じ
#             慣例で対象外（触っていない）。
#      DBマイグレ不要（既存の display_order / parent_task_id / name / start_date / due_date
#             列のみ使用。新規列・新規テーブルなし）。
#      検証：tsc 0/vitest 527件全通過（519件+新規8件）/eslint 35件で完全一致（baseline比較。
#             24 error + 11 warning）/build成功
#
# v3.02 fix: タスク/PJのTF・KRピッカーを部署絞り込み（currentGroupId）に統一（2026-07-24）
#      🔴 症状（由々しき事態・山本さんからの報告）：タスク詳細（TaskEditModal）でTF追加の
#             プルダウンを開くと、EGGを表示中なのにAID部署のTFが選択肢に出ていた。
#      原因：タスク/PJをTF・KRに紐づける（＝選択肢を出す）ピッカーが、部署絞り込み用の純粋関数
#             （`lib/okr/deptScope.ts`のtaskForcesInGroup/keyResultsInGroup。v2.94で新設済み）を
#             一切使わず、全部署分のTF・KRをそのまま選択肢に出していた。v2.94 changelogで
#             「PJ編集フォームの『紐づけKR/TF』ピッカーは部署絞り込み未対応」と名指しで既知の
#             宿題にしていた箇所を含め、**タスク/PJ文脈のOKRピッカー全て**が未対応のままだった。
#      🟢 今回のスコープ＝UI（表示絞り込み）の修正のみ。OKR系テーブル（objectives/key_results/
#             task_forces）のRLS部署分離（DB側のアクセス制御）は引き続き別フェーズ（Section 1.6・
#             Section 9のG参照）。DBマイグレ・新規テーブル/列・保存挙動の変更は無し。
#      修正1（TaskEditModal.tsx）：TF追加プルダウンの選択肢を`taskForcesForPicker`
#             （`taskForcesInGroup(taskForces, keyResults, objectives, currentGroupId)`）に限定。
#             `currentGroupId`は`s.currentGroupId`（表示中の部署）、`objectives`は`s.objectives`
#             （v2.94で新設の全部署・全期分の生配列）から取得。**既に紐づいているTFのラベル表示
#             （linkedTfsのチップ・tfLabelByIdのラベル解決）は部署絞り込み前の`taskForces`
#             （active()のみ）のまま**にし、他部署TFが誤って紐づいていた既存データでも表示は
#             消さない（絞り込むのは「追加で選べる選択肢」だけ、という設計方針）。
#             `getEligibleTfIds`（日付適格性フィルタ）は`taskForcesForPicker`に対してこれまで
#             どおり併用（部署フィルタ→日付フィルタの両方を選択肢に適用）。
#      修正2（TaskSidePanel.tsx）：TaskEditModal.tsxと全く同型の修正（`taskForcesForPicker`新設・
#             linkedTfs/tfLabelByIdは無改造）。
#      修正3（QuickAddTaskModal.tsx）：KR・TFピッカーに部署絞り込み（`krsInGroup`/`tfsInGroup`。
#             `keyResultsInGroup`/`taskForcesInGroup`使用）を、v2.66の既存クォーター絞り込み
#             （`effectiveTfQuarter(tf) === currentQ`）と**併用**する形で追加（どちらか一方だけ
#             満たしても選択肢に出ない＝AND条件）。v2.66の「ToDoパネルからの既定KR/TFは絞り込み
#             条件を満たさなくても選択肢の先頭に強制的に含める」フォールバックはそのまま温存
#             （defaultKrId/resolvedDefaultTfIdの強制包含ロジックは無変更）。
#      修正4（AdminView.tsx・PJSection内のProjectFormFields＝「紐づける TF」ピッカー）：
#             v2.94で名指しされていた未対応箇所。このセクションは既にprojects/membersを
#             設定画面ローカルの`selectedGroupId`（super-adminが設定画面で見比べる部署。
#             MainLayout等の`currentGroupId`とは別概念）でスコープする方針（v2.94・v2.99）の
#             ため、`keyResults`/`taskForces`もこれに揃えて`selectedGroupId`基準で
#             `keyResultsInGroup`/`taskForcesInGroup`により絞り込んだ（`currentGroupId`は
#             使わない＝このファイル内の既存の使い分けに揃えた判断）。
#             **チェックボックス形式特有の追加対応**：このピッカーはチップ＋ドロップダウンでは
#             なくKRごとのチェックボックス一覧そのものが表示兼操作面のため、単純に絞り込むと
#             「既に紐づいているが他部署扱いになったTF」のチェックボックス自体が消えて見えなくなる
#             （TaskEditModal等の「チップは残す」に相当する対処ができない構造）。これを防ぐため
#             `taskForcesForPicker`/`keyResultsForPicker`を新設し、`form.tf_ids`に含まれるが
#             部署絞り込み後の一覧に無いTF・その所属KRを、active()済みの生配列から補って含める
#             （選択肢を狭めるのは新規に選べる分だけ、というTaskEditModal等と同じ考え方をこの
#             コンポーネントの構造に合わせて実装）。
#      横断確認：`addTaskTaskForce`/`addProjectTaskForce`/`tf_ids:`/`tf_id: value`でgrep検索し、
#             TF紐づきUIがAdminView.tsx・TaskSidePanel.tsx・TaskEditModal.tsxの3ファイルに限定
#             されることを確認済み（`ProjectCreateModal.tsx`はTF/KRピッカーを持たない・
#             `payloadBuilder.ts`のTF参照はAI投入用ペイロード生成でピッカーUIではないため対象外）。
#      DBマイグレ不要（フロントの表示絞り込みのみ）。
#      検証：tsc 0/vitest 527件全通過（新規純粋関数を追加していないため既存テストの追加なし。
#             taskForcesInGroup/keyResultsInGroup自体のテストはdeptScope.test.tsで既存カバー済み）/
#             eslint 35件で完全一致（baseline比較。24 error + 11 warning・新規0）/build成功
#
# v3.03 feat: OKRコア階層（objectives/key_results/task_forces/todos）のDBレベル部署分離
#      （マルチテナントRLS）（2026-07-24・⚠️要マイグレ適用＝山本さん手動・dev→prod）
#      🔴 背景（山本さんからの明確な指示）：「データは部署ごとに明確にデータベースを分けて、
#             どんなエラーが起こっても別部署との干渉が起こらないように」。OKR系テーブルは
#             schema.sqlのDOループで全て「authenticated full access」（USING(true)
#             WITH CHECK(true)）＝ログイン済みなら誰でも全部署のOKRデータを受信・書込可能な
#             まま残っていた（members/projects/tasksは20260626〜20260722bで分離済みだが
#             OKR系だけこの穴が残存。objectivesはv2.94・20260723bでgroup_id列を追加した
#             がRLSは表示絞り込みのUI対応のみで据え置きのままだった＝Section 1.6・
#             Section 9のG参照）。
#      🟢 今回のスコープ＝コア階層4テーブルのみ（第1弾）：objectives/key_results/
#             task_forces/todos。OKR周辺テーブル（kr_sessions/kr_declarations/
#             kr_meeting_notes/kr_note_tf_entries/okr_analyses/kr_reports/quarterly_*）
#             は第2弾で別途対応するため今回は触っていない（引き続きfull accessのまま）。
#             member_tags本体も全社共通マスタとして従来どおり全公開のまま（触っていない）。
#      設計の核：各テーブルに自前のgroup_id列を追加し、DBトリガーで親から自動注入する
#             （結合を辿るRLSより堅牢＝「どんなバグでも干渉しない」を満たすため）。
#             key_results.group_id ← objective_id経由でobjectives.group_idを継承、
#             task_forces.group_id ← kr_id経由でkey_results.group_idを継承（＝Objective
#             経由）、todos.group_id ← tf_id経由でtask_forces.group_idを継承。objectives
#             は既にgroup_id保有（追加不要）。
#      トリガー2段構え：①BEFORE INSERT/UPDATE（sync_kr_group_id/sync_tf_group_id/
#             sync_todo_group_id。sync_task_group_idsと同じSECURITY DEFINER方式で親の
#             RLSを迂回して参照）が、その行が保存されるたびに親から現在の値を再計算して
#             上書き注入する（フロントがgroup_idを送っても送らなくても常に正しい値になる。
#             KR/TFのobjective_id/kr_id付け替え＝再親付けにもこれだけで追従する）。
#             ②AFTER UPDATE（cascade_objective_group_id_to_krs/cascade_kr_group_id_to_tfs/
#             cascade_tf_group_id_to_todos。cascade_project_group_ids_to_tasksと同型）が、
#             親のgroup_id自体が変わったとき（子が保存されない限り①だけでは子は追従
#             しないため）子を明示的に更新し連鎖させる（Objective変更→KR→TF→ToDoまで
#             自動的に波及）。既知の副作用：親のgroup_idを変えると配下全ての updated_at
#             が動く（cascade_project_group_ids_to_tasksと同じ割り切り）。
#      フロント無改修：KeyResult/TaskForce/ToDoのTypeScript型（lib/localData/types.ts）は
#             group_id列を持たないため、saveKeyResult/saveTaskForce/saveTodoは今後も
#             group_idを一切送らない＝コード変更ゼロ。saveObjectiveはv2.94から既に
#             group_idを送るため同じく無改修（Objectiveには親がいないため注入トリガー
#             不要）。よってフロントが先にデプロイされてもマイグレ未適用の間は従来どおり
#             動作し、マイグレ適用後は自動的に部署分離が効き始める＝適用順序に起因する
#             本番破損リスクなし。
#      RLS張り替え（インシデント再発防止が最重要）：schema.sqlのDOループから
#             objectives/key_results/task_forces/todosの4件を除外し、
#             `DROP POLICY IF EXISTS "authenticated full access"` を必ず先に実行してから
#             個別ポリシーに差し替え。単一group_id列のため配列オーバーラップ（&&）ではなく
#             `group_id = ANY(current_member_group_ids())` を使用。NULL許可の猶予句は
#             一切書いていない（20260702bの教訓＝group_idがnullの行は自動的に隠れる
#             ＝安全側の正しい挙動として扱う）。
#      成果物：`supabase/migrations/20260724_scope_okr_core_tables.sql`（山本さんが
#             SQL Editorへ手動適用。dev→prodの順）。schema.sqlにも同内容を反映済み
#             （drift防止）。適用後に監査クエリ2本（緩いポリシー残存検出・
#             バックフィル漏れ検出）で確認する運用（マイグレファイル末尾・Section 1.6
#             参照）。
#      検証：tsc 0/vitest 527件全通過（フロント無改修のため新規テスト追加なし）/
#             eslint 35件で完全一致（baseline比較・新規0）/build成功
#
# v3.04 feat: ガントのタスクリスト内で「名前だけ簡易追加」「空行ドラッグで期間を新規作成
#      （ドラッグ中の日付ツールチップ）」／fix: ラベル列の日付インライン表示を撤去
#      （2026-07-24・デスクトップ GanttView のみ対象。GanttMobileView は既存の多くの
#      ガント新機能と同じ慣例で対象外）
#      背景：現状タスク追加は画面右下FABのモーダル（QuickAddTaskModal）経由のみ。
#             山本さんから「ガントのタスクリスト内で、名前だけサクサク追加し、期間は
#             ガント上で横にドラッグして作れるようにしたい。名前と期限が最重要で、他は
#             追ってまとめて追加したい」との要望。加えてv3.01で追加した「ラベル列の
#             日付インライン表示」が、タスク名にホバーするたびに名前に被って読めず不便
#             との指摘（確定方針＝撤去）。3点セットで対応。
#      ①（fix・最優先）ラベル列の日付インライン表示を撤去：GanttParts.tsx の
#             GanttRowDateEdit（v3.01で追加した内部専用コンポーネント。行ホバー時に
#             開始日〜期日のInlineEditDate 2つを表示）を削除し、GanttPjLabelRow/
#             GanttTodoLabelRow/GanttPersonLabelRowの3行コンポーネント全ての描画・
#             Props型・GanttView.tsxのonSaveStartDate/onSaveDueDate配線
#             （handleSaveRowStartDate/handleSaveRowDueDate）を撤去。タスク名の
#             インライン編集（InlineEditText。v3.01のもう一方の機能）は名前を覆わない
#             ため存置。日付編集は②のバードラッグ（新規期間作成・既存のリサイズ/移動）
#             ＋タスク詳細パネル（TaskEditModal/TaskSidePanel）に一本化する
#             （v3.01時点の「ラベル列に日付編集UIを置く」設計判断はここで撤回）。
#      ②（feat）期日未登録タスクの空行ドラッグで期間を新規作成：calcTaskBar
#             （ganttUtils.ts）はdue_date未設定だとnullを返し、該当タスク行は
#             TaskBarRowの空の外枠（高さ30px・position:relative）だけが存在する。
#             この空行への mousedown→ドラッグ→mouseup で開始日〜期日を作成できるように
#             した。TaskBarRowPropsに`onEmptyDragStart`を追加し、TaskBarRowImpl側で
#             `bar===null && !isPreview && !isDone`のときだけ行コンテナ自身に
#             mousedownをバインドする（bar があるときは内側のバー要素側が担うため排他的
#             に切り替わり二重発火しない）。ホバー時のみ「ドラッグして期間を設定」の
#             薄いヒント（pointer-events:none）を表示し発見しやすくした。
#             座標→日付変換はB2矢印描画と同じ基準（ganttBodyRefのgetBoundingClientRect()
#             起点）を使う純粋関数`xToDate(x, rangeStart, dayWidth)`
#             （ganttUtils.ts。`addDays(rangeStart, Math.round(x/dayWidth))`）と、
#             ドラッグの始点・終点（順不同）からstart=min/due=maxを正規化する
#             `computeDragCreateRange(dateA, dateB)`の2つの新規純粋関数で構成（同日
#             ドラッグ＝単日タスクとして許容）。GanttView.tsxの`creatingRangeTask`
#             state はtaskId/anchorDateのみを持つ「ドラッグセッションの識別子」として
#             不変に保つ設計（バー移動ドラッグのdraggingMoveTaskと同じ流儀。フレーム
#             ごとに変化する現在日はプレビュー側のstateだけに書き込むことで、
#             mousemoveのたびにuseEffectのlistenerを貼り直さずに済む）。ドラッグ中の
#             プレビューバーは新規コード無しで実現：既存の`resizePreviewDates`
#             （リサイズ/移動ドラッグと共有）にstart/dueを書き込むだけで、既存の
#             `applyResizePreview`→`calcTaskBar`の流れがそのまま効き、bar===nullの
#             行が一時的に実際のバーとして描画される（3箇所のバー描画＝人別/PJ別/
#             ToDo別ビュー全てで自動的に効く。用意した`onEmptyDragStart`もこの3箇所
#             全てに配線した＝スコープ制限なし）。確定はsaveTask経由（choke point。
#             B1依存ゲート・B3自動リスケ連鎖・B4ベースライン凍結が自動的に効く）。
#      ③（feat）ガントのタスクリスト内での簡易タスク追加（名前のみ）：PJ別ビュー
#             （viewMode==="pj"）のラベル列で、各PJのタスク行の末尾に
#             `GanttQuickAddTaskRow`（GanttParts.tsx新規）を追加。既定は
#             「＋ タスクを追加」の折りたたみ表示、クリックで入力欄に切り替わりEnterで
#             `saveTask({ name, project_id: pj.id, start_date: null, due_date: null, ... })`
#             （日付なし）を呼ぶ。作成後も入力欄を開いたまま・フォーカス維持し続けて
#             追加できるようにした（空のままEscape/フォーカスアウトで折りたたみに戻る）。
#             InlineEditTextを流用しなかった理由＝「保存後も編集状態を保つ」がその
#             コンポーネントの想定外の挙動のため専用実装にした。group_idは
#             saveTask/appStore側が現在の部署から自動注入するため明示不要。
#             日付なしで作成されたタスクは②のドラッグで期間を付ける、という一連の
#             流れになる。
#      共通（ドラッグ中の日付ツールチップ）：②を最優先に、既存のバー端リサイズ・
#             バー中央移動ドラッグにも同じツールチップを追加（「狙った日付で的確に
#             操作したい」という一貫した要望のため、低リスクな範囲で横展開）。
#             GanttView.tsxに`dragDateTooltip`（x/y/label の1 state）を新設し、
#             3種のドラッグそれぞれのonMove/onUpで更新・クリアするだけに留め、表示は
#             1箇所のposition:fixed要素に集約。日付ラベルは`formatMDWithWeekday`
#             （src/lib/date.ts。既存関数）をそのまま使用（例："7/24(木)"、範囲は
#             "7/24(木) 〜 7/26(土)"）。
#      スコープ判断（今回やらないこと）：①③はPJ別ビューのみ（簡易追加はD&D並べ替え
#             ＝v3.01と同じスコープ方針。人別・ToDo別ビューは対象外）。②は3ビュー
#             全てに配線済み（ビュー限定なし）。GanttMobileViewは①②③とも対象外
#             （既存の多くのガント新機能と同じ慣例）。
#      DBマイグレ不要（既存の name/start_date/due_date/project_id 列のみ使用）。
#      新規純粋関数：`xToDate`/`computeDragCreateRange`（ganttUtils.ts）。ユニット
#             テスト7件追加（ganttUtils.test.ts）。
#      検証：tsc 0/vitest 534件全通過（527件+新規7件）/eslint 35件で完全一致
#             （baseline比較・新規0）/build成功
#
# v3.05 feat: ガントビュー週ラベルの直下に「ものさし目盛り」行（1日ごと・土=青/日祝=赤）を
#      追加＋日本の祝日判定ライブラリを新規導入（2026-07-24・デスクトップ GanttView のみ対象。
#      GanttMobileView は対象外・未変更）
#      背景：v2.38で日付数字行を週ラベル（8月W1形式）に置き換えて以来、実際にタスクの
#             日付を選ぶ際「どこが土日か」を気にしながら1日ずつ数える必要があった。
#             週ラベルの粒度（大局）と1日単位の粒度（実際の日付選び）を両立させたいという
#             要望
#      追加1（祝日ライブラリ）：`japanese-holidays`（v1.0.10・MIT・依存ゼロ・約9KB）を
#             `dependencies` に、型定義 `@types/japanese-holidays`（v1.0.3）を
#             `devDependencies` に追加。選定理由：①振替休日・ハッピーマンデー・春分秋分の
#             計算式を含み日本の祝日を実務精度でカバー、②依存ゼロで軽量、③algorithmic
#             （祝日法改正への追従がデータ更新なしで比較的しやすい）。
#             オフライン検証（2026-07-24）：npm registry・unpkg上のソース
#             （index.js・lib/japanese-holidays.js）を確認し、http/https/fetch/
#             XMLHttpRequest/net等のネットワークアクセスコードが存在しないこと・実行時
#             依存が0件であることを確認済み（`npm view japanese-holidays` でも
#             `deps: none` を確認）。node上で `isHoliday(date, true)` を実行し
#             元日/建国記念の日/海の日（ハッピーマンデー）/振替休日（2024-05-06）が
#             正しく判定されることも実地確認した。@holiday-jp/holiday_jp
#             （データ網羅的だがバンドル重め）は不採用。
#      追加2（薄いラッパー）：`src/lib/date/holidays.ts`（新規）に
#             `isHoliday(dateStr: string): string | null`（祝日なら祝日名、そうでなければ
#             null。振替休日を含めて判定）を実装。アプリ側は必ずこの関数経由で祝日判定し、
#             `japanese-holidays` を直接あちこちで呼ばない（将来ライブラリを差し替える際の
#             変更箇所を1箇所に閉じる）。ユニットテスト6件（元日・ハッピーマンデー・
#             振替休日・平日・土曜・無効な日付文字列）。
#      追加3（ものさし目盛り行）：`ganttUtils.ts` に `dayTickColorKind(date, holidayName)`
#             （曜日＋祝日名→色分類。優先順位＝祝日>日曜>土曜>平日）・`dayTickColor(colorKind)`
#             （色分類→実際のCSS color。赤=`HOLIDAY_TICK_COLOR`(#dc2626)、
#             青=`SATURDAY_TICK_COLOR`(#2563eb)、平日=`var(--color-text-tertiary)`）・
#             `computeDayTicks(days, dayWidth, isHolidayFn)`（days配列1件につき1目盛り＝
#             x座標・日の数字（1〜31）・色分類・祝日名を返す純粋関数）を追加。
#             GanttView.tsx はこれを `useMemo(() => computeDayTicks(days, dayWidth, isHoliday), 
#             [days, dayWidth])` で回し、days/dayWidthが変わらない限り再計算しない。
#             `computeDayTicks` は祝日判定を`isHolidayFn`として引数注入する設計にした
#             （下記「バンドルサイズへの影響」参照・ganttUtils.ts自体は祝日ライブラリに
#             依存しない）。ヘッダーに週ラベル行（既存）のすぐ下の新しい行（高さ16px・
#             `borderTop`で週ラベル行と区切る）として、`days.map`で1 divずつ
#             （`borderLeft`で色付きの目盛り線＋中に日の数字・フォント8px）を描画。
#             祝日は`title`属性で祝日名をホバー表示。ボディ側の土日グラデーション
#             （weekendGradient）・週コラムの淡いグリッド線（weekGridLines）・月初/月曜
#             境界線（borderDays）は無変更（スコープ外＝目盛り行の追加のみ）。
#             ユニットテスト7件（dayTickColorKind4件・dayTickColor1件・computeDayTicks2件、
#             ganttUtils.test.ts）。
#      バンドルサイズへの影響：`ganttUtils.ts` は `appStore.ts`（`computeBulkMoveShifts`
#             経由）からも参照される共有モジュールのため、当初 `isHoliday` を
#             `ganttUtils.ts` の先頭でモジュールレベルimportしたところ、CJSモジュール
#             （`japanese-holidays`）がtree-shakeされずappStoreチャンク（毎回即時読み込み
#             ＝全ユーザーが影響を受ける）にも約4.5KB混入することが判明（build出力で
#             appStoreチャンクの前後比較で発覚）。`computeDayTicks`の引数に
#             `isHolidayFn`として注入する設計に変更し、`isHoliday`の実import自体は
#             `GanttView.tsx`（既存の遅延読み込みチャンク）側だけに置くことで解消。
#             最終的なバンドル影響：GanttViewチャンクのみ +4.61KB（gzip +1.83KB。
#             72.90KB→77.51KB、gzip 19.79KB→21.62KB）。appStoreチャンクへの影響は
#             実質ゼロ（206.49KB→206.89KB・gzip 54.53KB→54.67KBは通常のビルド差分の
#             範囲・祝日ライブラリ起因ではない）。ガントビューを開くユーザーだけが
#             この+4.6KBを追加ダウンロードする
#      スコープ：デスクトップ GanttView のみ。GanttMobileView・ボディ側の土日
#             シェーディング/既存グリッド線（祝日をボディにも塗る等）は対象外
#      DBマイグレ不要（表示のみ・保存操作なし）
#      検証：tsc 0/vitest 548件全通過（534件+新規13件＝holidays 6件・ganttUtils 7件）/
#             eslint 35件で完全一致（baseline比較・新規0）/build成功
#
# v3.06 fix: ガントビュー左右行ズレの2原因を修正／feat: タスク行の「間」への挿入UI
#      （2026-07-24・デスクトップ GanttView のみ対象。GanttMobileView は対象外・未変更）
#      背景：左ラベル列（labelBodyRef）と右バー列（scrollRef）は別スクロールコンテナで
#             scrollTopを同期しているだけの設計のため、両列の「行順・各行高さ・ヘッダー高さ」
#             が完全一致していないと縦にズレる。v3.04/v3.05のリグレッションで2つの不一致が
#             生じていたのを両方修正。加えて、PJ末尾（v3.04のGanttQuickAddTaskRow）でしか
#             タスク追加できず不便との指摘を受け、タスク行の「間」に挿入できるUIを追加した。
#      ①-A（fix・リグレッション）ヘッダー高さ不一致（定常16pxズレ）：v3.05で右バー列の
#             ヘッダーに「ものさし目盛り」16pxを追加した際、左ラベル列のヘッダー（52px固定）を
#             揃え忘れていた（右＝月24+週28+目盛り16＝68px、左＝52pxのまま）。左右のヘッダー
#             高さを`ganttUtils.ts`の新規定数`GANTT_HEADER_MONTH_HEIGHT`(24)/
#             `GANTT_HEADER_WEEK_HEIGHT`(28)/`GANTT_HEADER_DAY_TICK_HEIGHT`(16)と、
#             その合計`GANTT_LABEL_HEADER_HEIGHT`(68)に定数化。左ラベルヘッダーは
#             `GANTT_LABEL_HEADER_HEIGHT`を直接使い、右バー列の3段（月/週/目盛り）も
#             同じ定数を参照するようにした＝以後どちらかの段の高さを変えても両列が自動的に
#             一致し続ける（今回のリグレッションの再発防止）。
#      ①-B（fix・リグレッション）簡易追加行の非対称（累積ズレ）：v3.04でPJ別ビューの
#             左ラベル列にPJブロック末尾の簡易タスク追加行（`GanttQuickAddTaskRow`。
#             高さ26px+borderBottom 1px）を追加したが、右バー列側の対応するPJブロックには
#             スペーサーを足し忘れていた（バーを持たない見出し専用行のため右列に「行」自体が
#             存在しない）。右バー列のPJブロック（タスク行map直後・`</div>`で閉じる直前）に、
#             左と同じ条件（`!isCollapsed && !isPreview`）・同じstyle
#             （`height: QUICK_ADD_ROW_HEIGHT(26), borderBottom: "1px solid var(--color-border-primary)"`）
#             の空divを追加。`QUICK_ADD_ROW_HEIGHT`は`ganttUtils.ts`の新規定数で
#             `GanttQuickAddTaskRow`本体（GanttParts.tsx）とスペーサー側の両方が参照する
#             ＝pxが乖離しようがない設計にした。
#      ①検証：PJ複数・折りたたみ有無・タスク多数・人別ビュー・ToDo別グループで左ラベル行と
#             右バー行が最下部まで縦にピタリ一致することを目視確認する想定（実機確認は
#             山本さんが実施）。①-Aは全ビュー共通で効き、①-Bは対称化のためPJ別ビューのみ対象
#             （元々PJ別ビュー限定の機能への対症のため）。
#      ②（feat）タスク行の「間」への挿入UI：`GanttPjLabelRow`（GanttParts.tsx）のホバー時、
#             行の下端に小さな「＋」を絶対配置オーバーレイで表示する（`position: relative`を
#             行コンテナに追加した上で`position: absolute; bottom: -8px`。行の高さ30pxは
#             一切変えない＝①の行ズレ再発防止が最優先制約）。「＋」クリックは
#             `stopPropagation`し、行のonClick（詳細を開く）・D&Dハンドル・InlineEditText
#             と競合しない。新規プロップ`onInsertAfter?: (task: Task) => void`
#             （undefinedなら「＋」自体を描画しない＝PJ別ビューのみで配線するスコープ制御は
#             GanttView側が担う）。
#      挿入動作：「＋」クリックで`GanttView.tsx`の新ハンドラ`handleInsertTaskAfter`が、
#             ホバー中タスク（アンカー）と同じ階層（同じ`parent_task_id`・同じ`project_id`）に
#             新タスクを作成し、display_orderをアンカーの直後に配置する。既存の兄弟は
#             新規純粋関数`computeInsertAfterOrder(allTasks, anchorId, newTaskId)`
#             （`src/lib/dragReorder.ts`。ドラッグ並べ替えの`computeSiblingReorderIds`と
#             対になる関数＝兄弟をdisplay_order順に並べてアンカー直後に新タスクを挿入し
#             0..nで振り直したidの配列を返す）で計算し、変わった分だけ`saveTask`する
#             （choke point経由＝B1依存ゲート・B3自動リスケ連鎖・B4ベースライン凍結が
#             自動的に効く）。ユニットテスト5件追加（dragReorder.test.ts）。タスク生成自体は
#             既存`handleQuickAddTask`（v3.04）と同じ形（uuidv4・status:"todo"・日付null等）を
#             雛形にした。日付は無し（②のドラッグで期間設定する、という既存v3.04/v3.05の
#             流れにそのまま乗る）。
#      名前の即編集：`InlineEditText`（common）に後方互換の`autoEdit?: boolean`プロップを
#             追加（`useState(!!autoEdit)`で初期editing・マウント時のみ全選択）。
#             `GanttView.tsx`は`autoEditTaskId` stateを持ち、新タスク作成直後にセットして
#             `GanttPjLabelRow`へ`autoEditName={autoEditTaskId === task.id}`として配線
#             （新タスクは新規マウント＝key=task.idのため初期editingで入る）。名前確定
#             （onSave）は既存`handleSaveRowName`（saveTask経由）をそのまま使う。
#             【設計判断】新タスクを空名（""）で作ると、既存`InlineEditText`のcommitが
#             空文字を弾いて元の値（＝空のまま）に戻す仕様のため、何も入力せず確定した場合に
#             名前が可視化されない行が残るリスクがある。これを避けるため新タスクは
#             「新しいタスク」という初期値で作成し、autoEdit時にinput全体を選択状態にする
#             ことで最初の文字入力でまるごと上書きできるようにした（空名で作る案は不採用）。
#      スコープ判断（今回やらないこと）：PJ別ビュー（`viewMode==="pj"`）のみ。人別・ToDo別
#             ビューは対象外（既存の簡易追加・D&D並べ替えと同じスコープ方針）。子タスク行間
#             への挿入は`computeInsertAfterOrder`が`parent_task_id`ベースで階層を判定するため
#             実装上は親子どちらの階層でも動作する（子タスク同士の間にも「＋」を出している。
#             「無理なら最上位優先」という当初想定より広く倒せたため制限しなかった）。
#             空PJ（0件）でも最初の1件を足す導線はPJ末尾の既存`GanttQuickAddTaskRow`が
#             引き続き担う（①-Bのスペーサー対応込みで担保）。
#      DBマイグレ不要（既存の name/project_id/parent_task_id/display_order 列のみ使用）。
#      検証：tsc 0/vitest 553件全通過（548件+新規5件＝dragReorder computeInsertAfterOrder）/
#             eslint 35件で完全一致（baseline比較・新規0）/build成功
#
# v3.07 fix: AI相談（メイン相談フロー）がターンを重ねるとJSONパース失敗で応答不能になる
#      バグを修正（複数タスクの日程調整など大きな構造化提案で発生）（2026-07-24）
#      症状：スケジュール調整でAIと3回ほど相談を重ねた後、画面に「AIのレスポンスをJSONとして
#             パースできませんでした」＋再試行ボタンが出て応答が返らなくなる（2回同一現象で報告）。
#      根本原因：`apiClient.ts`（メイン相談＝ConsultationPanel/useAIConsultationの経路）が
#             `max_tokens: 4096`固定で呼んでいた。会話を重ねる＋複数タスクの日程調整のような
#             大きな構造化JSON提案では出力が4096トークンを超えて途中で切れ、
#             `responseParser.ts`のJSONパース（```フェンス除去→最初の{〜最後の}抽出の
#             フォールバックも含む）が失敗しAIError("INVALID_RESPONSE")になっていた。
#      v2.93との関係：OKR取込（`okrImportExtractor.ts`）では同種の出力切れ・不正JSON対策を
#             2026-07-23に先行実装済み（max_tokens 4096→8192・自己修正リトライ・プロンプト
#             厳格化）だったが、メイン相談フローには未適用のまま残っていた。今回はそれを
#             メイン相談フローへ横展開した形。
#      修正1（`apiClient.ts`）：max_tokensを4096→**16384**に引き上げ（定数`MAX_TOKENS`）。
#             中〜長い相談・複数タスクの構造化提案でも出力が途中で切れないようにする。
#      修正2（Edge Function・要再デプロイ）：`supabase/functions/ai-consult/index.ts`の
#             `MAX_TOKENS_CAP`が**8192**にハードコードされていた（v2.93でOKR取込用に8192へ
#             上げた名残）。クライアントの`max_tokens`は`Math.min(body.max_tokens, MAX_TOKENS_CAP)`
#             で丸められるため、フロントを16384にしてもEdge Function側の上限が8192のままだと
#             静かに8192へ丸められ、修正が完全には効かない。**MAX_TOKENS_CAPも16384に引き上げ**、
#             Edge Functionの再デプロイが必要（詳細は本コミットの報告参照。CLIまたはSupabase
#             管理画面での手動再デプロイ・git pushでは反映されない）。
#             なお`stop_reason`は元々レスポンス全文をそのまま転送する実装だったため、Edge
#             Function側の変更なしで既にクライアントまで届いていた（今回追加の変更は不要）。
#      修正3（`apiClient.ts`/`responseParser.ts`）：Anthropicレスポンスの`stop_reason`を
#             `AICallResult.stopReason`としてクライアントまで通し、`parseAIResponse(rawText,
#             stopReason)`が`stopReason==="max_tokens"`の場合はパース失敗時に汎用的な
#             「AIのレスポンスをJSONとしてパースできませんでした」ではなく「応答が長くなり
#             すぎて途中で切れました。相談を分けるか、もう一度お試しください。」という的確な
#             案内をAIErrorとしてthrowするようにした（`TRUNCATED_RESPONSE_MESSAGE`定数）。
#      修正4（新規`src/lib/ai/consultationRunner.ts`・自己修正リトライ）：v2.93の
#             `okrImportExtractor.extractOkrImportData`と同じ作法で、`callAIConsultation`→
#             `parseAIResponse`を束ねる`runAIConsultation()`を新設。パース失敗時、
#             `stop_reason==="max_tokens"`（出力切れ）ならリトライしても同じ壁にぶつかるだけ
#             なので即座にエラーを伝播し、それ以外（引用符エスケープ漏れ等）の場合のみ
#             1回だけ、直前の不正出力をassistantターンとして渡し「厳密なJSONで出し直して」と
#             リトライする（`apiClient.ts`の`callAIConsultation`に`retryContext`引数を追加）。
#             `useAIConsultation.ts`はこの`runAIConsultation()`を呼ぶ形にリファクタ
#             （callAIConsultation+parseAIResponseの直接呼び出しをやめた）。リトライで
#             実際に2回APIを呼んだ場合は`ai_usage_logs`にも2回分を記録する（実コストの
#             正確な計上。CLAUDE.md Section 16の趣旨）。会話履歴（セッション）にはリトライ
#             成功後の正しいJSONを保存する。apiClient.ts↔responseParser.tsの循環import
#             を避けるため、この束ね役はどちらにも依存する別モジュールとして新設した。
#      確認5（会話履歴トランケート）：`sessionManager.ts`の`truncateOldTurns`（10ターン超で
#             warning→続行時に直近5ターンのみ残す）は`useAIConsultation.ts`側で従来どおり
#             機能していることを確認。今回のバグの主因ではなかったため変更なし（現状維持）。
#      修正6（プロンプト厳格化・`systemPrompt.ts`）：`RESPONSE_FORMAT`の「## 重要なルール」に、
#             v2.93の`okrImportExtractor.ts` SYSTEM_PROMPTと同内容のJSON厳格化指示
#             （二重引用符は\\"でエスケープ・日本語引用は「」を使う・生の改行禁止・末尾カンマ
#             禁止）を追加。全5モード（change/simulate/diagnose/deadline_check/scope_change）
#             に反映される（RESPONSE_FORMATは共通テンプレートのため）。
#      テスト：`responseParser.test.ts`に3件（stop_reason=max_tokens時の的確メッセージ／
#             end_turn時は従来メッセージ／max_tokensでもパース成功なら誤検知しない）、
#             新規`apiClient.test.ts`3件（max_tokens=16384で送信・stop_reasonの通過・
#             retryContextのメッセージ構築）、新規`consultationRunner.test.ts`4件（1回で成功／
#             不正JSONから1回リトライで救済／max_tokensはリトライせず即エラー／リトライ後も
#             失敗なら最終的にエラー伝播）、`systemPrompt.test.ts`に1件（全モードにJSON厳格化
#             指示が含まれる）を追加。計564件（553件+新規11件）全通過。tsc 0・eslint 35件で
#             完全一致（baseline比較・新規0）・build成功。
#      デプロイ：フロント分（apiClient.ts/responseParser.ts/systemPrompt.ts/
#             useAIConsultation.ts/consultationRunner.ts）はcommit＋push済み（Vercel自動
#             デプロイ）。**Edge Function（supabase/functions/ai-consult/index.ts）の
#             MAX_TOKENS_CAP変更は山本さんの手動再デプロイが必要**（Supabase CLI:
#             `supabase functions deploy ai-consult`、または管理画面のEdge Functionsから
#             再デプロイ。git pushでは反映されない）。再デプロイ完了までは、クライアントが
#             16384を要求してもEdge Function側で8192に丸められるため、4096→8192相当の
#             改善までは即時に効くが、16384までの完全な効果は再デプロイ後になる。
#
# v3.08 refactor: ガントビュー左右行ズレの根本解決＝「共有行モデル」への再設計
#      （2026-07-24・デスクトップ GanttView のみ対象。GanttMobileView は対象外・未変更）
#      背景：v3.06で①ヘッダー高さ不一致②簡易追加行の非対称という2つの個別ズレ原因を修正した
#             ものの、「各行の高さは一致しているのに底部でまだズレる」という別の非対称が残存
#             （山本さんフィードバック）。根本原因は、左ラベル列（labelBodyRef）と右バー列
#             （scrollRef）が**完全に別々のDOM（別スクロール領域）で、それぞれ独立にPJ/ToDo/
#             担当者のツリーを辿ってJSXを組み立て、行順・行数・各行の高さを手作業で一致させる**
#             設計だったこと。この方式は本質的に脆く、新機能を足すたび（v3.04簡易追加行・v3.05
#             目盛り行・v3.06行間挿入）に左右どちらか片方だけ変更が反映され非対称が混入する
#             （個別修正はもぐら叩きで再発する）。山本さんの要望＝「そもそもズレない根本設計に」を
#             受け、統括と方針確定した「共有行モデルで同一構造化」を実装した。
#      設計①（ganttUtils.ts・新規純粋関数）：縦方向に並ぶ「全行」を1つの配列
#             `GanttRow[]`として表現する共有行モデルを導入。行種別は
#             `pj-header`(36px)/`task`(30px)/`quick-add`(QUICK_ADD_ROW_HEIGHT=26px)/
#             `todo-header`(36px)/`todo-task`(30px)/`person-header`(36px)/`person-task`(30px)
#             の7種（新規定数`GANTT_GROUP_ROW_HEIGHT`=36・`GANTT_TASK_ROW_HEIGHT`=30。
#             既存`QUICK_ADD_ROW_HEIGHT`はそのまま流用）。`buildPjViewGanttRows`
#             （PJ別ビュー：PJ見出し→タスク→簡易追加行→ToDoグループ見出し→ToDoタスク）と
#             `buildPersonViewGanttRows`（人別ビュー：担当者見出し→タスク）の2つの組み立て関数が、
#             **折りたたみ（PJ／親タスク／ToDoグループ／担当者）・簡易追加行の表示可否
#             （!isCollapsed && !isPreview）を、この1箇所だけで判定**する（従来は左右それぞれの
#             JSXにこの分岐が二重に書かれていた）。各行は`blockKey`（PJ.id／`todo_${id}`／
#             `person_${id}`。既存のcollapsed stateのキーとそのまま揃えた）を持ち、同じ
#             blockKeyの行は必ず連続して並ぶ。
#      設計②（GanttView.tsx・描画の一本化）：`ganttRows`をuseMemoで1回だけ構築し、
#             左ラベル列・右バー列は**この同一配列をそれぞれ1回ずつmapするだけ**にした
#             （`renderLabelRow(row)`/`renderBarRow(row)`という行種別スイッチ関数を新設し、
#             従来3ビュー×2列=6箇所に分散していたJSX組み立てをこの2関数に集約）。両関数とも
#             TypeScriptの網羅性チェック（`const _exhaustive: never = row`）付きのswitchのため、
#             将来行種別を追加した際にどちらかの実装だけ更新し忘れるとコンパイルエラーになる
#             （構造的な再発防止）。さらに、各行の高さは`row.height`という**単一の値**を
#             ラベル側コンポーネント（`GanttPjLabelRow`/`GanttTodoLabelRow`/
#             `GanttPersonLabelRow`/`GanttQuickAddTaskRow`に新設した`rowHeight`/`height`プロップ）
#             とバー側コンポーネント（`TaskBarRow`に新設した`rowHeight`プロップ。既存の
#             `barHeight`＝バー本体の見た目の太さとは別物）の**両方にそのまま渡す**。同じ
#             `ganttRows`配列・同じ`row.height`を左右がそのまま使うため、行数・各行の高さが
#             構造的に必ず一致する（ズレが原理的に起きなくなる）。
#      設計③（帯のオーバーレイ化・最も慎重を要した箇所）：従来マイルストーン帯・過負荷帯は
#             PJ／メンバーブロックを`position:relative`で個別に包み、その中に`top:0;bottom:0`の
#             絶対配置で描いていた（ブロックの高さ＝内部の通常フローで自然に決まる、という
#             ラッパー依存の設計）。共有行モデルでラッパーを撤廃しフラット化したため、この手法は
#             使えなくなる。代わりに`computeGanttBlockRanges(rows)`（新規純粋関数。ganttRowsを
#             先頭から積み上げ、同じblockKeyの連続する行のtop/heightを算出する）で各ブロックの
#             Y範囲を求め、帯を**「バー列全体（ganttBodyRef）を覆う絶対配置オーバーレイ」**
#             として描画するように変更した（`renderGanttBandsOverlay()`。依存関係矢印SVGが
#             既にコンテナ全体への絶対配置＝同じ考え方）。DOM上の描画順序・zIndex（帯=1）は
#             従来と同じ位置関係を維持しており、見た目のレイヤリングは変えていない。
#      削除した個別対応：v3.06で入れた「バー列側の簡易追加行スペーサーdiv」は、共有行モデルでは
#             `quick-add`行がバー列側にも自動的に描画される（中身はスペーサーのみ）ため、
#             ラベル列・バー列で条件分岐を別々に書く必要が無くなった（構造的に保証されるため
#             手当て自体が不要になった実例）。
#      壊していないことの確認（全て既存の3ビューで無変更のまま維持）：バー描画（PJ別/人別/
#             ToDo別・親バーは子の最早〜最遅に合成）／依存矢印B2（data-task-id実測。行div自体に
#             `data-task-id`を維持）／ドラッグ各種（端リサイズ・中央移動・複数選択一括・B5結線・
#             空行ドラッグでの期間新規作成）／ベースラインゴーストB4／進捗フィル／
#             クリティカルパス／マイルストーン◆と帯／過負荷帯／週グリッド線・目盛り行／
#             完了フィルタ／折りたたみ（PJ/親/ToDo/人）／タスク名インライン編集・行間挿入UI／
#             簡易追加／ホバー強調／ズーム／今日線。renderLabelRow/renderBarRowの各caseは
#             既存JSXのロジックをそのまま移植（分岐条件・variable名・スタイル値を変更していない）。
#      ズレが構造的に起きないことの担保：①`ganttRows`は`useMemo`で1回だけ構築し、左右の
#             `.map(row => ...)`は**同一の配列参照**を使う。②各行の高さは`row.height`という
#             単一の値を左右のコンポーネントへそのまま渡す（ラベル側・バー側で別々に定数を
#             ハードコードする従来方式をやめた）。③TypeScriptの網羅性チェックにより行種別の
#             片側実装漏れはコンパイルエラーになる。④ユニットテスト
#             （`ganttUtils.test.ts`）で、同一の`ganttRows`から求めた総高さ・ブロック範囲が
#             常に一意に定まること（`computeGanttRowsTotalHeight`/`computeGanttBlockRanges`）を
#             検証。実機確認は山本さんが実施。
#      検証：tsc 0・vitest 576件全通過（564件+新規12件＝buildPjViewGanttRows5件・
#             buildPersonViewGanttRows3件・computeGanttBlockRanges/computeGanttRowsTotalHeight
#             3件・実データでの総高さ一致1件）・eslint 35件で完全一致（baseline比較・新規0）・
#             build成功（GanttViewチャンク77.51KB→79.66KB、gzip 21.62KB→22.62KB。行モデル導入
#             による自然な増分）。
#      DBマイグレ不要（表示構造のリファクタのみ）。
#
# v3.09 feat: ガントビュー週ラベルの数え方を「月内日数ブロック」→「カレンダー週（月曜始まり・
#      日曜終わり）」に変更（2026-07-24・デスクトップ GanttView のみ対象。GanttMobileView は対象外・未変更）
#      背景：v2.38で導入した週ラベル（W1=1〜7日／W2=8〜14日…の月内日数ブロック方式）は、
#             カレンダーアプリやOutlook等の「週」の感覚（月曜〜日曜）とズレており、山本さんから
#             「カレンダー表示の週の列と揃えたい」との要望を受けた
#      新ルール（確定）：各週は月曜〜日曜で整列する。W1＝その月の1日から、その月で最初の日曜まで
#             （月頭の半端な週。1日が日曜ならその日だけがW1）。W2以降は次の月曜〜日曜、以降も
#             月曜始まり・日曜終わり。週番号は月ごとにリセット（月が変わったらW1から数え直す）。
#             結果としてブロックの区切りは「毎週月曜(getDay()===1)」と「月の1日(getDate()===1)」に
#             入り、月をまたぐカレンダー週は月境界で切れて「前月の最終週」と「新月のW1」に分かれる
#             （月の1日が月曜の場合は月境界と月曜が一致し、W1がそのままフル週＝月〜日になる）
#      変更：src/components/gantt/ganttUtils.ts の computeWeekBlocks。ブロック境界の判定を
#             「年+月+floor((日-1)/7)の変化」→「前日と比べて月が変わった、またはその日が
#             月曜(getDay()===1)」に変更。週番号は新設の calendarWeekNumber(d)（月の1日の曜日から
#             「月頭の半端な週の長さ」を求め、以降は7日ずつのMon-Sun週として数える純粋関数）で
#             日付から直接算出する方式にした（v2.38の「直前ブロックからのインクリメント」ではなく、
#             1日単位の入力からその日単体で正しい週番号が求まる設計。days配列が月の途中から
#             始まる範囲でも正しい週番号になることをテストで担保）。isMonthStart は
#             「ブロック開始日が月の1日か」に変更（従来の「週番号===1」から変更したが、
#             結果的に指す対象は同じ＝月頭ブロック）。startDate/endDate（v2.73のツールチップが使う）
#             はブロック内の最初/最後の日のままで計算方法自体は変更なし
#      影響確認：①computeWeekGridLines（v2.40・週コラムの淡い縦線）はweekBlocksから導出する
#             だけの関数のため無変更で新ルールに追従した。「月初(isMonthStart)を除外」する既存の
#             除外ロジックも新定義のisMonthStart（月の1日始まりのブロック）でそのまま意図通り動作
#             （月境界の線は既存の月初境界線=borderDaysに任せ、週コラム線は月曜境界のみに引かれる）。
#             ②ものさし目盛り行（v3.05・1日ごと）はweekBlocksに依存しないため影響なし（確認のみ）。
#             ③GanttView.tsxのボディには従来からborderDays（d.getDate()===1またはd.getDay()===1の
#             日に境界線）が既に存在しており、新ルール下では非月初の週コラム境界＝常にMondayと
#             一致するため、weekGridLinesが引く淡い線はborderDaysの通常Monday線とほぼ同じ位置に
#             重なる（視覚的な破綻はないが、v2.40時点の「月内日数ブロックの週境界（8/15等・
#             非Monday）に淡い線を引く」という当初の狙いは、新ルールでは実質的にborderDaysの
#             Monday線と重複する形になった。害はないため今回はこの点の設計変更・線の削除はしない）
#      テスト：src/components/gantt/__tests__/ganttUtils.test.ts のcomputeWeekBlocks/
#             computeWeekGridLines を新ルールに書き換え（旧ルール前提のテストは削除・新ルールの
#             期待値に更新）。新規ケース：7月（1日=水、5ブロック）／8月（1日=土、部分週から開始）／
#             6月（1日=月、W1がフル週になるケース）／7月末→8月頭の月またぎ（前月最終週=3日→
#             新月W1=2日→W2=1日、の3ブロックに分かれる）／範囲先頭が月曜始まりの週の途中
#             （月をまたがない）。vitest 577件全通過（computeWeekBlocks/computeWeekGridLinesの
#             既存テストを新ルールの期待値に置き換え・ケース追加した上での総数）・tsc 0・eslint 35件で完全一致
#             （baseline比較・新規0）・build成功
#      DBマイグレ不要（表示ロジックのみ）
#
# v3.10 fix: タスク行間「＋」挿入UI（v3.06）の2バグを修正（2026-07-24・デスクトップ
#      GanttView のみ対象。GanttMobileView は対象外・未変更）
#      バグ①「＋」で挿入したタスクが「①と②の間」でなく何行か下に入る：
#      原因：`handleInsertTaskAfter`（GanttView.tsx）は`computeInsertAfterOrder`
#             （dragReorder.ts）でdisplay_orderを正しく「アンカー直後」に振り直していたが、
#             ガントの並び順を決める`sortTasks`（旧・GanttView.tsx内useCallback）は
#             日付順（sortOrder="date"）または名前順でソートするだけでdisplay_orderを
#             一切見ていなかった（日付キー・名前キーが同値の要素同士は入力順のまま＝
#             `return 0`、日付なしは常に末尾＝`if (!da) return 1`）。新タスクは
#             v3.06時点では日付なしで作られるため、display_orderを直しても表示順に
#             反映されず末尾に流れていた。
#      修正1（sortTasksにdisplay_orderをタイブレーカーとして追加）：`sortTasks`の実体を
#             `ganttUtils.ts`の新規純粋関数`sortGanttTasks(tasks, sortOrder)`に切り出し、
#             日付キー・名前キーが同値のとき（両方日付なし、同日、同名）のみ
#             `(a.display_order ?? 0) - (b.display_order ?? 0)`でタイブレークするようにした。
#             日付・名前が異なるタスク同士の並びは従来どおり変えていない（タイブレーカーは
#             「同値のときだけ」効く）。依存順（`orderSiblingsWithDependencies`・v2.39）が
#             最優先で上書きする既存仕様はそのまま。GanttView.tsx側の`sortTasks`は
#             `useCallback((tasks) => sortGanttTasks(tasks, sortOrder), [sortOrder])`という
#             薄いラッパーになった（純粋関数化によりユニットテストが可能になった）。
#      修正2（挿入する新タスクにアンカーの日付を継承・仕様変更）：`handleInsertTaskAfter`で、
#             新タスクの`start_date`/`due_date`を**アンカー（クリックした行のタスク）と
#             同じ値**にした（従来は常にnull固定）。日付を持つタスク列の間に挿入しても
#             新タスクがアンカーと同じ日付位置にソートされ、修正1のタイブレーカーにより
#             アンカーの直後に確実に並ぶ＝「①と②の間」に入る。【仕様変更】アンカーが
#             日付なしなら新タスクもnullのままで、従来の「日付なしで作ってドラッグで
#             期間設定する」流れは維持される。
#      バグ②「＋」がガントチャート（バー）領域のホバーでも表示される：
#      原因：`GanttPjLabelRow`（GanttParts.tsx）の「＋」表示条件が、ラベル列とバー列の
#             両方が更新する**共有ホバー状態`hoveredTaskId`**（propの`isHovered`＝
#             `hoveredTaskId === task.id`）に連動していたため、同じタスクのバーをホバー
#             しても左ラベルの「＋」が出てしまっていた。
#      修正：`GanttPjLabelRow`内にローカルなhover state（`useState<boolean>`
#             `isRowHovered`）を追加し、行自身の`onMouseEnter`/`onMouseLeave`で切り替える
#             （`onMouseEnter`では従来通り共有状態用の`onHoverEnter(task.id)`も引き続き
#             呼ぶ＝バーとの相互ハイライト・依存矢印のハイライトは共有`hoveredTaskId`の
#             ままで壊していない）。「＋」の表示条件を`isHovered`→`isRowHovered`に変更。
#             これで「＋」はタスクリスト（ラベル列）の当該行にカーソルがあるときだけ出る。
#      テスト：`ganttUtils.test.ts`に`sortGanttTasks`のテスト6件追加（date順で日付が
#             異なる場合は従来通り／date順で日付なし同士はdisplay_orderでタイブレーク
#             （挿入UIのバグ再現ケース）／date順で同日同士もタイブレーク／date順で
#             日付ありは常に日付なしより前／name順で名前が異なる場合は従来通り／
#             name順で同名同士はタイブレーク）。既存`dragReorder.test.ts`の
#             `computeInsertAfterOrder`テストは挙動変更なし（display_order振り直し自体は
#             元から正しかったため）。バグ②はDOM依存（hover）のため実機確認のみ
#             （山本さんが実施）。
#      検証：tsc 0・vitest 583件全通過（577件+新規6件）・eslint 35件で完全一致
#             （baseline比較・新規0）・build成功。
#      DBマイグレ不要（既存の name/project_id/parent_task_id/display_order/start_date/
#             due_date 列のみ使用）。
#
# v3.11 refactor: ガント系クラスタ（v3.01〜v3.10の変更分）の品質リファクタ（挙動不変・2026-07-24）
#      背景：本日v3.01〜v3.10で段階的に大量変更したガント系クラスタ（GanttView.tsx/
#             GanttParts.tsx/ganttUtils.ts）を対象に、山本さんの指名で品質のみのリファクタを
#             実施。新機能・挙動変更・バグ修正は一切行っていない（既存テスト全通過が担保）
#      変更：PJ別/ToDo別/人別の3ビューでタスクバー1行の描画のたびに繰り返されていた4種の
#             重複計算を、ganttUtils.tsの純粋関数に集約した：
#             ①isDone判定（インライン重複式）→既存の`isCompletedForProgress`（taskMeta.ts）
#             経由に統一（GanttView.tsx 3箇所・GanttParts.tsx 3箇所・ganttUtils.tsの
#             computeBulkMoveShifts 1箇所）②hasRange/dateLabel計算の完全同一実装→
#             `formatBarDateLabel`として新規抽出③ツールチップ末尾（滞留/クリティカルパス
#             バッジ）の同一実装→`formatBarTooltipSuffix`として新規抽出④バー基本色
#             （完了=成功色／期限超過=危険色／それ以外=ビュー固有fallback色）の同一優先順位
#             判定→`resolveGanttBarColor`として新規抽出
#      確認：v3.01→v3.04で撤去済みの「ラベル列日付インライン編集」の残置props/import等は
#             無く健全（grep確認済み）。dragReorder.ts/useTaskDragReorder.ts/holidays.ts/
#             InlineEditText.tsxは重複・死蔵とも見つからず変更なし
#      スコープ外（意図的に見送り）：3種のラベル行コンポーネント（GanttPjLabelRow/
#             GanttTodoLabelRow/GanttPersonLabelRow）自体の構造的統合は、ビュー固有の機能差
#             （PJ別のみドラッグハンドル・行間挿入UI等）が大きく無理な統合は大規模構造変更に
#             なりかねないため見送った（v3.08の共有行モデルでデータ構造レベルの重複は既に解消済み）
#      テスト：ganttUtils.test.tsに10件追加（formatBarDateLabel4件・formatBarTooltipSuffix4件・
#             resolveGanttBarColor3件、一部重複整理の上で純増10件）。既存583件も全通過
#             （合計594件）。tsc 0・eslint 35件で完全一致（baseline比較・新規0）・build成功
#      詳細：docs/REFACTORING.md「ガント系クラスタ品質リファクタ（2026-07-24）」節参照
#
# v3.12 refactor: AI相談系クラスタ（v3.07の変更分）の品質リファクタ（挙動不変・2026-07-24）
#      背景：本日v3.07で新設・変更したAI相談系クラスタ（apiClient.ts/responseParser.ts/
#             consultationRunner.ts〈新設〉/systemPrompt.ts/useAIConsultation.ts）を対象に、
#             山本さんの指名で品質のみのリファクタを実施。新機能・挙動変更・バグ修正は一切
#             行っていない（既存テスト全通過が担保）。Edge Function（supabase/functions/
#             ai-consult/index.ts）はgit push非対象・手動デプロイ運用のため対象外（改善余地は
#             観察のみ記録）
#      変更：`useAIConsultation.ts`のAI使用量ログ記録（通常呼び出し分・リトライ発生時の
#             追加呼び出し分でほぼ同一実装が2箇所に展開されていた）を、ローカル関数
#             `logUsage(usage, label)`に集約し重複を解消（記録内容・失敗時のconsole.warn文言・
#             catchで相談処理を止めない性質はすべて維持）
#      確認：新設`consultationRunner.ts`の循環import回避目的の分離は、実際のimportグラフ
#             （apiClient.ts↔responseParser.tsの一方向依存）を確認した上で妥当と判断。
#             `retryContext`/`stopReason`まわりに呼び出し元0件の死蔵exportは無し。古い
#             max_tokens値（4096/8192）への言及は経緯コメント・再発防止テスト名としてのみ残存し、
#             現在の実値と矛盾するコメントは無し
#      スコープ外（意図的に見送り）：`useAIConsultation.ts`のcatchブロック（Section 15の
#             formatErrorForUser非経由）は本日の変更範囲外かつ、AIErrorが既にユーザー向けに
#             整形済みのメッセージを持つ設計のため、formatErrorForUnserを通すとコード接頭辞が
#             付き表示テキストが変わる（挙動不変の制約に反する）ため現状維持。v2.93
#             （okrImportExtractor.ts）とv3.07（consultationRunner.ts）の自己修正リトライの
#             同型ロジックの共通化も、リトライ判定条件が異なるため見送り
#      テスト：既存594件（今回の重複解消はテスト対象外の内部実装のみのため新規テスト追加なし）。
#             tsc 0・eslint 35件で完全一致（baseline比較・新規0）・build成功
#      詳細：docs/REFACTORING.md「AI相談系クラスタ品質リファクタ（2026-07-24）」節参照
#
# v3.13 feat: ローディング画面に操作テクニックのヒントを表示（2026-07-27）
#      目的：初回データ読み込み中（App.tsx のプログレスバー画面）の待ち時間に、初回ガイドツアー
#             （tour/tours/first-time.ts）では扱っていない操作テクニックを1つずつ表示する
#             （ガントのドラッグ操作・依存関係の作り方・複数選択・コマンドパレット等、
#             覚えると便利だがツアーでは説明しきれていない内容）
#      追加：`loading_tips` テーブル（migrations/20260727_add_loading_tips.sql）。全社共通の
#             1テーブル（group_id を持たない）。読み取りはauthenticated全員、書き込みは
#             current_member_is_super_admin() のみ（RLS）。論理削除（is_deleted）。既定10件を
#             「テーブルが空のときだけ」初期投入（再適用しても増殖しない）
#      設計：ローディング画面はまさにその loading_tips を読んでいる最中に表示されるため、
#             DB から取得した値をその場の初回表示には使えない。そこで2段構えにした：
#             ①起動のたびに loading_tips を fire-and-forget で取得し、取得できたら
#             localStorage（KEYS.LOADING_TIPS_CACHE）にキャッシュする、②ローディング画面の
#             表示はそのキャッシュ（無ければ組み込みの DEFAULT_LOADING_TIPS）だけを見る。
#             このため、設定画面での変更は保存した本人を含め各ユーザーの**次回の読み込みから**
#             反映される（今回のセッション中は変わらない）。src/lib/tips/loadingTips.ts の
#             ヘッダコメント参照
#      追加：`src/lib/tips/loadingTips.ts`（DisplayTip型・DEFAULT_LOADING_TIPS10件・
#             toDisplayTips/pickTipsForDisplay/readCachedTips/writeCachedTips の純粋関数群）・
#             `src/components/common/LoadingTips.tsx`（7秒ごとに切り替わるヒントカード。
#             App.tsx のローディング画面に追加。スピナー・プログレスバー・loadingHintの
#             再試行メッセージ自体は無変更）
#      追加：`LoadingTip`型（localData/types.ts）・fetchLoadingTips/upsertLoadingTip/
#             softDeleteLoadingTip（lib/supabase/store.ts）・appStore に loadingTips state と
#             saveLoadingTip/deleteLoadingTip アクション（load() 内で fire-and-forget 取得し
#             キャッシュを書く。保存・削除のたびにもキャッシュを更新）
#      追加：設定画面に新カテゴリ「アプリ設定」→「ローディングのヒント」タブ
#             （`src/components/admin/LoadingTipsSection.tsx`）。一覧＋↑↓並べ替え＋インライン
#             編集＋DangerZoneでの削除＋モーダルでの新規追加。**全社スーパー管理者のみ**左ナビに
#             表示（部署管理者には見せない。UIとDB RLSの二重ガード）。localStorage の
#             ADMIN_LAST_TAB に "tips" が残ったまま super admin でないユーザーが開いた場合の
#             フォールバックも実装
#      refactor：`AdminView.tsx` のモジュール定数だった inputStyle/primaryBtnStyle/
#             ghostBtnStyle/addBtnStyle を `src/components/admin/adminStyles.ts` に切り出し
#             （セクションを別ファイルに分けるたびに再定義・循環importを避けるため。挙動不変）
#      テスト：`src/lib/tips/__tests__/loadingTips.test.ts` 新規10件（toDisplayTips の
#             is_deleted/is_active=false/本文空白の除外・sort_order順・安定ソート、
#             pickTipsForDisplay のフォールバック、DEFAULT_LOADING_TIPS の件数・非空検証）。
#             readCachedTips/writeCachedTips はlocalStorage依存かつvitest環境がenvironment:
#             "node"のため未検証（既存方針どおり省略）。既存604件（594+10）全通過。
#             tsc 0・eslint 35件で完全一致（baseline比較・新規0）・build成功
#      ⚠ マイグレ要：`supabase/migrations/20260727_add_loading_tips.sql` を山本さんが
#             手動適用（dev→prod の順）。未適用の環境ではローディング画面は組み込みの
#             既定値10件で動作する（appStore側でfetch失敗を握りつぶす設計のため起動はブロックしない）
#
# v3.14 fix: 起動シーケンスの4つの全画面ローディングを1枚の画面に見せる（2026-07-27）
#      背景：App.tsx の起動シーケンスは①認証セッション確認→②システム空判定→③ログイン
#             ユーザー自動マッチング→④データ読み込み、の4段階に分かれ、それぞれ独立した
#             早期returnを持つ（＝画面としては都度アンマウント／再マウントされる）。
#             v3.13時点では①〜③が小さいスピナーのみ、④だけがアイコン＋プログレスバー＋
#             ヒントカードという別デザインだったため、実際には一連の起動処理でも
#             「別々のローディングが2回起きた」ように見え、ヒント（7秒間隔で回転）も
#             ④の間しか出ないうえ画面が切り替わるたびに再マウントで最初の1件目に戻り、
#             結果としてどちらの画面でもヒントを読み切れなかった（山本さん指摘）
#      追加：`src/components/common/FullScreenLoading.tsx`。④の見た目（40pxのSVGスピナー・
#             幅200pxのテキストブロック・決定的プログレスバー・補足行・ヒントカード）を
#             正としてコンポーネント化し、①〜④すべてがこれ1つを描画するように統一
#             （①②③は`<FullScreenLoading message="準備しています..." />`のみ、④は
#             `message="データを読み込み中..." progress={loadProgress} hint={loadingHint}`）。
#             props省略時でも高さが変わらないよう、プログレスバーのトラックは常に描画し
#             （塗りだけ progress の有無で出し分け）、補足行も空文字ではなく半角スペースで
#             埋める。スピナー・テキスト・バー・ヒントカードのY座標が①→②→③→④で
#             1pxも動かないことが目的（動くと「別画面に切り替わった」ように見えてしまう）
#      変更：ヒント回転を state ベース → 経過時間ベースに変更（`src/lib/tips/loadingTips.ts`）。
#             `computeTipIndex(elapsedMs, tipCount, offset, intervalMs)` の純粋関数と、
#             モジュールレベルで1回だけ生成する `getTipRotationSession()`（開始時刻＋
#             ランダムoffset）・`getSessionTips()`（表示するヒント配列も1回だけ解決し
#             キャッシュ、読み込み中に localStorage キャッシュが書き換わっても表示中の
#             配列を揺らさない）を追加。`ROTATE_INTERVAL_MS`（7000ms）も
#             LoadingTips.tsx からこちらへ移動。理由：state
#             （useState+setInterval）だと画面のアンマウント／再マウントでindexも
#             tips配列もリセットされ、①〜④のどこで切り替わってもヒントが最初から
#             流れ直していた。開始時刻・ヒント配列をモジュールレベル（ページを開いている
#             間ずっと同一）に持たせることで、画面が切り替わってもヒントは「続きから」流れる
#      変更：`LoadingTips.tsx` は index を state で持たず、`computeTipIndex(Date.now() -
#             session.startedAt, ...)` を毎レンダー算出（マウント時に即計算される）。
#             再レンダーのためだけの1秒tickの setInterval のみ残す。インジケータ
#             （丸のドット列）は同じ index をそのまま使うため無変更
#      対象外：`MainLayout.tsx` の ViewSkeleton／Suspense fallback（ビュー切替時の
#             スケルトン）・`backgroundLoading` の3px上部バー（Phase 2のOKR取得）・
#             LoginScreen／UserSelectScreen／SetupWizard／AccessDeniedScreen・認証フロー／
#             autoMatch／bootstrapStatus の判定ロジック（表示の器だけを差し替え、判定条件は
#             一切変更していない）・loading_tips のDB／RLS／appStore／設定画面
#             （LoadingTipsSection）
#      テスト：`computeTipIndex` に7件追加（elapsed 0でoffsetそのもの、interval未満で
#             index不変、interval経過ごとに+1、tipCountで巡回、tipCount=0で0、負の
#             elapsedMsでも範囲内・NaNにならない）。既存604件＋7件＝611件、全通過。
#             tsc 0・eslint 35件（24 error + 11 warning）で完全一致（baseline比較・新規0）・
#             build成功
#
# v3.15 feat: ラボ機能「マイページ（ウィジェット）」Phase 1（MVP）を追加（2026-07-27）
#      背景：`docs/dev/mypage-widgets-design.md`（統括Claude作成の設計書）に基づく実装。
#             山本さんの最終目標＝「将来、仕様に従って自分でウィジェットを作り、取り込める
#             ようにする」ための土台として、Phase 1から「ウィジェットがどうやってデータを
#             受け取るか」の契約だけは正しく切る（設計書§0参照）
#      🔴 最重要の契約（ウィジェットは useAppStore を直接触らない）：ウィジェットの
#             コンポーネント（`src/components/lab/widgets/*.tsx`）は `useAppStore` を一切
#             importしない。部署スコープ済み・論理削除除外済みのデータ（tasks/projects/
#             members）と、書き込みの唯一の経路（`actions.openTask`/`actions.navigateTo`・
#             `setConfig`）は、ホスト（`MyPageView.tsx`）が`WidgetContext`という単一の入口に
#             まとめて渡す。理由は3つ：①部署スコープの担保をホスト1箇所に集約できる
#             （`selectScopedTasks`等を購読するのは`MyPageView`だけ。ウィジェットごとに
#             書かせると将来誰かが素の`s.tasks`を読んで他部署のデータを表示する事故を防ぐ。
#             Section 1.6参照）②将来の権限制御（外部ウィジェット受け入れ時に「何を渡すか」
#             をホストが決められる）③書き込みの制御（`saveTask`を直接呼ばせず、B1依存ゲート・
#             B3自動リスケ等の choke point を迂回させない）
#      追加（型・純粋関数。DOM/store/コンポーネント非依存）：`src/lib/widgets/types.ts`
#             （`WidgetSize`/`WidgetContext`/`WidgetDefinition`/`WidgetConfigField`
#             〈Phase2用に型だけ〉/`WidgetInstance`/`MyPageLayout`）・`src/lib/widgets/layout.ts`
#             （`createDefaultLayout`/`addWidget`/`removeWidget`/`moveWidget`/`setWidgetSize`/
#             `setWidgetConfig`/`normalizeLayout`。全てイミュータブル・引数のlayoutを破壊しない）。
#             このファイルはレジストリ（コンポーネント層）をimportしない層構造を守るため、
#             既定5ウィジェットのid・サイズを`DEFAULT_WIDGET_ENTRIES`として自前で保持する
#             （registry.ts側の同じ5件のdefaultSizeと値を一致させる運用。ずれても致命傷には
#             ならないが初回表示サイズだけ食い違って見える）
#      **`normalizeLayout`の前方互換方針（重要）**：パース失敗・version不一致・widgetsが
#             配列でない→既定レイアウトへフォールバック。壊れたエントリ（instance_id/
#             widget_idが非空文字列でない等）はその要素だけ捨てる。**未知のwidget_idは
#             ここでは捨てず残す**（ホスト側で「このウィジェットは現在利用できません」の
#             プレースホルダを出し、編集モードで削除可能にする。ウィジェットを一時的に
#             外した／リネームした時にユーザーの並び・サイズ設定ごとレイアウトを破壊しない
#             ための設計。設計書§2-3）
#      追加（レジストリ・コンポーネント層）：`src/components/lab/widgets/registry.ts`
#             （`WIDGET_REGISTRY`/`getWidgetDefinition`）。型はlib、レジストリはコンポーネント
#             側という層構造（libからコンポーネントをimportしない）。ウィジェット7個
#             （📌自分の今週のタスク／🔥期限超過・滞留／👥自分の負荷／📊締切の見通し／
#             📈完了ペース／📝メモ／⭐ピン留めプロジェクト）は**新しい集計ロジックを一切
#             作らず**、既存の純粋関数・既存チャートをそのまま再利用（`getAssigneeIds`/
#             `isAssignedTo`/`suppressOverdue`/`isTaskStagnant`〈ganttUtils〉/
#             `computeMemberWorkloadRows`/`DueForecastChart`・`VelocityChart`〈内部で
#             `computeDueForecast`/`computeWeeklyVelocity`を呼ぶ〉/`isCompletedForProgress`/
#             `isParentTask`。真実の源の二重化を避ける）。タスク行クリックは
#             `actions.openTask(taskId)`を呼ぶだけ。メモウィジェット（📝）は「設定を持つ
#             ウィジェット」の最初の実例として`config`往復（`setConfig`で書き込み→次回
#             `config`から読み戻す）を実証（600msローカルデバウンス）。ピン留めPJ（⭐）は
#             Phase1簡易実装として⚙アイコンは持たず、未選択時にウィジェット内へ直接PJの
#             チェックリストを表示する（設計書§5の「簡易実装で可」に従う）
#      追加（エラー隔離）：`src/components/lab/widgets/WidgetErrorBoundary.tsx`（新設・
#             ウィジェット専用の小さなErrorBoundary）。既存`src/components/common/
#             ErrorBoundary.tsx`（アプリ全体用・全画面フォールバック固定）はfallbackを
#             差し替えられない設計のため、**既存ファイルには一切手を加えず**専用の境界を
#             新設する方を選んだ（グローバルの挙動を変えない）。`MyPageView`が各ウィジェット
#             インスタンスをこれで個別に包むため、1個のウィジェットが落ちてもマイページ全体は
#             生き続ける
#      追加（ホスト画面）：`src/components/lab/MyPageView.tsx`。CalendarLabViewと全く同じ
#             流儀の全画面オーバーレイ（`position:fixed inset:0`・zIndex 250・
#             `animate-overlay`＋本体`animate-fadeIn`・✕で閉じる）。`selectScopedTasks`/
#             `selectScopedProjects`/`selectScopedMembers`を**ホストで1回だけ**購読し
#             （`active()`で論理削除除外も1箇所で担う）、`WidgetContext.data`として読み取り
#             専用で渡す。レイアウトはCSS Grid（PC 3カラム／タブレット 2／モバイル 1。
#             `window.innerWidth`のresizeリスナーで判定。s=1・m=2・l=3カラム分、
#             `Math.min(size, totalCols)`でモバイルは常に1カラムに収まる）。編集モード
#             （既定OFF）で✕削除・S/M/Lサイズ切替・⠿ドラッグハンドルを表示、閲覧時は一切
#             出さない（誤操作防止）。並べ替えはHTML5 drag events、ドロップ位置ハイライトは
#             box-shadowのinsetのみ（border幅の変更によるdragover/dragleave高頻度往復＝
#             CLAUDE.md v2.25の教訓を踏襲）。ゾーン判定（before/after）は既存の
#             `computeDropZoneFromRatio`（`src/lib/dragReorder.ts`。ListView/GanttViewと
#             共有する純粋関数。`allowNest=false`で呼ぶ）を流用。「＋ウィジェットを追加」は
#             `AdminFormModal`を使わず（管理画面専用のため）、同じ演出（`animate-overlay`＋
#             `panel-slide-up`・zIndex 260）の簡易モーダルを自前で用意しレジストリ一覧を表示
#      追加（タスク編集の重ね方）：`MainLayout.tsx`に`myPageEditTaskId` state を新設し、
#             `calendarEditTaskId`と全く同じパターン（zIndex 300のラッパーでTaskEditModalを
#             マイページ〈250〉の上に重ねる）で配線。`actions.navigateTo`は`onNavigate`
#             （ビュー切替）を呼んだ後`onClose()`でマイページ自体を閉じる（Phase1では
#             navigateToを使うウィジェットは無いが、契約として提供済み）
#      追加（永続化）：`src/lib/supabase/store.ts`に`fetchMyWidgetLayout`/
#             `upsertMyWidgetLayout`。**`saveWithLock`は使わない**（id列PK前提の楽観ロック
#             ヘルパーのため。このテーブルのPKは`member_id`で所有者が1人しかいない行のため
#             楽観ロックも不要。`supabase.from("member_widget_layouts").upsert({...},
#             { onConflict: "member_id" })`で素直に書く）。`src/hooks/useMyPageLayout.ts`
#             （新設）が`currentUser`のマウント時に1回フェッチし、以後の変更は800msデバウンスで
#             保存する。**appStoreには足さない**（アプリ全体で常時必要なデータではなく、
#             マイページを開いた時だけ読む個人設定のため）
#      **レイアウトをDB＋`current_member_id()` RLSで持つ理由（localStorage・members列を
#             却下した経緯）**：設計書§3で3案を比較。A＝localStorageは端末・ブラウザごとに
#             別物になる（PCブラウザとTeams埋め込みの両方で使うアプリのため「設定したのに
#             消えた」が日常的に起きる）。C＝`members`にjsonb列を追加する案は、`members`の
#             RLSは同部署の他メンバーも更新できる設計のため**他人にレイアウトを上書き
#             されうる**ため却下。B（採用）＝新テーブル`member_widget_layouts`
#             （`member_id`主キー＋`layout jsonb`）＋RLSで自分の行だけ読み書き。
#             `current_member_group_id()`等（Section 1.6）と完全に同じ流儀で
#             `current_member_id()`（`auth.email()`から自分のmember idを返すSECURITY
#             DEFINER関数）を新設し、RLSを`member_id = current_member_id()`のみにする
#             （NULL猶予条項は入れない。20260702bの教訓＝`current_member_id()`がNULL
#             〈未登録ユーザー等〉なら何も見えないのが正しい挙動）。group_id（部署スコープ）は
#             持たせない（個人所有データ・所有者本人しかアクセスしないため）
#      **ゲストは閲覧のみ（重要）**：`isGuestMember`（`lib/guestMode.ts`）のゲストユーザーは
#             `members`に行が無いためFK違反・RLS拒否になる。`useMyPageLayout`はゲストの間
#             DB読み書きを一切行わず`createDefaultLayout()`をそのまま返し続ける
#             （`isGuest`分岐で`fetchMyWidgetLayout`/`upsertMyWidgetLayout`ともスキップ）。
#             `MyPageView`もゲストには編集トグル自体を出さない（「ゲストは閲覧のみです」の
#             注記のみ表示）
#      取得・保存失敗時：`formatErrorForUser`＋`showToast`で通知し、画面は既定レイアウトの
#             まま動き続ける（マイグレ未適用でもアプリの起動・利用を妨げない。ローディング
#             ヒント機能・v3.13と同じ方針）
#      配線（MainLayout.tsx）：PCサイドバー「🧪 ラボ」サブメニューに「🧩 マイページ」を
#             既存の体制図・関係グラフ・カレンダーと同じ`NavItem`で追加。モバイルのラボ
#             ボトムシート配列にも同項目を追加（icon "🧩"・label "マイページ"）。
#             `MyPageView`自体は**CalendarLabViewと同じくPC returnブロック側に1箇所だけ**
#             配置（既存コードのコメント「ここに置くとPCでは2つ同時にDOMに存在してしまい
#             印刷2ページ・マイルストーン重複が起きる」という確立済みの流儀に合わせた設計
#             判断。モバイルのボトムシートからは項目を選べる〈state自体はセットされる〉が、
#             実際の描画はCalendarLabViewと全く同じ制約を踏襲する）。`ViewMode`型には
#             追加していない（ラボ機能はオーバーレイ方式のため。既存のラボ機能群と統一）
#      ⚠️ マイグレ要（山本さんが手動でSupabase SQL Editorに適用・dev→prodの順）：
#             `supabase/migrations/20260727b_add_member_widget_layouts.sql`
#             （`current_member_id()`ヘルパー＋`member_widget_layouts`テーブル＋RLS）。
#             `supabase/schema.sql`にも同内容を反映済み（drift防止）。未適用の環境でも
#             起動・利用は妨げない（フェッチ失敗を握りつぶして既定レイアウトで動作継続）
#      テスト：`src/lib/widgets/__tests__/layout.test.ts`（新規31件。`createDefaultLayout`
#             4件・`addWidget`2件・`removeWidget`3件・`moveWidget`7件・`setWidgetSize`2件・
#             `setWidgetConfig`2件・`normalizeLayout`11件〈正常系・JSON壊れ4パターン・
#             version不一致・配列でない・壊れたエントリを個別に捨てる4パターン・不正size
#             フォールバック・config欠落フォールバック・**未知のwidget_idは残す**・未知の
#             設定キーは無視〉）。既存611件も全通過（合計642件）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 642件全通過（新規31件）／
#             `npx eslint src`は変更前と同じ35件（24 error + 11 warning、baseline比較で
#             完全一致・新規0件。MyPageView.tsxのドラッグ受け皿divに
#             `jsx-a11y/no-static-element-interactions`のeslint-disableを付与＝ListView/
#             GanttParts/KanbanViewの既存ドラッグ&ドロップ実装と同じ確立済みパターンを踏襲）／
#             `npm run build`成功（`MyPageView`が21.48KB・gzip 6.28KBの独立チャンクに分離
#             されていることを確認済み）
#
# v3.16 feat: ラボ機能「マイページ（ウィジェット）」Phase 2（configSchema駆動フォーム＋
#      新規ウィジェット3個）を追加（2026-07-27）
#      背景：`docs/dev/mypage-widgets-design.md`§7フェーズ計画のPhase 2。Phase 1（v3.15）で
#             「設定を持つウィジェット」の最初の実例（メモ）は入れたが、設定UIはウィジェットごとの
#             ベタ書きJSXのままだった。Phase 2はこれを「configSchemaから自動生成」に一般化し、
#             書き込みアクション（タスク作成）の最初の実例を追加する
#      ①configSchema駆動の設定フォーム：`src/lib/widgets/types.ts`の`WidgetConfigField`に
#             `type: "number"|"memberMultiSelect"`と`description`/`placeholder`/`defaultValue`/
#             `min`/`max`を追加。`src/lib/widgets/config.ts`（新規・純粋関数）に
#             `resolveConfig(schema, raw)`（型検証＋既定値埋め。text/textarea=""・number=0
#             〈min/maxクランプ〉・boolean=false・select=options[0]??""・
#             projectMultiSelect/memberMultiSelect=[]）と`applyConfigChange(current, key, value)`
#             （**未知のキーを保持したまま**1項目だけ更新。schemaから一時的に外した項目の値を
#             消さないため。前方互換方針＝設計書§2-3と同じ思想）を新設。
#             `src/components/lab/widgets/WidgetConfigModal.tsx`（新規）がconfigSchemaから
#             フォームを自動生成する。**個別ウィジェット用の分岐は持たない**（typeごとの
#             switchのみ）。text/textareaは600msのローカルデバウンス経由でsetConfig、
#             number/boolean/select/multiSelectは即時。projectMultiSelect/memberMultiSelectは
#             常にWidgetContext.data.projects/membersから選択肢を組み立てる（field.optionsは
#             使わない）。selectはfield.optionsが明示されていればそれを使い、未指定
#             （動的な選択肢が必要なケース＝QuickAddTaskWidget.projectIdのみ）なら
#             data.projectsから組み立てる、という唯一の一般化ルールで対応（特定ウィジェットの
#             keyで分岐しているわけではない）。createPortalは使わない（MyPageView自体が
#             portal無しの通常フローで描画されるため、v2.33のpointer-events罠は非該当）
#      ①-4：MyPageView.tsxの編集モードで、`configSchema`を持つウィジェットのヘッダにだけ
#             ⚙ボタンを表示（S/M/Lサイズボタンと✕削除ボタンの間）。押すとWidgetConfigModalが
#             開く。ウィジェット本体・設定モーダルの両方が同じ`buildContext(w)`（新設の
#             ローカルヘルパー）でWidgetContextを構築し、構築ロジックを二重化していない
#      ①-5：既存2ウィジェットをconfigSchema駆動に移行。**PinnedProjectsWidget**は独自実装の
#             PJ選択チェックリストUIを削除し、`configSchema: [{key:"projectIds",
#             type:"projectMultiSelect", ...}]`を宣言する形に変更（configSchema駆動の最初の
#             実例。未選択時は「編集モードの⚙から選んでください」の空状態案内）。
#             **MemoWidget**は本文（テキストエリア）は今まで通りウィジェット内で直接編集した
#             まま、`configSchema: [{key:"title", type:"text", label:"見出し", ...}]`を追加し
#             複数枚置いたときに見分けられるようにした（見出しが空なら従来通り無表示）。
#             両ウィジェットとも`○○_CONFIG_SCHEMA`をウィジェット自身のファイルからexportし、
#             registry.tsがそれをimportする設計にした（registry.tsが個別ウィジェットの
#             configをハードコードするとregistry.ts→widget→registry.tsの循環importになるため）
#      ②既定レイアウトの重複解消：`createDefaultLayout`のシグネチャを
#             `createDefaultLayout(resolveDefaultSize: (widgetId: string) => WidgetSize |
#             undefined, generateId?: () => string)`に変更。`DEFAULT_WIDGET_ENTRIES`は
#             widget_idの並びだけを持つ配列に変更し、サイズはレジストリから解決するように
#             した（layout.tsは引き続きレジストリをimportしない＝呼び出し側の
#             `useMyPageLayout.ts`が`(id) => getWidgetDefinition(id)?.defaultSize`を注入する。
#             hooks層はコンポーネント層に依存してよいためregistry.tsをimport可）。
#             `normalizeLayout`も同じ`resolveDefaultSize`を受け取りフォールバック時に
#             `createDefaultLayout`へ渡すようシグネチャ変更。解決できない場合は"m"に
#             フォールバック
#      ③新規ウィジェット3個（いずれも既存の純粋関数を再利用し新しい集計ロジックは作らない）：
#             **🕒RecentlyUpdatedWidget**（最近更新されたタスク）＝`updated_at`降順。
#             configSchemaに`limit`（number・既定10・min1・max30）・`mineOnly`
#             （boolean・既定true）。**⏳BlockedTasksWidget**（先行待ちのタスク）＝
#             自分が担当し未完了の先行タスクがあるタスクを一覧表示。判定は既存の
#             `getIncompletePredecessors`（`src/lib/dependencies/gate.ts`）をそのまま使用
#             （自前で依存を辿らない）。ブロック元タスク名は`formatBlockerNames`を流用。
#             このためWidgetContext.dataに`taskDependencies: readonly TaskDependency[]`を
#             追加（MyPageViewが`selectScopedTaskDependencies`を購読し`is_deleted`除外して
#             渡す）、`WidgetDefinition.dataNeeds`の型に`"dependencies"`を追加。
#             **➕QuickAddTaskWidget**（クイックタスク追加。**書き込みアクションの最初の
#             実例**）＝タスク名を入力しEnterで作成。configSchemaに`projectId`
#             （select・既定は未選択＝PJなし）・`defaultDueInDays`（number・既定0＝期日なし。
#             1以上なら今日+N日を期日に）
#      ③最重要ルール（choke point迂回防止）：`WidgetContext.actions`に
#             `createTask: (draft: {name, projectId?, dueDate?}) => Promise<void>`を追加。
#             QuickAddTaskWidgetはこれを呼ぶだけで**saveTaskを直接呼ばない**。
#             実装は**ホスト側でのみ**：`MyPageView`が受け取った`onCreateTask` propをそのまま
#             `actions.createTask`として渡し、実際の`useAppStore.getState().saveTask(...)`呼び
#             出しは`MainLayout.tsx`の`handleMyPageCreateTask`（新設）が担う。これにより
#             B1依存ゲート・B4ベースライン捕捉・v2.75親自動完了などのchoke pointを必ず通る
#             （ウィジェット側がstore・supabaseを直接触る例外は作らない）。タスク生成の形は
#             既存の`handleQuickAddTask`（GanttView.tsx・v3.04）を雛形にした（uuidv4／
#             status "todo"／assignee未設定／`updated_by`はcurrentUser.id／group_idは
#             appStoreが自動注入）。成功時は`showToast`で通知し入力欄をクリア・フォーカス維持、
#             失敗時は`formatErrorForUser`でトースト。**ゲスト（`isGuestMember`）は入力欄
#             自体を無効化**し「ゲストは閲覧のみです」を表示（Phase 1と同じ方針）
#      設計書への追記：`docs/dev/mypage-widgets-design.md`§2に「2-4. `actions`の拡張ポリシー」
#             節を追加（(a)ウィジェットが要求できる副作用はactionsに列挙されたものだけ
#             (b)新しい副作用を足すときは必ずホスト側でappStoreのchoke pointを経由して実装する
#             (c)ウィジェット側にstore・supabaseを触らせる例外は作らない）。§7フェーズ計画の
#             Phase 2行に実装済み注記を追加
#      DBマイグレ不要（ウィジェット設定は既存のlayout jsonbに入る。新規列・新規テーブルなし）
#      テスト：`src/lib/widgets/__tests__/config.test.ts`（新規30件・①1-2の網羅：各type既定値・
#             型不一致の矯正・min-maxクランプ・options無い値のフォールバック・動的select・
#             未知キー保持等）。`src/lib/widgets/__tests__/layout.test.ts`に2件追加
#             （`resolveDefaultSize`が解決したサイズがそのまま使われる・undefinedを返したら
#             "m"にフォールバック。既存テストは新シグネチャに追従）。新規ウィジェット3個は
#             表示中心のため専用テストなし（流用元の`getIncompletePredecessors`等は既存テスト
#             済み）。既存642件＋新規32件＝**674件全通過**
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 674件全通過／`npx eslint src`は
#             変更前と同じ35件（24 error + 11 warning、baseline比較で完全一致・新規0件）／
#             `npm run build`成功（`MyPageView`チャンクが21.48KB→32.31KB・gzip 6.28KB→8.63KBに
#             増加。ウィジェット3個＋設定モーダルの追加分として想定内）
#
# v3.17 feat: ラボ機能「マイページ（ウィジェット）」Phase 3（ウィジェット作成仕様書＋テンプレート＋
#      契約の機械チェック。デプロイ型の自作を解禁）を追加（2026-07-28）
#      背景：`docs/dev/mypage-widgets-design.md`§7フェーズ計画のPhase 3。山本さんの最終目標
#             （「将来、仕様に従って自分でウィジェットを作り、取り込めるようにする」）のうち、
#             §6で選定済みの案1（デプロイ型）を実際に使える状態にする。新しいウィジェット機能
#             そのものは増やしていない（Phase 1〜2で実装済みの10種のまま）
#      **なぜランタイム取り込みではなくデプロイ型を先に用意したか**：このアプリのオリジンの
#             `localStorage`にはSupabaseの認証セッショントークンがある。アプリ本体が任意JSを
#             その場で実行できる仕組み（eval/new Function/動的import等）を持つと、そのコードは
#             全社のPJ・タスク・メンバー情報を読み外部へ送信できる状態を作ってしまう（悪意が
#             無くても生成コードのバグや第三者スニペットの混入だけで成立する）。ブランドコア
#             §0・§4に真正面から抵触するため、デプロイ型（コードとして書く→ビルドを通す→
#             差分レビューできる状態で配布する。実行時の動的コード読み込みがゼロ）を先に用意した
#             （`mypage-widgets-design.md`§6の案1〜3比較を参照。案2〈宣言的ウィジェット〉・
#             案3〈サンドボックスiframe〉は「それでも足りない」となった時点で検討する）
#      **契約を文章だけでなくテストで強制したこと**：将来この契約に引っかかるのは山本さん自身
#             ではなくClaude Codeが生成したウィジェットである可能性が高いため、レビュー頼みに
#             せず`widgetContract.test.ts`で機械的に落とす設計にした。禁止import
#             （useAppStore/stores/appStore/supabase）・外部通信（fetch/XMLHttpRequest/
#             WebSocket）・レジストリの6つの不変条件（id一意性・allowedSizesがdefaultSizeを
#             含む・dataNeedsが配列・configSchemaのkey一意性・title/description/iconが空でない・
#             _template.tsxが未登録）を検査し、失敗時は「何が・どのファイルで・なぜダメか・
#             どう直すか」まで含めたメッセージを出す
#      追加：`docs/dev/widget-authoring.md`（新規・本Phaseの主成果物）。実装済みのコードを正として
#             書いた仕様書。①これは何か・配布のしかた（ランタイム取り込みを提供しない理由を含む）
#             ②5分で1個作る手順（実際のコマンド・コード片付き）③WidgetContextの完全リファレンス
#             （型定義をそのまま転記）④WidgetDefinitionの各フィールドの書き方（表形式。id不変の
#             重要性等）⑤configSchemaの全type一覧（表形式。text/textarea/number/boolean/select/
#             projectMultiSelect/memberMultiSelect）⑥禁止事項⑦副作用を増やしたいときの手順と
#             choke pointを通す理由⑧見た目の作法⑨提出前チェックリスト⑩Claude Codeに貼る
#             プロンプト雛形（コピペ即使用可能な実用ブロック）の10節構成
#      追加：`src/components/lab/widgets/_template.tsx`（新規）。コピーして使う最小のウィジェット
#             雛形。WidgetContextを受け取りresolveConfigで設定を正規化し、データを1つ絞り込んで
#             一覧表示・空状態も出す「よくある形」を一通り含む。穴埋め箇所は`// 👉 ここを変える：`
#             コメントで明示。ビルド対象には入るがレジストリには未登録のため画面には出ない。
#             全ての宣言（configSchema定数・コンポーネント）を実際に使う形にし、新規eslint
#             エラー0を担保
#      追加：`src/components/lab/widgets/__tests__/widgetContract.test.ts`（新規・60テスト）。
#             `fs`で`src/components/lab/widgets/*.tsx`（直下ファイルのみ・非再帰）を読み、
#             禁止import・外部通信をファイルごとに検査（`it.each`）。`WIDGET_REGISTRY`を
#             importしレジストリの6不変条件を検査。パス解決は`process.cwd()`に依存せず
#             `fileURLToPath(import.meta.url)`基準（vitest実行ディレクトリに依存しない）
#      是正（Phase 2の申し送り）：`src/components/lab/widgets/registry.ts`冒頭コメントの
#             「defaultSize は layout.ts の DEFAULT_WIDGET_ENTRIES と値を一致させること」という
#             記述（Phase 2でこの二重管理は解消済みだったにもかかわらず残っていた）を、実装に
#             合わせて「defaultSize の真実源はここ（レジストリ）1箇所のみ。layout.tsはレジストリを
#             importしない層構造のため、useMyPageLayout.tsのresolveDefaultSizeが解決して注入する」
#             に修正。`layout.ts`側は既にPhase 2時点で正しい記述だったため変更なし（確認のみ）
#      更新：`docs/dev/mypage-widgets-design.md`§7フェーズ計画のPhase 3行に実装済み（2026-07-28）
#             を追記（他の記述は書き換えていない）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 734件全通過（既存674件＋新規60件）／
#             `npx eslint src`は変更前と同じ35件（24 error + 11 warning、baseline比較で完全一致・
#             新規0件。`_template.tsx`自身も新規エラー0）／`npm run build`成功（`_template.tsx`は
#             どこからもimportされないため、いずれのチャンクサイズにも影響なし）
#      DBマイグレ不要（ドキュメント・テンプレート・テストの追加のみ。フロントの表示・保存ロジックは
#             無改造）
#
# v3.18 feat: 英語化（i18n）Phase 1（アプリ骨格＋共通UI＋認証その他画面）を追加（2026-08-04）
#      背景：`docs/dev/i18n-plan.md`のPhase 1。Phase 0（土台）＋LoginScreenのみだった状態から、
#             App.tsx／MainLayout.tsx本体／components/common/全ファイル／auth/残り3画面を
#             t()化した。Phase 0時点で「言語トグルはMainLayout（ログイン後）にあるのに、
#             翻訳済み画面はLoginScreen（ログイン前）だけ」という構造的な不整合があり、
#             トグルを押しても切替を体感できなかった問題も本Phaseで解消
#      新設：`src/i18n/layout.ts`（`layoutJa`/`layoutEn`）。App Shell・MainLayout本体の文言
#      拡張：`src/i18n/common.ts`（ConfirmModal/DangerZone/CustomSelect/ErrorBoundary/ErrorBar/
#             FileAttachButton/InlineEditAssignee・Date・Text/LoadingTips/MentionTextarea/
#             SaveProgressLoader/AIProgressLoader/CommandPalette/ShortcutsPanelの自前固定文言）
#      拡張：`src/i18n/auth.ts`（UserSelectScreen/SetupWizard/AccessDeniedScreenの文言。既存の
#             auth.*キーは変更なし）
#      新規：`src/components/common/LangToggle.tsx`。MainLayoutのモバイルヘッダー／サイドバー
#             フッターに個別実装（コピペ）されていたEN/JAトグルを部品化し、`variant="icon"|"text"`
#             の2種を提供。ログイン前の4画面（LoginScreen/UserSelectScreen/SetupWizard/
#             AccessDeniedScreen）にも同じ部品を右上固定で配置し、「トグルはあるのに翻訳画面が
#             無い／翻訳画面はあるのにトグルが無い」の構造的不整合を解消
#      設計判断：①共通UI部品はToast/EmptyStateのように呼び出し元がprops経由で渡す文言は対象外
#             （呼び出し側はPhase 2以降。ここで訳すと二重管理になるため）。②ErrorBoundary.tsxは
#             クラスコンポーネントでuseT()が使えないため`useLangStore.getState().lang`+
#             `translate()`を直接呼ぶ方式を採用（FileAttachButton.tsxの素の関数からのalert()文言も
#             同じ方式）。③ShortcutsPanel.tsx/CommandPalette.tsxのモジュール定数だったデータ
#             （SECTIONS/VIEW_ACTIONS）はt()を受け取るbuildXxx(t)関数に変換しコンポーネント内で
#             useMemoして使う形にした。④InlineEditDateのプレースホルダから「期日」「開始日」を
#             正規表現で抜き出して文言に埋め込んでいた実装は英語で成立しないため、汎用的な
#             「日付」表現に簡略化（既存の`placeholder`propそのものは維持・後方互換）
#      テスト：`src/lib/__tests__/i18n.test.ts`に「ja/enのキー集合が完全一致すること」を検証する
#             テストを追加（common/auth/layoutの3辞書。片側にしかないキーがあれば失敗しキー名を
#             メッセージに出す＝追加漏れの回帰防止）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 737件全通過（既存730件＋新規7件）／
#             `npm run build`成功
#      未対応（Phase 2以降）：dashboard/gantt/kanban/list/task/milestone/consultation/okr/lab/
#             admin/meeting/tour/graph/guideの各モジュールは意図的にスコープ外（計画通り）。
#             日付・曜日名のロケール対応も引き続きスキップ
#      DBマイグレ不要（localStorageの言語設定のみ。UI文言とテストの追加）
#
# v3.19 feat: ダウンロード量最小化（en辞書の動的import＋閾値超えチャンクのDL確認）を追加（2026-08-04）
#      背景：v3.18時点でen辞書はja辞書と同じファイルに静的importされており、日本語しか使わない
#             ユーザーも英語文言を必ずダウンロードしていた（`useT`チャンクが46.50kB/gzip12.77kB
#             まで肥大化）。「英語を普段使わないユーザーに英語データを持たせたくない」
#             「使用者が限られる機能は初めて使う時にだけDLしてほしい」という要望に対応
#      変更：`src/i18n/{common,auth,layout}.ts`を`<module>.ja.ts`（静的import・既定言語）と
#             `<module>.en.ts`（動的import専用・`import type`でja側の型のみ参照し実行時の
#             依存を持たない）に分割。`src/lib/i18n.ts`に`loadEnDict()`を新設（3モジュールを
#             `Promise.all`でまとめて読み込み、メモリ内にのみ保持・再ロードしない。
#             localStorageには辞書データ本体を保存しない＝ブラウザのHTTPキャッシュに任せる）
#      変更：`src/stores/langStore.ts`に`isLoadingEn`フラグを追加。`lang`を"en"にする処理は
#             `loadEnDict()`解決後にしか行わない（未ロードのenをtranslate()に渡すと全キーが
#             jaフォールバック＋大量console.warnになるため）。前回enを選んでいた場合は起動直後に
#             黙って読み込みだけ開始し、完了次第自動でenに切り替える。読み込み失敗時はjaのまま
#             Toastでエラー通知
#      変更：`src/components/common/LangToggle.tsx`に`isLoadingEn`中の小さい回転スピナー表示を追加
#             （クリック不可・カーソルwait）
#      新規：`vite.config.ts`に`chunk-size-manifest`プラグイン。rollupの`generateBundle`フックで
#             全チャンクの実コードからraw/gzipサイズを実測し`dist/chunk-sizes.json`を生成
#             （gzip計算は既存依存の`fflate`を再利用・新規パッケージ追加なし）。ハードコードした
#             推測値だとビルドとズレるため、必ずビルド出力から実測する設計
#      新規：`src/lib/chunkSizeGate.ts`。`CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES`（暫定200KB・
#             gzip後）を超える`React.lazy`チャンクを初めて要求する時だけダウンロード確認を
#             要求する判定ロジック（`resolveChunkGateStatus`は純粋関数）。承認したかどうかは
#             localStorageに**フラグのみ**保存（`LS_KEY.chunkDownloadApproved`）＝
#             Human in the loopパターン③「承認して記憶」。マニフェストのfetchはアプリ起動直後に
#             前倒しで開始し、ゲート判定自体は同期（未取得時は確認なしで許可に倒し、初回表示の
#             体感速度を犠牲にしない）
#      新規：`src/components/common/ChunkDownloadGate.tsx`の`withChunkDownloadGate()`。
#             `lazyWithRetry()`の戻り値をラップし、承認されるまで実体（LazyExoticComponent）を
#             レンダーしない＝dynamic import()の発火自体を防ぐ。`MainLayout.tsx`の全18個の
#             lazyコンポーネントに適用（現時点で200KBを超えるチャンクは無いため実際には確認
#             ダイアログは発火しない＝仕組みのみ導入。将来チャンクが育った時に自動で効く）
#      修正：`MainLayout.tsx`の`tour:action`リスナー（`useEffect`のdeps=[]）が`t()`をマウント時に
#             クロージャで固定していたバグ（マウント後に言語切替してからツアーデモを発火すると
#             切替前の言語の文言が入る）。リスナーの張り替え（deps に t を追加）ではなく、
#             `useRef`で最新の`t`を保持しリスナーから参照する形で修正（Phase 1の申し送り事項）
#      グランドルール追加：CLAUDE.md Section 18.5「使用者が限られる重量級機能は`React.lazy`で
#             分割し、閾値超えは確認ダイアログを通す」
#      実測（ビルド出力・v3.18→v3.19）：`useT`チャンク 46.50kB→27.40kB raw（gzip 12.77kB→8.87kB）。
#             新設の`common.en`(10.69kB/gzip2.79kB)・`auth.en`(4.89kB/gzip1.80kB)・
#             `layout.en`(5.99kB/gzip2.16kB)は英語未使用ユーザーは一切ダウンロードしない
#             （日本語のみのユーザーの初回ダウンロード量：約19.1kB raw／約3.9kB gzip 削減）。
#             200KB(gzip)を超えるチャンクは現時点で1つも無い（最大は`index`エントリの64.34kB gzip）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 741件全通過（既存737件＋新規4件）／
#             `npm run build`成功
#      DBマイグレ不要（localStorage・vite設定・辞書ファイル構成の変更のみ）
#
# v3.20 fix: ヘルプガイド（manifestチャンク）を遅延読み込み化（2026-08-06）
#      背景：`manifest`チャンク（`docs/guides/**/*.md?raw`24ファイルの全文・raw80.13kB/
#             gzip26.74kB）が、「？」ボタンを一度も押さないユーザーにも常時ダウンロード
#             されていた。原因は`HelpButton.tsx`が`GuideOverlay.tsx`を同期importし、
#             その先の`src/lib/docs/manifest.ts`が全ガイドMarkdownを`import.meta.glob(...,
#             { eager: true })`で静的importしていたため。`HelpButton`自体は`MainLayout.tsx`
#             （アプリ本体）と`ConsultationPanel.tsx`（`MainLayout.tsx`から静的import）の
#             2箇所から常時ロード経路に載っていた
#      事前検証：`manifest.ts`の静的import経路を全て洗い出し（詳細は本文参照）。
#             `GuideModeView.tsx`（manifest.tsを直接静的import）と`AdminView.tsx`
#             （GuideOverlay.tsxを静的import）は両方とも既にMainLayout側でlazyWithRetryに
#             乗っていたため対応不要。常時ロード経路は`HelpButton.tsx`の1箇所のみと確定
#      変更：`HelpButton.tsx`内で`GuideOverlay`を`lazyWithRetry` + `withChunkDownloadGate`で
#             動的import化。呼び出し元8箇所は無変更（HelpButton内で完結）。Suspense
#             fallbackはGuideOverlayと同じ外枠（背景オーバーレイ＋右パネル）にSkeleton3本を
#             敷いた軽量版を新設し、読込中の一瞬が「何も出ない」ように見えないようにした
#      確認：`lazyWithRetry`は既に`src/lib/lazyWithRetry.ts`に共有モジュール化済みだった
#             （MainLayout.tsx側のローカル定義ではなかった）ため、切り出し作業は不要
#      実測（ビルド出力・v3.19→v3.20・index.htmlのmodulepreload対象＝常時ロード分の合計）：
#             raw 792,633B→710,439B（約82.2kB減）／gzip 232,128B→204,799B（約26.7kB減）。
#             `manifest`チャンクは`dist/index.html`のmodulepreloadから消えた（＝GuideOverlay/
#             GuideModeViewいずれかのlazyチャンクを要求した時にだけ動的fetchされる）
#      注記追加：CLAUDE.md Section 19に、`CustomSelect`チャンク（gzip46kB）の97.5%が
#             react-dom本体であり削減不可能なこと、`appStore`チャンク（gzip60kB）の大半が
#             Supabase SDK本体であることを追記（次の調査時間の節約のため）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 741件全通過／`npm run build`成功
#      DBマイグレ不要（コンポーネント分割のみ）
#
# v3.21 feat: EN/JA切替トグルに「英語UIは一部の画面のみ対応」注記を追加（2026-08-06）
#      背景：i18nはPhase 0（土台）＋Phase 1（アプリ骨格・共通UI・認証画面）まで完了・
#             Phase 2以降（ダッシュボード/ガント/カンバン/リスト/タスク編集/OKR/管理画面等
#             の各画面本体）は未着手のまま凍結することが決定（海外事業部展開の具体化時に
#             再開）。この状態でENに切り替えると「枠組みは英語／画面の中身は日本語」という
#             中途半端な見え方になり、不具合と誤解されるおそれがあるため明示する
#      変更：`LangToggle.tsx`に2段構えの注記を追加。
#             (a) tooltip：`lang==="en"`のとき既存title文言（あえてt()を通さず日英併記の
#                 まま固定・既存の設計意図は不変）の末尾に注記(en)を改行追加。レイアウト
#                 影響ゼロ
#             (b) 吹き出し：`lang`が`"en"`になった時（読込時点で既にenの場合も含む）に
#                 一度だけ表示。8秒でフェードアウト・✕で即閉じ可。`localStorage`
#                 （`KEYS.LANG_PARTIAL_NOTICE_SEEN`）で「一度見せたら以後出さない」を管理。
#                 `position:absolute`＋`position:relative`のinline-flexアンカーで実装し
#                 呼び出し元5箇所のレイアウトは無変更
#             辞書キー`common.lang.partialNotice`をja/en両方に追加
#      呼び出し元5箇所の親要素チェーンを確認した結果、`variant="text"`（サイドバー
#             フッター・幅48/196pxでoverflow:hidden）は読める幅の吹き出しがどちら向きに
#             出しても枠外に出て切れるため、この箇所のみ吹き出しを出さずtooltipのみで
#             注記する（安全側の判断）。`variant="icon"`（モバイルヘッダー・LoginScreen/
#             UserSelectScreen/SetupWizard/AccessDeniedScreen）はいずれもoverflow:hiddenの
#             狭い祖先を持たないため吹き出しを表示。位置は全箇所共通でアンカー右下（右端
#             揃え・下方向に展開）に統一し、既存のz-index（ショートカットボタン140・
#             カレンダー編集300等）と衝突しない値（50）を使用
#      色は`var(--color-bg-info)`/`var(--color-border-info)`/`var(--color-text-info)`
#             （警告色・赤は使わない情報トーン）。角丸`var(--radius-md)`
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 741件全通過（既存件数から減少なし）／
#             `npm run build`成功
#      DBマイグレ不要（localStorage・辞書ファイルの変更のみ）
#
# v3.22 fix: PCサイドバーのENトグルで注記が誰にも見えない穴を修正（2026-08-06）
#      背景：v3.21のレビューで発覚。`variant="text"`（PCサイドバーフッター。PCブラウザで
#             ログイン後に使える唯一のEN/JAトグル）は、サイドバー外枠のoverflow:hiddenで
#             吹き出しが枠外に切れるためtooltipのみに倒していたが、tooltipはホバーしないと
#             出ないため「PCでログイン後にENへ切り替えたユーザーには何も見えない」状態に
#             なっていた。山本さんが選んだ仕様（EN選択時に注記を出す）を満たしていなかった
#      変更：`variant="text"`のときは吹き出しの代わりに既存の`showToast(message, "info")`
#             （`src/components/common/Toast.tsx`）を使うよう`LangToggle.tsx`を修正。
#             fixed配置のためサイドバーのoverflow:hiddenの影響を受けず、`ToastContainer`
#             （`App.tsx`）はログイン後の画面に必ずマウントされている（`variant="text"`
#             自体もログイン後のサイドバーでしか使われないため前提を満たす）。localStorage
#             フラグ（`KEYS.LANG_PARTIAL_NOTICE_SEEN`）は吹き出し（`variant="icon"`）と
#             共用し、「注記は生涯1回だけ」を両経路をまたいで維持する
#             （`consumeFirstTimePartialNotice()`ヘルパーに集約）
#      `variant="icon"`側（モバイルヘッダー・ログイン前4画面）の吹き出し・8秒フェード・
#             ✕閉じは無変更。辞書キーも既存の`common.lang.partialNotice`を再利用（新規キー
#             は追加していない）。Toast自体の表示時間・スタイルも変更していない
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 741件全通過（既存件数から減少なし）／
#             `npm run build`成功
#      DBマイグレ不要（コンポーネント内の分岐修正のみ）
#
# v3.23 feat: ラボ系ビューがサイドバーを覆っていた問題を修正（2026-08-06）
#      背景：山本さんの要望「どの機能を触っている時も、基本的にサイドバーは見えるように
#             したい」。体制図・カレンダー・マイページ・関係性グラフ・OKRレポート／
#             クォーター計画／なぜなぜ分析（右ドロワー）は`position: fixed; inset: 0`で
#             サイドバーごと画面全体を覆っていた。設定画面（`adminOverlay`）だけが
#             `flex: 1`でメインエリア内に収まる理想形だった
#      設計：`MainLayout.tsx`のPCレイアウトroot要素にCSSカスタムプロパティ
#             `--app-sidebar-w`（サイドバー展開時196px／折りたたみ時48px）を設定し、各
#             オーバーレイの`inset: 0`を`top:0; right:0; bottom:0;
#             left: var(--app-sidebar-w, 0px)`に変更（`transition: "left 0.2s ease"`も
#             付与。Sidebar自身の`transition: "width 0.2s ease"`と揃えてガタつきを防止）。
#             幅の値は`SIDEBAR_WIDTH_EXPANDED`/`SIDEBAR_WIDTH_COLLAPSED`定数に集約し
#             Sidebar自身の幅指定と二重管理にしていない。モバイルレイアウトのroot要素には
#             変数を設定していない（各オーバーレイ側の`var(--app-sidebar-w, 0px)`フォール
#             バックにより自動的に従来どおり全画面のまま）
#      対象：`ProjectStructureView.tsx`（体制図）／`CalendarLabView.tsx`（カレンダー）／
#             `MyPageView.tsx`（マイページ本体＋ウィジェット追加モーダル）／
#             `GraphView.tsx`（関係性グラフ）／`KrReportPanel.tsx`・
#             `KrQuarterPlanPanel.tsx`・`KrWhyPanel.tsx`（右ドロワー系の暗幕div。ドロワー
#             本体の幅・右寄せ位置は変更なし）
#      `KrJointSessionFlow.tsx`は調査の結果、`position: fixed`のrootが元から存在せず
#             （`flex:1`で埋め込まれる前提の実装）、そもそもサイドバーを覆っていないため
#             対象外とした（MainLayout側での呼び出し方に既存の別課題がある可能性は別途
#             記録。今回は対象外につき未修正）
#      GraphViewのCanvasリサイズ対応：サイドバーの折りたたみ／展開はwindowのresizeイベント
#             を発生させないため、canvas要素自体をResizeObserverで監視するよう追加
#             （`GanttView.tsx`/`ProjectStructureView.tsx`と同じ流儀）。既存の
#             `window.addEventListener("resize", resize)`はそのまま維持し、
#             ResizeObserverを併用する形にした
#      サイドバーのナビ操作（ビュー切替・モード切替・PJ/KR/部署選択）をしたら開いている
#             ラボ系ビューを閉じる`closeLabViews()`を追加。`setAppMode`・
#             `handleSelectProject`・`handleSelectKr`・新設の`handleSelectGroupNav`・
#             Sidebarへ渡す新設の`navSetViewMode`（PCサイドバーのビュー切替専用）から呼ぶ。
#             ツアー機能内部の`setViewMode`呼び出し（"tour:action"ハンドラ）は素のままとし
#             `navSetViewMode`とは分離した（`closeLabViews`を挟むとそのuseEffectの
#             exhaustive-depsが警告を出すため）。`MyPageView`の`onNavigate`は既存のまま
#             `setAppMode`→`setViewMode`を呼ぶ経路のため、`setAppMode`が`closeLabViews`を
#             呼ぶようになったことで自動的にマイページも閉じるようになった
#      CLAUDE.mdにSection 20（グランドルール：全画面ビューでもサイドバーを覆わない）を新設。
#             「サイドバー」「メインエリア」の用語定義もここに明記
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 741件全通過（既存件数から減少なし）／
#             `npm run lint`は変更ファイルに新規エラー・新規警告なし（既存の
#             `jsx-a11y/label-has-associated-control`等11件は変更前から存在する既存分）／
#             `npm run build`成功
#      DBマイグレ不要（フロントエンドのレイアウト・状態管理のみ）
#
# v3.24 fix: 中央寄せモーダルが画面の上下を突き抜けて操作できなくなる不具合を修正（2026-08-06）
#      背景：山本さんの実機報告「『過去のPJから新規PJを作る』でProjectCreateModalを開くと、
#             モーダルが画面の上下を突き抜けて保存ボタンに到達できず、PJを作成できない」。
#             引き継ぎ元PJのタスク一覧（実測145件）が伸びるとモーダル本体が画面外まで伸び、
#             オーバーレイにも`overflow`が無いためはみ出した部分に到達できなかった。
#      根本原因：箱（モーダル本体）に`maxHeight`が無く、コンテンツの高さまで無制限に伸びて
#             いた。オーバーレイの`overflow`未指定も重なり、はみ出し分に到達する手段が
#             無かった。本文の`overflowY:"auto"`は箱に高さ上限が無いと機能しない（親が
#             伸びるだけでスクロールが発生しない）
#      設計：新規`src/components/common/modalStyles.ts`に契約を集約。
#             `modalOverlayStyle(zIndex)`＝`position:fixed;inset:0`＋中央寄せ＋保険の
#             `overflow:"auto"`。`modalBoxStyle(width)`＝`maxHeight:"100%"`（オーバーレイの
#             paddingを除いた内側＝ビューポート内に必ず収まる）＋縦フレックス＋
#             `overflow:"hidden"`。`MODAL_BODY_STYLE`＝`flex:1;minHeight:0;overflowY:"auto"`
#             （`minHeight:0`必須＝フレックス子要素の既定`min-height:auto`でスクロールし
#             なくなる罠を防ぐ）。`MODAL_FOOTER_STYLE`＝`flexShrink:0`（操作ボタンが常に
#             見える）。既存のJSX構造（オーバーレイdiv＞箱div＞ヘッダー/本文/フッター）は
#             変更せず、styleをspreadで差し替えるだけに留めた
#      修正した3件：`ProjectCreateModal.tsx`（今回の報告事象。オーバーレイ・箱・本文・
#             フッターの4箇所を共有スタイルに置き換え）／`QuickAddTaskModal.tsx`（タスク
#             追加ポップアップ。従来はbackdrop divとtop:50%/left:50%/transformで中央寄せする
#             別構造で、箱に高さ上限が一切無かったため同種の不具合リスクがあった。overlay>box
#             のネスト構造に変更し、タイトル・全フィールド・ボタンをMODAL_BODY_STYLEの
#             スクロール領域にまとめた）／`ConfirmModal.tsx`・`MainLayout.tsx`の
#             `tourInviteDialog`（window.confirm代替・初回ツアー招待。ヘッダー/本文/フッター
#             分割の無い単一ブロック構造のため、箱に直接`maxHeight:"100%"`+`overflowY:"auto"`
#             の保険を追加。念のための修正で実害の報告は無い）
#      調査した上で変更不要と判断：`TaskEditModal`／`AdminFormModal`／`TodoDecomposeModal`／
#             `MilestoneAddModal`／`MilestoneEditModal`／`ProjectKarte`／`DashboardView`（AI
#             分析モーダル）／`CommandPalette`／`ConfirmationDialogModal`／
#             `ChangeHistoryModal`／`ShortcutsPanel`／`WidgetConfigModal`／`MyPageView`の
#             ウィジェット追加モーダル／`ErrorBar`＝いずれも既に`maxHeight`＋
#             フレックス構造で画面内に収まっていた。`GuideOverlay`／`HelpButton`／
#             `OkrImportModal`／`MeetingImportPanel`／`OkrDashboardView`の履歴・概要
#             オーバーレイ＝右からのドロワー型（`alignItems:"stretch"`で高さが常に画面
#             いっぱいに固定され、伸びる余地が無い）のため対象外
#      機械チェック：`src/components/common/__tests__/modalStyles.test.ts`を新設
#             （`widgetContract.test.ts`と同じソース走査方式）。`position:"fixed"`かつ
#             `inset:0`で中央寄せ（`alignItems:"center"`+`justifyContent:"center"`）して
#             いるオーバーレイを検出し、`modalStyles.ts`のimportか自前の`maxHeight`が
#             あるかを検査。実装前の事前検証で、src/全体（`position:fixed`使用39ファイル）
#             に対し誤検知ゼロ（ドロワー・全画面ラボビュー・ツールチップは検出パターンに
#             一致しない）と確認済み。ドロワー等は明示的な除外配列`EXCLUDED_FILES`に理由
#             付きで列挙（将来の検出強化に備えた保険）
#      CLAUDE.mdにSection 21（グランドルール：中央寄せモーダルは必ず画面内に収まる高さ
#             上限を持つ）を新設
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 752件全通過（既存741件から
#             新規テスト11件増）／`npm run lint`は変更ファイルに新規エラー・新規警告なし
#             （既存の`jsx-a11y/no-autofocus`等は変更前から存在）／`npm run build`成功
#      DBマイグレ不要（フロントエンドのレイアウト・状態管理のみ）
#
# v3.25 feat: 画面隅に控えめなバージョン表示を追加（2026-08-06）
#      要望：山本さんから「アプリの隅に、目立たないようにバージョン情報も置いてほしい」
#      仕様：画面上の文字は`v{APP_VERSION}`のみ。ホバー時のtooltipにビルド日時
#             （Asia/Tokyo変換済み）も表示。10px・`var(--color-text-tertiary)`・右寄せ
#      配置：①PCサイドバー最下部＝既存のフッター行（アバター/テーマ/EN・JA/🧪/🗓️/⏏）は
#             一切変更せず、その下に独立した細い1行を追加（196px幅が既に詰まっているため
#             行を分ける判断）。折りたたみ時（48px）は非表示。②`LoginScreen`（ログイン/
#             新規登録フォーム・登録完了両方の画面）に`position:fixed`で控えめに表示
#             （`UserSelectScreen`/`SetupWizard`/`AccessDeniedScreen`は対象外）。
#             ③モバイルは対象外の方針だが、ラボ機能ボトムシートのタイトル行
#             （🧪 ラボ機能）に自然に置ける場所があったため、タイトルと同じ行の右端に追加
#      正本の持ち方（ドリフト防止）：新規`src/lib/version.ts`に`APP_VERSION`を1箇所で
#             定義（"3.25"のようにvを含めない）。ビルド日時は`vite.config.ts`の`define`で
#             `__BUILD_TIME__`（UTC ISO文字列）として埋め込み、表示直前に
#             `formatBuildTime()`でAsia/Tokyoの"YYYY-MM-DD HH:mm"へ変換（`hourCycle:"h23"`
#             明示＝`hour12:false`が一部ICU実装で深夜0時を"24:00"にする既知の不具合を回避）。
#             新規`src/components/common/VersionBadge.tsx`（表示・tooltipの薄いラッパー）を
#             サイドバー・ログイン画面・モバイルラボシートの3箇所で共有
#      機械チェック：新規`src/lib/__tests__/version.test.ts`。①`APP_VERSION`が
#             CLAUDE.md冒頭の`v数字.数字`表記と一致するかを実際にファイルを読んで検証
#             （modalStyles.test.ts等と同じ「ソースを読んで検査する」方式。片方だけ
#             バージョンを上げるとテストが落ちて気づける）②`formatBuildTime()`のUTC→JST
#             変換（日付が繰り上がる境界ケース含む）
#      i18n：tooltip文言`common.version.tooltip`（`{version}`/`{buildTime}`変数）を
#             `common.ja.ts`/`common.en.ts`の両方に追加。ja/enキー集合完全一致テストで
#             片方だけの追加漏れを検知
#      やらないこと：`package.json`の`version`との同期はスコープ外（`0.1.0`のまま）／
#             コミットハッシュの埋め込みはしない（gitへの依存をビルドに持ち込まないため）
#      実物確認：`npm run build`後、`dist/assets/index-*.js`に`__BUILD_TIME__`という
#             識別子が残っていない（`define`で実際の値に置換済み）ことと、実際のISO
#             タイムスタンプ・バージョン文字列"3.25"が埋め込まれていることをgrepで確認
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 755件全通過（既存752件から
#             新規テスト3件増）／`npm run lint`は変更ファイルに新規エラー・新規警告なし
#             （既存の`jsx-a11y/no-autofocus`は変更前から存在）／`npm run build`成功
#      DBマイグレ不要（フロントエンドの表示のみ）
#
# v3.26 feat: マイグレーション適用漏れを起動時に検知する仕組みを追加（2026-08-06）
#      背景：20260721_add_task_status_hold_cancelled.sql（v2.74）が本番に未適用のまま
#             約2週間気づかれず、タスクのステータス「保留」「中止」の保存が
#             タスク編集モーダル・カンバン・リスト・ガント・AI提案の反映の全経路で
#             失敗し続けていた事故を受けて実装（CLAUDE.md Section 22参照）
#      仕組み：起動時（管理者のみ・1回）→ RPC（check_schema_health）でスキーマ検査 →
#             欠けていたら管理者にだけ控えめな警告バナー。Human in the loopに従い
#             スキーマは自動修正しない（検知して知らせるだけ）
#      検査項目の正本：新規`src/lib/schema/schemaChecks.ts`に宣言的な配列として持つ
#             （SQL側にハードコードしない。新しいマイグレを足したらここに1行足すだけで
#             済む設計）。初期投入14項目（task_dependencies/baseline列/on_hold・cancelled
#             CHECK/onboarding bootstrap関数2件/group_ids列3件/objectives・key_results
#             のgroup_id列/loading_tips/member_widget_layouts）
#      RPC：新規`supabase/migrations/20260806_add_schema_health_check.sql`の
#             `check_schema_health(p_checks jsonb)`。動的SQL（EXECUTE）は使わず
#             pg_catalog/information_schemaへのパラメータ化された参照のみで判定。
#             SECURITY DEFINER＋`SET search_path = ''`。呼び出せるのは部署管理者・
#             全社スーパー管理者のみ（それ以外は例外ではなく静かに空配列を返す）
#      クライアント：新規`src/lib/schema/checkSchemaHealth.ts`（RPC呼び出し＋判定を
#             純粋関数`resolveSchemaHealthResult`に分離しテスト容易化）・新規
#             `src/components/common/SchemaHealthBanner.tsx`（`src/App.tsx`から
#             管理者にのみマウント。起動時1回・非ブロッキング・warningトーン・
#             閉じても次回読み込み時にはまた表示＝localStorageで永久に黙らせない）。
#             RPC自体が未適用（PGRST202）のときは黙って無効化せず「検査を実行できません」
#             を明示（v3.19のDL確認ゲートと同じ轍を踏まないため）
#      i18n：`common.schemaHealth.title`/`body`/`rpcUnavailable`を`common.ja.ts`/
#             `common.en.ts`の両方に追加
#      機械チェック：新規`src/lib/schema/__tests__/schemaChecks.test.ts`（各項目の
#             `migration`ファイルが`supabase/migrations/`に実在するかを検証。存在しない
#             ファイル名を書いた時点で落ちる）・新規`checkSchemaHealth.test.ts`
#             （`toCheckPayload`/`isRpcMissingError`/`resolveSchemaHealthResult`の純粋関数
#             を直接検証。supabaseクライアントはモックしない）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 783件全通過（既存755件から
#             新規テスト28件増）／`npm run lint`は変更ファイルに新規エラー0／
#             `npm run build`成功
#      山本さんの作業：新規マイグレ`20260806_add_schema_health_check.sql`をSupabase
#             SQL Editorに全文適用（dev→prod）。適用後、管理者としてログインしバナーが
#             出ないこと（正しく検知できること）を実機で確認
#
# v3.27 fix: ログアウトを押しても効かない不具合を修正（2026-08-06）
#      背景：山本さんの実機報告「ログアウトを押してもログアウトできないようになっている」
#      根本原因：`src/App.tsx`の`handleLogout`がSupabaseの`signOut()`を呼ばず、ローカルの
#             選択状態（`clearCurrentUser`/`setCurrentUserState(null)`）だけを消していた。
#             認証セッションは生きたままのため、`currentUser`がnullになった瞬間に
#             `AuthenticatedApp`の`autoMatch()`（deps に`currentUser`を含む）が再実行され、
#             Auth emailと`members.email`の一致で同じユーザーを即座に再特定し`onLogin()`
#             してしまい、押しても何も起きないように見えていた。`autoMatch()`自体は正しく
#             動作しているため変更していない
#      修正：`handleLogout`を非同期化し、`signOut()`の完了を待ってから
#             `setGuestMode(false)`→`clearCurrentUser()`の順でローカル状態をクリアする
#             （順序を逆にすると、クリア直後に`autoMatch()`が走る隙ができるため固定）。
#             `appStore`（zustand）に残る前ユーザーのタスク・PJ等のメモリ残留を断つため、
#             ストアの個別リセットではなく`window.location.reload()`で画面全体を再構築する
#             （迷ったらリロードを選ぶ方針）
#      失敗時の扱い：`signOut()`がネットワーク断等で失敗した場合、ローカル状態は
#             クリアしない（クリアしてもサーバー側セッションは生きたままで、結局
#             `autoMatch()`が同じユーザーに戻してしまい本質的には未解決なため）。
#             `formatErrorForUser`＋`showToast`でエラーを明示し、再試行を促すだけに留める
#             （無言で何も起きないことを避ける・CLAUDE.md Section 15準拠）
#      二重signOutの確認：`onLogout()`を直接呼んでいる箇所は`AccessDeniedScreen.tsx`の
#             1箇所のみ（`MainLayout.tsx`のサイドバー・モバイルヘッダーは`onClick={onLogout}`
#             という参照渡しで、実体は`App.tsx`の`handleLogout`）。同ファイルは既に自前で
#             `await signOut()`→`onLogout()`の順で呼んでおり、今回の修正後は
#             `signOut()`が2回呼ばれる経路になる。`@supabase/auth-js`
#             （`GoTrueClient._signOut`）の実装を確認：セッションが無い（＝1回目で既に
#             ログアウト済み）場合はサーバーへの呼び出し自体を行わず`{ error: null }`を
#             返して正常終了するため、例外は発生しない
#      機械チェック：新規`src/__tests__/logout.test.ts`（`modalStyles.test.ts`と同じ
#             ソース走査方式。React Testing Library等の実マウント前例が本リポジトリに
#             無いため）。`App.tsx`の`handleLogout`が`signOut()`をimportし、
#             `clearCurrentUser()`より前に呼んでいること／`catch`＋`showToast`を持つこと／
#             `window.location.reload()`を持つことを検証。加えて`onLogout()`の直接呼び出し
#             箇所が`AccessDeniedScreen.tsx`の1件のみであること・同ファイルが
#             `signOut()`→`onLogout()`の順で呼んでいることも固定（新しい直接呼び出し箇所が
#             増えたら気づけるようにするため）
#      やらないこと：`autoMatch()`のロジック変更・ゲストモード関連の改修（別途計画予定）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run` 790件全通過（既存783件から
#             新規テスト7件増）／`npm run lint`は変更ファイルに新規エラー0／
#             `npm run build`成功
#      DBマイグレ不要（フロントエンドの認証フローのみ）
#
# v3.28 feat: ゲスト用サンプルデータビュー（Phase 2）を実装（2026-08-06）
#      背景：「アプリの内容や見栄えだけを見てみたい」人向けに、架空のサンプルデータで
#             アプリを見てもらう入口を作る。既存のゲストモード（`guestMode.ts`）は
#             入口の表示条件（`members.length>0`）と到達条件（`autoMatch`不成立）が
#             どちらも「RLSがメンバーと認識するか」に依存する同一条件のため構造的に
#             両立せず、事実上到達不能だった。仮に到達できても、ゲストは独立した権限
#             主体ではなくログイン済み実ユーザーのセッションに被せた見た目だけの
#             ペルソナで、書き込みブロックは`from(table)`のinsert/update/upsert/delete
#             だけが対象＝select（読み取り）・rpc・functions.invoke・storageは素通り
#             していたため、実部署の業務データが全部見えてしまう構造だった
#      方針の反転：「特定の経路を塞ぐ」から「原則全部止める」へ。ゲストはSupabaseに
#             一切接続しない設計にした
#      choke point：`src/lib/supabase/client.ts`の`supabase`Proxyに`assertGuestBlocked()`
#             を追加し、`from()`（読み書き両方）・`rpc()`・`functions.invoke()`・
#             `storage.from()`の全経路を単一の関数でブロックする。Phase 3でAI機能を
#             限定開放する際の例外はここに1つ足す形にする（コメントで明示済み）
#      入口：`LoginScreen.tsx`に「サンプルを見る」ボタンを追加（Supabase Authの
#             サインインは行わない＝アカウント不要）。押すと`App.tsx`の
#             `handleGuestEnter`が`setGuestMode(true)`→サンプルデータを動的import
#             （`src/lib/demo/loadDemoDataset()`）→`appStore.loadDemoData()`で
#             ストアへ直接注入→`guestActive`フラグをtrueにして`MainLayout`を直接表示。
#             `AppDataProvider`（Supabase `load()`・realtime購読）の配下には一切置かない
#             （`authenticated`判定より前に`guestActive`を分岐）。`AppDataContext.tsx`側にも
#             `isGuestMode()`ガードを二重防衛として追加
#      削除：到達不能だった旧ゲスト導線（`UserSelectScreen.tsx`の「見学の方」ブロック）と
#             不要になったi18nキー（`auth.userSelect.visitorHeading`/`guestLabel`/
#             `guestDesc`）を削除
#      サンプルデータ：`src/lib/demo/`配下（`dataset.ts`本体・`constants.ts`・`types.ts`・
#             `guestPersona.ts`・`loadDemoDataset.ts`）。架空事業部・架空メンバー5名・
#             PJ6件・タスク約62件・OKR1セット（Objective1→KR3→TF4→ToDo5）。全idは
#             `demo-`接頭辞、group_idは`grp-demo`に統一（`__tests__/dataset.test.ts`が
#             機械的に検証）。日付は`addDaysFromToday()`基準の相対オフセットで生成（固定
#             日付だと時間経過で不自然になるため）。依存関係チェーン4本・ベースライン
#             差分1件・マイルストーン3件・5ステータス全種・過負荷帯（鈴木陸に展示会
#             タスクを集中）・親子タスクを含む。マイページ既定ウィジェットが空表示に
#             ならないよう、`guestPersona.ts`がランタイム専用の後処理でゲスト自身
#             （`GUEST_MEMBER`）をmembersに追加し、3件のタスクの担当者を付け替える
#             （`dataset.ts`自体の出力は"demo-接頭辞のみ"を保ったまま不変）
#      AI機能：`invokeAI.ts`/`apiClient.ts`（`callAIConsultation`）の先頭でゲストなら
#             明示的なエラー（`common.guest.aiBlocked`＝「サンプルではAI機能はご利用
#             いただけません」）を投げる。`client.ts`のブロックが二重の防衛線
#      i18n：`auth.guest.*`（LoginScreenの文言）・`common.guest.aiBlocked`をja/en両方に追加
#      ドキュメント：CLAUDE.md Section 23を新設（ゲストモードの設計・Supabase非接触の
#             安全性根拠・Phase 3の拡張ポイントを明記）
#      テスト：`src/lib/demo/__tests__/dataset.test.ts`（id/group_id接頭辞・参照整合性・
#             5ステータス網羅・依存関係循環無し・ベースライン/マイルストーン存在・静的
#             import禁止のソース走査）・`src/lib/supabase/__tests__/client.test.ts`
#             （guest時にfrom/rpc/functions.invoke/storage.fromの全経路がブロックされる
#             ことを実行時に検証）・`invokeAI.test.ts`/`apiClient.test.ts`にゲストガードの
#             テストを追加
#      やらないこと：ゲストへの編集許可（閲覧のみ）・匿名認証・AI回数制限（いずれも
#             Phase 3）・実データを参照したサンプル作成
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`全通過／`npm run lint`変更ファイル
#             新規エラー0／`npm run build`成功・サンプルデータが別チャンクに分離され
#             初回ロードに含まれないことを`dist/`実物で確認
#      DBマイグレ不要（フロントエンドのみ・Supabaseアクセスを増やさない変更）
#
# v3.29 ゲスト（サンプル閲覧）へのAI機能限定開放（Phase 3。2026-08-07）
#      背景：v3.28（Phase 2）で「ゲストはSupabaseに一切接続しない」設計にした後、この
#             遮断に`functions.invoke("ai-consult")`だけの例外を1つ開けてAI機能を開放する
#      匿名認証：ゲストがAIを初めて使うときだけ`src/lib/supabase/guestAiAuth.ts`の
#             `ensureGuestAiSession()`が`signInAnonymously()`でセッションを遅延生成
#             （Edge Functionが有効なJWTを要求するため）。ゲストの通常操作（サンプル閲覧）
#             は引き続きSupabaseに一切接続しない
#      choke pointの例外：`client.ts`に`isGuestInvokeBlocked(functionName)`を追加し、
#             `functionName === "ai-consult"`のときだけブロックしない。他の関数名・
#             `from()`/`rpc()`/`storage`は一切緩めていない
#      ゲスト判定：`supabase/functions/ai-consult/index.ts`がJWTの`is_anonymous`クレーム
#             （`user.is_anonymous`）だけで判定する。クライアント送信のフラグは見ない
#      回数制限（DBで原子的に強制）：`guest_ai_usage_daily`（ブラウザ別）・
#             `guest_ai_usage_global_daily`（全体）の2テーブルと、無条件で加算して
#             件数を返すだけのSECURITY DEFINER関数`consume_guest_ai_quota()`
#             （`service_role`限定・`authenticated`/`anon`にはEXECUTE権限を渡さない）を
#             `supabase/migrations/20260807_add_guest_ai_quota.sql`で追加。しきい値超過
#             判定は`supabase/functions/ai-consult/guestQuota.ts`の`decideGuestAiQuota()`
#             （Deno/ブラウザ依存の無い純粋関数）が行う。しきい値の数字はEdge Function側の
#             定数1箇所（既定：ブラウザ別1日3回・全体1日10回）だけで管理
#      エラー分離：個人上限超過は`GUEST_DAILY_LIMIT_EXCEEDED`（「サンプルでのAI利用は
#             1日3回までです」）、全体上限超過は`GUEST_GLOBAL_LIMIT_EXCEEDED`（「本日の
#             サンプルAI利用枠が上限に達しました」）と別コード・別文言で区別。
#             `apiClient.ts`/`invokeAI.ts`が日本語メッセージまで通す
#      管理画面への反映：`ai_usage_logs`に`is_guest`列を追加。Edge FunctionがAnthropic
#             応答成功後にサービスロールで`member_id="__guest__"`・`is_guest=true`の
#             ログを記録（クライアントからのINSERTは`from()`ブロックで常に失敗するため
#             唯一の記録経路）。`AdminView.tsx`のAI使用量タブに「🧪 ゲスト（サンプル利用）」
#             の全期間合計行を追加（部署の絞り込みは適用しない）
#      併せて是正した既存ドリフト：`ai_usage_logs`のINSERT用ポリシーが本番には存在するが
#             一度もマイグレーション化・`schema.sql`化されていなかった点を明文化（本番への
#             実害は無し。参照用DDLの是正）
#      ドキュメント：CLAUDE.md Section 23にPhase 3の実装内容を追記
#      テスト：`decideGuestAiQuota()`の境界値（ブラウザ別3回目/4回目・全体10回目/11回目・
#             両方超過時の優先順位）・`ensureGuestAiSession()`の単体テスト・
#             `isGuestInvokeBlocked()`（例外はai-consultだけ）・ゲスト判定が
#             `user.is_anonymous`のみに基づくことのソース走査・`invokeAI.ts`/`apiClient.ts`
#             のゲスト経路（intentをbodyに含めること含む）を追加
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`849件全通過（823件から26件増）／
#             `npm run lint`変更ファイル新規エラー0／`npm run build`成功
#      要手動作業：Supabaseダッシュボードでの匿名認証の有効化・マイグレーション適用・
#             Edge Function（ai-consult）の再デプロイ（詳細は報告参照）
#
# v3.30 ゲストAI回数制限の可用性バグ修正（本番適用前のレビュー指摘。2026-08-07）
#      欠陥：v3.29の`consume_guest_ai_quota()`は「無条件で両方のカウンタをインクリメント
#             してから事後判定する」設計だった。このため拒否されたリクエストも全体枠を
#             消費してしまい、1ブラウザが上限（3回）を超えて何度も押すだけで全体枠
#             （10回/日）を1人で食い潰せる可用性バグがあった（コストは守られていた＝
#             拒否された試行はAnthropicを呼ばないため課金は発生しない）。マイグレは
#             dev/prod共に未適用だったため、新規マイグレを追加せずファイル自体を直接修正
#      修正：`consume_guest_ai_quota()`を「上限未満のときだけ加算する条件付き加算」に変更。
#             `INSERT ... ON CONFLICT DO UPDATE ... WHERE call_count < 上限`で、上限到達時は
#             RETURNINGが0行（=NULL）になり判定できる（判定と加算が同一SQL文＝TOCTOUレース
#             無し）。全体枠を先に条件付きで加算し、通ってからブラウザ別枠を条件付きで加算。
#             ブラウザ別枠で拒否されたら、直前に加算した全体枠を同一トランザクション内で
#             1減算して取り消す（拒否時にどちらのカウンタも消費しないための補償）。拒否理由
#             の優先順位（全体枠切れを優先）は維持。しきい値は引き続きEdge Function側の
#             定数1箇所からSQLへ引数で渡す（`p_browser_limit`/`p_global_limit`追加）
#      guestQuota.ts：`decideGuestAiQuota()`（事後判定用の純粋関数）を廃止し、
#             `simulateConsumeGuestAiQuota()`（SQL関数と手順を1対1で対応させた参照実装）に
#             置き換えた。本番の判定経路ではなく、実際のPostgresを起動できないテスト環境で
#             SQL側の状態遷移ロジック（条件付き加算・補償）をVitestで固定するためだけに存在する
#      テスト：境界値（ブラウザ3回目/4回目・全体10回目/11回目）・拒否時に両カウンタが
#             不変であること（今回の欠陥の再現テスト＝4回目以降を20回試しても全体カウンタが
#             増えないこと）・補償が効いていること・拒否理由の優先順位を
#             `guestQuota.test.ts`に追加（5件→8件）
#      ドキュメント：CLAUDE.md Section 23のPhase 3節を新しい設計に更新
#      マイグレーション：`supabase/migrations/20260807_add_guest_ai_quota.sql`を直接修正
#             （dev/prod共に未適用のまま。新規ファイルは追加していない）。schema.sqlも同期
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`852件全通過（849件から3件増）／
#             `npm run lint`変更ファイル新規エラー0／`npm run build`成功
#      Edge Function再デプロイ：引き続き必要（index.tsのRPC呼び出し引数・戻り値の扱いを変更）
#
# v3.31 ゲストAI利用回数の明示UI（使う前に上限を伝える。2026-08-07）
#      背景：v3.29〜v3.30でゲストにAI機能を回数制限つき（既定：ブラウザ別3回/日・全体10回/日）で
#             開放したが、上限に達して初めてエラーで知る状態だった。「PJ分析で使い切られたら
#             もったいない」との指摘を受け、使う前に「1日3回まで」を明示するUIを追加
#      追加：`src/lib/guestAiQuotaCounter.ts`（localStorageベースの表示専用カウンタ）。
#             `{date, count}`をKEYS経由の1キーに保存し、日付が変わっていれば0として扱う
#             （明示的なクリア処理は持たない）。表示は参考値であり、回数制限の強制は
#             引き続きEdge Function→`consume_guest_ai_quota()`（SQL）だけが行う。
#             上限値`GUEST_AI_DAILY_LIMIT`（=3）は`ai-consult/index.ts`の
#             `GUEST_AI_PER_BROWSER_DAILY_LIMIT`と二重管理（環境変数で上限を変えたら
#             両方直すこと）。日付跨ぎ・加算・下限クランプの判定は`resolveGuestAiUsedCount`/
#             `resolveGuestAiRemaining`という純粋関数に分離（vitestが`environment:"node"`で
#             localStorage非対応のため。`chunkSizeGate.ts`と同じ方針）
#      追加：`src/components/common/GuestAiQuotaNotice.tsx`（banner/inlineの2バリアント）。
#             ゲスト以外は常にnullを返すため呼び出し側は分岐不要。`useT()`フックではなく
#             `useLangStore.getState()+translate()`の「素の関数」方式（`invokeAI.ts`の
#             `tOutside`と同じ流儀）にして、Reactレンダラー無しでも直接呼び出してテストできる
#             ようにした
#      加算ポイント：`invokeAI.ts`/`apiClient.ts`の2箇所。AI呼び出しが成功したときだけ
#             `recordGuestAiUse()`を呼ぶ。429（GUEST_DAILY_LIMIT_EXCEEDED等）や他のエラー時は
#             加算しない
#      表示箇所：`MainLayout.tsx`（既存ゲストバナー内）・`LoginScreen.tsx`
#             （`auth.guest.desc`に追記）・`ConsultationPanel.tsx`（タブ説明バー内）・
#             `ProjectKarte.tsx`／`DashboardView.tsx`（PJ分析実行ボタン付近）。
#             いずれもflexの`gap`に乗せる形で設置し、ゲストでない時（nullを返す時）に
#             余分な空白が生まれないようにした。ボタンの無効化はしない（クライアント側の
#             参考値だけで誤って締め出さないため）
#      i18n：`common.guest.quota.remaining`/`common.guest.quota.exhausted`をja/en追加。
#             `auth.guest.desc`にAI利用回数の案内を追記（{limit}で補間）
#      ドキュメント：CLAUDE.md Section 23に「回数の明示UI」の項を追記
#      テスト：`guestAiQuotaCounter.test.ts`（純粋関数の境界値・localStorage非対応時の
#             安全性）・`GuestAiQuotaNotice.test.tsx`（ゲスト以外でnull）を新規追加。
#             `invokeAI.test.ts`/`apiClient.test.ts`に「成功時のみ加算・エラー時は
#             加算しない・非ゲストでは呼ばない」を追加
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`873件全通過（852件から21件増）／
#             `npm run lint`変更ファイル新規エラー0（既存warning4件のみ）／`npm run build`成功
#      要手動作業：無し（マイグレーション・Edge Function変更は今回のスコープ外）
#
#
# v3.32 ゲストのオンボーディングツアーが破綻しないよう修正（2026-08-07）
#      背景：`TourProvider`はMainLayoutの内側にありゲストの描画経路も通るため、ツアー機能
#             自体はゲストでも生きていた。しかしツアー定義（first-time.ts）は実ユーザー前提の
#             ままで、ゲストで実行すると2つの実害があった。①`fab`ステップ（右下＋ボタンの
#             説明）はtargetを持たない中央表示ステップのためskipIfMissingが効かず、ゲストでは
#             非表示のFABの説明がそのまま出てしまう。②`ai-consult-demo`ステップは
#             `action:"demo-ai-consult"`で実際にAI相談を1回送信する実演のため、ツアーを見る
#             だけでゲストのAI利用枠（1日3回）を1回消費してしまう
#      追加：`src/components/tour/tours/index.ts`に純粋関数`buildTours({isGuest})`を追加。
#             `isGuest=false`は既存の`ALL_TOURS`をそのまま返す（通常ユーザーは無影響）。
#             `isGuest=true`は`firstTimeTour`の複製を作り直し、fabステップを除去・
#             ai-consult-demoステップをaction/target無しの説明のみ（placement:"center"）に
#             差し替え・welcomeステップの本文に「表示されているのは架空のサンプルデータ」の
#             1行を追加する。`firstTimeTour`（モジュールレベル定数）自体は書き換えない
#      変更：`src/components/layout/MainLayout.tsx`の`TourProvider`への`tours`props を
#             `ALL_TOURS`固定から`useMemo(() => buildTours({isGuest: isGuestMember(currentUser)}),
#             [currentUser])`に変更。毎レンダーで新しいオブジェクトを作らないことで
#             `TourProvider`内の`useCallback`の作り直し（不要な再レンダー）を避けた
#      対象外：`TourProvider.tsx`本体・`skipIfMissing`の仕組みは変更していない
#             （ツアー定義側だけで解決できたため）
#      ドキュメント：CLAUDE.md Section 23に「ゲストのオンボーディングツアー」の項を追記
#      テスト：`src/components/tour/tours/__tests__/buildTours.test.ts`を新規追加
#             （demo-ai-consultアクションが1つも無い・fabステップが無い・非ゲスト版は
#             ALL_TOURSと同一・呼び出し後もALL_TOURSが変化しない・target有りステップは
#             skipIfMissing必須、の7件）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`880件全通過（873件から7件増）／
#             `npm run lint`変更ファイル新規エラー0／`npm run build`成功
#      要手動作業：無し（DBマイグレーション・Edge Function変更は今回のスコープ外）
#
#
# v3.33 全画面ラボ系ビューをposition:fixedから角丸カード内flexへ全面変更（2026-08-07）
#      背景：v3.23〜v3.24で導入した「アプリ外枠（`body{padding:8px}`＋`#root{border-radius;
#             overflow:hidden}`で作る角丸カード）」と、v3.23で導入したラボ系ビューの
#             `position:fixed; left:var(--app-sidebar-w,0px)`方式が根本的に相性が悪かった。
#             `position:fixed`はビューポート基準で描画されるため`#root`のoverflow:hiddenの
#             対象外になり、①外周8pxの余白まで塗りつぶし丸縁の外へはみ出す、②角が直角のまま
#             丸縁が消える、③leftの基準もビューポートのため実際はサイドバー右端8pxに重なる、
#             という3つの不具合が常に発生していた（山本さんの指摘：「メニューバーに被らない
#             ように上からレイヤーをかぶせているみたいで、元々の丸縁の枠に収まっていないのが
#             嫌」）
#      変更：対象7ビュー（GraphView・CalendarLabView・ProjectStructureView・MyPageView・
#             KrReportPanel・KrQuarterPlanPanel・KrWhyPanelの非inline時）のroot styleから
#             position/top/right/bottom/left/zIndex/transitionを削除し、
#             `{flex:1,minWidth:0,minHeight:0,overflow:"hidden",...}`（内部のdisplay/
#             flexDirection/alignItems/justifyContent等ビューごとの構成は維持）に変更。
#             GraphViewのみ、直下の凡例パネル等position:absoluteな子要素の基準を保つため
#             `position:"relative"`を追加（fixedの禁止対象ではない）
#      追加：`MainLayout.tsx`に`labOverlay`（PCのみ対象。`isGuideOpen ? guideOverlay :
#             (isAdminOpen&&!isGuest) ? adminOverlay : labOverlay ? labOverlay : appMode==="okr"
#             ? ... : ...`の優先順位でmainContent内に埋め込む。分岐順はGraph→Calendar→
#             Structure→MyPage→KrReport→KrWhyで一意に決まる）と、モバイル専用の薄い全画面
#             ラッパー`MobileFullscreenOverlay`（position:fixed;inset:0はここだけに残す）を追加
#      変更：MyPageView.tsx内の「＋ウィジェットを追加」モーダル（AddWidgetModal）はビュー本体
#             とは別（一時的な中央寄せポップアップ・Section21対象）のため、`modalStyles.ts`の
#             `modalOverlayStyle()`/`modalBoxStyle()`/`MODAL_BODY_STYLE`を使う形に変更
#             （position:fixedのまま・Section20の対象外）
#      削除：CSSカスタムプロパティ`--app-sidebar-w`（`MainLayout.tsx`のPCレイアウトroot要素の
#             設定と関連コメント）。src/全体で利用箇所が無いことを確認済み
#      対象外：モバイルは`body{padding:0}`で角丸カード自体が存在しないため、従来どおり全画面
#             表示のまま（呼び出し側のMobileFullscreenOverlayで対応）。ゲストバナー・AI相談
#             パネルとの共存挙動・ガント/カレンダー印刷CSS・GraphViewのcanvasリサイズは無変更
#      ドキュメント：CLAUDE.md Section 20を新方式に全面書き換え（旧方式の欠陥を明記）。
#             Section 21の「Section20対象外」表現も新方式に追従
#      テスト：`src/components/__tests__/labViewContainment.test.ts`を新規追加
#             （①src/のどのファイルにも`var(--app-sidebar-w`が無いこと、②対象7ビューの
#             ビュー本体rootがposition:"fixed"を使っていないこと、をソース走査方式で検査）。
#             `modalStyles.test.ts`のEXCLUDED_FILESから、position:fixedを使わなくなった
#             全画面ラボビュー4ファイルを削除（除外が不要になったため。将来の逆行を見逃さない）。
#             【2026-08-07修正】①の検査を`it.each`で全ソースファイルに展開すると、grep 1本の
#             検査だけでテスト件数が約300件水増しされ、CHANGELOG記録上の「テスト件数の増減＝
#             変更規模のシグナル」が埋もれてしまうため、1件のテストに集約（違反ファイルの配列を
#             `expect(offenders).toEqual([])`で比較。失敗時は配列の差分にファイルパスがそのまま
#             出るため診断能力は落ちない）。②（対象7ファイル固定）は`it.each`のまま維持
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`889件全通過（880件から9件増）／
#             `npm run lint`変更ファイル新規エラー0（既存35件のみ・内訳不変）／`npm run build`成功
#      要手動作業：無し（DBマイグレーション・Edge Function変更は今回のスコープ外）
#
# v3.34 ラボ系ビューの開閉を「重ねる」から「切り替える」構造へ変更（2026-08-07）
#      背景：v3.33までラボ機能（体制図・関係性グラフ・カレンダー・マイページ・OKRレポート／
#             なぜなぜ分析）ごとに独立した真偽値state（isGraphOpen/isCalendarOpen/
#             isStructureOpen/isMyPageOpen/isKrReportOpen/isKrWhyOpen）を持っていたため、
#             Bを開いてもAが閉じず両方trueになり得て、`labOverlay`の分岐が宣言順で先勝ち
#             （Graph→Calendar→Structure→MyPage→KrReport→KrWhy）に1つ選んでいた。押した
#             機能が宣言順で後ろだと画面が変わらず、押し直しても既にtrueなので何も起きない、
#             という不具合だった（山本さんの指摘：「Aを押した後にBを押して、その後また
#             Aを見ようとAを押しても、Bの下に隠れてAが見えない。重ねるのではなく画面が
#             切り替わるようにしてほしい」）
#      変更：`MainLayout.tsx`の6つの真偽値stateを、単一state
#             `activeLabView: LabViewId | null`（`LabViewId`は"graph"/"calendar"/
#             "structure"/"mypage"/"kr-report"/"kr-why"/"kr-session"の7値）に置き換え。
#             `closeLabViews()`は`setActiveLabView(null)`の1行に。`labOverlay`は
#             `activeLabView`に対する`switch`に置き換え、`default`節で`LabViewId`を
#             `never`型変数に代入することで、id追加時に分岐を書き忘れると型エラーで
#             気づけるようにした（テスト追加は不要と判断）。同じ機能のボタンを押し直しても
#             閉じない（開いたまま）仕様は維持——サイドバーのビュー切替ナビと同じ挙動に揃える
#             ための意図的な仕様
#      変更：`KrJointSessionFlow`（OKRの「セッション記録」）を`activeLabView`の対象に統合。
#             旧方式ではposition:fixedを使わない設計のためv3.33の対象外だったが、
#             `isKrSessionOpen`単独の真偽値でPCでは`mainContent`の兄弟として描画されており
#             メインエリアの横に並んで表示され他のラボ機能と挙動が揃っていなかった。
#             `activeLabView === "kr-session"`として統合し、他と同じく`labOverlay`経由で
#             メインエリア内に描画。このコンポーネント自身のrootは`minHeight:0`を持たない
#             （他のラボビューは持つ）ため、`labOverlay`側で
#             `{flex:1,minWidth:0,minHeight:0,overflow:"hidden",...}`のラッパーで包み契約に
#             合わせた（コンポーネント自体は変更していない）
#      変更：モバイル分岐（`isMobile`のreturnブロック）も同じ`activeLabView`を参照する形に統一。
#             モバイルに入口が無いビュー（calendar/mypage。旧方式でも`isMobile ? null`の
#             labOverlayガードにより描画されていなかった）は今回も新たな入口を追加していない
#      変更：`Sidebar`に`activeLabView`をpropsで追加し、ラボサブメニューの4項目
#             （体制図・関係性グラフ・カレンダー・マイページ）に既存の`NavItem`の`active`
#             プロップ（NAV_ITEMSと同じスタイルトークン）を渡し、現在開いているビューを
#             ハイライト表示するようにした
#      付随state：`graphEditTaskId`/`calendarEditTaskId`/`calendarQuickAddDate`/
#             `myPageEditTaskId`はクリアしない（現状維持）。既存の`closeLabViews()`呼び出し元
#             （`setAppMode`/`handleSelectProject`/`handleSelectKr`/`handleSelectGroupNav`/
#             `navSetViewMode`）も元々これらをクリアしておらず、ラボビューの✕ボタンで閉じても
#             同様にクリアされない設計だった（TaskEditModal等は独立して閉じられる）。今回の
#             単一state化はこの既存の設計判断を変更するものではないため、踏襲した
#      ドキュメント：CLAUDE.md Section 20に新設計の背景・契約を追記（v3.34）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`889件全通過（件数不変。switchの
#             `default: never`による型レベルの網羅性チェックで代替し、機械テストは追加しな
#             かった）／`npm run lint`変更ファイル新規エラー0／`npm run build`成功
#      要手動作業：無し（DBマイグレーション・Edge Function変更は今回のスコープ外）
#
# v3.35 ラボビュー切替時の付随state（編集モーダル等）クリア漏れを修正・choke point化（2026-08-07）
#      背景：v3.34で「付随state（graphEditTaskId/calendarEditTaskId/calendarQuickAddDate/
#             myPageEditTaskId）はクリアしない（現状維持）」と判断したが、これは誤りだった
#             （統括レビュー指摘）。根拠にした「既存のcloseLabViews()呼び出し元も元々クリア
#             していなかった」は、v3.33までラボビューを2つ同時に開けなかったため「ビューAから
#             ビューBへ切り替える」操作自体が存在せず、その経路での取り残しが起こり得なかった
#             ことに当てはまる。v3.34の単一state化で切り替えが可能になったことで、実害が
#             新規に発生する：GraphViewでタスクをクリックしてTaskEditModalを開いた
#             （graphEditTaskIdがセットされる）状態のまま、サイドバーでCalendarに切り替える
#             と、GraphViewは閉じたのに、そこから開いたタスク編集モーダルだけがCalendarの上に
#             残る（どのビューから開いたか分からない浮遊モーダルになる）。calendarQuickAddDate
#             （カレンダーの日付セルから開くクイック追加）も同様
#      変更：`MainLayout.tsx`に`openLabView(id: LabViewId)`を新設し、`setActiveLabView`を
#             直接呼ぶ箇所を`openLabView`と`closeLabViews`の2つだけに限定（choke point化）。
#             `openLabView`は「前と違うidに変わるときだけ」上記4つの一時stateをまとめて
#             クリアする（同じビューを開いたまま行う通常操作——例：MyPage表示中に
#             onOpenTaskでmyPageEditTaskIdをセットする操作——まで巻き込まないよう、
#             「前と同じidなら何もしない」を先に判定）。`closeLabViews`はビューを閉じる
#             ときに常に4つともクリアするよう変更（サイドバーのナビ操作・各ビューの✕ボタンの
#             両方から効く）
#      ドキュメント：CLAUDE.md Section 20に「choke pointを通し付随stateをクリアする」契約を
#             追記（v3.35）。新しいラボビューを追加する際に同じ穴を作らないための明記
#      テスト：`src/components/__tests__/labViewChokePoint.test.ts`を新規追加（2件）。
#             `MainLayout.tsx`内の`setActiveLabView(`呼び出しの総出現数と、`openLabView`/
#             `closeLabViews`の関数本体内の出現数を突き合わせ、choke pointの外で直接呼んで
#             いる箇所があれば検出する（ソース走査方式。`labViewContainment.test.ts`と同じ
#             流儀）。実装前に意図的に違反コードを注入して検出できることを確認済み
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`891件全通過（889件から2件増）／
#             `npm run lint`変更ファイル新規エラー0／`npm run build`成功
#      要手動作業：無し
#
# 最終更新：2026-08-07（v3.35）
#
# v3.36 OKRモード再設計 Phase 1 Step A：個人OKR層のDB・型・ストア層を追加（2026-08-07）
#      背景：docs/dev/okr-redesign-plan.md（統括Claude／山本さんとの設計セッション）で
#             確定した「Kintoneが正本・アプリはKintoneに存在しない『週の層』を埋める実行層」
#             という再設計方針のうち、Step A（DB・型・ストア層のみ。画面は作らない）を実装
#      変更：新規マイグレーション `supabase/migrations/20260807b_add_personal_okr.sql`
#             （personal_krs/personal_kr_months/personal_kr_weeks/personal_kr_week_tasks/
#             personal_kr_memosの5テーブル。⚠️山本さんの手動適用が必要・未適用）／
#             `supabase/schema.sql`に同期／`src/lib/schema/schemaChecks.ts`に検査項目5件追加／
#             `src/lib/localData/types.ts`にPersonalKr等5型を追加／
#             `src/lib/supabase/personalOkrStore.ts`を新規追加（低レベルCRUD・flat関数群。
#             appStore.tsには組み込まない＝OKRモードを開かない人にクエリを発生させない）／
#             `src/lib/supabase/store.ts`のsaveWithLockをexport化（personalOkrStoreから再利用）
#      設計判断：RLSは本人のみ。personal_krs以外の4テーブルは列にmember_idを冗長保持せず、
#             SECURITY DEFINERヘルパー関数（personal_kr_owner_member_id/
#             personal_kr_week_owner_member_id）で親を辿って判定する方式を採用（理由は
#             マイグレーションファイル冒頭コメント参照）。week_indexの上限は計画書の「1〜5」
#             から「1〜6」に広げた（既存カレンダー週アルゴリズムでは月初の曜日次第で6週になる
#             月が実在し、2026年8月自身がそのケースだったため。CHECK制約を1〜5のままにすると
#             今月の週データ登録自体が失敗する事故になる）
#      リファクタ：ganttUtils.ts（v3.09のカレンダー週計算）から純粋な「月→週セグメント」部分
#             （calendarWeekNumber）を`src/lib/date/monthWeeks.ts`へ抽出し、
#             `computeMonthWeekSegments`を新設（個人OKRの週レーンと共有するため。週の計算を
#             二度書かない）。ganttUtils.tsはそこからimportするだけに変更・ガントの座標計算・
#             挙動は一切変えていない（既存のganttUtils.test.ts 99件が無改修で全通過することで確認）
#      ドキュメント：CLAUDE.mdにSection 24（個人OKR層）を新設。正本はdocs/dev/okr-redesign-plan.md
#             であることを明記しCLAUDE.md本体は要点のみに留めた（Section 11のルール）
#      テスト：`src/lib/date/__tests__/monthWeeks.test.ts`（7件・月初が日曜/月曜/土曜の
#             各ケース・W1が1日だけになるケース・5週/6週になる月・月末が週の途中で終わる
#             ケースを2026年の実カレンダーで検証）／
#             `src/lib/supabase/__tests__/personalOkrStore.test.ts`（14件・null送信の
#             回帰テスト＝self_rating/band_overrideをクリアする保存でundefinedではなくnullを
#             送ることをJSON.stringifyの往復まで含めて検証、他fetch/upsert/softDelete/
#             物理delete系）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`917件全通過（891件から26件増）／
#             `npm run lint`変更ファイル新規エラー0（既存の24件のエラー・11件の警告は
#             今回変更していないファイルの既存分）／`npm run build`成功
#      要手動作業：山本さんが `supabase/migrations/20260807b_add_personal_okr.sql` を
#             Supabase SQL Editorへdev→prodの順で適用すること（エージェントは未適用）
#
# v3.37 OKRモード再設計 Phase 1 Step B：個人OKRビュー（画面）を追加（2026-08-07）
#      背景：Step A（v3.36・DB/型/ストア層のみ）に続き、docs/dev/okr-redesign-plan.md §7・§8の
#             受け入れ条件を満たす画面を実装。マイグレーション20260807b_add_personal_okr.sqlは
#             本番へ適用済みの前提（山本さんが適用完了）
#      変更：OKRモードのメインエリアに「グループ／自分」の切替を追加（`OkrDashboardView.tsx`。
#             グループ側の既存タブ構成は無改修）／新規ディレクトリ`src/components/okr/personal/`
#             （PersonalOkrView.tsx・PersonalKrPanel.tsx・PersonalKrFormModal.tsx・
#             WeekCard.tsx・WeekTaskLinkModal.tsx）／専用zustandストア
#             `src/stores/personalOkrUiStore.ts`（appStore.tsには足さない）／
#             純粋関数`src/lib/personalOkr/`（quarterMonths.ts・weightCheck.ts・
#             bandOptions.ts・weekTaskCandidates.ts・weekLayout.ts）
#      設計判断：「自分」タブはlazyWithRetry+withChunkDownloadGateで分割（実測gzip約10.7KB・
#             閾値未満のため確認ダイアログは出ない）。状態管理は素のuseStateではなくzustandを
#             新設（KRタブ/月切替/週カード/メモ欄が同じデータを読み書きするため、krIdごとの
#             キャッシュ管理を1箇所に集約）。i18nは新規辞書キーを追加せず既存OKR系コンポーネント
#             と同じ日本語直書きに合わせた（英語化はPhase 2以降凍結中）。週の紐づけタスクの
#             遅延・先行待ち表示は既存ロジック（B4：computeDelayDays/formatDelayLabel・
#             B1：getIncompletePredecessors/formatBlockerNames）を再利用し再実装していない。
#             Phase 3（これから・AIパネル）・Phase 4（月末のKintone下書きボタン）はこの画面には
#             作っていない（未実装の空ボタンを出さない方針）
#      🔴週の列数：computeMonthWeekSegments()が返すセグメント数（5〜6件）をそのまま使い、
#             grid-template-columns: repeat(auto-fit, minmax(150px,1fr))で可変列にした。
#             5列固定・6列打ち切りにしていないことをweekLayout.test.tsで回帰テスト
#      ドキュメント：CLAUDE.md Section 24にStep Bの画面設計を追記／
#             docs/dev/okr-redesign-mock.htmlの週レーン（.weeks{grid-template-columns:repeat(5,1fr)}）
#             が5列固定で誤っている点に注記コメントを追加（実装は6週になる月にも対応済み）
#      テスト：`src/lib/personalOkr/__tests__/`4本・23件新規
#             （quarterMonths.test.ts 7件・weightCheck.test.ts 6件・
#             weekTaskCandidates.test.ts 6件・weekLayout.test.ts 4件）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`940件全通過（917件から23件増）／
#             `npm run lint`新規エラー0（既存の24件のエラー・11件の警告のみ・変更前と同数）／
#             `npm run build`成功（PersonalOkrViewチャンクgzip約10.7KB）
#
# v3.38 OKRモード再設計 Phase 1 Step C：既存の整理（3項目）（2026-08-10）
#      背景：docs/dev/okr-redesign-plan.md §9の3項目。CLAUDE.md Section 1の古い「Supabase
#             保存は要確認」記述が残っていたため、クォーター計画（KrQuarterPlanPanel）だけが
#             localStorage実装のまま取り残されていた。2026-08-07に山本さんが
#             「Supabase保存はすでに問題ない」と確認し、決着を明記した
#      変更①：CLAUDE.md Section 1の⚠リストを是正（Supabase項目のみ「2026-08-07に確認済み
#             （社内的にクリア）」と決着を明記。Claude API送信／Teams埋め込み申請の2項目は
#             今回の確認範囲外のため未解決のまま残した）
#      変更②：`quarterPlanStore.ts`をlocalStorage→Supabase（新規`kr_quarter_plans`テーブル）
#             へ移行。個人OKR（本人のみRLS）とは異なり、クォーター計画はKRに紐づくチーム
#             （マネージャー）の資産のため部署スコープ（`group_id = ANY(current_member_group_ids())`。
#             OKRコア階層と同じ流儀＝自前のgroup_id列＋トリガーで親〈key_results〉から自動注入）
#             にした。「1つの(kr_id,quarter)につきアクティブな計画は最大1件」という元の
#             localStorage実装の制約を部分UNIQUE索引で保ちつつ、保存はsaveWithLock（楽観ロック）
#             経由に変更（チーム内の同時編集を検出できるようになった）。削除は論理削除に変更
#             （元はlocalStorage.removeItemという物理削除）。マイグレーション：
#             `supabase/migrations/20260807c_add_kr_quarter_plans.sql`（**未適用・山本さんの
#             手動適用が必要**）。schema.sql・schemaChecks.tsに同期
#      🔴localStorageの旧データ：黙って捨てない。`loadLegacyLocalQuarterPlan`/
#             `clearLegacyLocalQuarterPlan`（quarterPlanStore.ts）でこのブラウザに残っている
#             Phase 1時代の下書きを検知し、`KrQuarterPlanPanel.tsx`のセットアップ画面に
#             「Supabaseへ移行」／「このブラウザから削除」を選ばせるバナーを追加（自動移行は
#             しない＝他端末が既にSupabase側に保存済みの可能性があるため。Human in the loop）
#      変更③：死蔵テーブル`quarterly_objectives`/`quarterly_kr_task_forces`の整理
#             （`docs/REFACTORING.md` M24→解消）。`quarterly_kr_task_forces`はappStore.ts/
#             store.tsの死蔵state（`quarterlyKrTaskForces`）・2アクション
#             （`addQuarterlyKrTaskForce`/`removeQuarterlyKrTaskForce`）・fetch/insert/delete
#             関数を削除（読み書きとも参照ゼロに）。`quarterly_objectives`はOKR PDF取込
#             （`OkrImportModal`が「四半期OKR」選択時に記録用の骨組みを1件作成する）が今も
#             書き込むため**この経路は撤去していない**（撤去すると取込機能が壊れるため）。
#             どちらのテーブルもDropしていない（物理削除禁止・Section 4）。schema.sqlに
#             「死蔵」の明記コメントを追加。`QuarterlyKrTaskForce`型定義（types.ts）も
#             死蔵注記を追加して残置（DBテーブルが残るため型も残す）
#      テスト：新規テストファイルは追加していない（既存のschemaChecks.test.tsがSCHEMA_HEALTH_
#             CHECKSの項目数に応じて動的にテストを生成するため、検査項目1行追加だけで
#             940件→941件に自動で1件増える）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`941件全通過（940件から1件増）／
#             `npm run lint`新規エラー0（既存の24件のエラー・11件の警告のみ・変更前と同数）／
#             `npm run build`成功
#      要手動作業：山本さんが `supabase/migrations/20260807c_add_kr_quarter_plans.sql` を
#             Supabase SQL Editorへdev→prodの順で適用すること（エージェントは未適用）。
#             適用前はクォーター計画の保存・読込がエラー表示になる（黙って無効化しない設計。
#             Section 22参照）
#
# v3.39 OKRモードの初回ゲート＋死蔵`quarterly_objectives`の起動時フェッチ除外（2026-08-10）
#      背景：CLAUDE.md Section 19「ダウンロード量の最小化」の対象を、③のチャンクDLゲート
#             （コードのダウンロード）に加えて「モードで使うデータのフェッチ」にも広げた。
#             OKRモードを使わない人にOKR系データを黙って読み込ませない
#      変更①：`fetchOkrData`（起動時Phase 2）から`quarterly_objectives`を除外（7→6テーブル）。
#             appStore.tsの読み取り用state（`quarterlyObjectives`）を撤去（grep確認：参照は
#             自分自身の保守コードのみ・0件の外部参照）。書き込み専用アクション
#             `saveQuarterlyObjective`（OkrImportModalが「四半期OKR」取込時に記録用の骨組みを
#             1件作成する経路）だけ残す（ローカル配列の楽観反映・楽観ロック追跡は撤去。
#             常に新規idでの1件作成のみのため不要）。未使用だった`deleteQuarterlyObjective`
#             アクション・`softDeleteQuarterlyObjective`（store.ts）も削除（呼び出し元0件）。
#             `applyRemoteChange`（realtime）は元々`quarterly_objectives`のケースが無く無関係。
#             schema.sqlの死蔵コメントに起動時フェッチ除外を追記
#      変更②：OKRモードの初回ゲート（紹介ポップアップ＋データ読み込みの承認）を追加
#             （Human in the loop パターン③「承認して記憶」。CLAUDE.md Section 19 ⑥）。
#             `src/lib/okr/okrModeGate.ts`（判定の純粋関数`shouldShowOkrModeIntro`＋
#             localStorage読み書き）＋`src/components/okr/OkrModeIntroModal.tsx`
#             （modalStyles.ts契約に従うモーダル）。「plan」→「okr」の切替choke point
#             （`MainLayout.tsx`の`handleToggleAppMode`。既存の2つの呼び出し口＝PC compact
#             トグル・Sidebarの`onToggleMode`を1関数に集約）で、未承認なら直接切り替えず
#             ポップアップを出す。承認したら`KEYS.OKR_MODE_INTRO_APPROVED`に真偽値を記録して
#             次回から聞かない。紹介文は実装済み機能のみ（グループOKR確認／①会議ノート→
#             ②セッション記録＆分析→③レポート作成／なぜなぜ／クォーター計画／「自分」タブの
#             個人OKR＝月次計画・週の目標状態と自己評価◯△✕・メモ）
#      🔴ゲストは対象外：Supabaseに一切接続しない設計（Section 23）のため、
#             `shouldShowOkrModeIntro`はゲストなら常にfalse（ポップアップを出さず直接入る。
#             承認フラグも書かない＝実ユーザーが同じブラウザを使うときに正しく初回表示される）
#      作業3の判断（過剰プリフェッチにしない）：承認時・承認済みでの再入場時に**新規のSupabase
#             フェッチは追加していない**。理由：①OKRモードのトップ表示（グループのOKR/KR/TF
#             一覧）が必要とする6テーブルは、このゲートに関係なく起動時Phase 2で全ユーザーに
#             既に読み込まれている（Section 19の「やらないこと」で外せないと確定済み）。
#             ②KRごとのセッション履歴・latestシグナル表示は`OkrDashboardView`自身の既存の
#             マウント時`useEffect`（`krSessionsMap`）が引き続き担う（このコンポーネントは
#             component-localなstateのため、ゲート側で同じクエリを重ねて呼んでも共有できる
#             キャッシュが無く、単純な二重フェッチにしかならない＝過剰プリフェッチの逆効果）。
#             ③会議ノート本文・分析結果・レポート本文はKR選択後のみ必要なため対象外（従来
#             どおり遅延）。④`kr_quarter_plans`は`20260807c_add_kr_quarter_plans.sql`が
#             未適用のため対象外（対象に入れるとマイグレ未適用環境で全員にエラーが出る）。
#             ⑤個人OKR（`personal_krs`等）は「自分」タブを開いたときだけ読む既存の遅延設計
#             （Section 24 Step B）を維持——OKRモードのトップ表示（既定は「グループ」タブ）
#             には不要。以上の理由で、このゲートの役割は現時点では「データフェッチへの
#             承認UI」に純化した（将来、真にOKRモードのトップ表示専用で新規に増えるデータが
#             出たときの拡張点として`okrModeGate.ts`/`handleToggleAppMode`を使う）
#      テスト：`src/lib/okr/__tests__/okrModeGate.test.ts`6件新規（表示判定4件＋
#             localStorage例外時に落ちない2件）。`src/stores/__tests__/realtimeApply.test.ts`の
#             reset用stateから`quarterlyObjectives`を削除（AppStateから型が消えたため）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`947件全通過（941件から6件増）／
#             `npm run lint`新規エラー0（既存の24件のエラーは変更前と同数。警告は11→12件、
#             新規モーダルの`autoFocus`1件のみ増加＝`ConfirmModal.tsx`等既存4ファイルと
#             同じ許容済みパターン）／`npm run build`成功。チャンクサイズ実測（v3.38比）：
#             `appStore`チャンクは213.97KB/gzip57.91KB（-0.89KB/-0.08KB。quarterly_objectives
#             撤去分）、メイン`index`チャンクは269.19KB/gzip67.64KB（+2.43KB/+0.53KB。
#             ゲートUI自体はOKRモードへの切替前に描画する必要があるため、既存の
#             ChunkDownloadGate.tsxと同様に遅延分割できずメインバンドルに入る）
#      要手動作業：無し（新規マイグレーションは追加していない）
#
# v3.40 OKRモードのグループ側を白紙化・個人OKR専用モードへ（2026-08-10）
#      背景：山本さんの指示（2026-08-10）。「元々あったグループモードの機能は一旦白紙にしたい。
#             個人のモードだけにしたい。グループ側の機能は、一旦アーカイブとしてコードのみ保管
#             する形にしましょう」。CLAUDE.md Section 24 Step E参照
#      変更①：`OkrDashboardView.tsx`を`PersonalOkrView`のみを描画する薄いラッパーに縮小。
#             旧内容（上位タブ／サブタブ①〜③・サイクル進捗バー・OKR概要オーバーレイ・
#             セッション履歴オーバーレイ・「グループ／自分」切替seg）は丸ごと新規ファイル
#             `src/components/okr/GroupOkrDashboardArchived.tsx`へ退避（エクスポート名のみ
#             `GroupOkrDashboardArchived`に変更、内容は無改変。中の`no-irregular-whitespace`
#             lint既存エラー1件は全角スペース→半角に直して解消）。撤去した
#             component-local フェッチ：`fetchKrSessions`／`fetchKrMeetingNote`／
#             `fetchLatestOkrAnalysis`／`fetchKrReport`（選択中KR×今週のサイクル状態表示用）
#      変更②：サイドバーのラボからKR系3機能（KRレポート生成／KRなぜなぜ分析／KRセッション
#             記録）を撤去。`MainLayout.tsx`の`LabViewId`を`"graph"|"calendar"|"structure"|
#             "mypage"`の4値に縮小（`"kr-report"`/`"kr-why"`/`"kr-session"`を削除）。
#             `labOverlay`のswitch・モバイルの`MobileFullscreenOverlay`分岐・モバイルの
#             ラボボトムシート項目（3項目）から該当ケースを削除。`KrReportPanel`/
#             `KrJointSessionFlow`/`KrWhyPanel`の`lazyWithRetry`宣言を削除。調査の結果、
#             **クォーター計画（`KrQuarterPlanPanel`）はサイドバーのラボからの独立導線
#             （standalone）が元から存在しなかった**（inline＝OKRモードの「計画」タブの
#             1経路のみ。想定と異なっていたため`ARCHIVED.md`に注記）。同様に**KR系3機能への
#             PC側の導線もそもそも配線されていなかった**（`labOpen`サブメニューにKR系項目が
#             無く、モバイルのラボボトムシートにしか入口が無かった）
#      変更③：`OkrDashboardView`呼び出し箇所（`MainLayout.tsx`）から`selectedKrId`/
#             `onSelectKr`/`activeTool`/`onSetActiveTool`の4propsを撤去（`currentUser`のみに）。
#             `okrActiveTool`/`setOkrActiveToolPersisted`state・`OkrActiveTool`型import・
#             モバイルのOKRモード用ボトムナビ（管理／なぜなぜ／計画の3ボタン）を撤去（OKR
#             モードでは`appMode==="plan"`の時だけボトムナビを表示し、OKRモードの分は
#             mainContentのpaddingBottomも0にして詰める）。サイドバーの「OKR管理：KR一覧」
#             （OKRモード中に表示していたKR選択リスト。選択の受け手が無くなったため）を撤去
#      変更④：ガイド記事の新しい除外方式を導入。`docs/guides/`のfrontmatterに`archived: true`
#             を立てると、`src/lib/docs/manifest.ts`の`ALL_ENTRIES`構築時に除外され、ガイド
#             目次・`?`ボタン（`getDocByMode`）・slug直参照（`getDocBySlug`）のどこからも
#             到達できなくなる（既存の`deprecated: true`は一覧に出続けるため今回の目的に
#             合わず、ファイルも移動・削除しない最小の手段として新設）。対象：
#             `docs/guides/02_modes/okr/00_cycle.md`〜`03_report.md`・`03_roles/kr-rep.md`・
#             `03_roles/facilitator.md`・`04_workflows/weekly-rhythm.md`の7本。
#             `admin.objective-kr-tf`（Objective/KR/TF登録。データ構造自体は今回無改修）と
#             `meeting.import`（会議読み込み。別機能）は対象外。`docs/guides/_meta/
#             conventions.md`Section 5.1に方式を追記。除外した記事へのHelpButton参照が
#             残っていないことを確認済み（`HelpButton modeKey="okr.cycle"`は撤去済み）
#      変更⑤：`src/lib/ai/uiGuide.ts`の`FEATURE_LIST_SECTION`をグループ側の記述（3階層管理・
#             KRセッション記録・KRレポート自動生成）から個人OKRの実装済み機能に差し替え
#             （CLAUDE.md Section 17）。`common.okrModeGate.feature1〜4`（初回ゲートの紹介文・
#             ja/en）も同様に個人OKRのみの内容へ差し替え
#      アーカイブの形：ファイルは移動・削除せず、描画経路（import・呼び出し・ラボの導線・
#             ガイド目次）だけを切る。対象ファイル一覧・復帰手順は
#             `src/components/okr/ARCHIVED.md`が正本。DBテーブル・ストア層
#             （`krSessionStore`/`krMeetingNoteStore`/`okrAnalysisStore`/`krReportStore`/
#             `quarterPlanStore`）は無改修（データは保全）。`fetchOkrData`の6テーブル
#             （起動時Phase 2）も無改修
#      テスト：新規テストなし（既存の`labViewContainment`/`labViewChokePoint`/`modalStyles`/
#             `version`/`schemaChecks`が全通過することを確認）。`modalStyles.test.ts`の
#             `EXCLUDED_FILES`から`components/okr/OkrDashboardView.tsx`を削除（右ドロワーを
#             持たなくなり除外の意味が無くなったため。理由をコメントに明記）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`947件全通過（件数変化なし）／
#             `npm run lint`35件（23エラー12警告。変更前36件＝24エラー12警告から**エラー1件
#             減**＝GroupOkrDashboardArchived.tsx作成時に全角スペースを修正した分。新規エラー
#             0）／`npm run build`成功。**チャンクサイズ実測（同一node_modulesでのstash比較。
#             worktreeでの別npm installは依存解決差でチャンク分割が変わり比較に使えないと
#             判明したため採用しない）**：
#             メイン`index`チャンクは269.19KB→266.33KB（gzip67.64KB→67.15KB。-2.86KB/-0.49KB）。
#             `appStore`チャンクは213.97KB→209.44KB（gzip57.91KB→55.72KB。-4.53KB/-2.19KB）。
#             `OkrDashboardView`チャンクは127.28KB→1.83KB（gzip33.71KB→1.01KB。-125.45KB/
#             -32.70KB）。`KrReportPanel`（31.92KB/gzip10.16KB）・`KrWhyPanel`（22.22KB/
#             gzip7.41KB）・`KrJointSessionFlow`（50.55KB/gzip12.96KB）の3チャンクは**完全に
#             消滅**（誰からもimportされなくなりビルドに含まれない）。**全チャンク合計は
#             1,682,702B→1,443,071B（-239,631B・約-14%）**——OKRモードを開かない/使わない人が
#             一切ダウンロードしなくなる分がそのまま総量減。`manifest`チャンク（ガイド記事の
#             全文取込）は78.15KB→79.44KB（+1.29KB。frontmatter追記分。archived記事の本文
#             テキスト自体は変更前から常にeager glob importされており除外はJS側のフィルタ
#             のみのため本文サイズは変わらず、増分はfrontmatterの数行のみ）
#      要手動作業：無し（新規マイグレーションは追加していない）
#
# v3.41 OKRモード再設計 Phase 2：Kintone個人OKR取込（2026-08-10）
#      内容：個人OKRビュー（`PersonalOkrView`）に「📥 Kintoneから取込」を追加。Kintoneの
#            「個人OKR設定フォーム」（個人四半期KR）／「個人OKR_月次振返り記録」（個人月次
#            計画・振り返り）のPDF・テキストをAIが解析し、個人KR・月次計画・振り返りを
#            抽出→人が確認・対応づけ・編集→登録する（`OkrImportModal.tsx`と同じ
#            Human-in-the-loopの型を踏襲）。
#      新規ファイル：
#      - `src/components/okr/personal/PersonalOkrImportModal.tsx`：取込モーダル本体
#        （入力→解析→確認→登録→完了の5ステップ）
#      - `src/lib/ai/personalOkrImportExtractor.ts`：AI抽出（`AIIntent`に
#        `"okr-personal-import"`を追加。`invokeAI()`経由・max_tokens=16000）
#      - `src/lib/personalOkr/importFieldParse.ts`：`mapKrKindHint`/`parseBandValue`/
#        `parseWeightPct`/`parsePercentValue`（kr_kind・バンド・ウェイトの決定的な正規化。
#        AIには変換させない）
#      - `src/lib/personalOkr/importMatch.ts`：`rankExistingPersonalKrMatches`/
#        `pickDefaultMapping`/`rankGroupTfMatches`（既存personal_kr・グループKR/TFへの
#        対応づけ候補のランキング。自動確定はせず初期選択のヒントのみ）
#      - `src/lib/personalOkr/importApplyPlan.ts`：`buildImportApplyPlan`（確認画面で人が
#        確定した内容から実際にupsertする行を組み立てる純粋関数。既存KRに対応づけた場合は
#        新しいuuidを発行せず既存の`personal_krs.id`をそのまま使う——これが週の目標状態・
#        メモが孤立しないことの本体保証）
#      🔴最重要：既存の`personal_krs`（同じ四半期）への対応づけを必ず人が確認する。
#            `personal_kr_weeks`/`personal_kr_memos`は`personal_kr_id`にしか紐づいていない
#            ため、既存KRを取込で作り直すとそれまでの週の目標状態・メモが画面から孤立する。
#            確認画面の「対応づけ」ドロップダウン（新規作成／既存KRから選択）を必ず経由させ、
#            初期選択は`importMatch.ts`のスコアリング（スコア0.5未満なら安全側で「新規作成」
#            を既定にする）に留め、最終決定は人に委ねる。
#      種別判定：四半期OKRか月次振返りかはAIに判定させ（`detected_doc_type`）、確認画面の
#            セグメントボタンで人が切り替えられる。グループKR/TFの実リンク候補
#            （`kr_kind='group_kr'`のとき）は表示中の部署に絞る（`deptScope.ts`。v3.02の
#            他部署TF選択事故の再発防止）。
#      機密への配慮：月次振返りPDFにはGM評価・面談コメントが含まれるため、入力ステップに
#            「🔒 AIに送信される内容」を明示してから解析を実行させる。
#      DBスキーマ変更：無し（Step Aの5テーブルで足りるため新規マイグレーションは追加していない）。
#      テスト：新規4ファイル・38件追加（`importFieldParse.test.ts`11件・`importMatch.test.ts`
#            9件・`importApplyPlan.test.ts`7件＝🔴既存の週・メモが失われないことの回帰テスト・
#            `personalOkrImportExtractor.test.ts`11件）。既存の`labViewContainment`/
#            `labViewChokePoint`/`modalStyles`/`version`/`schemaChecks`も全通過を確認。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`985件全通過（947件→985件・+38件）／
#            `npm run lint`35件（23エラー12警告。v3.40と同数・新規エラー0）／`npm run build`
#            成功。**チャンクサイズ実測（同一node_modulesでのstash比較）**：
#            `PersonalOkrView`チャンクは41.13KB→85.67KB（gzip10.90KB→24.12KB。
#            +44.54KB/+13.22KB。取込UI・AI抽出・マッチングロジック一式の追加分）。
#            `index`・`appStore`等の常時ロード経路のチャンクは無変化（取込機能はOKRモードの
#            「自分」タブを開いた人だけがダウンロードするReact.lazyチャンクの中に収まって
#            いるため）。gzip24.12KBはSection 19のDL確認ゲート閾値（200KB）を大きく下回り、
#            新たな確認ダイアログは不要。**全チャンク合計は1,440,053B→1,484,664B
#            （+44,611B・約+3.1%）**。
#      要手動作業：無し（新規マイグレーションは追加していない）
#
# v3.42 プロジェクト招待（部署外メンバーの受け入れ）Phase 1：DB・SECURITY DEFINER関数のみ（2026-08-10）
#      正本：docs/dev/project-invite-plan.md（CLAUDE.md Section 25に要点を記載）。
#      内容：社内の別部署の人を特定のPJ1件に招待する機能のDB層。新しいアクセス制御の軸は
#            作らず、PJごとに1つ「招待用の部署」（groups.is_invite_group=true）を作って
#            既存のgroup_ids配列に乗せる（RLSは既存テーブルを1行も変えない）。今回は画面を
#            作らない（発行UI・管理画面・ログイン導線はPhase 2/3）。
#      新規マイグレーション：supabase/migrations/20260810_add_project_invites.sql
#            （⚠️山本さんが手動適用。dev→prod）
#      - groups.is_invite_group列を追加
#      - project_invitesテーブル（SELECTのみRLS。書き込みはSECURITY DEFINER関数経由のみ）
#      - create_project_invite(p_project_id, p_email)：呼び出し者が対象PJにアクセスできる
#        かをcan_access_group_ids()で検証（🔴最重要の安全弁）→メールドメイン許可リスト検証
#        （@以降の完全一致。部分一致にしない）→招待用部署を作成/再利用→発行者本人と
#        projects.owner_member_idに招待用部署を兼務付与→コード生成（pgcrypto不使用。
#        gen_random_uuid()2連結）→ハッシュ化（sha256()。pgcrypto不使用）して保存し
#        平文は戻り値で1度だけ返す
#      - accept_project_invite(p_code, p_email, p_display_name, ...)：4条件（存在/未使用/
#        未取消・24時間以内・メール完全一致(入力値とauth.email()の両方)・コードのハッシュ
#        照合）を検証してmembersを作成（is_admin/is_super_adminは必ずfalse）。同時受諾の
#        TOCTOUはpg_advisory_xact_lockで直列化
#      - guard_member_privilege_columns()を拡張：発行者・PJオーナーへの招待用部署の兼務
#        付与が既存の「非super-adminのgroup_ids直接変更は差し戻す」ルールに素通りせず
#        ぶつかってしまう問題を、トランザクションローカルのセッション変数
#        （app.allow_invite_group_grant。クライアントから直接設定不可）で明示許可した場合
#        に限り例外的に許可する分岐で解決
#      新規ファイル：
#      - src/lib/projectInvite/inviteRules.ts：メールドメイン許可判定・有効期限判定・
#        コード生成の参照実装（本番の判定経路ではない。SQL側と1対1対応させた参照実装。
#        supabase/functions/ai-consult/guestQuota.tsと同じ位置づけ）
#      - src/lib/supabase/projectInviteStore.ts：RPCラッパー＋一覧取得。code_hashは
#        select列から明示的に除外（RLSは行単位のため列は隠せない）。appStoreには足さない
#        （招待は管理系機能で全員が起動時に読む必要が無い。個人OKRと同じ判断）
#      型：ProjectInvite（src/lib/localData/types.ts）・Group.is_invite_group
#      schemaChecks.ts：groups.is_invite_group列／project_invitesテーブル／
#            create_project_invite・accept_project_invite関数の4項目を追加
#      テスト：新規1ファイル・25件追加（inviteRules.test.ts。メールドメイン判定を特に厳しく
#            テスト＝許可/拒否/偽装ドメイン(前方一致・後方一致・複数@)/サブドメイン/大文字
#            小文字/前後空白/複数ドメイン指定）
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1014件全通過（985件→1014件・+29件＝
#            inviteRules 25件＋schemaChecks 4件）／`npm run lint`35件（23エラー12警告。
#            v3.41と同数・新規エラー0）／`npm run build`成功
#      要手動作業：supabase/migrations/20260810_add_project_invites.sqlの手動適用（dev→prod）
#
# v3.43 AI呼び出しの非2xxエラーの内容が捨てられていたバグを修正（2026-08-10）
#      症状：OKRモード「Kintoneから取込」でPDF解析に失敗すると「AI解析に失敗しました
#            Edge Function returned a non-2xx status code」しか出ず原因不明（CLAUDE.md
#            Section 26に詳細）。
#      原因：supabase.functions.invoke()は非2xx時にdataを必ずnullにし、Edge Functionが
#            返した本文（{error,message,detail,status}）は戻り値のresponse（Response
#            オブジェクト）にしか入らない。invokeAI.ts/apiClient.tsはどちらもdataだけを
#            見ていたため、ANTHROPIC_ERROR/RATE_LIMIT_EXCEEDED/ゲスト回数制限等の分岐が
#            実際には一度も実行されず常に汎用文言に落ちていた。
#      新規ファイル：src/lib/ai/edgeFunctionError.ts（readEdgeErrorPayload/extractEdgeError/
#            buildInvokeErrorMessageに集約）。invokeAI.ts/apiClient.tsの両方から利用し
#            data不在時はresponseの本文を読む経路に統一（apiClient.tsもSection16の例外
#            経路だが同じバグを持っていたため同じ直し方で揃えた）。
#      改善点：①HTTPステータスをメッセージに含める（例「Anthropic APIエラー (529):
#            overloaded_error」）②本文がJSONでない・空でも汎用文言だけで終わらせず
#            ステータス＋生テキスト先頭300文字を必ず添える③413（添付が大きすぎる）は
#            専用の案内文に変換。
#      添付サイズの送信前チェックは追加しなかった：Supabase Edge Functionsの受信ペイロード
#            サイズ上限は2026-08-10時点で公式ドキュメントに明記が無く、GitHub上の
#            「10MB」という回答も関数バンドル自体の上限であり受信ペイロードの上限では
#            ないと確認した。根拠のある数値が調べきれなかったため、推測の厳しい閾値で
#            機能を狭めることはせず、エラー時のメッセージ改善（413対応）のみに留めた。
#      personalOkrImportExtractor.tsのmax_tokens=16000は確認のみ（Edge Function側の
#            MAX_TOKENS_CAP=16384の範囲内で原因ではないと判断・変更なし）。
#      CLAUDE.md：Section 15末尾に「dataだけを見るとEdge Functionの理由を捨てる」旨を
#            追記。新規Section 26に本修正の詳細を記載。
#      テスト：新規1ファイル・23件追加（edgeFunctionError.test.ts）＋invokeAI.test.ts/
#            apiClient.test.tsに実際の非2xx挙動（data=null・response読み取り）のテストを
#            各3件追加（既存テストは変更せず全通過）。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1043件全通過（1014件→1043件・
#            +29件）／`npm run lint`35件（23エラー12警告。v3.42と同数・新規エラー0）／
#            `npm run build`成功
#      マイグレーション追加なし
#
# v3.44 プロジェクト招待（部署外メンバーの受け入れ）Phase 2：発行側＋Phase 3：受け入れ側（2026-08-10）
#      正本：docs/dev/project-invite-plan.md（CLAUDE.md Section 25参照）。Phase 1（DB・v3.42）で
#            作った関数を実際に使う画面をまとめて実装した。
#      🔴 追加マイグレーション：supabase/migrations/20260810b_add_revoke_project_invite.sql
#            （⚠️山本さんが手動適用。Phase 1のマイグレには取り消し用RPCが含まれていなかった）
#            revoke_project_invite(p_invite_id)：呼び出し者がcurrent_member_id()を持つ／対象招待の
#            project_idのPJにcan_access_group_idsでアクセスできる（他部署の招待を取り消せてしまう
#            事故を防ぐ）／accepted_atが入っている招待は明示的なエラーで拒否、を検証してrevoked_at/
#            revoked_byを設定。NULL猶予条項なし・ドル引用タグは$fn_revoke_project_invite$。
#            schema.sql同期・schemaChecks.tsに検査項目1件追加。
#      Phase 2（発行側）：
#      - ProjectKarte.tsx（PJカルテ）に「🔗 このPJに招待する」を追加（ゲストには非表示）→
#        新規src/components/project/ProjectInviteModal.tsxがcreate_project_invite()を呼ぶ。
#        コード・招待リンク（アプリURL+?invite=<code>）は戻り値でのみ得られるため「1度だけ表示」を
#        明記しコピーボタンを設置。エラーはformatErrorForUser経由でSQL側の日本語メッセージそのまま。
#      - AdminView.tsxに新カテゴリ「組織」内「プロジェクト招待」タブ（InvitesSection）を追加。
#        fetchProjectInvites()で一覧取得・選択中の部署に紐づくPJの招待に絞り込み・状態
#        （未使用/使用済み/期限切れ/取り消し済み）を表示・取り消しボタン（unusedのみ表示）。
#        code_hashは今回もselectしない。
#      Phase 3（受け入れ側）：
#      - LoginScreen.tsxに「プロジェクトの招待コードをお持ちの方はこちら」を追加（既存フォームと
#        ゲストボタンの間）。押すと招待コード／メール／パスワード／表示名／略称の登録フォームに
#        切り替わる（イニシャル・色は入力欄を出さず自動生成）。URLの?invite=<code>があれば
#        コード欄に事前入力してこの画面から起動する。
#      - 🔴メール確認への対応＝設計判断(a)「自動受諾」を採用：signUp()直後、needsConfirmationの
#        値に関わらず入力内容（パスワードは除く）をlocalStorageに一時保持（新規
#        src/lib/projectInvite/pendingInvite.ts）。実際のaccept_project_invite()呼び出しは
#        フォーム自身ではなくApp.tsxのAuthenticatedAppに一本化した（needsConfirmation=falseの
#        場合、App.tsxトップレベルのonAuthStateChangeがsignUp成功と同時にauthenticated=trueを
#        検知しフォームが受諾処理を終える前にunmountされるレースがあるため）。判定はSetupWizard/
#        AccessDeniedScreen/UserSelectScreenのどれが出るかより前段に置いた。成功したら
#        window.location.reload()（新しいmembers行をRLS越しに反映）。失敗（期限切れ等）したら
#        保留データを消してトースト表示し通常画面へフォールバック。既に登録済みのメールでの
#        signUpはauth.ts の signUp() が alreadyRegistered（Supabase Authのidentities空配列）を
#        検出し専用メッセージを表示・保留データも保存しない。
#      - AccessDeniedScreen.tsxに同名の招待コード導線を追加。この経路は既にAuthセッションがある
#        ためaccept_project_invite()を直接呼べる（signUp不要・メール確認の問題が発生しない最も
#        素直な経路。手動フォールバックとしても機能）。
#      - 受諾後に通常画面へ入れることの確認：accept_project_invite()がmembers.emailにauth.email()
#        をそのまま書き込むため、既存のautoMatch()（Auth emailとmembers.emailの一致で自動ログイン）
#        がreload後にそのまま働く。コードを読んで確認済み（実機確認は山本さんが行う）。
#      新規ファイル：src/lib/projectInvite/{inviteStatus,inviteUrl,pendingInvite,memberDefaults}.ts
#            （招待の状態判定・URLからのコード抽出・保留招待の一時保持・表示名からの既定値生成、
#            いずれも純粋関数）／src/components/project/ProjectInviteModal.tsx。
#      auth.ts：signUp()の戻り値にalreadyRegistered追加（既存呼び出し元は無変更で動作）。
#      types.ts：ProjectInvite.revoked_at/revoked_byのコメント更新（Phase 2で実際に書き込まれる
#            列になったため）。
#      i18n：auth.ja.ts/auth.en.tsに招待関連の新規キーを追加（LoginScreen/AccessDeniedScreenは
#            既存の対象モジュールのため追加。AdminView/ProjectInviteModalは他の管理系画面と同じく
#            日本語ハードコード＝対象外のまま）。
#      テスト：新規4ファイル・39件追加（inviteStatus 9件・inviteUrl 11件・pendingInvite 11件・
#            memberDefaults 8件）。期限の境界値（ちょうど期限・1ms前）・URLの?invite=抽出
#            （不正値・空・複数パラメータ・?無し）・保留データの検証（壊れたJSON・必須欠落）を
#            重点的にテスト。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1083件全通過（1043件→1083件・+40件）／
#            `npm run lint`38件（23エラー・v3.43と同数＝新規エラー0／15警告・v3.43から+3＝
#            ProjectInviteModal・LoginScreen・AccessDeniedScreenの各1件がautoFocus警告。既存
#            コード全体で既に使われている警告付きパターンと同種で新規のリスクではない）／
#            `npm run build`成功（AdminViewチャンク146.85kB→152.02kB・gzip33.42→34.48kB＝+1.06kB。
#            メインバンドルgzip67.47→69.16kB＝+1.69kB。いずれも閾値200KB gzipのDL確認ゲートに
#            はほど遠く新規のゲート対応は不要）
#      要手動作業：supabase/migrations/20260810b_add_revoke_project_invite.sqlの手動適用
#            （Phase 1本体=20260810_add_project_invites.sqlは既に適用済み）
#
# v3.45 PDF添付でEdge Functionが落ちる問題の修正・PDFのクライアント側テキスト抽出（2026-08-10）
#      症状：OKRモード「Kintoneから取込」で670KBのPDFを解析すると、Edge Functionが
#            546 WORKER_RESOURCE_LIMIT（Function failed due to not having enough
#            compute resources）で落ちる（v3.43でエラー本文が読めるようになって判明）。
#      原因1：personalOkrImportExtractor.tsのmax_tokensが16000（実績のある
#            okrImportExtractor.tsは8192）。v3.43時点では「Cap16384の範囲内で原因では
#            ない」と判断していたが、実際にはこの値とPDF添付の合算が原因だった。
#      原因2：PDFをbase64（670KB→約894KB）でEdge Functionへ送っていた。req.json()での
#            パース＋JSON.stringifyでの再構築で複数コピーがメモリに載る。Supabaseは
#            関数ごとにメモリ/CPU上限を上げられないため、送る側を軽くするのが唯一の解。
#      対応1：personalOkrImportExtractor.tsのmax_tokensを16000→8192に変更（初回・自己修正
#            リトライ両方）。invokeAI.tsのAIRawResponseにstop_reasonを追加し、
#            stop_reason==="max_tokens"のときはJSONパースを試みる前に「抽出結果が長すぎて
#            途中で切れました。四半期OKRと月次振返りを分けて取り込んでください。」という
#            明示的なエラーにした（consultationRunner.tsの先例と同じ方針。リトライしない）。
#      対応2：pdfjs-dist(6.2.108・キャレット無し固定)を新規導入し、PDFをクライアント側で
#            テキスト抽出してからテキスト添付として渡す（docxText.tsと同じ形）。
#            新規ファイル：src/lib/pdfTextFormat.ts（pdfjs-dist非依存の純粋関数。
#            isPdfFile/normalizePdfText/pageItemsToText/isBlankExtractedText/
#            PDF_EMPTY_TEXT_MESSAGE）・src/lib/pdfText.ts（pdfjs-distを使うextractPdfText。
#            前者を再export）・src/lib/fileAttachMediaType.ts（FileAttachButton.tsxの
#            resolveMediaType/isSupportedMediaTypeを切り出し）。
#      セキュリティ対処（承認条件）：①isEvalSupported:falseを明示（6.2.108では型・実装
#            ともにこのオプション自体が削除済み・evalコード自体が無いことをgrep確認済みで、
#            フラグより強い形で解決済み。将来の巻き戻しに備え型を拡張して防御的に指定は残す）
#            ②worker(?url明示importで同一origin配信)・cmap・標準フォント(vite.config.tsの
#            ensurePdfjsAssets()がnode_modulesからpublic/pdfjs/へコピー)を全てローカルに
#            バンドルし外部URLへのリクエストを無くす(dist全体をunpkg/jsdelivr/cdn./
#            mozilla.github/cdnjsでgrepし0件・pdfTextチャンクのコードを直接読んで
#            /pdfjs/...・assets/pdf.worker-*.mjsという相対パスであることを確認済み)
#            ③package.jsonでバージョン固定。
#      @napi-rs/canvas対策：pdfjs-distのoptionalDependency（Node用画像化バイナリ12種）。
#            npm install --omit=optionalで一度除外したところ、Rollupの必須ネイティブ
#            バイナリまで一緒に除外されvite buildが壊れる副作用があったため、package.jsonに
#            overrides: {"@napi-rs/canvas": "npm:@napi-rs/canvas-do-not-install@0.0.0"}を
#            追加し存在しない偽パッケージへ解決させることで@napi-rs/canvasだけを除外した。
#      FileAttachButton.tsx：PDFを.docx/.htmlと同じ専用抽出→テキスト添付（isText:true）に
#            統一。DOC_MEDIA_TYPES（application/pdfのみ）を削除。lib/pdfText.tsは
#            FileAttachButton.tsx側からのみ動的import（PDFを添付しない人はDLしない）。
#      personalOkrImportExtractor.tsのシステムプロンプトに「入力はPDFそのものではなく
#            レイアウト情報を失ったテキスト」の注記を追加（既存の角括弧表記優先の設計は
#            大きな変更不要）。
#      CLAUDE.md：Section 6-1c（max_tokensの目安）新設・Section19⑦（base64添付とワーカー
#            上限の関係）新設・新規Section 27に本修正の詳細を記載。
#      テスト：新規2ファイル・24件追加（pdfTextFormat.test.ts 16件・fileAttachMediaType.
#            test.ts 8件）＋personalOkrImportExtractor.test.tsにmax_tokens/stop_reason関連
#            5件追加。PDF本体のパース自体はライブラリ依存・vitestがenvironment:"node"の
#            ため実PDFを読むテストは作らず、pdfjs-dist非依存の純粋関数のみをテストした。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1112件全通過（1083件→1112件・
#            +29件）／`npm run lint`変更ファイルに新規エラー0／`npm run build`成功。
#            常時ロード経路（メインindexチャンク）はgzip69.16→69.17kB（+0.01kB。実質
#            変化なし）。新規pdfTextチャンクはgzip127.38kB（閾値200KB未満のためDL確認
#            ゲート未発火）。ただしSection19③のDLゲートはMainLayout.tsxのReact.lazy
#            ビュー専用の仕組みで、FileAttachButton.tsx内の素の動的importは元々この
#            仕組みの対象外（将来育った場合は個別対応を検討）。
#      既知の未解消リスク：OkrImportModal.tsx（グループOKR取込）・MeetingImportPanel.tsx
#            （会議文字起こし取込）はFileAttachButton.tsxを使わずPDFをbase64のdocument
#            ブロックとして直接送る独自実装を持ち、今回の対応範囲外（十分大きなPDFで同じ
#            WORKER_RESOURCE_LIMITに落ちる可能性が残る）。
#      マイグレーション追加なし
#
# v3.46 個人OKR取込のAI呼び出しを2回に分割（実行時間起因の546再発対策・2026-08-10）
#      症状（v3.45の続き）：PDFのクライアント側テキスト抽出とmax_tokens=8192への引き下げの後
#            も、山本さんが実データで取込を試したところ「テキストだけで抽出は行われた」
#            （テキスト抽出自体は成功）が、しばらく時間が経った後に同じ546 WORKER_RESOURCE_
#            LIMITになった。ペイロードのサイズではなく、個人四半期KR（最大8本×6本文欄）と
#            月次計画・振り返り（最大8本×3か月×計画/振り返り両方）を1回の呼び出しで抽出して
#            いたことによる生成時間の積み重ねが原因。546はペイロードサイズだけでなく1回の
#            呼び出しの実行時間でも起きることが判明した（CLAUDE.md Section 19 ⑧新設）。
#      対応：src/lib/ai/personalOkrImportExtractor.ts の抽出を2回の呼び出しに分割した。
#            呼び出し1（extractPersonalOkrQuarterlyData）：資料の種類の判定
#            （detected_doc_type）＋KR単位の基本情報（KR種別・ラベル・ウェイト・6本文欄）。
#            常に実行する（月次振返り記録でも6本文欄は「KR_四半期OKRから転記」列に同じ内容が
#            転記されているため、この呼び出しだけで拾える）。
#            呼び出し2（extractPersonalOkrMonthlyData）：月次の計画・振り返り。呼び出し1が
#            "monthly_review"と判定したときだけ実行する（四半期OKRのみの資料には月次情報が
#            無いため呼ぶ意味が無く、呼び出しを1回減らせる）。呼び出し1自体が失敗したときは
#            種別が分からないため保険的に実行する。
#            マージは純粋関数 mergePersonalOkrImportResults(quarterly, monthly) に分離。
#            source_label→label→同一インデックスの順で対応づける（両呼び出しは同じKintone
#            画面を同じ順序で読むため、ラベル不一致でも位置で対応づく可能性が高い）。対応の
#            見つからないmonthly側グループはデータを失わないよう末尾に追加する。
#            片方の呼び出しが失敗しても、成功した方をそのまま確認画面に出す（全部やり直しに
#            しない）。extractPersonalOkrImportData()のオーケストレーターが呼び出しごとに
#            try/catchし、失敗した方はwarnings: string[]に理由を積んで返す（両方失敗した
#            ときだけ例外を投げる）。PersonalOkrImportModal.tsxのレビュー画面に⚠️の警告
#            ボックスとして表示する。
#            max_tokensは8192のまま（分割で1回あたりの生成量が減るため足りる見込み）。
#            進捗表示：onProgressコールバックで{current,total,label}
#            （"1/2 個人KRを抽出中"→"2/2 月次計画を抽出中"→完了）を呼び出し元へ伝える。
#            従来の時間ベースの演出（AIProgressLoader）から、実際の呼び出し完了状況を表す
#            もの（SaveProgressLoaderを流用）に差し替えた（無言で長時間待たせないため）。
#            モデル切替の余地を残した（既定は変えない）：invokeAI()にmodel引数（省略可）を
#            追加し、Edge Function側のALLOWED_MODELS（claude-sonnet-4-6/claude-haiku-4-5）
#            から指定できるようにした。personalOkrImportExtractor.tsのPERSONAL_OKR_IMPORT_
#            MODEL定数（1箇所）が既定値（claude-sonnet-4-6）を持つ。呼び出し分割でも546が
#            続く場合は、この定数をclaude-haiku-4-5に変えると生成が速くなる。
#      新規ファイル：src/lib/personalOkr/importCharWarning.ts
#            （isPersonalOkrImportTextTooLong・PERSONAL_OKR_IMPORT_CHAR_WARNING_
#            THRESHOLD=20000の純粋関数）。添付から抽出した文字数（MAX_TEXT_CHARS=40000で
#            切り詰めた後の実際に送信する文字数）が閾値を超えるかを判定する。20000字は
#            「40000字の上限内でも546が再発した」という事実から安全側に倒した値（既存上限の
#            半分）。PersonalOkrImportModal.tsxの解析実行前（入力欄）・解析成功後（レビュー
#            画面）の両方に表示し続ける（今後の切り分けに使うため、コンソールログではなく
#            画面に出す）。閾値超えは「量が多いため、四半期OKRと月次振返りを別々に取り込む
#            ことをお勧めします」という行動が分かる警告文を添える。
#      CLAUDE.md：Section 19 ⑧新設（546は実行時間でも起きる）・Section 28新設
#            （本修正の詳細）。
#      テスト：personalOkrImportExtractor.test.ts を分割後の構成に合わせて再構成（呼び出し
#            1・2をそれぞれ独立にテスト＋mergePersonalOkrImportResultsの純粋関数テスト
#            ＋オーケストレーターの呼び出し省略・進捗・部分失敗・全滅を検証）。新規
#            importCharWarning.test.ts（閾値の境界値）。
#            検証：`npx tsc --noEmit`エラー0／`npx vitest run`1133件全通過（1112件→1133件・
#            +21件）／`npm run lint`変更ファイルに新規エラー0／`npm run build`成功
#            （常時ロード経路のindexチャンクはgzip69.17→69.21kB。ほぼ変化なし）。
#      既知の未解消リスク：呼び出し2（月次）自体がKR件数・月数の多い資料で単独でも546の
#            リスクを持ち続ける（さらなる分割はしていない・今回の依頼範囲外）。
#            OkrImportModal.tsx（グループOKR取込）・MeetingImportPanel.tsx（会議文字起こし
#            取込）のPDF独自送信経路は引き続き対応範囲外（v3.45から継続）。
#      マイグレーション追加なし
#
# v3.47 プロジェクト招待：既存部署のビューを不変にする調整＋招待された人の可視性の是正（2026-08-11）
#      正本：docs/dev/project-invite-plan.md §4-2・§4-4・§6・§8（CLAUDE.md Section 25 Phase 4）。
#      山本さんの要望「既存の部署の既存のPJに招待することで、既存の部署にいる人は特にビューは
#      変わらず、そのPJだけメンバーが増えている状態を実現したい」を受け、統括が特定した2点の
#      ズレを是正した。
#      (a) 発行者・PJオーナーのサイドバーに「表示部署」切替が出てしまう問題：
#      create_project_invite()が発行者本人とprojects.owner_member_idに招待用部署を
#      group_idsの兼務として付与するため、accessibleGroups.length >= 2になり切替UIが
#      表示されていた（ビューが変わるため要望に反する）。
#      対応：新規src/lib/projectInvite/sidebarGroupVisibility.tsのfilterInviteGroupsForSidebar()
#      （純粋関数）がMainLayout.tsxのaccessibleGroupsからis_invite_group=trueの部署を除外する。
#      🔴招待された本人（招待用部署しか持たない）はフィルタすると選択肢が空になるため除外
#      しない——「フィルタ結果が1件も残らない場合は除外前のリストをそのまま返す」という
#      一般則だけで両ケースを安全に処理する（本人かどうかを個別判定するコードは書いていない）。
#      (b) 招待用部署に属する人が、兼務を持たない他部署メンバーから見えない問題：
#      membersのRLS（group_ids && current_member_group_ids() OR current_member_is_super_admin()）
#      は部署単位のみで判定するため、招待された人のgroup_ids（招待用部署のみ）は兼務を
#      持たない部署メンバーのcurrent_member_group_ids()と一切重ならず見えなかった
#      （担当者に指定しても担当者欄が「未担当」のままになる実害）。
#      🔴追加マイグレーション：supabase/migrations/20260810c_extend_members_visibility_for_
#      invites.sql（⚠️山本さんが手動適用・未適用）。新設のSECURITY DEFINERヘルパー
#      visible_invite_group_ids()（自分がアクセスできるPJに紐づく招待用部署のidの配列を返す。
#      current_member_group_ids()/can_access_group_ids()と同じ流儀）＋membersのRLSポリシーに
#      「OR group_ids && visible_invite_group_ids()」を追加のみで足した。既存2条項は1文字も
#      変更していない。NULL猶予条項なし・SET search_path=''・ドル引用タグは
#      $fn_visible_invite_groups$で関数固有。schema.sql同期・schemaChecks.tsに検査項目
#      （fn_visible_invite_group_ids）を1件追加。監査クエリに「部署Aの一般メンバーから、
#      招待用部署に属さない部署Bのメンバーが見えないこと」の確認クエリを含めた。
#      🔴広げた範囲はmembersテーブル1つ・「招待用部署に属する人」の可視性のみ。部署間の
#      可視性（部署Aの人が部署Bの人を見る）・projects/tasksのRLSは一切変えていない。
#      当初方針「RLSは1行も変えない」（project-invite-plan.md冒頭）の唯一の例外として
#      明記した。
#      残った非対称（今回は許容・運用でカバー）：(b)で「部署の人→招待者」の可視性は解決
#      したが、「招待者→部署の社内メンバー」の可視性は兼務付与（発行者本人とPJオーナーの
#      2人だけ）に依存したまま。他の社内担当者を招待者に見せたい場合は管理画面から
#      招待用部署を手動で兼務追加する運用。CLAUDE.mdと設計書の両方に明記した。
#      新規ファイル：src/lib/projectInvite/sidebarGroupVisibility.ts（純粋関数）。
#      変更ファイル：src/components/layout/MainLayout.tsx（accessibleGroups構築時に
#      filterInviteGroupsForSidebar()を適用）／supabase/schema.sql（visible_invite_group_ids()
#      追加・members_groupポリシーにOR条項追加）／src/lib/schema/schemaChecks.ts（検査項目
#      1件追加）。
#      テスト：新規sidebarGroupVisibility.test.ts（7件。通常部署1件／2件・招待用部署のみ
#      （招待された本人）・ホーム+招待用の兼務（発行者・PJオーナー）・ホーム+複数招待用の
#      兼務・招待用部署が複数件だけの異常系・空配列、の各ケース）＋schemaChecks.test.tsが
#      配列走査方式のため検査項目追加で自動+1件。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1141件全通過（1133件→1141件・+8件）／
#      `npm run lint`38件（23エラー・15警告・v3.46と同数＝変更ファイルに新規エラー0）／
#      `npm run build`成功（indexチャンクgzip69.21→69.33kB。ほぼ変化なし。新規チャンクの
#      追加は無し＝sidebarGroupVisibility.tsはMainLayout.tsxの常時ロード経路に静的import
#      されるが極小のためチャンク分割の対象外）。
#      要手動作業：supabase/migrations/20260810c_extend_members_visibility_for_invites.sqlの
#      手動適用（適用するまでは(b)は未解消のまま。(a)はコード側の変更のみのためpush済みで
#      即座に有効）。
#
# v3.48 個人OKR取込のモデルを haiku に切り替え（2026-08-11）
#      背景：v3.45（PDFのクライアント側テキスト化でペイロード削減）・v3.46（AI呼び出しの
#             2分割）を入れてもなお 546 WORKER_RESOURCE_LIMIT が続いたため、山本さんの
#             指示で個人OKR取込に限り生成の速い claude-haiku-4-5 に切り替えた。
#      変更：src/lib/ai/personalOkrImportExtractor.ts の PERSONAL_OKR_IMPORT_MODEL 定数のみ。
#      影響範囲：AIIntent="okr-personal-import" の取込だけ。他のAI機能は Edge Function 側の
#             既定（claude-sonnet-4-6）のまま変わらない。
#      戻し方：同定数を "claude-sonnet-4-6" に戻す。その場合は分割の粒度をさらに細かくする
#             （月ごとに分ける等）方向で546を回避すること。
#      DBマイグレ不要・UI変更なし。
#
# v3.49 完了PJのアーカイブ導線とPJ設定画面の新設（2026-08-11）
#      山本さんの2つの要望に対応。
#
#      【要望1】完了したPJを完了しても左メニューバー（サイドバー）に残り続けるのが不便
#             だったので、アーカイブできるようにしてほしい。
#      調査で判明した実態：`projects.status`の`archived`自体は既に存在し、AdminViewの
#             PJ編集セレクタで変更でき、ProjectStructureView（体制図）は既に
#             `status !== "archived"`で運用済みだった。しかしMainLayout.tsxの`projects`
#             （サイドバー含む主要ビューが共有する変数）は元から`status === "active"`
#             のみを通す実装で、これは初回実装から変更が無かった——つまり`completed`も
#             `archived`と同じく一律で消えており、「完了してもactiveのまま放置され続ける
#             （非adminには完了させる手段自体が乏しい）」ことが不便の実態だった。
#      対応：`src/lib/project/sidebarProjectFilter.ts`の`filterSidebarProjects()`（純粋関数）
#             を新設し、MainLayout.tsxの`projects`をこれに置き換えた。ルールは
#             「active・completedは常に表示／archivedのみ既定で隠す」。サイドバーに
#             「アーカイブを表示」トグル（`KEYS.SIDEBAR_SHOW_ARCHIVED`・既定OFF・
#             localStorage記憶）を新設。**選択中のPJがarchivedになって一覧から消えて
#             宙に浮く問題**には、`pinnedProjectId`（選択中PJ id）を渡すとアーカイブ
#             判定だけを免除する方式で対応（トグル強制ONや選択解除ではなく「見ている
#             ものが急に消えない」を優先）。mineOnly（自分のPJのみ）の絞り込みは
#             pinでも免除しない（既存の同種の割り切りと挙動を揃えるため）。
#      揃えた範囲：MainLayout.tsxの`projects`を共有するダッシュボード・カンバン・ガント・
#             リスト・稼働状況・コマンドパレット・タスク追加/マイルストーン追加モーダルは
#             単一変数の共有により自動的に同じルールへ揃った。TaskEditModalのPJピッカー
#             （status不問でis_deletedのみ除外）とProjectCreateModalの「他PJから引き継ぐ」
#             元PJ選択は、既存タスクの現在の紐づき先・過去PJからの引き継ぎを妨げない
#             ためのそれぞれ別の設計判断があり、意図的に変更していない。AdminViewは
#             部署横断の棚卸し用途のため全ステータス表示のまま。
#
#      【要望2】PJごとの管理項目（メンバー招待等）が増えてきたので、各PJダッシュボードに
#             設定画面を置いて集約したい。
#      対応：`ProjectSettingsModal.tsx`（新規）をPJカルテの「⚙ このPJの設定」から開く
#             モーダルとして新設。3タブ構成：
#              - 基本情報（名前・目的・貢献メモ・オーナー・期間・color_tag・ステータス。
#                クイック操作で「完了にする」「アーカイブする」「進行中に戻す」を1クリック
#                実行可。フォームの未保存下書きを巻き込まず、常に正本の`project`から
#                status1列だけを更新する設計）
#              - 招待（発行・このPJの一覧・取り消し。旧`ProjectInviteModal.tsx`が担って
#                いた発行UIをここへ統合し、`ProjectInviteModal.tsx`は撤去）
#              - 関わるメンバー（オーナー・タスク担当者・招待用部署に属する人、の読み取り
#                専用一覧。**新しい紐づけテーブルは作らず**、`src/lib/project/
#                projectMembers.ts`の`computeProjectMembers()`（純粋関数）が既存3種の
#                データから組み立てる。招待用部署idは`'grp-invite-'+projectId`の文字列を
#                フロントで再構築せず、`fetchProjectInvites()`が返す実データの
#                `invite_group_id`から読む）
#      権限：既存モデルを広げていない。基本情報タブの編集可否はAdminViewのPJ編集と同じ
#             条件（部署管理者/全社スーパー管理者。部署内にis_adminが1人もいなければ
#             全員編集可のブートストラップも同じく踏襲）。編集不可の場合は入力欄ではなく
#             読み取り表示になる。招待の発行は権限に関わらず全メンバー可（Section 25の
#             既存決定を維持）。関わるメンバータブは常に読み取り専用。
#      AdminViewとの役割分担：AdminView「作業設定→PJ」タブ（部署横断・全ステータス一覧
#             編集・PJ削除）は残す。この設定画面は「今見ているPJ1件」に絞った日常操作の
#             入口。CLAUDE.md Section 4に使い分けを明記。
#      新規ファイル：src/lib/project/sidebarProjectFilter.ts／src/lib/project/
#             projectMembers.ts／src/components/project/ProjectSettingsModal.tsx。
#      削除ファイル：src/components/project/ProjectInviteModal.tsx（機能はProjectSettings
#             Modalの「招待」タブへ統合）。
#      変更ファイル：src/components/layout/MainLayout.tsx（`projects`の絞り込みを
#             filterSidebarProjects()に置換・「アーカイブを表示」トグル新設・PJ一覧に
#             アーカイブ済みの視覚区別を追加）／src/components/dashboard/ProjectKarte.tsx
#             （招待ボタンを設定ボタンに置換）／src/lib/localData/localStore.ts
#             （KEYS.SIDEBAR_SHOW_ARCHIVED追加）／src/i18n/layout.ja.ts・layout.en.ts
#             （サイドバーのアーカイブトグル文言）。
#      DBマイグレ不要（既存の`projects.status`・`project_invites`・`members.group_ids`
#             のみで完結）。
#      テスト：新規sidebarProjectFilter.test.ts（10件）・projectMembers.test.ts（8件）。
#             既存の機械チェック（modalStyles.test.ts／labViewContainment.test.ts／
#             labViewChokePoint.test.ts／version.test.ts／schemaChecks.test.ts）は
#             全通過。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1159件全通過（1141件→1159件・
#             +18件）／`npm run lint`変更ファイルに新規エラー0／`npm run build`成功
#             （DashboardViewチャンクgzip18.55→21.19kB・+2.64kB＝ProjectSettingsModal
#             が静的importで追加された分。indexチャンクgzip69.33→69.66kB・+0.33kB＝
#             MainLayout.tsxの追加分。どちらも200KB(gzip)の閾値には遠く及ばず、
#             Section 19のダウンロード確認ゲートは対象外のまま）。
#
# v3.50 サイドバーの絞り込みルールを是正：v3.49の逆行を修正（2026-08-11）
#      背景：v3.49は統括の事前診断ミスに基づく誤った指示で実装していた。実際の変更前の
#             挙動は`status==="active"`のみを通す＝completedもarchivedも一律で隠れる、
#             が正しかったが、v3.49は誤って「completedは常に表示」に変えてしまい、
#             山本さんの要望（「完了PJがサイドバーに残り続けて散らかる。片付けたい」）と
#             逆方向になっていた（完了済みにしたPJがサイドバーに再出現する）。
#      対応：`filterSidebarProjects()`（`src/lib/project/sidebarProjectFilter.ts`）を
#             「既定ではactiveのみ表示」に戻し、「アーカイブを表示」トグルを
#             「完了・アーカイブも表示」の1トグルに統合してcompleted/archivedの両方を
#             まとめて扱うようにした。pinnedProjectId（選択中PJ）の免除は維持しつつ、
#             免除対象をarchivedだけでなくcompletedにも拡張。mineOnlyの絞り込みは
#             従来どおり免除しない。
#      視覚的区別：completed/archivedはどちらも鈍色表示のままだが、マークをarchived=🗄・
#             completed=✅に分けて見分けられるようにした（同じ見た目にしない）。
#      localStorageキー：`KEYS.SIDEBAR_SHOW_ARCHIVED`（sidebar_show_archived_projects）
#             を`KEYS.SIDEBAR_SHOW_COMPLETED_ARCHIVED`（sidebar_show_completed_archived_
#             projects）へ改名。v3.49がリリース当日中の是正のため実使用者はいない想定で、
#             旧キーからの値の引き継ぎ処理は行わず、新キー名で改めて既定OFFから始まる
#             （実害は無い判断。CLAUDE.md Section 4に記録）。
#      変更ファイル：src/lib/project/sidebarProjectFilter.ts／src/lib/project/__tests__/
#             sidebarProjectFilter.test.ts／src/components/layout/MainLayout.tsx／
#             src/lib/localData/localStore.ts／src/i18n/layout.ja.ts・layout.en.ts／
#             src/components/project/ProjectSettingsModal.tsx（クイック操作の説明文を
#             実態に合わせて修正）。
#      DBマイグレ不要・UI操作そのものは変わらない（トグルの意味と既定挙動のみ変更）。
#      テスト：sidebarProjectFilter.test.ts を新ルールに合わせて更新（10件→11件・
#             pinnedProjectIdのcompletedケースを1件追加・既存の期待値は全て新ルールに
#             書き換え）。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1160件全通過（1159件→1160件）／
#             `npm run lint`変更ファイルに新規エラー0／`npm run build`成功。
#
# v3.51 OKRモード再設計 Phase 3前半：「これから」ブロックの機械計算（2026-08-11）
#      背景：docs/dev/okr-redesign-plan.md §5-1の方針どおり「AIが要るものと要らないものを
#             分ける」。今回は要らない側（機械計算・ゼロトークン・即時描画）だけを実装した。
#             AI呼び出し（見立て・捨てる候補・原因の推定・バンドのAI判定）はPhase 3後半で
#             実装する。
#      DB：`personal_kr_outlooks`テーブルを追加（`migrations/20260811_add_personal_kr_
#             outlooks.sql`。⚠️山本さんが手動適用・未適用）。AI解析結果を履歴として積む
#             （UPDATEしない）。RLSは既存の`personal_kr_owner_member_id()`を再利用し新しい
#             ヘルパー関数は増やしていない。今回はテーブルを作るだけで書き込みは無い。
#      新規：`src/lib/personalOkr/outlookFingerprint.ts`（`computeOutlookInputFingerprint()`。
#             Phase 3後半の「前回と一致したら再解析しない」判定用の純粋関数。FNV-1a・外部
#             ライブラリ不使用・週配列の順序に依存しない。今回はまだどこからも呼ばれない）。
#      新規：`src/lib/personalOkr/aheadCompute.ts`（`computeAheadFacts()`＝残り週数・月末
#             までの日数・週の自己評価の積み上げ・未設定/評価待ちの週一覧、`isTargetAndEvidence
#             Set()`）。`src/lib/personalOkr/aheadTaskStats.ts`（`summarizeLinkedTaskStatus()`＝
#             紐づくタスクの遅延/停滞/先行待ちの集計。既存ロジック＝computeDelayDays（B4）・
#             isTaskStagnant・getIncompletePredecessors（B1）を再実装せずそのままimport）。
#      新規：`src/lib/personalOkr/bandDisplay.ts`（`resolveBandDisplay()`＝バンドの3値
#             （band_target/band_ai/band_override）を混ぜず、override優先→target、を1箇所に
#             集約。band_aiはまだ無いため常に対象外）。
#      新規：`src/components/okr/personal/AheadBlock.tsx`（「これから」ブロックのUI。機械計算の
#             事実を表示し、AIが書く部分は「AIによる見立ては次の更新で入ります。」という控えめな
#             プレースホルダのみ・解析状態は固定文言「AI解析：未実施」のみで再解析ボタンは無し。
#             band_overrideをクリックで即保存・トグルで解除。解除時はnullを送る＝undefinedにしない）。
#      変更：`PersonalKrPanel.tsx`に「これから」を当月（monthStatus==="current"）のみ追加。
#             `src/lib/localData/types.ts`（`PersonalKrOutlook`型を追加）。`supabase/schema.sql`
#             （テーブル・RLS・インデックスを同期）。`src/lib/schema/schemaChecks.ts`
#             （`personal_kr_outlooks_table`検査項目を追加）。
#      テスト：新規`outlookFingerprint.test.ts`(14件)・`aheadCompute.test.ts`(10件)・
#             `aheadTaskStats.test.ts`(9件)・`bandDisplay.test.ts`(3件)。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1197件全通過（1160件→1197件・+37件）／
#             `npm run lint`変更ファイルに新規エラー0／`npm run build`成功（PersonalOkrView
#             チャンクgzip24.12kB→27.38kB・+3.26kB）。
#
# v3.52 OKRモード再設計 Phase 3後半：AI解析（見立て・バンド判定）＋AIパネル（2026-08-11）
#      背景：Phase 3前半（v3.51）で空けておいた「AIが必要な部分」を実装した。
#             docs/dev/okr-redesign-plan.md §5-2のトリガー設計・§6のバンド3値ルールを
#             機械的に守る（546の教訓＝max_tokens・入力量・1回にまとめる呼び出し設計を最優先）。
#      新規：`src/lib/ai/personalOkrOutlookExtractor.ts`（`analyzePersonalKrOutlook()`＝見立て・
#             週ごとの一手・捨てる候補・バンドのAI判定を1回の呼び出しにまとめる。max_tokens=4096・
#             `AIIntent="okr-personal-outlook"`。JSON検証・自己修正リトライ1回・
#             stop_reason==="max_tokens"の明示エラーは既存の抽出系クライアントと同じ作法）。
#      新規：`src/lib/personalOkr/personalOkrAiContext.ts`（`buildPersonalOkrAiContextText/Chips/
#             Starters()`＝作業1・作業3共通の「入力を絞った文脈」組み立て。紐づくタスクは
#             件数の要約のみで生データは渡さない）。
#      新規：`src/lib/personalOkr/outlookRunner.ts`（`runPersonalKrOutlookAnalysis()`＝
#             fingerprintが一致していればAI呼び出しをスキップしcachedをそのまま返す純粋関数。
#             invokeAI・Supabaseをモックせずにこの抑制ロジックを検証できるよう分離した）。
#      新規：`src/lib/ai/personalOkrChatPrompt.ts`（AIパネルのシステムプロンプト。達成度バンドの
#             定義に沿って「今どの水準か・上げるには何が必要か」で答える）・
#             `src/lib/ai/personalOkrChatClient.ts`（1ターン分のAI呼び出し。max_tokens=2048・
#             `AIIntent="okr-personal-chat"`）・`src/hooks/usePersonalOkrAiConsultation.ts`
#             （会話状態管理。既存sessionManager.tsを再利用・DBに保存しない）・
#             `src/components/okr/personal/PersonalOkrAiPanel.tsx`（計画モードのConsultationPanel
#             と同じ右パネルの型を流用。新しいパネルの仕組みは発明していない）。
#      変更：`src/stores/personalOkrUiStore.ts`（`outlookByKrMonth`/`ensureOutlookLoaded()`/
#             `runOutlookAnalysis()`を追加。DB取得→fingerprint比較→AI呼び出し→INSERTの一連を
#             ここに集約）。`src/lib/supabase/personalOkrStore.ts`
#             （`fetchLatestPersonalKrOutlook()`/`insertPersonalKrOutlook()`を追加。UPDATEしない）。
#             `src/lib/personalOkr/bandDisplay.ts`（`resolveBandDisplay()`を3引数化。優先順位は
#             override＞ai＞target。🔴 overrideがあればaiの値は表示に使わない）。
#             `src/components/okr/personal/AheadBlock.tsx`（AI解析中はスケルトン表示・
#             解析済みならlead/moves/tradeとバンドのAI判定を描画・「再解析」ボタンを追加）。
#             `src/components/okr/personal/PersonalKrPanel.tsx`（当月タブでのfingerprint計算＋
#             自動トリガーのuseEffect・AI文脈を親へ報告・「迷ったらAIに聞く」ブロック追加）。
#             `src/components/okr/personal/PersonalOkrView.tsx`（AIパネルをinline幅遷移で
#             メインエリアの横に配置。ConsultationPanelのMainLayout配置と同じパターン）。
#             `src/lib/ai/invokeAI.ts`（`AIIntent`に`"okr-personal-outlook"`/`"okr-personal-chat"`
#             を追加。集計単位として意味のある切り方にするため2つに分けた）。
#      テスト：新規`personalOkrOutlookExtractor.test.ts`(13件)・`personalOkrAiContext.test.ts`
#             (10件)・`outlookRunner.test.ts`(5件)・`personalOkrChatClient.test.ts`(3件)・
#             `personalOkrChatPrompt.test.ts`(3件)。既存`bandDisplay.test.ts`(3→5件)・
#             `personalOkrStore.test.ts`(13→19件)を拡張。
#      検証：`npx tsc --noEmit`エラー0／`npx vitest run`1238件全通過（1197件→1238件・+41件）／
#             `npm run lint`変更ファイルに新規エラー0（既存の未使用eslint-disable 2件を除去）／
#             `npm run build`成功（PersonalOkrViewチャンクgzip27.38kB→35.79kB・+8.41kB）。
#      マイグレーション：追加なし（`personal_kr_outlooks`テーブルはPhase 3前半で作成済み・
#             適用済みの前提で実装）。
#
# ============================================================
# v3.53（2026-08-12）個人OKR画面の不具合修正：KRタブの帯がflexShrinkでの潰れにより
#   高さ0で消える・「これから」AI解析の無限ローディング化・週カードの重い再計算（カクつき）
# ============================================================
#   【背景・課題A（KRごとに選択できない）の確定原因】山本さんの実機スクリーンショットにより、
#   データ側の不整合ではなくCSSのレイアウト崩れであることが確定した。
#     - `personal_krs.fiscal_year`は2026、`quarter`は全KR"3Q"で一致しており対象期のズレは
#       無かった（当初の仮説は否定された）。
#     - `PersonalOkrView.tsx`のKRタブの帯（`overflowX:"auto"`を持つflexアイテム）に
#       `flexShrink`の指定が無かった。overflowが`visible`以外の値を持つflexアイテムは
#       自動最小サイズが0になる（CLAUDE.md Section 21が本文に`minHeight:0`を要求するのと
#       対になるCSSの規則）。選択中KRの中身（`PersonalKrPanel`。折りたたみ・月次計画・
#       週カード・「これから」・メモまで含め縦に非常に長い）に対して親コンテナの高さが
#       不足すると、flex-shrinkの綱引きで「自由に0まで縮んでいい」判定になっているこの帯
#       だけが真っ先に高さ0まで潰れ、「KRタブが1つも表示されない」ように見えていた
#       （同じ帯の中の「＋KRを追加」「📥 Kintoneから取込」ボタンも一緒に消えていたことから
#       特定。他の行（「対象期」の行等）はoverflow指定を持たないため元から潰れていなかった）。
#       修正：`PersonalOkrView.tsx`のKRタブの帯・対象期の行の両方に`flexShrink:0`を追加。
#       再発防止テスト：新規`personalOkrViewLayout.test.ts`（この2箇所にflexShrink:0が
#       残っていることをソース走査で検査。一般ルール化は誤検知リスクが高いため見送った
#       理由をファイル冒頭に明記）。
#     - `personal_kr_months`は6KRとも7月分（month_index=1）のみ存在し8月分の行が無い状態
#       だった。Kintone側の月次振返り記録に8月欄がまだ入力されていない（8月半ばで未記入）
#       ことに起因する取込結果であり、取込・抽出コード側の不具合ではないと判断した。当月
#       （`monthStatus==="current"`）でKintone取込レコードが無い場合の手入力・保存は元から
#       正しく動作していた（コードのバグではない）。山本さんが「8月が表示できない」と言って
#       いたのは、上記のKRタブの帯が消えていたため「どのKRの8月を編集しているのか選べない・
#       分からない」状態を指していたと確定した。
#     - `personal_kr_outlooks`テーブルが2026-08-12にprod適用されるまでの間、当月タブを開くと
#       `ensureOutlookLoaded()`のSELECTが42P01相当で失敗し、`outlookByKrMonth[key]`が
#       `undefined`のまま放置されていた。KRタブ・月タブ・週の目標状態・メモへの影響は無かった
#       （失敗はtry/catchで握りつぶされ他のstateには伝播しない）が、「これから」ブロックのAI
#       部分だけが永久にスケルトン表示のまま止まっていた。
#   修正1（課題A・本丸）：`src/components/okr/personal/PersonalOkrView.tsx`のKRタブの帯・
#          「対象期」の行に`flexShrink:0`を追加。
#   修正2：`src/stores/personalOkrUiStore.ts`の`ensureOutlookLoaded()`。取得失敗時も
#          `outlookByKrMonth[key]`を`null`で確定させ`outlookFetchedKeys`に加える（＝
#          `AheadBlock`の`isLoadingOutlook`が永久にtrueにならず、エラー表示に切り替わる。
#          「再解析」ボタンは`force:true`で直接`runOutlookAnalysis`を呼ぶため影響を受けない）。
#   修正3（課題B・本丸）：`src/components/okr/personal/PersonalKrPanel.tsx`に
#          `linkedTasksByWeekIndex`（週カードごとの紐づけタスクを1回のuseMemoで計算）を
#          追加し、以前は`weekCards.map()`内で毎レンダー計算していた`linkedTasks`を
#          参照安定化した。`src/components/okr/personal/WeekCard.tsx`は
#          `getIncompletePredecessors`（部署全体のtasks×taskDependenciesのフルスキャン）と
#          `computeDelayDays`の結果を`useMemo`でキャッシュ。以前は「今月の計画」欄に1文字
#          打つだけで週カード全件×紐づけタスク全件ぶんこのフルスキャンが毎キーストロークで
#          再実行されていた（カクつきの実測原因。既存判定ロジック自体は変更していない）。
#   修正4：`src/components/okr/personal/PersonalKrPanel.tsx`の「今月の計画」に、当月かつ
#          Kintone取込のレコードが無い場合の案内文（Kintoneの入力を待たずアプリ側に直接
#          入力・保存できる旨）を追加。既存の「current＝編集可・textareaが最初から出る」設計
#          自体は元から正しく動いていた（コードのバグではない）が、入口の分かりにくさへの
#          対策として明示した。
#   修正5（安全網）：`src/lib/personalOkr/availablePeriods.ts`（新規・純粋関数
#          `listAvailablePersonalKrPeriods()`）を追加し、`PersonalOkrView.tsx`の
#          「対象期にKRが0件」の空表示に、実際にKRが存在する（年度・四半期）を件数付きの
#          候補ボタンとして出す（クリックで即切替）。今回の事象そのものの原因ではなかったが、
#          将来Kintone取込のAI抽出が別の年度・四半期を返した場合に利用者が詰まないための
#          再発防止として実装した（依頼元：CLAUDE.md Section 24）。
#   テスト：新規`availablePeriods.test.ts`(4件)・`personalOkrViewLayout.test.ts`(2件)。
#          既存テストへの影響なし。
#   検証：`npx tsc --noEmit`エラー0／`npx vitest run`1244件全通過（1238件→1244件・+6件）／
#          `npx eslint`変更ファイルに新規エラー0。
#   マイグレーション：追加なし。
#
# v3.54 サイドバーPJ行の「⋮」操作メニュー追加・「OKRタスク」セクションの描画停止（2026-08-12）
#   山本さんの依頼：「PJの設定などの場所がわかりにくい。メニューバーの各PJに縦三点の記号を
#   つけ、そこからアーカイブ・設定を開けるようにしたい。また『OKRタスク』はあまり使われない
#   ので一旦非表示にしましょう。PJがTFと紐づけられる仕様になっていれば十分」。
#   課題1（PJ行の「⋮」メニュー）：
#     - `src/lib/project/projectEditPermission.ts`（新規）：`canEditProjectBasicInfo()`。
#       元々`ProjectSettingsModal.tsx`にだけ実装されていた権限判定（部署管理者・全社スーパー
#       管理者。部署内にis_adminが1人もいなければ全員可のブートストラップ）をそのまま切り出し、
#       `ProjectSettingsModal.tsx`とサイドバーの両方から呼ぶ形にした（判定ロジックの複製をやめた）。
#     - `src/lib/project/projectRowMenu.ts`（新規）：`buildProjectRowMenuItems()`。何を出すか
#       （設定は常に・状態変更ボタンは編集権限がある人だけ・completed/archivedなら
#       「↩ activeに戻す」1つだけ・ゲストには空配列）を決める純粋関数。
#     - `src/components/project/ProjectRowMenu.tsx`（新規）：「⋮」トリガー＋ドロップダウン
#       パネルのUI。`CustomSelect.tsx`と同じ「getBoundingClientRect()からfixed座標を算出し
#       Portalでbody直下に描画する」方式（画面外にはみ出さないようクランプ。Escape・外側
#       クリック・スクロール/リサイズで閉じる）。Section 21（中央寄せモーダルの高さ上限契約）
#       の対象外と判断（理由はCLAUDE.md Section 4に明記）。
#     - `src/components/layout/MainLayout.tsx`：`Sidebar`のPJ行を、`NavItem`（行全体1個の
#       button）から`[選択ボタン][⋮トリガー]`のラッパーdivに変更（折りたたみ時は従来通り
#       `NavItem`のまま）。状態変更は`saveProject`（choke point・楽観ロック込み）経由、確認
#       ダイアログは挟まずトースト＋「元に戻す」（`useBulkTaskActions.ts`と同じ流儀）。
#       「⚙ このPJの設定」は既存の`ProjectSettingsModal`をそのまま開く（新しい設定画面は
#       作っていない）。開く対象PJは未絞り込みの`store.projects`から探す（sidebarの表示用
#       filteredリストから探すと、モーダルを開いた後の状態変更で一覧から消えた瞬間にモーダルも
#       閉じてしまうため）。
#     - `src/components/project/ProjectSettingsModal.tsx`：権限判定を上記の共通関数呼び出しに
#       置き換え（`activeAdmins`のインライン計算を削除）。
#     - `src/styles/globals.css`：`.pj-row-menu-trigger`（行ホバー・フォーカス・選択中のみ表示）。
#   課題2（「OKRタスク」セクションの描画停止）：
#     - `MainLayout.tsx`の`Sidebar`から、計画モードの「OKRタスク」セクション（KR一覧→
#       selectedKrIdでGantt/Kanban/List絞り込み）のJSXブロックを削除（v3.40のOKRモード
#       グループ側白紙化と同じ「描画経路を切るだけ」方式）。`selectedKrId`/`krTaskIds`/
#       `keyResultsInGroup`/DBテーブル/`project_task_forces`（PJ↔TF紐づけ）は一切変更していない。
#       使われなくなった`okrOpen`/`toggleOkrOpen`stateは削除、`KEYS.SIDEBAR_OKR_OPEN`・
#       i18nキーは削除していない（`localStore.ts`にコメント追記）。
#     - `src/components/layout/ARCHIVED.md`（新規）：復帰手順の台帳。`src/components/okr/
#       ARCHIVED.md`（OKRモードのグループ側コンポーネント台帳）とはドメインが異なるため、
#       混同を避けて`layout/`配下に別ファイルを作った（判断理由をファイル内に明記）。
#   i18n：`src/i18n/layout.ja.ts`/`layout.en.ts`に`layout.sidebar.pjRowMenu.*`（8キー）を追加。
#   テスト：新規`projectEditPermission.test.ts`(5件)・`projectRowMenu.test.ts`(5件)。
#          既存テストへの影響なし。
#   検証：`npx tsc --noEmit`エラー0／`npx vitest run`1254件全通過（1244件→1254件・+10件）／
#          `npx eslint src`変更ファイルに新規エラー0（新規warning3件：`MainLayout.tsx`の
#          `keyResults`/`onSelectKr`/`KrIcon`が「OKRタスク」セクション削除により未使用化。
#          復帰時にそのまま使えるよう削除せず残した意図的なもの）。
#   マイグレーション：追加なし。
#
# v3.55 個人OKR：月の選択を「対象期」へ一元化・AI解析を明示ボタン起動に変更（2026-08-12）
#   山本さんが実際に使ってみて出た3つの不満への対応：「KRを切り替える度に読み込みが発生し、
#   取得に何十秒もかかる」「7月にチェックを入れた後に他のKRに切り替えるとすべて8月に戻される」
#   「対象期で月も設定・変更できるようにしてほしい」。
#
#   課題1（月がKR切替のたびに当月へ戻る）：
#     - 原因：`PersonalOkrView.tsx`が`<PersonalKrPanel key={selectedKr.id} .../>`と`key`を
#       渡していたため、KR切替のたびにコンポーネントごと作り直され、月選択
#       （`PersonalKrPanel.tsx`のローカルstate）が当月にリセットされていた。
#     - 対応：月の選択を`PersonalOkrView.tsx`の「対象期」行（年input・四半期セレクトの隣）へ
#       持ち上げ、KRタブをまたいで共有するようにした。選択肢は`quarterMonthSlots()`が導く
#       3つ。既定値は新規`resolveDefaultMonthIndex()`（`src/lib/personalOkr/quarterMonths.ts`。
#       当月がその四半期に含まれていればその月、含まれていなければ先頭の月）。年・四半期を
#       変えるたびにこの既定値へ追従させる。`PersonalKrPanel.tsx`は`monthIndex`をpropsで
#       受け取るだけになり、内部の月タブUI（ボタン群）は撤去し、選択中の期・月と状態
#       （確定済み／未来）だけを表示する静的な行に縮小した（月選択を二重に持たない）。
#     - 🔴 `key={selectedKr.id}`は外した。副作用として、下書きstate（今月の計画の4欄・
#       bandTarget・メモの未送信ドラフト・週タスクリンクモーダル）が前のKRの内容を
#       引きずらないことを担保する必要があった。`positioning`等を初期化するuseEffectの
#       依存配列に`kr.id`を追加（以前は`monthRecord?.id`と`monthStr`だけで、新旧どちらの
#       KRにも月次計画が無いケースで依存配列が変化せずリセットされない事故が起きうる設計
#       だった）。`MemoSection`の下書き・週リンクモーダル（`linker`/`weekActionError`）にも
#       `kr.id`変化でクリアするuseEffectを追加した。
#
#   課題2（KR切替のたびに何十秒も待たされる）：
#     - 確定原因：`PersonalKrPanel.tsx`のuseEffectが、当月のKRタブを開くたびに
#       `runOutlookAnalysis()`（Anthropic API呼び出し）を自動発火していたこと（Step H・
#       v3.52で実装した「対象KRタブを開いたときのみ発火」という当初設計そのもの）。KRが
#       複数本あれば切替ごとにAI呼び出しが走り、その応答待ちが「何十秒」の実体だった。
#       `ensureKrDetailLoaded`/`ensureWeekTasksLoaded`は既にキャッシュ判定があり、同じKR・
#       同じ週への再クエリは発生しないことをコード上確認済み（N+1・直列待ちの追加要因では
#       なかった）。
#     - 対応（山本さんの決定）：AI解析は明示ボタンを押したときだけ発火する。
#       `PersonalKrPanel.tsx`から自動発火のuseEffectを削除し、代わりに
#       `ensureOutlookLoaded()`（保存済みの解析結果をDBから1回読むだけ・ゼロトークン）を
#       当月タブ表示中に自動で呼ぶ。機械計算分（残り週数・積み上げ等）は元から即時描画。
#       ボタンは1つ（`AheadBlock.tsx`）：未解析なら「✦ 見立てを出す」、解析済みなら
#       「再解析」に文言が切り替わる。force判定（既存の解析結果があるかどうか）は
#       `PersonalKrPanel.tsx`の`handleRunOutlook`が行う（未解析ならforce無し・解析済みなら
#       force:trueでfingerprint一致でも必ず呼ぶ＝以前の「再解析」ボタンと同じ挙動）。
#       `input_fingerprint`による再解析抑止のロジック（`outlookRunner.ts`）自体は変更なし。
#     - 自動で走ると誤解させる文言を排除：`AheadBlock.tsx`の空き状態プレースホルダを
#       「AIによる見立てを準備しています。」→「上の「✦ 見立てを出す」を押すと、AIが見立てを
#       出します。」に変更。「AI解析：未実施」にも「（ボタンを押すと実行されます）」を追記。
#
#   ドキュメント：`docs/dev/okr-redesign-plan.md`§5-2を実態（自動発火→明示ボタン）に
#     合わせて書き換え、変更理由・変更日を明記。CLAUDE.md Section 24にStep Jを追記。
#   テスト：`quarterMonths.test.ts`に`resolveDefaultMonthIndex`のケース4件を追加。
#     既存の`personalOkrViewLayout.test.ts`（flexShrink:0のソース走査）は対象期行・KRタブの
#     帯のstyle自体を変更していないため無修正で通過。
#   検証：`npx tsc --noEmit`エラー0／`npx vitest run`1258件全通過（1254件→1258件・+4件）／
#     `npx eslint`変更ファイルに新規エラー0。
#   マイグレーション：追加なし。
#
# 最終更新：2026-08-12（v3.55）

