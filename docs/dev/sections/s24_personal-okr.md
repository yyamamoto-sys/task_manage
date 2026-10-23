## 24. 個人OKR層（OKRモード再設計 Phase 1・Step A=v3.36／Step B=v3.37／Step C=v3.38／Step D=v3.39／Step E=v3.40）

**正本は [docs/dev/okr-redesign-plan.md](docs/dev/okr-redesign-plan.md)。** このセクションは要点だけを薄く残す（Section 11のルール）。詳細（列定義・段階計画・未決事項）は必ず計画書を読むこと。

- **一行で言うと**：Kintoneが正本。このアプリはKintoneに存在しない「週の層」を埋める実行層。個人四半期KR・月次計画の**編集・評価確定**はKintone側のまま変えない。
- **Step Aで追加した5テーブル**：`personal_krs`（個人四半期KR）／`personal_kr_months`（個人月次計画）／`personal_kr_weeks`（★週の目標状態。アプリだけが持つ層）／`personal_kr_week_tasks`（週とタスクの紐づけ）／`personal_kr_memos`（KRごとのメモ）。`migrations/20260807b_add_personal_okr.sql` 参照（**山本さんの手動適用が必要。未適用**。Step Bの画面は本番適用済みの前提で実装している）。
- **RLSは本人のみ**（`member_widget_layouts` と同じ流儀）。`personal_krs`/`personal_kr_memos` 以外の3テーブルは列にmember_idを持たせず、`personal_kr_owner_member_id()`/`personal_kr_week_owner_member_id()`（SECURITY DEFINER・親を辿るヘルパー関数）で判定する。判断理由はマイグレーションファイル冒頭コメント参照（20260723の「親を辿るポリシー」先例に近い＝単一所有者・低ホップ数・少量データのため）。
- **週の区切りは既存のカレンダー週ロジックを共有する**（二度書かない）。`src/components/gantt/ganttUtils.ts`（v3.09）から純粋な「月→週セグメント」部分を `src/lib/date/monthWeeks.ts`（`calendarWeekNumber`/`computeMonthWeekSegments`）へ抽出し、ganttUtils.ts はそこから import する。ガントの座標計算・挙動は一切変えていない。

### Step B：個人OKRビュー（v3.37）

- **配置**：OKRモードのメインエリアに「グループ／自分」の切替（`OkrDashboardView.tsx` 冒頭のseg）を足した。**グループ側の既存タブ構成（OKR管理/なぜなぜ/計画）は無改修**。`activeLabView`（Section 20の単一state）には足していない——ラボ系の全画面ビューではなく、OKRモードのコンテンツの一部だから。
- **重量級のためReact.lazy分割**：`src/components/okr/personal/PersonalOkrView.tsx` を `lazyWithRetry` + `withChunkDownloadGate` で読み込む（Section 19）。「グループ」タブしか使わない人はこのチャンク（gzip約10.7KB・閾値200KB未満のため確認ダイアログは出ない）を一切ダウンロードしない。
- **状態管理は専用の zustand ストアを新設**：`src/stores/personalOkrUiStore.ts`。**`appStore.ts` には足さない**（Section 19。OKRモードの「自分」タブを開かない人にpersonal_kr系テーブルへのクエリを一切発生させないため）。このストア自体も `PersonalOkrView.tsx` からのみimportされるため、`create()` の実行タイミングも「自分」タブを実際に開いた瞬間まで遅延する。KRタブ・月切替・週カード・メモ欄など複数コンポーネントが同じデータを読み書きするため、krIdごとのキャッシュ管理（月/週/メモの取得済み判定・楽観更新）を1箇所に集約する目的でzustandを選んだ（データ量自体は極小＝1人あたり四半期KR最大十数本・週は最大でもKR×6週間）。
- **🔴 週の列数は可変（5列固定にしない）**：`src/lib/personalOkr/weekLayout.ts` の `buildWeekCards()` が `computeMonthWeekSegments()` の返す件数（5〜6件）をそのまま使い、UI側（`PersonalKrPanel.tsx`）は `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))` で可変列にする。**1〜6週のいずれでも破綻しないことを `weekLayout.test.ts` で回帰テスト済み**（2026年8月＝6週・2026年2月＝5週・W1が1日だけになるケース）。
- **空の週レコードを事前に一括作成しない**：週カードはセグメントの計算結果だけで描画し、`personal_kr_weeks` の行は `goal_state` を書いた時点・自己評価を付けた時点に初めて `ensureWeek()`（`PersonalKrPanel.tsx`）が作る。
- **週とタスクの紐づけ（自動候補＋明示リンク）**：候補抽出は純粋関数 `src/lib/personalOkr/weekTaskCandidates.ts`（`computeWeekTaskCandidates`）に一元化。本人担当・期日が週内のタスクを基本に、個人KRに `task_force_id` が紐づく場合はそのTF配下（`todos.tf_id` 経由）を優先表示する。**紐づけたタスクの遅延・先行待ちの表示は既存ロジック（B4：`computeDelayDays`/`formatDelayLabel`・B1：`getIncompletePredecessors`/`formatBlockerNames`）をそのまま再利用**し、再実装していない。
- **達成度バンド**：Phase 1はAI判定（`band_ai`）が無いため `personal_kr_months.band_target`（Kintoneに書く「狙い」の手入力）のみを扱う。選択肢は`src/lib/personalOkr/bandOptions.ts`の`BAND_VALUES`（60/70/80/90/100）で、**90・100は常に取り消し線＋非活性**（3Qは基本的に置かない運用）。
- **月の可変**：`src/lib/personalOkr/quarterMonths.ts` の `classifyMonth()` が対象月を today との比較で past/current/future に分類する。past＝読み取り専用、current＝編集可、future＝「計画がまだありません」のみ（Kintone取込が無いPhase 1では未来月の手入力を許可しない）。
- **Phase 3以降は今回作らない**：「これから」（AI見立て）・AIパネル（`ConsultationPanel` 型のOKR版）・月末のKintone下書き生成ボタンはこの画面には無い（未実装の空ボタンを出さない方針。計画書§8）。
- **i18nの扱い**：新規辞書キーは追加していない。既存のOKR系コンポーネント（`OkrDashboardView.tsx`・`KrQuarterPlanPanel.tsx`等）と同じく日本語を直書きしている（英語化はPhase 2以降凍結中・`docs/dev/i18n-plan.md`）。
- **画面未実装**（Step Bのスコープ外）：Kintone取込・AI解析・`personal_kr_outlooks`・`okr_knowledge_docs` は対象外（Phase 2・3・5）。

### Step C：既存の整理（v3.38・計画書§9）

- **`quarterPlanStore.ts` を Supabase（`kr_quarter_plans`）へ移行。** 個人OKR（本人のみRLS）とは異なり、クォーター計画はKRに紐づくチーム（マネージャー）の資産のため**部署スコープ**（`group_id = ANY(current_member_group_ids())`。OKRコア階層と同じ流儀）にした。`migrations/20260807c_add_kr_quarter_plans.sql` 参照（**山本さんの手動適用が必要。未適用**）。
- **「1つの(kr_id, quarter)につきアクティブな計画は最大1件」** という元のlocalStorage実装の制約を部分UNIQUE索引（`WHERE is_deleted = false`）で保つ。保存は既存アクティブ行のid再利用＋`saveWithLock`（無ければ新規INSERT）。削除は論理削除（元は`localStorage.removeItem`という物理削除だったが変更）。
- **localStorageの旧データは黙って捨てない。** `loadLegacyLocalQuarterPlan`/`clearLegacyLocalQuarterPlan`（`quarterPlanStore.ts`）でこのブラウザに残っている旧下書きを検知し、`KrQuarterPlanPanel.tsx`のセットアップ画面に「Supabaseへ移行」／「このブラウザから削除」の選択を出す（自動移行はしない＝他端末が既にSupabase側へ保存済みの可能性があるため）。
- **`quarterly_objectives`/`quarterly_kr_task_forces`（死蔵テーブル。Section 1.6・`docs/REFACTORING.md` M24）**：`quarterly_kr_task_forces`はappStore.ts/store.tsの未使用state・アクション・fetch/insert/deleteを削除（読み書きとも参照ゼロになった）。`quarterly_objectives`はOKR PDF取込（`OkrImportModal`が「四半期OKR」選択時に記録用の骨組みを1件作成する）が今も書き込むため、この経路は**残した**（撤去すると取込機能が壊れるため）。どちらもテーブル自体は物理削除しない（Section 4）。`schema.sql`に「死蔵」の明記コメントを追加。

### Step D：OKRモードの初回ゲート＋`quarterly_objectives`の起動時フェッチ除外（v3.39）

- **`quarterly_objectives`を`fetchOkrData`（起動時Phase 2）から除外**（7→6テーブル）。appStore.ts側の読み取り用state（`quarterlyObjectives`）も参照ゼロ（グレップ確認済み）だったため撤去し、`saveQuarterlyObjective`（OkrImportModalの書き込み専用経路）だけを残した。詳細はSection 19 ⑥。
- **OKRモード（plan→okr）に初回ゲートを追加**：Section 19 ⑥参照。「起動時に全員が読むOKRコア6テーブル」とは別レイヤーで、モードそのものへの入室に承認を求める。個人OKR層の週の目標状態・自己評価（◯△✕）等の紹介文もこのゲートのポップアップに含む。

### Step E：OKRモードのグループ側を白紙化・個人OKR専用モードへ（v3.40・2026-08-10・山本さん指示）

- **一行で言うと**：「元々あったグループモードの機能は一旦白紙にしたい。個人のモードだけにしたい」（山本さん指示）。OKRモードは`PersonalOkrView`のみを表示するようになり、グループ側の機能（①会議ノート／②セッション記録&分析／③レポート作成／なぜなぜ分析／クォーター計画タブ／OKR概要・セッション履歴オーバーレイ）は全て描画経路を切ってアーカイブした。
- **サイドバーのラボからもKR系4機能を撤去**：`LabViewId`から`"kr-report"`/`"kr-why"`/`"kr-session"`を削除（4値に縮小）。クォーター計画（`KrQuarterPlanPanel`）はOKRモード内タブ（inline）のみで、サイドバーのラボからの独立導線（standalone）は元から無かった（調査済み・PC側の`labOpen`サブメニューには元々KR系項目自体が無く、モバイルのラボボトムシートにのみ`kr-report`/`kr-why`/`kr-session`の3項目があった）。
- **アーカイブの形は「描画経路を切るだけ」**：ファイルは移動・削除しない。対象ファイルの一覧・復帰手順は `src/components/okr/ARCHIVED.md` が正本。旧`OkrDashboardView.tsx`本体（タブ構成・サイクル進捗バー・概要/履歴オーバーレイ・「グループ／自分」切替seg）は丸ごと`src/components/okr/GroupOkrDashboardArchived.tsx`へ保管し、`OkrDashboardView.tsx`自体は`PersonalOkrView`だけを描画する薄いラッパーに縮小した。
- **撤去した component-local フェッチ**（旧`OkrDashboardView.tsx`にあったもの。撤去によりOKRモードで発生するクエリが実際に減った）：`fetchKrSessions`（KRごとのセッション一覧）／`fetchKrMeetingNote`／`fetchLatestOkrAnalysis`／`fetchKrReport`（選択中KR×今週のサイクル状態表示用）。ストア層（`krSessionStore`等）自体は削除していない。
- **`HelpButton modeKey="okr.cycle"`は撤去した**（案内先の`docs/guides/02_modes/okr/00_cycle.md`をガイド目次から除外したため）。
- **ガイド記事の除外方式**：`docs/guides/`はファイルを消さず、frontmatterに`archived: true`を立てて`src/lib/docs/manifest.ts`の`ALL_ENTRIES`構築時に除外する新方式を導入（`deprecated: true`とは異なり一覧に一切出ない）。対象：`02_modes/okr/00_cycle.md`〜`03_report.md`・`03_roles/kr-rep.md`・`03_roles/facilitator.md`・`04_workflows/weekly-rhythm.md`。`docs/guides/_meta/conventions.md` Section 5.1に方式を追記。`admin.objective-kr-tf`（Objective/KR/TF登録）と`meeting.import`（会議読み込み）はOKR管理データ構造・別機能のため対象外。
- **AIの機能認識（Section 17）**：`src/lib/ai/uiGuide.ts`の`FEATURE_LIST_SECTION`からグループ側の記述（3階層管理・KRセッション記録・KRレポート自動生成）を削除し、個人OKRの実装済み機能に差し替えた。
- **やらないこと（変更対象外）**：`fetchOkrData`の6テーブル（objectives/key_results/task_forces/todos/project_task_forces/task_task_forces）は起動時フェッチのまま維持（計画モードのTF/ToDoピッカー・ガント・ダッシュボードが使用）。DBテーブル（`kr_sessions`/`kr_meeting_notes`/`okr_analyses`/`kr_reports`/`kr_quarter_plans`等）・ストア層のファイルは削除しない。

### Step F：Kintone取込（Phase 2・v3.41・2026-08-10）

`PersonalOkrView`に「📥 Kintoneから取込」を追加（`PersonalOkrImportModal.tsx`）。`OkrImportModal.tsx`（グループOKR取込）と同じHuman-in-the-loopの型（PDF/テキスト→AI抽出→人が確認・編集→登録）を踏襲した。

- **入口**：既存の`FileAttachButton`/`FileDropZone`（PDF・Word・画像・テキスト対応）とテキスト貼り付け欄の両方を受ける。
- **種別判定はAIに任せる**：Kintoneの「個人OKR設定フォーム」（四半期KR）か「個人OKR_月次振返り記録」（月次計画・振り返り）かをAIが判定し`detected_doc_type`として返す（`src/lib/ai/personalOkrImportExtractor.ts`のSYSTEM_PROMPT）。確認画面には「🤖 個人四半期OKRとして読み取りました」等を明示し、誤判定時は人がセグメントボタンで切り替えられる。`AIIntent`に`"okr-personal-import"`を追加（Section 6-1b）。
- **🔴既存の`personal_krs`への対応づけが最重要**：`personal_kr_weeks`/`personal_kr_memos`は`personal_kr_id`（＝`personal_krs.id`そのもの）にしか紐づいていない。既存の同じ四半期のKRを取込で作り直すと、それまでの週の目標状態・メモが孤立して画面から消える。そのため確認画面で「対応づけ」ドロップダウン（新規作成／既存KRのどれかを選択）を必ず経由させ、**最終決定は人**にする。初期選択のヒントは`src/lib/personalOkr/importMatch.ts`の`rankExistingPersonalKrMatches()`（label・kr_kindの一致度スコアリング）が提示するが、スコアが閾値未満（`AUTO_SELECT_THRESHOLD`）なら「新規作成」を既定にする（曖昧な自動選択をしない）。実際の書き込み行（既存idの再利用or新規uuid発行）は`src/lib/personalOkr/importApplyPlan.ts`の`buildImportApplyPlan()`に一本化し、この判断をモーダル側のUIコードに分散させない。
- **グループKR/TFの候補も部署スコープ**：`kr_kind='group_kr'`のときの実リンク先（`key_result_id`/`task_force_id`）は、表示中の部署（`currentGroupId`）に絞った`keyResultsInGroup`/`taskForcesInGroup`（既存の`deptScope.ts`）から選ぶ（v3.02の「他部署のTFが選べた」事故の再発防止）。KintoneのKR番号（"KR1"）はアプリのKeyResultに対応する列を持たないため数値マッチングはできず、`rankGroupTfMatches()`はTF名・KRタイトルとヒント文字列（`group_kr_hint`）の重なりだけで候補を提示する（自動確定はしない）。
- **`kr_kind`・`band_target`・`weight_pct`の数値/enum変換はAIにやらせない**：AIには元のKintone表記（"グループKR1"等）や数値をそのまま返させ、`src/lib/personalOkr/importFieldParse.ts`の`mapKrKindHint()`/`parseBandValue()`/`parseWeightPct()`（決定的な純粋関数）で確定させる。`band_target`はKintoneの月次バンド欄が複数基準のルーブリック（説明文）であることが大半で単一目標が明記されていることは稀なため、AIには「単一の値が明記されている場合のみ数値・それ以外はnull」と指示し、null（未設定）のまま返すことを許容する。
- **既存の週・メモが失われないことをテストで固定**：`src/lib/personalOkr/__tests__/importApplyPlan.test.ts`が「既存KRに対応づけた場合は新しいuuidを発行せず既存の`personal_krs.id`をそのまま使う」「既存にあって抽出結果に無いKR・月は一切触れない」ことを回帰テストする。
- **月次計画の重複作成防止**：`personal_kr_months`は`UNIQUE(personal_kr_id, month)`制約があるため、対応づけ先の既存KRについては`ensureKrDetailLoaded()`で月次計画を確実に先読みしてから計画を組む（`PersonalOkrImportModal.tsx`の`handleApply`）。既存の月次計画が見つかればそのidを再利用して更新し、人が既に決めた`band_override`は取込で上書き・消去しない。
- **機密への配慮**：月次振返りPDFにはGM評価・面談コメントが含まれるため、入力ステップに「🔒 AIに送信される内容」を明示（送るファイル・テキストの範囲と、送らないもの＝アプリ内の既存データ）。
- **取込後も編集可能**：`personal_krs`/`personal_kr_months`の`source_label`/`imported_at`列を必ず埋め、`PersonalKrPanel.tsx`に「📥 {source_label}」バッジ（Kintoneが正本である旨のツールチップ付き）を表示する。取込後もアプリ上でこれらの列を編集できる（読み取り専用にしない）。
- **DBスキーマ変更なし**：Step Aの5テーブルで足りるため、新規マイグレーションは追加していない（`schemaChecks.ts`への追記も不要）。

### Step G：「これから」ブロック（Phase 3前半・機械計算のみ・v3.51・2026-08-11）

**AIが要るものと要らないものを分ける**（`docs/dev/okr-redesign-plan.md` §5-1）。今回作ったのは
**要らない側だけ**：既存データから即時に計算できる事実を「これから」ブロックとして描画する。
AI呼び出し（見立て・捨てる候補・原因の推定・バンドのAI判定）はPhase 3後半で実装する。

**分ける理由（2点）**：①更新中に茫然と待たせない——機械計算分は起動と同時に描画でき、AI分は
後から差し込む設計にすれば、AIの応答を待つ間も週の目標状態やメモは編集できる。②トークンを
使わない——モードを開いただけで発生する処理をゼロトークンに保ち、AI呼び出しは「開いているKR
タブ1本・入力が前回と変わったときだけ」に限定する設計（§5-2）の前提を崩さない。

- **`personal_kr_outlooks`テーブルを追加**（`migrations/20260811_add_personal_kr_outlooks.sql`。
  **2026-08-12に適用済み**＝テーブル作成・RLS有効化を確認。適用漏れは`SchemaHealthBanner`
  （Section 22）が「個人OKR：AI解析の結果とキャッシュテーブルが見つかりません」として検知した）。
  AI解析の結果を履歴として積む（UPDATEしない）。RLSは既存の
  `personal_kr_owner_member_id()`をそのまま再利用（新しいヘルパー関数を増やさない）。今回は
  テーブルを作るだけで、書き込みは無い（Phase 3後半でAI呼び出しを実装したときに初めて発生する）。
- **入力フィンガープリント**（`src/lib/personalOkr/outlookFingerprint.ts`の
  `computeOutlookInputFingerprint()`）：Phase 3後半の「前回と一致したら再解析しない」判定に使う
  純粋関数を先に用意した（今回はまだどこからも呼ばれない）。FNV-1a（32bit）による軽量ハッシュ
  （暗号強度は不要・外部ライブラリを足さない）。週配列はweekIndex昇順にソートしてから文字列化
  するため、要素の順序に依存しない。
- **「これから」の機械計算**：`src/lib/personalOkr/aheadCompute.ts`の`computeAheadFacts()`
  （残り週数・月末までの日数・週の自己評価の積み上げ＝◯△✕の件数・目標状態が未設定の週／
  評価待ちの週の一覧）と`isTargetAndEvidenceSet()`（当月末の達成目標が実質的に設定されているか）。
  紐づくタスクの状況は`src/lib/personalOkr/aheadTaskStats.ts`の`summarizeLinkedTaskStatus()`が
  集計するが、🔴 判定ロジック自体は再実装していない——ベースライン差分は既存の
  `computeDelayDays`（B4）、停滞は既存の`isTaskStagnant`（`AlertTasksWidget.tsx`と同じ判定
  関数）、先行待ちは既存の`getIncompletePredecessors`（B1）をそのままimportして使う。
- **バンドは3値を混ぜない**（`src/lib/personalOkr/bandDisplay.ts`の`resolveBandDisplay()`）：
  `band_ai`（AIの見通し）がまだ無いため、表示は`band_override`（人の決定）があればそれ、
  無ければ`band_target`（Kintoneの狙い）。バッジは「● 自分で決定」／「🎯 Kintoneの狙い」を
  明確に区別して出す。「✦ AI判定」バッジは常に無効表示の空き枠として置き、Phase 3後半で
  `band_ai`が入ったら差し替える（今は偽の判定結果を出さない）。
- **`band_override`は人が選んで保存できる**（`AheadBlock.tsx`）：バンドのボタンをクリックすると
  `personal_kr_months.band_override`/`band_override_by`/`band_override_at`を即保存する（トグルで
  解除も可）。解除時は`undefined`ではなく`null`を送る（Section 5・`personalOkrStore.ts`冒頭の
  null値送信ルール）。
- **AIが書く部分は控えめなプレースホルダのみ**（モックの`.ahead-lead`/`.trade`に相当する位置）：
  「AIによる見立ては次の更新で入ります。」とだけ表示し、偽の内容は一切出さない。
- **解析状態は「器」だけ**：「AI解析：未実施（次の更新で追加予定）」という固定文言のみを表示し、
  「解析中」「解析済み」の動的状態・再解析ボタンは置かない（今回はAI呼び出しが無いため、押せない
  ボタンを置かない方針。CLAUDE.md全体の「未実装の空ボタンを出さない」方針と同じ）。
- **表示対象は当月（`monthStatus==="current"`）のみ**：「これから」は前向きの計画ブロックのため、
  過去月・未来月には出さない（過去月の読み取り専用サマリー・未来月の「計画がまだありません」は
  既存のまま変更していない）。
- **やらないこと（Phase 3後半で実施）**：AI呼び出し（`AIIntent`への新タグ追加・
  `personal_kr_outlooks`への書き込み・`band_ai`の判定）・AIパネルのOKR版・月末の振り返り下書き
  （Phase 4）は今回作っていない。

### Step H：AI解析（見立て・バンドのAI判定）＋AIパネル（Phase 3後半・v3.52・2026-08-11）

Step Gで空けておいた「AIが必要な部分」を実装した。`personal_kr_outlooks`テーブル
（Step Gで追加・山本さんが適用済みの前提）への書き込みが今回初めて発生する。

**トリガーと抑制（§5-2のとおり）**：
- **発火はOKRモードで対象KRタブを開いたとき（＝そのKRの当月タブを表示したとき）のみ**。
  cron・全員一律のバッチは実装していない。`PersonalKrPanel.tsx`のuseEffectが
  `monthStatus==="current"`のときだけ`fingerprint`を計算し、ストアの`runOutlookAnalysis()`を
  呼ぶ（`personalOkrUiStore.ts`）。
- 🔴 **`input_fingerprint`が直近の保存値と一致していれば呼ばない**：`runOutlookAnalysis()`は
  まずDBの直近結果を1回だけ取得（`ensureOutlookLoaded()`。別端末・別セッションでも
  再解析されない前提を作る）し、`src/lib/personalOkr/outlookRunner.ts`の
  `runPersonalKrOutlookAnalysis()`（純粋関数）が「fingerprintが一致かつforceでなければ
  `analyzePersonalKrOutlook()`（＝AI呼び出し）を呼ばずcachedをそのまま使う」を判定する。
  AI呼び出しをテスト対象から分離してあるため、フィンガープリント一致時に呼ばれない／不一致
  なら呼ばれることをinvokeAI・Supabaseどちらもモックせずに検証できる
  （`outlookRunner.test.ts`）。
- **粒度は開いているKRタブ1本だけ**：`fingerprint`・`context`は選択中KR・当月に限定して
  組み立てる（他のKR・他の月はこの効果の対象外）。
- **「再解析」ボタン**（`AheadBlock.tsx`）：`force:true`でfingerprintが一致していても必ず呼ぶ。
- 🔴 **機械計算分は即時描画、AIが書く部分だけを後から差し込む**：`AheadBlock.tsx`は
  機械計算セクション（残り週数・自己評価の積み上げ等）を常に即時描画し、AIパートのみ
  `analyzing || outlookRow===undefined`のときスケルトン（3本のバー）にする。週の目標状態や
  メモは解析中でも編集できる（Step Bから変更していない）。

**入力を絞る理由と実際の内容**：`src/lib/personalOkr/personalOkrAiContext.ts`の
`buildPersonalOkrAiContextText()`が「作業1（AI解析）」「作業3（AIパネル）」共通の文脈テキストを
組み立てる。渡すのは①このKRの内容（6本文欄）②今月の計画（4欄＋狙いのバンド）③週の目標状態と
自己評価（◯△✕）④紐づくタスクの**機械計算済みの要約**（`summarizeLinkedTaskStatus()`の
件数のみ。Task[]の生データは一切渡さない）⑤メモの直近3件（各300字まで）。過去月の詳細・
部署ナレッジ（Phase 5未実装）は渡さない。546（Section 19・28）の教訓を踏まえ、渡す量を
機械的に絞ることで「1回の呼び出しを短く保つ」設計要件を満たす。

**AI呼び出し本体（`src/lib/ai/personalOkrOutlookExtractor.ts`の`analyzePersonalKrOutlook()`）**：
- 🔴 **max_tokens=4096**（見立て＋週ごとの一手＋捨てる候補1件＋バンド判定のJSONに
  8192/16000は不要。Section 6-1c）。
- **見立てとバンド判定は1回の呼び出しにまとめる**（`lead`／`moves`／`trade`／`band_ai`／
  `band_ai_reason`を同じレスポンスで返す）。
- **`stop_reason==="max_tokens"`を検知して明示的なエラーにする**（`personalOkrImportExtractor.ts`
  と同じ方針。リトライしても同じ壁にぶつかるだけなのでリトライしない）。
- 出力は`validatePersonalOkrOutlookPayload()`で構造検証する（`lead`欠落は例外・`moves`要素の
  必須項目欠落はその要素だけ弾く・`band_ai`は60/70/80/90/100以外は`null`に落とす・余剰
  プロパティは無視）。想定外の形は「弾く」——既存の抽出系クライアント
  （`personalOkrImportExtractor.ts`）と同じ検証の流儀。
- JSONパース失敗時は1回だけ自己修正リトライする（既存の抽出系と同じ作法）。
- Edge Functionは関数ごとに実行時間・メモリの上限を上げられない。落ちたら分割か入力削減
  しかない（本機能はそもそも入力が小さいため、まず1回にまとめたうえで入力を絞ることを優先し、
  分割が必要な事態を避けた設計）。

**バンドは見通しであって評価ではない**（§6）：`src/lib/personalOkr/bandDisplay.ts`の
`resolveBandDisplay()`を3引数（`bandOverride, bandAi, bandTarget`）に拡張し、優先順位は
`band_override`（決定）＞`band_ai`（見通し）＞`band_target`（狙い）。🔴 **`band_override`が
入っていれば`band_ai`の値は表示に一切使わない**——`AheadBlock.tsx`は`display.source==="ai"`の
ときだけ「✦ AI判定」バッジを出す（overrideがある間はこのバッジ自体を出さない。値をミュート
表示することもしない）。`band_ai`は月の途中でも出す「現時点の見通し」であり、人が決めた
「決定」を上書きする力を持たない（AI解析のシステムプロンプトにも明記した）。

**AIパネル（`src/components/okr/personal/PersonalOkrAiPanel.tsx`）**：
- 🔴 **計画モードと同じ右パネルの型を流用**（`ConsultationPanel.tsx`のヘッダーグラデーション・
  左端ドラッグでリサイズ可能なinline幅遷移・タブ説明バー・スクロール領域・下部固定フッターの
  構造をそのままコピー）。新しいパネルの仕組みは発明していない。提案の適用・Undo・
  Gantt/会議読み込みプレビュー等は持たない（相談・助言止まりで、DB操作は行わない）。
  `PersonalOkrView.tsx`が`ConsultationPanel`と同じ「width遷移でメインエリアが縮んで
  共存する」ラッパーで包む（`MainLayout.tsx`のインライン配置パターンと同じ）。
- 冒頭に「このパネルが見ているもの」として文脈チップ（`buildPersonalOkrAiContextChips()`）を
  明示する。スターター（質問候補。`buildPersonalOkrAiStarters()`）は当月のバンドの狙いに
  言及する4つの質問。
- **答え方**：`src/lib/ai/personalOkrChatPrompt.ts`の`buildPersonalOkrChatSystemPrompt()`が
  達成度バンドの定義に沿って「今どの水準か・上げるには何が必要か」で答えるよう指示する。
- 🔴 **入力を絞る**：文脈は作業1（AI解析）と同じ`buildPersonalOkrAiContextText()`を使う
  （同じ材料）。会話履歴は`sessionManager.ts`（既存・タスク管理AI相談と共有）で管理し、
  **DBに保存しない**（Section 6-7）。localStorageにも書かない（計画モードのAI相談パネルより
  保守的な扱い。個人の評価に関わる文脈を含むため）。
- max_tokens=2048（`src/lib/ai/personalOkrChatClient.ts`）。添付ファイルを伴わないコーチ役の
  短い回答を想定し、タスク管理の主相談（16384）より小さく絞った。`stop_reason==="max_tokens"`
  も同様に明示的なエラーにする。
- 当月タブを開いていない（`context===null`）ときはパネルを開けても「当月のタブを開いている
  ときだけAIに相談できます」と表示し、送信不可にする（AI解析と対象を揃えるため）。

**`AIIntent`は2つに分けた**（`src/lib/ai/invokeAI.ts`）：`"okr-personal-outlook"`（AI解析・
自動トリガー・キャッシュにより実際の呼び出し頻度は低い）と`"okr-personal-chat"`
（AIパネルの対話・明示操作でターンごとに発生する）。理由：使用量の集計単位として
意味のある切り方にするため——自動解析とユーザー主導の対話は発生頻度・コスト特性が
全く異なり、1つのタグにまとめると管理画面「AI使用量」タブでどちらが使用量を占めているか
分からなくなる（振り返り下書き=Phase 4の`"okr-personal-review-draft"`案とも同じ考え方）。

**やらないこと（Phase 4・5で実施）**：月末の振り返り下書き生成・部署ナレッジ
（`okr_knowledge_docs`）・グループビューは今回作っていない。

### Step I：バグ修正（v3.53・2026-08-12）

- 🔴 **KRタブの帯には`flexShrink:0`が必須。** `PersonalOkrView.tsx`のKRタブの帯は
  `overflowX:"auto"`を持つflexアイテムで、明示的な`flexShrink`が無いと自動最小サイズが0になる
  （Section 21が本文に`minHeight:0`を要求するのと対になるCSSの規則）。選択中KRの中身
  （`PersonalKrPanel`）は縦に非常に長いため、親の高さが不足するとこの帯だけが真っ先に高さ0まで
  潰れ「KRタブが1つも表示されない」ように見えていた（実機で発生・山本さんの報告）。KRタブの帯・
  「対象期」の行の両方に`flexShrink:0`を付けて固定した。再発防止テストは
  `personal/__tests__/personalOkrViewLayout.test.ts`（この2箇所をソース走査でピン止め。
  一般ルール化は誤検知が多いため見送った）。
- **「これから」のAI解析取得が失敗すると`isLoadingOutlook`が永久にtrueのままになるバグを修正**
  （`personalOkrUiStore.ts`の`ensureOutlookLoaded()`。取得失敗時も`outlookByKrMonth[key]`を
  `null`で確定させる）。`personal_kr_outlooks`未適用時にこの状態で実際に発生した。
- **週カードの`getIncompletePredecessors`（部署全体のtasks×taskDependenciesのフルスキャン）が
  「今月の計画」への1文字入力ごとに週カード全件×紐づけタスク全件ぶん再実行されていた重さを修正**
  （`PersonalKrPanel.tsx`で`linkedTasks`を参照安定化・`WeekCard.tsx`で計算結果を`useMemo`化）。
- **対象期にKRが0件のとき、実際にKRが存在する期を候補ボタンで提示する安全網を追加**
  （`src/lib/personalOkr/availablePeriods.ts`。取込先の年度・四半期がずれた場合の再発防止）。

### Step J：月の選択を「対象期」へ一元化・AI解析を明示ボタン起動に変更（v3.55・2026-08-12）

山本さんが実際に使ってみて出た3つの不満への対応。

- **課題1（月がKR切替のたびに当月へ戻る）の原因**：`PersonalOkrView.tsx`が
  `<PersonalKrPanel key={selectedKr.id} .../>` と`key`を渡していたため、KRを切り替えるたびに
  コンポーネントごと作り直され、月選択（`PersonalKrPanel.tsx`内のローカルstate）が
  `defaultMonthIndex`（＝当月）にリセットされていた。
  **対応**：月の選択を`PersonalOkrView.tsx`側へ持ち上げ、「対象期」行（年input・四半期
  セレクトの隣）にセレクタを追加した。選択肢は選択中の年・四半期から`quarterMonthSlots()`
  が導く3つ。既定値は`src/lib/personalOkr/quarterMonths.ts`の新規`resolveDefaultMonthIndex()`
  （当月がその四半期に含まれていればその月、含まれていなければ先頭の月）が決める。年・
  四半期を変えるたびにこの既定値へ追従させる（`useEffect`）。`PersonalKrPanel`は
  `monthIndex`をpropsで受け取るだけになり、内部の月タブUI（ボタン群）は撤去し、
  選択中の期・月と状態（確定済み／未来）だけを表示する静的な行に縮小した（月選択を
  二重に持たない）。
- **🔴 `key={selectedKr.id}`は外した。** KRを切り替えてもコンポーネントが作り直されなくなった
  副作用として、下書きstate（今月の計画の`positioning`/`activities`/`targetAndEvidence`/
  `risks`/`bandTarget`・メモの未送信ドラフト・週タスクリンクモーダル）が前のKRの内容を
  引きずらないことを担保する必要があった。`positioning`等を初期化するuseEffectの依存配列に
  `kr.id`を追加（以前は`monthRecord?.id`と`monthStr`だけだったため、新旧どちらのKRにも
  月次計画が無いケースで依存配列が変化せずリセットされない事故が起きうる設計だった）。
  メモの下書き（`MemoSection`内部state）・週リンクモーダル（`linker`/`weekActionError`）にも
  `kr.id`変化で明示的にクリアするuseEffectを追加した。
- **課題2（KR切替のたびに何十秒も待たされる）の確定原因**：`PersonalKrPanel.tsx`の
  useEffectが、当月のKRタブを開くたびに`runOutlookAnalysis()`（＝Anthropic API呼び出し）を
  自動発火していたこと（Step H・v3.52で実装した「発火はOKRモードで対象KRタブを開いたときの
  み」という当初設計そのもの）。KRが複数本あれば切替ごとにAI呼び出しが走り、その応答待ち
  （実測で「何十秒」）がそのままタブ切替の遅さとして体感されていた。ensureKrDetailLoaded・
  ensureWeekTasksLoadedは既にキャッシュ判定があり同じKR・同じ週への再クエリは発生しない
  ことをコード上確認済み（N+1や直列待ちの追加要因ではなかった）。
- **対応（山本さんの決定）**：AI解析は明示ボタンを押したときだけ発火する。
  `PersonalKrPanel.tsx`から自動発火のuseEffectを削除し、代わりに`ensureOutlookLoaded()`
  （保存済みの解析結果をDBから1回読むだけ・ゼロトークン）だけを当月タブ表示中に自動で呼ぶ。
  機械計算分（残り週数・積み上げ等）は元から即時描画でトークンを使わない。
  **ボタンは1つ**（`AheadBlock.tsx`）：未解析（`outlookRow`が無い）なら「✦ 見立てを出す」、
  解析済みなら「再解析」に文言が切り替わる。押し先は同じ`onReanalyze`で、force判定
  （既存の解析結果があるかどうか）は呼び出し元（`PersonalKrPanel.tsx`の
  `handleRunOutlook`）が行う——未解析なら`force`無し（キャッシュが無いのでどのみち呼ぶ）、
  解析済みなら`force:true`（fingerprintが一致していても必ず呼ぶ＝以前の「再解析」ボタンと
  同じ挙動）。`input_fingerprint`による再解析抑止のロジック（`outlookRunner.ts`）自体は
  変更していない。
- **自動で走ると誤解させる文言を排除**：`AheadBlock.tsx`の空き状態プレースホルダを
  「AIによる見立てを準備しています。」→「上の「✦ 見立てを出す」を押すと、AIが見立てを出します。」
  に変更。「AI解析：未実施」の表示にも「（ボタンを押すと実行されます）」を添えた。
- **docs/dev/okr-redesign-plan.md §5-2を実態に合わせて書き換えた**（変更理由と変更日を明記）。
- **テスト**：`quarterMonths.test.ts`に`resolveDefaultMonthIndex`のケース4件を追加（当月を
  含む四半期／含まない過去・未来の四半期／含まない別年度）。既存の
  `personalOkrViewLayout.test.ts`（flexShrink:0のソース走査）は対象期行・KRタブの帯の
  style自体を変更していないため無修正で通過。
- **やらないこと**：AI呼び出し本体（`analyzePersonalKrOutlook`）・`input_fingerprint`の
  計算方法・`AIIntent="okr-personal-outlook"`は変更していない。

### Step K：Kintone取込のトークン削減・決定的パーサを主経路にする（v3.56・2026-08-12）

**山本さんの指摘**：「Kintone画面は皆同じなので、インポートさせるPDFの型もほぼ似たようなものになる。AIに構造を推測させる必要が本来無い」。この前提で、Kintone取込（Step F）のAI依存度を段階的に下げた。取込の確認画面（既存KRへの対応づけドロップダウン等・Section 24 Step F 🔴）は一切変更していない。

- **① 決定的パーサを主経路にする**：新規`src/lib/personalOkr/kintoneTextParse.ts`（純粋関数のみ・pdfjs等に依存しない）。`personalOkrImportExtractor.ts`のSYSTEM_PROMPTに書かれたラベル規則（「●対象業務カテゴリ」「▼◯月に取り組む内容（計画）」「[自己評価：]」等の角括弧・記号表記）をそのままルールベースの正規表現に落とし、`PersonalOkrImportAnalysis`/`PersonalOkrImportMonthlyAnalysis`（AI抽出結果と同じ型）を返す。ウェイト・達成度バンド・自己評価％の数値正規化は既存の`importFieldParse.ts`の`parseWeightPct`/`parseBandValue`/`parsePercentValue`をそのまま再利用する（二重実装しない）。**山本さんは実際のKintone帳票のテキストを持っていないため、テストはSYSTEM_PROMPTの記述から組み立てた合成フィクスチャで行っている**（`kintoneTextParse.test.ts`冒頭に明記）。
- **② 信頼度ゲート（安全弁）**：`KintoneParseConfidence`（`ok`/`krCount`/`reasons`）。四半期側は「KR見出しが1件以上」「見出し番号が1から連番」「本文6欄の充足率50%以上」「見出しの括弧内から名称を抽出できている」を満たさなければ`ok=false`。月次側は「月次フィールドが1件以上検出できている」「充足率35%以上」を満たさなければ`ok=false`。`ok=false`のときは黙って従来のAI経路にフォールバックする（Kintone側の画面が変わっても壊れない設計の要）。**四半期は決定的に読めたが月次は読めない、のような部分適用も可**（読めた方だけ決定的パーサの結果を使い、AIには残りだけを投げる。丸ごとAIに投げ直さない）。
- **③ 経路の可視化**：`describeKintoneImportSource()`（同ファイル）が「⚙ 画面の構造から読み取りました（AI未使用）」／「🤖 AIで読み取りました」／混在時の表現を返す。`PersonalOkrImportModal.tsx`の確認画面に`ImportSourceNotice`として必ず表示し、「元◯◯字→AIへの送信◯◯字（0字ならAI未使用）」も併記する（山本さんが実機でどちらが動いたか報告するための唯一の手がかりのため省略しない）。
- **④ AIに渡す前に本文を削る**：新規`src/lib/personalOkr/importTextTrim.ts`（純粋関数）。AIにフォールバックする場合でも、SYSTEM_PROMPTが「抽出しないもの」と明示している領域（個人単位の月次/四半期評価サマリー・【N月限定KR】のような一時的なKR・役割等級要件や面談参考資料の付録セクション）を送信前に機械的に削る。境界が曖昧な削り方（本文中の「●」「▼」を境界にする等）はしない＝見出し文字列から次の既知セクション見出し、または文末までだけを削る（削りすぎない）。
- **⑤ AI呼び出しの1回／2回の自動切替**：`personalOkrImportExtractor.ts`に`extractPersonalOkrCombinedData()`（呼び出し1・2を1つの呼び出しに統合。既存の`validatePersonalOkrImportAnalysis()`をそのまま再利用できる形＝新設のバリデータ不要）を追加。決定的パーサの結果、四半期・月次の両方がAI必須になった場合のみ、削減後の送信本文が`PERSONAL_OKR_IMPORT_COMBINED_CALL_MAX_CHARS`（10000字。既存の警告閾値20000字の半分＝1回にまとめる判断はより慎重に取る）以下なら1回にまとめ、それを超える場合は実績のある2回分割（Section 19 ⑧・28）を維持する。**まとめ呼び出し自体が失敗した場合は2回分割へフォールバックする**（1回にまとめたことが原因の失敗を安全な経路でリトライする安全弁）。
- **モデル切替（④）は対応済みだった**：`PERSONAL_OKR_IMPORT_MODEL`は2026-08-11（v3.52・Step Hと同時期）に山本さんの指示で既に`claude-haiku-4-5`へ切替済み（Edge Functionの`ALLOWED_MODELS`に含まれる）。今回の変更対象外。決定的パーサが主経路になったことで、AIがフォールバック用途に後退し、haiku化による多少の精度差は許容できるという判断の裏付けが強まった。
- **`extractPersonalOkrImportData()`の型拡張**：`PersonalOkrImportResult`に`quarterlySource`/`monthlySource`（`"deterministic"|"ai"|"none"`）・`aiSentCharCount`・`originalCharCount`を追加した。既存の`warnings`は「まとめ呼び出し失敗→分割リトライ」のメッセージも積む。
- **テスト**：`kintoneTextParse.test.ts`（18件）・`importTextTrim.test.ts`（7件）を新設。`personalOkrImportExtractor.test.ts`にオーケストレーターの新規シナリオ（1回にまとめる／まとめ失敗時のフォールバック／閾値超えは2回分割のまま／決定的パーサのみで完結・AI呼び出しゼロ／四半期は決定的・月次だけAIの部分適用）を追加。既存のオーケストレーターテスト（分割呼び出しの検証）はダミーtranscriptが閾値以下だと新設のまとめ呼び出しに切り替わってしまうため、`LARGE_NON_KINTONE_TRANSCRIPT`（閾値超の長さ）を使うよう更新した。

### Step L：OKRモードのガイドツアー（v3.70・2026-08-12）

山本さんの依頼：「OKRモードを初めて選択した人には、OKRのガイドツアーを開始するようにしたい」「KRは基本的にOKRモードから登録する導線にしたいので、未設定の人に見せる前提で組んでほしい。ただし何も設定されていない画面では説明しようにも表示されないパラメータがあるため、サンプルデータを表示してイメージを実感してもらいたい」。

- **一行で言うと**：新しいツアー`okr-intro`（`src/components/tour/tours/okr-intro.ts`）を追加した。OKRモードを初めて開いたときに自動で始まり、対象期にKRが0本なら実データの代わりにv3.67のサンプル（`src/lib/demo/personalOkrDataset.ts`）を読み取り専用で差し込んで案内する。
- **起動口は1箇所（`PersonalOkrView.tsx`のマウント時useEffect）**：既存の初回ゲート（`OkrModeIntroModal`の承認・Section 19 ⑥）とゲストの直接入室（Section 23）は、どちらも最終的に`appMode`が`"okr"`になり`PersonalOkrView`がマウントされる点で合流する。この合流点に`if (!tour.isRunning && !tour.isCompleted(OKR_TOUR_ID)) tour.start(OKR_TOUR_ID)`を1つ置くだけで、「ゲートの承認直後」「ゲストの直接入室」の両方を1つのコードパスで満たせる（`MainLayout.tsx`側の2つの入口それぞれにツアー開始コードを重複させない）。完了・スキップは`firstTimeTour`と同じ`localStorage`（v3.138以降はメンバーID別の`tour_completed_v1:<memberId>`。Section 65）で管理され、一度でも終了/スキップすれば以後は自動再生されない。
- **再生導線**：`TourProvider`の`TourContextValue`に`activeTourId: string | null`を追加した（「今動いているのはOKRツアーか」をコンポーネント側が区別するために必要）。ガイド（`GuideModeView.tsx`の`GuideHome`）は`TOUR_LIST[0]`（主要ツアー）を大きな導線のまま維持し、`TOUR_LIST.slice(1)`（OKRツアー等）を「ほかのツアー」として小さめのカードで並べ、いつでも見直せるようにした。
- **🔴🔴 サンプル差し込みは読み取り専用（保存経路を完全に塞ぐ）**：判定は`src/lib/personalOkr/tourPreviewSample.ts`の`shouldInjectOkrTourPreviewSample(isOkrTourRunning, activeKrCountInPeriod)`（純粋関数・テスト有）1点＝「OKRツアー実行中か」×「対象期のKRが0本か」だけで行う。既にKRがある人（ゲスト含む。ゲストはv3.67で既にサンプルKRが実データとして注入済みのため、この条件だけで自然に「二重差し込みしない」が成立する）はその人の実データで案内する。
  - サンプル本体は`buildDemoPersonalOkrDataset()`（v3.67と同一・新規サンプルは作らない）を`PersonalOkrView.tsx`から**動的importでのみ**読み込む（`personalOkrDataset.test.ts`が静的import禁止を機械検査するため）。週カードの遅延・先行待ちバッジを再現するため、`dataset.ts`（グループOKR側サンプル）の`tasks`/`taskDependencies`も同時に動的importし、`tasks`/`taskDependencies`propとして実データの代わりに渡す。
  - `PersonalKrPanel.tsx`に`readOnly?: boolean`propを追加。`monthEditable = !readOnly && monthStatus === "current"`の1変数で、WeekCardの`editable`・AheadBlockの`editable`（バンド決定）・今月の計画のテキストエリア/保存ボタンの大部分が連動して無効化される。加えて`handleSaveMonthPlan`/`handleSetBandOverride`/`ensureWeek`/`handleRunOutlook`/`ensureOutlookLoaded`の自動effect/`MemoSection.handleAdd`の各先頭に`if (readOnly) return`を明示し、UI側のガードが将来崩れても実データの保存アクションへは到達できないようにしている（二重の防御）。
  - **呼び出し元（`PersonalOkrView.tsx`）でも保存経路そのものを差し替える**：`previewSample`が真のとき、`onSaveMonth`/`onSaveWeek`/`onSaveMemo`/`onLinkWeekTask`/`onUnlinkWeekTask`/`ensureWeekTasksLoaded`/`ensureOutlookLoaded`/`onRunOutlookAnalysis`は実データのstoreアクション（`usePersonalOkrUiStore`）を一切渡さず、共有のno-op（`PREVIEW_NOOP_ASYNC`/`PREVIEW_NOOP`）を渡す。`onEditKr`もno-opにする（サンプルKRの編集フォームを開かせない＝そのままsaveKrされてもサンプルidは実DBに存在せず失敗するため、経路自体を断つ）。`onOpenAiPanel`も`undefined`にして「迷ったらAIに聞く」ブロックを非表示にする。
  - **AI解析結果は「未実施」に固定**：サンプルKRのidは`personal_krs`に実在しないため、実データの`ensureOutlookLoaded`を呼ぶと無意味な問い合わせになる。代わりに`buildPreviewOutlookMap()`が全サンプルKR×対象月の組を`null`で埋めた`outlookByKrMonth`を作り、`outlookRow===undefined`による無限スケルトン表示（Section 24 Step Iで踏んだ罠と同種）を避けている。
  - **画面上の明示**：「対象期」行に🔍バッジ「これはサンプル表示です（保存されません）」、`PersonalKrPanel`本体にも同内容のバナーを表示する。「✏️ このKRを編集」ボタンは`disabled`＋ツールチップ「サンプル表示中は編集できません」。
  - **「＋ KRを追加」「📥 Kintoneから取込」は常に実際の登録操作のまま**：サンプル表示中でもここから作るKRは実データとして保存される（ツアーの着地点＝Step 8のターゲット`data-tour-id="okr-registration-actions"`。`PersonalKrFormModal`の`existingKrsInPeriod`・`PersonalOkrImportModal`の`allPersonalKrs`は意図的に実データ（`activeKrs`/`krs`）のままにし、サンプルの重み40/35/25%を実KR作成のウェイト集計に混ぜない）。実際に新しいKRが保存されると、次の描画で`activeKrs.length`が0でなくなり`shouldInjectOkrTourPreviewSample`がfalseに変わるため、サンプル表示は自動的に終了して実データへ切り替わる。
- **8ステップの構成**：①モードの目的（Kintoneが正本・週の層を埋める）②対象期の選び方③KRタブ④今月の計画⑤★週の目標状態（このアプリだけの層と明示）⑥タスクとの紐づけ（遅延・先行待ちの表示）⑦これから（AIは「✦ 見立てを出す」を押したときだけ動く旨を明記）⑧登録して始める（Kintone取込／KR追加への着地＋今後の拡張予定を一言添える）。ターゲットは`okr-period`/`okr-kr-tabs`/`okr-month-plan`/`okr-week-cards`（⑤⑥で共有）/`okr-ahead`/`okr-registration-actions`（`data-tour-id`属性。全てskipIfMissing:trueでUI変更耐性を確保）。
- **未設定時の空状態文言も改善**（ツアーを見ずに来た人が最初に見る画面でもあるため）：「{年}年{Q}の個人KRがまだありません。」の一文だけだったのを、「Kintoneに個人OKRが既にある場合は「📥 Kintoneから取込」、まだ無い場合は「＋ KRを追加」から手入力で登録できます。」を追加し、取込と手入力どちらから始めればよいかを案内するようにした。
- **回帰テスト**：`tourPreviewSample.test.ts`（判定4パターン）・`okrIntroTour.test.ts`（ステップ数7〜9・id重複無し・target持ちは必ずskipIfMissing・タイトル/本文の体裁）・`buildTours.test.ts`に追加（非ゲスト/ゲストどちらも`okr-intro`を含むこと・ゲスト版は改変されないこと）。`personalOkrViewLayout.test.ts`の正規表現は`data-tour-id`属性の追加を許容するよう更新した（属性が増えても「対象期」「KRタブ」の帯の`flexShrink:0`検査自体は変わらない）。

### Step M：月末の振り返り下書き（Phase 4・v3.83・2026-08-20）

`docs/dev/okr-redesign-plan.md`§8 Phase 4「月末の振り返り下書き（明示ボタン・別`AIIntent`）」の実装。行き先はKintone「個人OKR_月次振返り記録」の「振り返り」欄の地の文（貼り付け運用。Kintoneへの自動書き込みはしない）。

- **下書きはDBに残す（山本さんの判断）**：新テーブル`personal_kr_review_drafts`（`supabase/migrations/20260820_add_personal_kr_review_drafts.sql`。⚠️山本さんが手動適用）。RLSは既存の`personal_kr_owner_member_id(uuid)`/`current_member_id()`を再利用し`personal_kr_outlooks_own`と同型のポリシー（新しいヘルパー関数は作らない）。
  🔴 **`personal_kr_outlooks`との違い（同じ「AI生成の履歴テーブル」でも書き込み方が違う理由）**：outlooksはAI生成のたびに毎回INSERTして履歴として積む（UPDATEしない）が、このテーブルは**人の編集（`edited_text`/`edited_at`）だけは直近行をUPDATEする**。理由＝下書きは「AIが発行して終わり」ではなく、人がKintoneに貼る前に文章を仕上げる（言い回しを直す・具体を足す）ものだから。編集のたびに新しい行を積むと「今どれが最新の下書きか」が行の乱立で分からなくなる。再生成（force:true）のときは新しい行をINSERTし編集内容は自然に上書きされる（引き継がない。意図的な割り切り）。`updated_at`列・トリガーは持たせない。`src/lib/schema/schemaChecks.ts`に検査項目`personal_kr_review_drafts_table`を1件追加。
- **🔴 自己評価（%）・達成度バンドの数値をAIに書かせない理由（山本さんの判断）**：AIが出すのは文章の下書きだけ。`src/lib/ai/personalOkrReviewDraftExtractor.ts`のシステムプロンプトに「自己評価の割合・達成度バンドの数値を書いてはならない。角括弧表記も出力しない。数値の評価は人が決める」と明記し、出力の型（`review_text`/`evidence`/`carryover`）自体にも数値評価用のフィールドを持たせていない（計画書§6「バンドは見通しであって評価ではない」の延長）。代わりに機械計算の「材料」（`src/lib/personalOkr/reviewMaterial.ts`）を画面に出す。
- **🔴 過去月でも生成できる理由（実務上の必須要件）**：8月の振り返りは9月に書くのが実態のため、対象月が`classifyMonth()`で`past`でも下書きを生成できるようにした。`past`＝読み取り専用の制約は「月次計画欄の編集」に対する制約であり、下書き生成はその対象外。`PersonalKrPanel.tsx`の`personalOkrContext`/`fingerprint`の算出条件を「`monthStatus==="future"`でなければ計算する」に広げた（既存の「これから」AI解析・AIパネルは`okrAiContext`という当月限定の派生変数でゲートし続けるため、既存挙動は一切変えていない）。未来月は材料が無いため対象外。生成ボタンは、その月の週の目標状態が0本かつ自己評価が全て未評価なら非活性にし「材料がありません（週の目標状態を書いてから生成してください）」と出す（`isReviewMaterialEmpty()`）。
- **トリガーは明示ボタンのみ（自動発火しない）**：`src/lib/personalOkr/reviewDraftRunner.ts`の`runPersonalKrReviewDraft()`（`outlookRunner.ts`と同型の純粋関数。invokeAI・Supabaseをモックせず「一致なら呼ばない／不一致なら呼ぶ」をテストできる構造）が`input_fingerprint`一致時はAIを呼ばず保存済みを返す。「再生成」ボタンは`force:true`。
- **材料（機械計算・ゼロトークン）**：`src/lib/personalOkr/reviewMaterial.ts`の`computeReviewMaterial()`が対象月の週の◯／△／✕の内訳件数・未評価の週数・紐づくタスクの完了/未完了件数を組む。🔴 既存の`aheadCompute.ts`（週の内訳・未評価週数）・`aheadTaskStats.ts`（遅延・停滞・先行待ち）を再利用し、同じ計算を書き直していない。新規に足したのは紐づくタスクの完了/未完了件数の集計のみ。この材料は①画面に即時描画②AIへ渡す文脈にも含める、の両方で使う。
- **AI呼び出し**：`src/lib/ai/personalOkrReviewDraftExtractor.ts`の`generatePersonalKrReviewDraft()`。`AIIntent`に`"okr-personal-review-draft"`を追加（Section 6-1b）。max_tokens=2048（段落1つ＋短い箇条書きに4096以上は不要。Section 6-1c）。モデルは`personalOkrOutlookExtractor.ts`と同じ選定（claude-sonnet-4-6）に倣う。出力JSON＝`{review_text, evidence, carryover}`。`validatePersonalOkrReviewDraftPayload()`で構造検証（`review_text`欠落は例外・`evidence`/`carryover`の非文字列要素はその要素だけ弾く・余剰プロパティは無視）。`stop_reason==="max_tokens"`は明示エラーにしてリトライしない。JSONパース失敗時は1回だけ自己修正リトライ。
- **文脈は既存の組み立てを再利用し、渡す量を絞る**：`personalOkrAiContext.ts`の`buildPersonalOkrAiContextText()`はそのまま使う（共通関数自体は無改修）。`personalOkrReviewDraftExtractor.ts`内の`buildReviewDraftContextText()`がこれに材料（自己評価内訳・完了/未完了件数）を追記して渡す。渡す上限はStep Hと同じ（メモは直近3件×各300字まで／タスクは機械計算済みの要約のみ）。
- **UI**：`src/components/okr/personal/PersonalOkrReviewDraftModal.tsx`（新規）。入口は`PersonalKrPanel.tsx`の「📝 振り返りの下書き」ボタン（`monthStatus!=="future"`かつ`!readOnly`のときのみ表示。サンプル表示中は`onEditKr`と同じ扱いで出さない）。Section 21準拠（`modalStyles.ts`。中央寄せは箱側の`margin:"auto"`）。構成：①材料（即時描画）②AIの下書き（編集可能なtextarea）③evidence（折りたたみ）④carryover⑤コピー⑥「Kintoneの『振り返り』欄に貼り付けてください」の注記⑦編集を保存⑧再生成。🔴 機械計算分は即時描画し、AIが書く部分（textarea・evidence・carryover）だけをスケルトンにする（Step H・AheadBlock.tsxと同じ）。`draftRow===undefined`（未取得）と`null`（未生成）を区別する（Step Iの「永久スケルトン」の罠を踏まない）。エラー表示はSection 15準拠。生成中はボタンを非活性にして二重発火を防ぐ。
- **ストア**：`src/stores/personalOkrUiStore.ts`に`reviewDraftByKrMonth`キャッシュ・`ensureReviewDraftLoaded()`・`runReviewDraft()`・~~`saveReviewDraftEdit()`~~を追加。ゲスト分岐（`isGuestMode()`）を必ず入れる（既存の流儀＝AI呼び出し自体は素通しするが、DB書き込み＝insert/updateはスキップしメモリ上のみで成立させる。リロードで消える）。`client.ts`のProxyと`GUEST_ALLOWED_FUNCTIONS`は1文字も緩めていない。**🔴 `saveReviewDraftEdit()`はStep N（v3.96）で廃止した**（下書きの保存先が月の`review_text`へ一本化されたため）。
- **付随更新**：`uiGuide.ts`の`FEATURE_LIST_SECTION`に「これから」表示・「振り返りの下書き」を追記（Section 17）。バージョン4点セット（version.ts/CLAUDE.md/CHANGELOG.md/releaseNotes.ts）を更新。CHANGELOG.mdのv3.82記載漏れ（直近commit 37720bfがCHANGELOG.mdを更新していなかった）を本Sectionの実装と同時に補った。
- **テスト**：`reviewMaterial.test.ts`（週0本・全未評価・混在のケース）・`reviewDraftRunner.test.ts`（fingerprint一致/不一致/force）・`personalOkrReviewDraftExtractor.test.ts`（`validatePersonalOkrReviewDraftPayload`の検証・stop_reason・自己修正リトライ）を新規追加（合計25件）。既存1592件を壊さず、合計1617件が全通過。
- **やらないこと**：Phase 5（`okr_knowledge_docs`）・Kintoneへの自動書き込み・グループOKR側への変更は対象外。i18n辞書キーは追加していない（既存OKR系と同じく日本語直書き）。マイグレーションの適用は山本さんが手動で行う。

### Step N：月次「振り返り」の記録・AI下書きの1本化・過去月の編集解放（v3.96・2026-08-26）

山本さんの依頼：①計画だけでなく振り返り結果も記入・記録できるようにしてほしい ②AIが出した下書きを直接編集して保存できるようにしてほしい（Step Mの下書きは保存先が下書きテーブル専用で月の記録と繋がっていなかった）。

- **設計判断（山本さんが選択済み）**：記録項目は`review_text`＋`self_eval_pct`＋`gm_eval_pct`＋`gm_comment`の4つとも画面編集可。下書きの保存先は1本化（AI下書きを編集して保存すると月の`review_text`になる）。過去月は計画欄・週カード・バンド決定・振り返り欄すべて編集可。
- **新規「振り返り」ブロック**：`src/components/okr/personal/MonthReviewBlock.tsx`。配置は「これから」→「迷ったらAIに聞く」→「振り返り」→「メモ」。当月・過去月で表示（未来月では出さない）。既存列（マイグレーション不要）を保存ボタン方式（自動保存にしない）で編集する。数値入力の検証・dirty判定は`src/lib/personalOkr/monthReviewForm.ts`（`parseEvalPctInput`／`computeMonthReviewDirty`）に切り出した——`self_eval_pct`は文字列⇔数値の往復で誤判定しやすいため正規化してから比較する。
- **🔴 保存が互いのフィールドを消す不具合の修正（Step 0で発見）**：`PersonalKrPanel.handleSaveMonthPlan`は`PersonalKrMonth`を新規に組み立てて`onSaveMonth`へ渡しており、`review_text`等を含めていなかった。`personalOkrUiStore.saveMonth`は`upsertById`（渡されたオブジェクトで既存行を丸ごと**置換**）でローカルstateを更新するため、DB側は`saveWithLock`が`undefined`のキーを送らず列を保持するが、**ローカルstate側では画面から振り返り欄・バンド決定が消えて見える**。新規`src/lib/personalOkr/monthRecordMerge.ts`の`mergeMonthRecord(monthRecord, fallback, patch)`（純粋関数）に切り出し、`handleSaveMonthPlan`・`handleSetBandOverride`・新設`handleSaveReviewText`の3箇所すべてを「既存レコード＋自分の担当フィールドだけ上書き」の形に統一した。
- **AI下書き→振り返り本文の1本化**：`PersonalOkrReviewDraftModal.tsx`の初期値は「①月の`review_text` ②旧`draftRow.edited_text`（救済）③`draft_json.review_text`」の優先順位（`initializedRef`で「初回同期」と「再生成による同期」を区別——再生成時は優先順位を無視し常に新しい生成結果を表示する。月の`review_text`は自動上書きしないため）。「編集を保存」は`onSaveMonth`経由で月の`review_text`へ保存する。**`personal_kr_review_drafts.edited_text`への書き込み経路（store関数`saveReviewDraftEdit`・低レベルCRUD`updatePersonalKrReviewDraftEdit`）は廃止**（`edited_text`列と既存データは読み取りフォールバックとして残す。DBのDROP COLUMNはしない）。再生成時、既に振り返り本文がある場合はConfirmModalで確認する（`tone:"neutral"`・cancel側＝安全側＝再生成しない。Section 21・v3.88の教訓）。
- **過去月の編集解放**：`src/lib/personalOkr/quarterMonths.ts`に純粋関数`isMonthEditable(monthStatus, readOnly)`（`!readOnly && monthStatus !== "future"`）を切り出し、`PersonalKrPanel.tsx`の`monthEditable`をこれに差し替えた。`grep -rn "monthStatus|classifyMonth" src`で全箇所を洗い出し、「これから」のAI解析・AIパネル（`okrAiContext`）は当月限定のまま**維持**（過去月では意味を成さないため）。
- **バンド決定UIの共通化**：`AheadBlock.tsx`内の「バンドを決定する」ボタン群を`src/components/okr/personal/BandOverridePicker.tsx`へ切り出し、`AheadBlock`（当月）と`MonthReviewBlock`（過去月のみ。当月はAheadBlock側にあるため二重にしない）の両方から使う。
- **過去月の文言修正**：「今月の計画」見出し・保存ボタンを`${月}月の計画`のように月番号を使う文言へ変更（過去月で見ると嘘になるため）。「（確定済み・読み取り専用）」バッジを「（過去月）」に変更し、計画欄の説明文を過去月・当月で統一した。
- **テスト**：`monthRecordMerge.test.ts`（4件）・`monthReviewForm.test.ts`（10件）・`quarterMonths.test.ts`に`isMonthEditable`（4件）を追加。
- **やらないこと（v3.97で対応）**：週次の任意化（AI側・画面表示側）はこのバージョンでは行っていない。

### Step O：週次（週ごとの目標設定・自己評価）の任意化（v3.97・2026-08-26）

山本さんの依頼：AIの分析結果に「週ごとに目標を立てて振り返れているか」への言及が多い。週次の目標設定・自己評価は、使いたい人だけが使う任意の補助機能でありAIが分析するための補助情報。必須手順ではない。週次機能を使っているかどうかで評価してはならない。大事なのは内容。記入がないものについて、記入がないこと自体に言及する必要はない。

- 🔴 **新グランドルール（v3.105で更新）**：週ごとの目標設定・自己評価は任意の補助機能である。AI・画面のいずれでも「記入が無いこと」を指摘・評価してはならない。**個人OKRのAI用プロンプト（システムプロンプト）を追加・変更するときは`WEEKLY_IS_OPTIONAL_NOTICE`（`src/lib/ai/weeklyOptionalNotice.ts`）と`ACTUAL_WORK_COUNTS_NOTICE`（`src/lib/ai/actualWorkNotice.ts`。v3.105・実施記録の評価軸）の両方を必ず含める。**
- **共通条項の1箇所化**：`WEEKLY_IS_OPTIONAL_NOTICE`・`ACTUAL_WORK_COUNTS_NOTICE`の両定数を、SYSTEM_PROMPTを持つ5つのAI呼び出しファイル（`personalOkrOutlookExtractor.ts`のこれから解析・`personalOkrReviewDraftExtractor.ts`の振り返り下書き・`personalOkrChatPrompt.ts`のAIパネル・`personalOkrPlanDraftExtractor.ts`の翌月の計画ドラフト・`personalOkrPeriodReviewDraftExtractor.ts`の全体タブの振り返り下書き）すべてに埋め込む。文言を分散させると片方だけ直されて取り残される（コピペ実装の教訓）。
- **`personalOkrAiContext.ts`（作業1・3共通の文脈組み立て）**：`buildPersonalOkrAiContextText()`は`goal_state`／`self_rating`のどちらかが入っている週だけ行を出す（両方空の週は出さない）。出す週が0本なら【週の目標状態と自己評価】セクション自体を省略（「週データなし」とも書かない）。「（目標状態未設定）」「未評価」という文言は一切出力しない。`buildPersonalOkrAiContextChips()`は週データが0本ならW1〜Wn等のチップを出さない。`buildPersonalOkrAiStarters()`は週データが0本なら週前提の候補（「△や✕になった週の原因は…」「残り週の計画をどう組み替えるべき？」）を出さず、週に依存しない候補（「当月末の達成目標に対して、今どこまで来ている？」等）に差し替える。当月末狙いのバンドが未設定の行も同様に出さない。
- **`reviewMaterial.ts`（v3.96で先行実施済み）**：`isReviewMaterialEmpty()`を`isGenerationMaterialEmpty(material, hasPlanContent, memoCount)`へ改名し、週データ基準から材料全般基準（計画欄・タスク・メモのいずれかがあれば生成可）へ変えた対応はv3.96で先に実施済み（Step N参照）。`weeksWithGoalSet`／`unratedWeekCount`フィールドは誰も使わなくなったため削除した。
- **`personalOkrReviewDraftExtractor.ts`**：`buildReviewDraftContextText()`の材料行から週数の内訳（全N週中・設定済みN週・未評価N週）を削除。◯/△/✕が全て0件なら週の行そのものを出さない。SYSTEM_PROMPTの「週の積み上げの結果どうだったか」→「取り組みの結果どうだったか」、evidenceの説明「どの週・どのタスクに基づくか」→「どの記録（週・タスク・メモ・計画）に基づくか」に変更。
- **`personalOkrOutlookExtractor.ts`**：`moves`の説明から「目標状態が未設定の週があれば、それを書くことを一手として含めてよい」を削除。`moves.week_label`を任意にし（週が設定されていない場合は「残り期間」「月末まで」等の時期の目安、または空文字でよい）、`validateMove()`は`action`のみ必須に緩めた（`week_label`が空ならUI側でラベル表示を省く）。`lead`の説明「週の積み上げから見た現在地」→「これまでの積み上げから見た現在地」。
- **画面表示側**：`AheadBlock.tsx`から「評価待ちの週：W3・W4」「W4・W5の目標状態が未設定です」／「残り週の目標状態はすべて設定済みです」の行を削除。「週の自己評価：◯N／△N／✕N」は◯△✕が全て0なら行ごと出さない。`moves`の週ラベルが空なら列自体を出さない（`BandOverridePicker.tsx`への分離自体はv3.96実施済み）。`PersonalOkrReviewDraftModal.tsx`の材料表示から「（全N週中・目標状態設定済みN週・未評価N週）」を削除し、◯△✕が全て0なら週の行ごと出さない（この対応もv3.96のモーダル改修と同時に先行実施済み）。「材料がありません（週の目標状態を書いてから生成してください）」→「まだ材料がありません（計画・週の記録・タスク・メモのいずれかを書いてから生成してください）」に変更（v3.96で先行実施済み）。`PersonalKrPanel.tsx`の週カード見出しに「週ごとの目標状態と自己評価は任意です。使う場合のみ記入してください。」を追記した。
- **テスト**：`personalOkrAiContext.test.ts`（週が全て空／一部だけ埋まっている／bandTarget未設定のケースを追加。修正前のソースに対して実際に走らせ8/16件が赤くなることを確認済み）・`personalOkrOutlookExtractor.test.ts`（`week_label`無しでも`action`があれば通ることを追加）・`personalOkrReviewDraftExtractor.test.ts`（週の行が0件時に出ないこと・共通ノーティスの検証を追加）・`personalOkrChatPrompt.test.ts`（共通ノーティスの検証を追加）。
- **やらないこと**：週次機能そのものの削除はしていない（任意化するだけ。機能は残す）。DBスキーマ変更なし。

### Step P：前月をふまえて下書き（翌月の計画ドラフト。v3.99・2026-08-26）

山本さんの依頼：「このアプリには四半期OKRの情報と月次OKR振返りが登録されるので、例えば7月の振返りと上司からのFBが揃えば、四半期OKRにある目標を達成するために、8月の計画のドラフトも生成できるはず」。v3.96で`review_text`/`gm_comment`が画面から記入できるようになったことで初めて実用的に揃う材料の上に載る機能。

- 🔴 **設計判断（山本さんが選択済み・変更禁止）**：ドラフトの置き場所は計画欄に直接流し込む（**新テーブル・新列は作らない＝マイグレーション不要**）。狙いのバンド（`band_target`）はAIに提案させ、確定は人が別操作で行う。入力範囲は当四半期の過去月すべて（3か月目なら1・2か月目の両方）。上司FB（`gm_eval_pct`/`gm_comment`）はAIに渡してよい。
- **Step 0で確認した3点**：①`AIIntent`はEdge Function側（`supabase/functions/ai-consult/index.ts`）に許可リスト・分岐を持たない自由文字列で、`consultation_type`列への記録にのみ使う。新タグ追加に**Edge Functionの再デプロイは不要**。②`PersonalKrPanel`の計画欄（`positioning`等）はv3.87/v3.88のdirty判定・`baselineUpdatedAtRef`（楽観ロック衝突検知）を持たない（TaskEditModal/TaskSidePanel専用の仕組みで、個人OKRの計画欄は対象外。保存ボタンは常に活性）。本機能のstateセットはこの既存挙動と衝突しない。③週の行の組み立て（`personalOkrAiContext.ts`）は関数として切り出されていなかったため、`buildFilledWeekLines()`として抽出し、当月のAI文脈とこの機能の両方から共有する。
- **文脈の組み立て**：新規`src/lib/personalOkr/planDraftContext.ts`（純粋関数）。`personalOkrAiContext.ts`（当月の実行支援用）は改造せず新設した。KRの6本文欄（記入がある欄だけ）・四半期の進み方（残り◯か月）・当四半期の過去月すべて（古い月から順。計画4欄・狙いのバンド・振り返り本文・自己評価%・GM評価%・GMコメント・週の記録・タスクの機械集計）・当月に既に書かれている計画・直近のメモ、の順で組み立てる。記入が無い項目・記入が無い週は行ごと出さない（週次任意化＝Step Oと同じ思想を全項目に適用）。
  - 🔴 既存関数の再利用：週の行は`buildFilledWeekLines`、タスクの機械集計は`summarizeLinkedTaskStatus`/`computeReviewMaterial`をそのまま使う。新規`computeWeekCardsLinkedTasks()`（`weekLayout.ts`）を「週カード群に紐づくタスクをユニーク化する」処理として切り出し、当月（`PersonalKrPanel.tsx`の`monthLinkedTasks`）・過去月（本機能）の両方から使う（同じ計算を書き直さない）。
  - **546対策（Section 19・28）**：`review_text`/`gm_comment`は各1200字でクリップ（`buildPlanDraftPastMonthEntry`）。組み立て後の総文字数が上限（`PLAN_DRAFT_CONTEXT_CHAR_LIMIT`＝8000字目安）を超えたら、`buildPlanDraftContext()`が**古い月から順に「週の記録→メモ→計画4欄」の順で決定的に削る**。
- **AI呼び出し**：新規`src/lib/ai/personalOkrPlanDraftExtractor.ts`。`AIIntent="okr-personal-plan-draft"`を追加。model=`claude-sonnet-4-6`・max_tokens=3072（Section 6-1c）。出力は`{positioning, activities, target_and_evidence, risks, band_target, band_target_reason, basis}`の厳密なJSON。`band_target`は60/70/80/90/100以外の値（65や"70"等）は`null`に落とす（弾いて例外にしない）。4欄すべて空なら例外（生成失敗）・1〜3欄が空なのは許容する。`WEEKLY_IS_OPTIONAL_NOTICE`をシステムプロンプトに埋め込んだ（**Section 24グランドルールの最初の適用例**）。`stop_reason==="max_tokens"`は明示エラーにしてリトライしない・JSONパース失敗時は1回だけ自己修正リトライ（既存の抽出系と同じ作法）。非2xxのエラー処理は`invokeAI()`をそのまま経由し独自実装しない。
- **UI（生成→提示→反映の3段階。いきなり計画欄を書き換えない）**：新規`src/components/okr/personal/PersonalOkrPlanDraftModal.tsx`。①材料の要約（過去月ごとに1行。機械計算・即時描画）②生成／再生成ボタン③生成結果を4欄＋バンド提案で表示（各欄はその場で編集できるtextarea）④「計画欄に反映」→ 親（`PersonalKrPanel`）の`positioning`/`activities`/`target_and_evidence`/`risks`のstateへセットするだけ（**DBへは書かない。人が計画欄の「保存」を押して初めて保存される**）。既に記入がある欄が1つでもあれば`ConfirmModal`で確認する（`tone="danger"`・confirmLabel="上書きして反映する"・cancelLabel="反映しない"。**cancel側＝安全側＝反映しない**。背景クリックは必ずcancel扱いになるため。CLAUDE.md Section 21・v3.88の教訓）。⑤バンド提案は「この値を狙いに入れる」ボタンを4欄の反映とは別に置き、同時には入れない（数値は人が明示的に選ぶ、という既存方針を維持）。
  - **入口**：`PersonalKrPanel.tsx`の「◯月の計画」見出し右の「✦ 前月をふまえて下書き」ボタン。表示条件は`monthStatus !== "future" && !readOnly`。非活性は`isPlanDraftMaterialEmpty()`（KR定義6欄が全て空・かつ当四半期の過去月に計画4欄・振り返り本文・自己評価%・上司コメントのいずれの記入も無いとき）のみ。🔴 **1か月目（過去月が無い）でもKR定義があれば生成できる**（四半期の達成基準から初月の計画を引くのは正当な使い方）。
  - 🔴 **トラップ③対策**：モーダルは`kr.id`・`monthStr`のどちらかが変わったら閉じる（別の月への反映事故を防ぐ）。
- **既存の穴の確認（Step 0）**：`PersonalKrPanel`の計画欄は`unsavedEditorRegistry`（v3.89・Section 46）に登録されていない（TaskEditModal/TaskSidePanel専用の仕組みで、個人OKRの計画欄は元々対象外）。本機能はこの既存の設計をそのまま踏襲する（新たな穴を作ったわけではなく、修正も本機能のスコープ外）。
- **テスト**：`planDraftContext.test.ts`（27件）・`personalOkrPlanDraftExtractor.test.ts`（14件）・`weekLayout.test.ts`に`computeWeekCardsLinkedTasks`を2件追加。
- **やらないこと**：新しいテーブル・新しい列・マイグレーション。生成結果のDB自動保存。前四半期のKRを材料にすること。未来月での生成。Kintoneへの書き込み。部署ナレッジ（Phase 5）。

### Step Q：月全体・四半期全体の振り返りを記録する「全体」タブ（v3.101・2026-08-26）

山本さんの依頼：「我々は月末に月次面談をGMと行い、一緒に振返りとコメントをいただくので、その月全体の自己評価とGM評価も受取ります。個別KRに加え、全体のことも記録できるタブがあると嬉しい」。個別KR（`personal_kr_months`）とは独立に、月全体・四半期全体の自己評価%・GM評価%・振り返り本文・GMコメントを記録する場所を作った。

- 🔴 **設計判断（山本さんが選択済み・変更禁止）**：記録項目は全体の自己評価%／GM評価%／全体の振り返り本文（本人）／GMコメントの4つのみ（面談日・来月への申し送りは選ばれなかったため作らない）。全体%の算出は参考値として機械計算を提示し、確定は手入力（「この値を入れる」ボタン方式）。AI下書きを用意する。単位は月単位と四半期単位の両方。
- 🔴 **本機能は唯一マイグレーションが1本発生する**：`supabase/migrations/20260826_add_personal_period_reviews.sql`（新テーブル`personal_period_reviews`。山本さんが手動適用）。**一意制約は部分ユニークインデックス2本**（`WHERE period_kind='month'`／`WHERE period_kind='quarter'`）で張る。`UNIQUE(...,month)`は使わない（Postgresでは`period_kind='quarter'`のときmonthが常にNULLのため、NULL同士は相異なると扱われ重複を検出できない）。RLSは`personal_krs`と同じ「member_idを直接持つため親を辿らない」流儀（新しいヘルパー関数は作っていない）。
- 🔴🔴 **W2（最重要）：テーブル未適用の窓でも「全体」タブだけが案内を出し、KRタブ側は完全に従来どおり動く**。`usePersonalOkrUiStore`に`periodReviews`/`periodReviewsLoaded`/`periodReviewsLoading`/`periodReviewsError`という**KRタブ側のstateとは完全に独立したstate群**を新設し、`loadPeriodReviews()`はfetch失敗を`periodReviewsError`にメッセージとして積むだけで例外を投げ直さない（`krs`等には一切触れない）。`PersonalOverallView.tsx`は`periodReviewsError`が真なら「この機能はデータベースへの適用がまだです（管理者に連絡してください）」を表示するだけに留める。回帰テストは`src/stores/__tests__/personalOkrUiStore.test.ts`（fetch失敗を模擬し、`krs`が無傷であることまで確認。**実装前にtry/catchを外した状態で実際にテストが赤くなることを確認済み**）。`src/lib/schema/schemaChecks.ts`に`personal_period_reviews_table`を追加。
- **UI**：`PersonalOkrView.tsx`のKRタブ列の**先頭**に「全体」タブを追加（sentinel `OVERALL_TAB_ID`。KR一覧の自動選択effect・`ensureKrDetailLoaded`effectの対象外にする分岐を追加）。選択すると`PersonalOverallView.tsx`が縦2ブロック（月全体・四半期全体）を`PersonalPeriodReviewBlock.tsx`（同じコンポーネントを`periodKind`違いで2回使う。コピペしない）で描画する。
  - **参考値**：`src/lib/personalOkr/periodReviewReference.ts`の`computeWeightedAverage`/`computeMonthlyAverage`/`computePeriodReference`（純粋関数）。月ブロック＝`Σ(KRの自己評価%×weight_pct)÷Σ(weight_pct)`、四半期ブロック＝各KRの3か月平均（`computeMonthlyAverage`）を求めてから同じ加重平均に使う（`Σ(KRの自己評価%の3か月平均×weight_pct)÷Σ(weight_pct)`）。算出式は画面にそのまま明記する。**`weight_pct`が全て0、または記入済みKRが0件のときは`null`を返し、「参考値を出せません（KRのウェイトまたは自己評価が未記入です）」と表示する**（0除算・誤解を招く0%表示を避ける。記入が無いことを咎める書き方にしない）。GM評価%も独立に同じ式で算出する。KRごとの内訳（KR名・ウェイト・自己評価%・GM評価%）は`<details>`で折りたたむ。
  - **「この値を入れる」ボタン**：参考値を自己評価%・GM評価%の入力欄へセットするだけ（保存はしない）。片方だけ算出できる場合はその欄だけセットする。
  - **入力欄4つ＋明示保存**：v3.87/v3.93/v3.96の作法（自動保存にしない・未変更時は🚫にせず「✓ 保存済み」）。dirty判定・数値バリデーションは既存の`monthReviewForm.ts`（`computeMonthReviewDirty`/`parseEvalPctInput`）を**そのまま再利用**（`personal_kr_months`と同じ4フィールド構成のため判定ロジックを二重化していない）。空欄は`undefined`ではなく`null`を送る。
  - **編集可否**：`isMonthEditable`と同じ思想＝未来のみ不可。四半期側は新設の`isQuarterEditable(fiscalYear, quarter, readOnly, today)`（`quarterMonths.ts`。四半期の1か月目が未来でなければ編集可）。
  - 🔴 **`unsavedEditorRegistry`への登録を実装済み**：`PersonalPeriodReviewBlock.tsx`が月・四半期の各ブロックインスタンスごとに`useId()`＋`registerUnsavedEditor`/`unregisterUnsavedEditor`を呼ぶ（`MonthReviewBlock.tsx`と同型）。KRタブ・月・四半期の切替（`PersonalOkrView.tsx`の`guardedSwitch`。v3.100で導入済み）が既にこのレジストリを参照するため、「全体」タブを離れる操作も自動的にガードされる（新しいガード経路を増やしていない）。
- **AI下書き**：新規`src/lib/ai/personalOkrPeriodReviewDraftExtractor.ts`（`AIIntent="okr-personal-period-review-draft"`・model=`claude-sonnet-4-6`・max_tokens=3072）＋文脈組み立て`src/lib/personalOkr/periodReviewDraftContext.ts`。入力は対象期間の全KRについて、KR名・ウェイト・当月（四半期なら各月）のreview_text/self_eval_pct/gm_eval_pct/gm_comment/計画4欄の要点、および紐づくタスクの機械集計（既存の`computeMonthWeekSegments`/`buildWeekCards`/`computeWeekCardsLinkedTasks`/`computeReviewMaterial`をそのまま再利用）。記入が無い項目は行ごと出さない。`WEEKLY_IS_OPTIONAL_NOTICE`をシステムプロンプトに埋め込んだ。自己評価%・GM評価%・達成度バンドの数値は書かせない（出力の型自体が`review_text`/`basis`のみでこれらのフィールドを持たない）。
  - **546対策**：`review_text`/`gm_comment`は各800字でクリップ、組み立て後の総文字数が上限（目安10000字）を超えたら`buildPeriodReviewDraftContext()`が**①全エントリの計画4欄の要点→②タスク内訳（遅延/停滞/先行待ち。完了/未完了の件数自体は残す）→③GMコメント→④振り返り本文、の順にフィールド種別ごと一括で削る**（決定的な順序。テストで固定）。
  - **UI（生成→提示→反映の3段階）**：新規`src/components/okr/personal/PersonalOkrPeriodReviewDraftModal.tsx`（`PersonalOkrPlanDraftModal.tsx`と同型）。①材料の要約（機械計算・即時描画）②生成／再生成ボタン③生成結果を編集可能なtextareaで表示④「本文欄に反映」→ 親（`PersonalPeriodReviewBlock`）のstateへセットするだけ（**DBへは書かない。人が「保存」を押して初めて保存される**）。既に本文がある場合は`ConfirmModal`で確認する（`tone="danger"`・cancel側＝安全側＝反映しない）。
  - 🔴 **AI生成履歴のテーブルは作っていない**（山本さんの依頼どおり）。生成結果はモーダルのローカルstateのみで保持し、閉じれば消える。
- **Step 0で確認した4点**：①既存マイグレーション（`20260820_add_personal_kr_review_drafts.sql`）の作法（`update_updated_at()`共有トリガー・ドル引用タグ・確認クエリの書式）をそのまま踏襲した。②`personalOkrUiStore`の各アクションは`upsertById`（idが一致すれば置換・無ければ追加）による**マージ型**の更新で、丸ごと置換ではない。③`PersonalOkrView.tsx`のKRタブ描画は`displayKrs.map`のフラットな帯で、v3.100の`unsavedEditorRegistry`登録はコンポーネント単位（`PersonalKrPanel`/`MonthReviewBlock`）で行われている（同じ作法をそのまま踏襲）。④`schemaChecks.ts`へのテーブル追加は`kind:"table"`の1エントリで足りる（本機能は本文差し替え型の関数変更を伴わない）。
- **テスト**：`periodReviewReference.test.ts`（13件）・`periodReviewDraftContext.test.ts`（16件・546対策の削減順序が決定的であることを含む）・`personalOkrPeriodReviewDraftExtractor.test.ts`（9件）・`quarterMonths.test.ts`に`isQuarterEditable`を5件追加・`personalOkrUiStore.test.ts`に「全体」タブ用のゲスト分岐・テーブル未適用時の回帰テストを6件追加・`guardedNavigateCoverage.test.ts`に「全体」タブへの切替パターンを追加（**実装前に未ガード状態で実際に赤くなることを確認済み**）。
- **やらないこと（スコープ外）**：面談日・来月への申し送りの欄。Kintone取込側を「全体合計値も拾う」ように広げること（`personalOkrImportExtractor.ts`の既存コメントはそのまま）。GM（上長）が本アプリから直接書き込む機能。部署・全社での集計ビュー。AI生成履歴テーブル。

### Step Qの是正（v3.102・2026-08-26・山本さんの適用前レビューで検出）

v3.101のマイグレーション（未適用のまま）に2件の欠陥があり、山本さんが適用する前に統括のレビューで検出・修正した。

- 🔴 **欠陥1（Section 39のグランドルール違反）**：新設ポリシー`personal_period_reviews_own`が`current_member_id()`（SECURITY DEFINER STABLE関数）を裸で呼んでいた。Section 39は「RLSポリシー内でSECURITY DEFINER関数を呼ぶときは`(SELECT ...)`で包む」を必須のグランドルールとしている（v3.80・実測で`shared hit=6504`・`Execution Time 76.085ms`という異常値が確定済み）。仕様書§W1にもこの指示を明記していたが実装で抜けていた。`20260819c_optimize_members_rls_initplan.sql`と同じ書き方（`(SELECT public.current_member_id())`）に揃えた。**`personal_krs`以下の既存7ポリシーは今回のスコープ外**（Section 39制定前のもので、一斉是正が必要かは統括が別途判断する）。
- 🔴 **欠陥2（正本スキーマの同期漏れ）**：`supabase/schema.sql`に`personal_period_reviews`のテーブル定義・部分ユニークインデックス2本・RLS有効化・ポリシーが未反映だった（`personal_kr_review_drafts`等の前例は反映済みなのに本テーブルだけ漏れていた）。テーブル定義（`personal_kr_review_drafts`ブロックの直後）・`updated_at`トリガーのDOループのテーブル名リスト（`~825行目`）・RLS有効化コメント（`~900行目`）・ポリシー（`personal_kr_review_drafts_own`の直後）・インデックス（同テーブルの索引ブロックの直後）の5箇所に追記し、`schema.sql`側も新設ポリシーを`(SELECT ...)`で包んだ形にした（マイグレーションファイルと1文字も食い違わないよう揃えた）。
- **ユニーク制約違反時のUIの振る舞い（山本さんの依頼で確認）**：`PersonalPeriodReviewBlock.tsx`の保存は元々try/catchで包まれ`formatErrorForUser`（コード・詳細を含む）を表示する設計だったため、白画面・無言の失敗にはならないことを確認済み。ただし生のPostgrestメッセージ（`duplicate key value violates unique constraint "idx_personal_period_reviews_month_unique"`）は技術的すぎるため、新規`src/lib/personalOkr/periodReviewSaveError.ts`の`isPeriodReviewUniqueViolation()`（`AdminView.tsx`の`isMemberEmailUniqueViolation()`と同型：codeが23505かつ制約名を含むかを判定）で検知し、「この期間の全体の振り返りは、既に他の操作（別のタブ・別の端末等）で作成されています。画面を再読み込みしてから、あらためて保存してください。」という行動が分かる案内に差し替えた。想定される発生条件：periodReviewsのロード完了前に保存した／複数タブ・別端末で同じ月・四半期の行を同時に新規作成した場合（クライアント側stateが既存行のidを掴めておらず新しいuuidでINSERTしてしまう）。

### Step R：個人OKRの計画・振り返りをKintoneへ「全文をコピー」できるようにする（v3.103・2026-08-26）

山本さんの依頼：計画欄・振り返り欄の内容をKintoneへコピーする際、「位置づけ」「当月に取り組む内容」等を1つずつコピーしなければならず手間。一括で全文コピーできるようにしてほしい。

- 🔴 **見出し文字列の唯一の正本＝`src/lib/personalOkr/kintoneFormat.ts`（新規）**。この見出しに触れる箇所（①コピー生成②AI取込プロンプト③決定的パーサ`kintoneTextParse.ts`）を全てここ経由にした。文字列を2箇所以上に持つと片方だけ直されて取り残される事故がこのリポジトリで繰り返し起きている（v3.85の4箇所コピペ・v3.98の`pointerEvents`欠落）ため、構造的にズレようがなくした。
  - テンプレート文字列（`{M}`を月番号のプレースホルダとして持つ）から、①コピー生成用の実文字列（`headingActivities(8)`→`"▼8月に取り組む内容（計画）"`）と③決定的パーサ用の正規表現ソース（`activitiesHeadingRegexSource()`→`"▼(\\d{1,2})月に取り組む内容（計画）"`）の両方を導出する。半角スペースだけは正規表現化の際`\s*`に緩める規則（`headingBandTarget`の「月末 達成度バンド」間の空白）を1箇所に持たせ、`kintoneTextParse.ts`の既存の緩さ（`\s*`）を1文字も変えずに温存した。
  - ②AI取込プロンプト（`personalOkrImportExtractor.ts`のSYSTEM_PROMPT_MONTHLY・SYSTEM_PROMPT_COMBINED）は、見出し説明の直書き文字列を`${headingActivities("◯")}`等の定数参照に置き換えた（「◯」は月番号の一般的なプレースホルダとして使う。プロンプトの意味は変えていない＝生成される文言は変更前とバイト単位で同一）。
  - ③決定的パーサ（`kintoneTextParse.ts`）の`ACTIVITIES_RE`/`TARGET_RE`/`BAND_RE`/`POSITIONING_RE`/`RISKS_RE`は、`new RegExp(activitiesHeadingRegexSource(), "g")`等、kintoneFormat.ts由来の関数で構築する形に変更した（正規表現リテラルの直書きをやめた）。生成される`.source`は変更前と完全に同一であることを確認済み（既存テスト18件・オーケストレーターのテスト40件が無改修で全通過）。
- **コピー生成の純粋関数**（同ファイル）：`buildKintonePlanCopyText()`（positioning/activities/target_and_evidence/risks/band_targetの5項目。記入が無い項目は見出しごと省略・全項目空なら空文字列）と`buildKintoneReviewCopyText()`（review_text＋`[自己評価：XX%]`。片方だけでも破綻しない）。月番号は`month_index`ではなく実際の月番号（8月なら`8`）を引数で渡す。
- **UI（3箇所。「全体」タブには付けない＝山本さんが選んだ設計判断）**：
  1. **計画ブロック**（`PersonalKrPanel.tsx`「◯月の計画」ヘッダ）：画面に見えている値＝フォームの現在値（保存済みかどうかは問わない）を対象にする。
  2. **計画ドラフトのモーダル**（`PersonalOkrPlanDraftModal.tsx`）：モーダル内で編集中の4欄＋バンド提案（AIの生成結果）を対象にする。計画欄へ反映・保存しなくてもコピーできる。実際の月番号を渡すため`monthNumber: number`propを新設した（既存の`targetMonthLabel`は表示用の文字列のみで数値を持っていなかったため）。
  3. **振り返りブロック**（`MonthReviewBlock.tsx`）：画面に見えている値（フォームの現在値）を対象にする。自己評価%の入力が無効（範囲外・非数値）でもコピー自体は妨げない（`parseEvalPctInput().value`がnullになるだけ）。
  - いずれも内容が空のときはボタンを非活性にし、`title`で「記入がまだありません」と伝える（記入が無いことを咎める書き方にしない。CLAUDE.md Section 24グランドルール「週次は任意」と同じ配慮）。
  - クリップボード書き込みは`PersonalOkrReviewDraftModal.tsx`の`handleCopy`と同型（`navigator.clipboard.writeText().then(showToast成功, showToast失敗)`）。トーストは「計画の全文をコピーしました」「振り返りの全文をコピーしました」。
  - **ラベルは新旧で区別**：新しいボタンは3箇所とも「📋 全文をコピー（Kintone用）」。既存の`PersonalOkrReviewDraftModal.tsx`の「コピー」ボタン（本文のみ・振り返り下書きの编集内容用）はそのまま残した（統括の依頼どおり、山本さんへ判断を報告する形で決定）。
- **ラウンドトリップの機械検証**（`src/lib/personalOkr/__tests__/kintoneFormat.test.ts`）：`buildKintonePlanCopyText()`で生成した文字列を`parseKintoneMonthlyText()`（決定的パーサ）に実際に通し、元の入力どおり読み戻せることを検証する。加えて、見出しがプロンプト側・パーサ側で直書きに戻っていないことをソース走査で固定する（`modalStyles.test.ts`と同じ「ソースを読んで検査する」方式）。**実装検証として、パーサ側の正規表現を意図的に定数から切り離して直書きに戻し、ラウンドトリップテスト・ソース走査テストの両方が実際に赤くなることを確認した上で元に戻した**（本セクション執筆時点の実施記録）。
- **DBスキーマ変更なし**（クリップボードへの書き出しのみ。マイグレーション・`schemaChecks.ts`への追記は不要）。

### Step S：KRの構成とウェイトが月をまたいで変わる運用への対応（v3.104・2026-08-26）

山本さんの依頼：「全社や部署の環境変化によって、個人OKRのKRそのものやパーセンテージが、月を跨ぐと変わる可能性がある。そういった場合にも対応できるようにしてほしい。例えば現在、私には、7月専用のKRを置いたために8月にもKRとパーセンテージが残存してしまう現象が起こっている」。

🔴 **設計判断（山本さんが選んだ・変更禁止）**：対象外KRの見せ方＝その月のKRタブから消す／「対象月」の設定場所＝KR編集モーダルで1・2・3か月目を選ぶ／月ごとのウェイト変更＝対応する（既存の`weight_override_pct`を有効化）／ウェイト合計100%の判定単位＝その月の対象KRの合計。**統括の判断（指定が無かった箇所）**：月ごとのウェイトの入力場所は「その月の計画ブロック」（`personal_kr_months`を更新。KR編集モーダルからは書きに行かない＝1つの保存操作が2テーブルにまたがると部分失敗の経路が増えるため）。KR編集モーダルには各月の合計を読み取り専用で表示する。

- 🔴 **`personal_kr_months.weight_override_pct`は列・型・Kintone取込処理まで既に存在するのに、表示にも計算にも一度も使われていなかった**（`PersonalOkrImportModal.tsx`／`importApplyPlan.ts`／`kintoneTextParse.ts`／`personalOkrImportExtractor.ts`の取込経路だけが触っていた）。本バージョンで初めて有効化した。
- 🔴 **v3.101の「全体」タブの参考値は月ごとのウェイトを無視している実装欠陥だった**（`PersonalOverallView.tsx`の4箇所が四半期共通の`kr.weight_pct`をそのまま見ていた）。今回あわせて是正した。
- **新規`src/lib/personalOkr/krMonthScope.ts`（唯一の計算元）**：`isKrActiveInMonth(kr, monthIndex)`（`kr.active_month_indexes ?? [1,2,3]`に含まれるか。未適用時はundefinedのため全月対象として扱う＝後方互換）／`resolveEffectiveWeightPct(kr, monthRecord, monthIndex)`（対象外ならnull、対象なら`monthRecord?.weight_override_pct ?? kr.weight_pct`。🔴 `weight_override_pct`が0のとき`??`は0を落とさない）／`sumEffectiveWeightPct(krs, monthRecordsByKrId, monthIndex)`（その月の対象KRだけの実効ウェイト合計）。KRタブ一覧・タブのウェイト表示・「全体」タブの参考値・KR編集モーダルの月ごとの合計、いずれもここを経由する。
- **マイグレーション`20260826b_add_personal_krs_active_month_indexes.sql`（山本さんが手動適用）**：`personal_krs`に`active_month_indexes integer[] NOT NULL DEFAULT ARRAY[1,2,3]`を追加。既存行はDEFAULTで`{1,2,3}`＝従来どおり全月対象（後方互換）。CHECK制約は`coalesce(array_length(active_month_indexes,1),0) >= 1 AND active_month_indexes <@ ARRAY[1,2,3]`（🔴 `array_length('{}',1)`はNULLを返すため`coalesce(...,0)`が必須。素の`array_length(...) >= 1`だとNULLが「違反ではない」として空配列を通してしまう）。RLSは`personal_krs`の既存ポリシーがそのまま効くため新設しない。`supabase/schema.sql`にも同じ列・CHECKを反映した（v3.101で同期漏れが起きた反省）。
- 🔴🔴 **未適用時に「KRの保存が全滅」しないための3点（最重要。2026-08-12のupsertTask全滅事故と同型）**：
  1. `src/lib/schema/schemaChecks.ts`に`personal_krs_active_month_indexes_column`（`kind:"column"`）を追加。
  2. 新規`src/lib/personalOkr/activeMonthIndexesSaveError.ts`の`isActiveMonthIndexesColumnMissing(e)`（`code==="PGRST204"`かつメッセージ等に`"active_month_indexes"`を含むかを判定。列名まで見て他のPGRST204と誤判定しない）を`PersonalKrFormModal.tsx`の保存catchに配線し、「データベースへの適用がまだ済んでいません（管理者に連絡してください）」を表示する。
  3. **読み取り側は未適用でも壊れない**：`fetchPersonalKrs()`はSELECT `*`のため列が無くても単に返らないだけ（`kr.active_month_indexes`がundefinedになる）で例外にならず、`isKrActiveInMonth`等の`?? [1,2,3]`フォールバックがそのまま効く。
- **反映先（すべてkrMonthScope.ts経由）**：
  1. **KRタブ一覧**（`PersonalOkrView.tsx`）：`monthActiveDisplayKrs`（`displayKrs.filter(kr => isKrActiveInMonth(kr, monthIndex))`）をタブ描画・自動選択effect・ウェイト合計の対象にする。選択中KRが月切替で対象外になった場合の自動補正は既存の自動選択effect（v3.55由来）の対象を差し替えるだけで実現し、新たなguardedSwitchは追加していない（月・四半期・KRタブのクリック自体は既存の`guardedSwitch`で既にガードされており、その結果としての自動補正はv3.100と同じ考え方で未ガードのままでよい）。その月の対象KRが0件（四半期にはKRがあるがこの月は対象外）のケースは、四半期自体が空のケースと文言を分け、「この月を対象にしたKRがありません」＋各KRを直接編集できるボタン列を出す（KR編集への導線）。
  2. **KRタブのウェイト表示**：`resolveEffectiveWeightPct(kr, monthRecord, monthIndex)`を使い、月ごとの上書きが効いている場合は控えめな印（＊・title付き）を付ける。
  3. **「全体」タブの参考値**（`PersonalOverallView.tsx`）：月ブロックは対象外KRを除外し実効ウェイトを使う。🔴 **四半期ブロックの算出式を変更した**：v3.101は「各KRの3か月平均self_eval_pct×四半期ウェイト」だったが、月ごとに対象KR・ウェイトの両方が変わる以上この式は成り立たない。**「月ごとに参考値を出し、それらを平均する」**に改めた（新規`averageMonthlyReferences()`。`periodReviewReference.ts`）。KRごとの内訳表示（`quarterKrRows`）は「四半期を通して1度でも対象だった月だけの自己評価%平均」を参考情報として残すが、この数値自体は実際の参考値計算には使わない（月ごとに重みが変わるKR単位の単一値では四半期の参考値を再現できないため）。算出式は画面の`formulaText`にそのまま明記した。`PersonalPeriodReviewBlock.tsx`は参考値を内部で`computePeriodReference(krRows)`から計算する方式をやめ、呼び出し元が算出式に応じて組み立てた`reference`propを受け取る方式に変更した。
  4. **KR編集モーダル**（`PersonalKrFormModal.tsx`）：「対象月」チェックボックス3つ（既定は全部オン・最低1つ必須）。旧・四半期合計の単一警告表示を、月ごとの合計3行（読み取り専用）に置き換えた（100%とずれている月は警告のみ・保存はブロックしない）。
  5. **計画ブロック**（`PersonalKrPanel.tsx`）：「今月のウェイト」入力欄（`weight_override_pct`）を追加。空欄なら四半期共通値を使う旨を補足に明記。🔴 空欄は`undefined`ではなく`null`を送る（`parseEvalPctInput`の`value`をそのまま`weight_override_pct`に渡す）。既存の`mergeMonthRecord()`を通し、`computeMonthPlanDirty()`（`monthPlanForm.ts`。`weightOverrideRaw`/`weightOverridePct`フィールドを追加）経由で既存の`unsavedEditorRegistry`登録にそのまま乗る（新しい登録は増やしていない＝計画欄は既に1つのgetterで登録済みのため、比較対象のフィールドを増やすだけで済んだ）。
- **やらないこと（スコープ外）**：四半期をまたぐKRの引き継ぎ・Kintone側への書き戻し・既存の`weight_override_pct`データの一括補正（既定値で従来挙動が保たれるため不要）・「対象月」を各月の画面からも切り替えられるようにすること・ウェイト合計100%未達時の保存ブロック。
- **テスト**：`krMonthScope.test.ts`（13件）・`activeMonthIndexesSaveError.test.ts`（8件）・`periodReviewReference.test.ts`に`averageMonthlyReferences`と月ごとに構成が変わるシナリオを追加（18件に増加）・`monthPlanForm.test.ts`に`weightOverrideRaw`/`weightOverridePct`のケースを追加（13件に増加）。

### Step T：「実施記録」欄の追加（v3.105・2026-08-27）

山本さんの依頼：振り返りを下書きする際に、現在はアプリに載っている「計画」と「毎週の目標」だけが参考材料になっており、実際に何をやったかという事後の記録が無い。そのため当初立てた計画を守れているかどうかは加味されるが、途中で生じた緊急対応や方針転換、プラスアルファで実施した業務が反映されない。

- **マイグレーション**（`20260827_add_actual_activities.sql`。山本さんが手動適用）：`personal_kr_months.actual_activities text`／`personal_period_reviews.actual_activities text`を1列ずつ追加（新テーブルは作らない）。列名は計画欄の`activities`と対になる名前。`schema.sql`にも同期した。
- 🔴🔴 **最重要（マイグレーション未適用でも既存の保存を壊さない設計）**：actual_activitiesは、計画欄（`handleSaveMonthPlan`）・振り返り欄（`MonthReviewBlock.handleSave`／`handleSaveReviewText`）・バンド決定（`handleSetBandOverride`）・「全体」タブの自己評価%等（`PersonalPeriodReviewBlock.handleSave`）とは**完全に別の保存関数**（`handleSaveActualActivities`）でしか送らない設計にした。既存4ハンドラは一切変更していない（`actualActivitiesIsolation.test.ts`が、各ハンドラの関数本文をソースから抽出し`actual_activities`という文字列を含まないことを機械的に固定する）。この隔離により、列の有無に関わらず既存3種の保存は影響を受けない。
- **入力欄の表示可否（Step 0で確認した事実）**：`check_schema_health` RPC（Section 22）は部署管理者・全社スーパー管理者にしか結果を返さない設計（`20260806_add_schema_health_check.sql`）のため、一般メンバー向けのゲートには使えない。代わりに新規`probeActualActivitiesColumn()`（`personalOkrStore.ts`）が`personal_kr_months`へ`select("actual_activities").limit(1)`する軽量プローブを行い、PGRST204（列が見つからない）かどうかで判定する（`personalOkrUiStore.ensureActualActivitiesChecked`。OKRビューのマウント時に1回だけ実行）。判定不能（ネットワークエラー等）はfail-openで「利用可能」扱いにする。UI（`ActualActivitiesBlock.tsx`）は`"unknown"`（未確認）の間は入力欄を出さず、`"unavailable"`（未適用と判明）のときだけ「この機能はデータベースへの適用がまだです」と案内する。保存時のPGRST204検知（`isActualActivitiesColumnMissing`）も二重の防御として持つ。
- **新規`ActualActivitiesBlock.tsx`**：KR×月（`PersonalKrPanel.tsx`。計画ブロックと振り返りブロックの間）と「全体」タブ（`PersonalPeriodReviewBlock.tsx`。自己評価%等の入力と全体の振り返り本文の間）の両方で共有する1コンポーネント（コピペしない）。`variant="section"`（見出し＋独立カード）／`"embedded"`（見出し・カードの外枠を出さず中身だけ。「全体」タブの既存カード内に入れ子カードを作らないため）を切り替える。保存の作法は既存のMonthReviewBlock/PersonalPeriodReviewBlockと同じ（明示保存・未変更時は「✓ 保存済み」表示。Section 48）。未保存編集レジストリ（Section 46）にも登録する。空欄は`undefined`ではなく`null`を送る（`toActualActivitiesSaveValue`）。
- **AI連携（4機能）**：`personalOkrAiContext.ts`（【当月の実施記録】セクション。「これから」・AIパネル・KR単位振り返り下書きが共有。1500字クリップ）・`planDraftContext.ts`（過去月の実績として追加。削り順は①週の記録→②実施記録→③メモ→④計画4欄）・`periodReviewDraftContext.ts`（KR単位の実施記録＋対象期間そのものの実施記録`overallActualActivities`を追加。削り順は①計画4欄→②タスク内訳→③GMコメント→④実施記録→⑤振り返り本文）。記入が無ければセクションごと出さない（記入が無いこと自体に言及しない。Step Oと同じ思想）。
- 🔴 **プロンプトの評価軸を変更（依頼の核心）**：新規`ACTUAL_WORK_COUNTS_NOTICE`（`src/lib/ai/actualWorkNotice.ts`）を、`WEEKLY_IS_OPTIONAL_NOTICE`と同じ流儀で5つのSYSTEM_PROMPTファイルすべてに埋め込んだ（詳細はStep O直後の本セクション冒頭グランドルール参照）。**仕様書は「4つのプロンプト」として`personalOkrAiContext.ts`等4ファイルを名指ししていたが、`WEEKLY_IS_OPTIONAL_NOTICE`の実際の埋め込み先（SYSTEM_PROMPTを持つ5ファイル：`personalOkrChatPrompt.ts`／`personalOkrOutlookExtractor.ts`／`personalOkrPeriodReviewDraftExtractor.ts`／`personalOkrPlanDraftExtractor.ts`／`personalOkrReviewDraftExtractor.ts`）に揃える形へ実装時に変更した**（全体タブの振り返り下書きが評価軸の恩恵から漏れるのを防ぐため。統括に報告済み）。
- **誤配線の是正（W6）**：`personal_kr_memos`にmonth列が無くKR単位のため、過去月を対象にした振り返り下書き生成でも「直近3件」が対象月と無関係な月のメモを渡していた（例：9月に7月の振り返り下書きを生成すると、AIには9月時点の直近メモが渡る）。新規`resolveRecentMemosForAiContext(isCurrentMonth, clippedMemos)`（`personalOkrAiContext.ts`）で、当月を対象にしているときだけメモを渡すよう一元化した。「これから」・AIパネル（`okrAiContext`＝当月限定）は従来どおり影響なし。
- **`schemaChecks.ts`に2列分の検査項目を追加**（管理者向け`SchemaHealthBanner`用。一般メンバー向けの判定は上記プローブが別途担う）。
- **やらないこと（スコープ外）**：メモの月紐づけ改修（既存の`personal_kr_memos`にmonth列を足す改修）は山本さんが選ばなかったため行っていない。Kintone向け「全文をコピー」（v3.103）には実施記録を含めていない（Kintone側に対応する見出しが無いため）。
- **テスト**：新規`actualActivitiesForm.test.ts`・`actualActivitiesSaveError.test.ts`・`actualActivitiesIsolation.test.ts`（既存4ハンドラの隔離をソース検査で固定＋対照確認）。既存テスト拡張：`personalOkrAiContext.test.ts`・`planDraftContext.test.ts`・`periodReviewDraftContext.test.ts`・`personalOkrStore.test.ts`・`personalOkrUiStore.test.ts`・5つのAIプロンプトテスト（生成結果に対して`ACTUAL_WORK_COUNTS_NOTICE`を検査）。

### Step U：ウェイト合計の警告が未訪問KRのせいで誤って出る不具合の修正（v3.106・2026-08-27）

山本さんの報告：各月でOKRの比率を設定しても、アプリ読み込み直後は正本（Kintone）の値だけが参照されているようで、実際には100%に調整されている月でも、各タブを開くまでは「⚠ この月のウェイト合計 60%（100%ではありません。Kintoneが正本のため警告のみです）」のような警告が出る。

- **原因**：月レコード（`personal_kr_months`）はKR単位の遅延読み込み（`ensureKrDetailLoaded`＝そのKRのタブを選択したときだけ発火）。`resolveEffectiveWeightPct`は月レコードが無いと四半期共通値`kr.weight_pct`へフォールバックする設計自体は正しい仕様（Step S・v3.104参照）だが、未訪問のKRは常にこのフォールバックに落ちるため、8月の上書き（0%）だけが反映された1本＋残り6本の四半期共通値の合計＝60%になっていた（報告の数値と一致）。
- **🔴 Step 0で確認：「全体」タブは実は壊れていなかった。** `PersonalOverallView.tsx`は自身のuseEffectで対象期の全KR分を`ensureKrDetailLoaded`しており、開いた瞬間に自己解決する設計だった（Step Qでこの仕組みは既に入っていた）。ただし「全体」タブを一度も開かなければKRタブ側の警告は直らないため、本命の修正はKRタブ側に必要だった。
- **対応**：
  1. `src/lib/supabase/personalOkrStore.ts`に`fetchPersonalKrMonthsForKrs(krIds)`を新設。`.in("personal_kr_id", krIds)`＋`.eq("is_deleted", false)`で複数KR分を1クエリでまとめて取得する（krIdsが空なら投げない）。
  2. `personalOkrUiStore.ts`に`ensurePeriodMonthsLoaded(krIds)`アクションを新設。既に`monthsByKr[krId]`が読み込み済み・先読み中（`monthsPreloadPendingKrIds`）のKRは対象から除外する（重複ロード防止・同時多重呼び出し防止）。🔴 書き込み直前に`state.monthsByKr[krId]`を再確認し、既にundefined以外（＝先読み中に`saveMonth`が入った等）なら先読みの結果で上書きしない（保存直後のローカル値が古い先読み結果で巻き戻らないための対策）。ゲストは低レベルCRUDを呼ばず、未確定分を空配列で埋めるだけ。週（`weeksByKr`）・週タスク（`weekTasksByWeek`）は先読み対象にしない（従来どおり遅延読み込み）。
  3. `PersonalOkrView.tsx`が対象期のKR一覧（`activeKrs`）確定時・対象期切替時にこのアクションを呼ぶ（`useEffect`の依存配列に`activeKrIds`を含めるだけで両方満たす。期を切り替えると`activeKrs`自体が変わるため自然に読み直しが発火する）。
  4. `krMonthScope.ts`に`areAllKrMonthsLoaded(krs, monthsByKr)`を新設し、ウェイト合計警告（`PersonalOkrView.tsx`）と「全体」タブの`loadingKrData`（`PersonalOverallView.tsx`）の両方がこの1関数を共有するよう統一した（同じ条件を各所に書き直さない）。全KR分の月レコードが揃うまでは警告を出さない（誤った合計を一瞬でも見せない）。
- **テスト**：`krMonthScope.test.ts`（`areAllKrMonthsLoaded` 3件）・`personalOkrStore.test.ts`（`fetchPersonalKrMonthsForKrs` 2件・`.in()`のモック対応を追加）・`personalOkrUiStore.test.ts`（`ensurePeriodMonthsLoaded` 8件：空krIds・未読み込み分のみ取得・既読み込み除外・全件既読でクエリなし・対象期切替で読み直す・保存直後のローカル値を巻き戻さない・同時多重呼び出しの多重発火防止・ゲスト分岐）・`personalKrMonthsPreloadWiring.test.ts`（配線のソース走査3件）。実装前に該当テスト（`ensurePeriodMonthsLoaded`関連8件）が全て赤くなることを確認済み。
- **マイグレーション不要**（DB変更なし）。

---
