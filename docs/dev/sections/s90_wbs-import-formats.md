## 90. WBS取り込みの拡張：MS Project XML・各種ツールのCSV（v3.198・2026-10-30）

s88（任意の深さ）・s89（依存の種類／ラグ）を取り込みでも使う。固定列テンプレート（s78 のグループ・v3.189 の取り込み）は互換のまま、取り込み元を3つ足した。

### 構造（src/lib/wbsImport/）
- `wbsFileLoader.ts`：拡張子で振り分け。結果は `WbsSource`＝`rows`（テンプレート。そのまま確認へ）／`items`（MSPDI。グループ切替だけ）／`table`（CSV・テンプレートに合わない xlsx。列の対応づけを挟む）。`.mpp`・`.xls` は案内つきエラー。テストは `loadWbsBytes`（File 非依存）。
- `wbsItems.ts`：共通の中間表現 `WbsItem` と `buildRowsFromItems`。階層は「深さ（depth）」か「親ID」。親が子より後ろでも木にして深さ優先の順に並べ直す。照合できない親・自己参照・循環は最上位にして警告。`groupTop`（既定ON）＝最上位で子を持つ行をPJ内グループにし、その子を深さ0のタスクにする。子の無い最上位はタスクのまま。OFFは全行タスク。深さが `MAX_TASK_DEPTH` を超える枝は祖先の兄弟へ引き上げ。
- `wbsParse.ts`：`WbsRow`＝`isGroup`／`depth`／`predecessors`（id・type・lagDays）／`status`。テンプレート読みは従来の列規則のまま（G→グループ、P→深さ0、C→深さ1）。`parseWbsDate` は M/D/YYYY・YYYY年M月D日・日時つきを追加（M/D と D/M が両方ありうるときは M/D と読み `ambiguous`。12 を超える側があれば確定）。
- `wbsPredecessors.ts`：先行の表記「3」「3FS+2」「3SS-1d」「PRJ-12」。種類省略＝FS、ラグ省略＝0。種類なしでラグだけのときは単位（d／日）必須（「PRJ-12」の「-12」をラグと取り違えない）。トークン全体が既知IDならそれを優先。区切りは `, ; 、` と改行（読めない塊は空白でも分ける）。
- `miniXml.ts`／`wbsMspdi.ts`：MS Project XML。DOMParser を使わず自前の小さな解析にしたのは、テスト環境（vitest の node）に DOMParser が無く jsdom を足さずに検証したかったため。DOCTYPE は読み飛ばし外部実体は展開しない。名前空間は接頭辞を落とした局所名で読む。
- `wbsCsv.ts`：区切り自動判定（`, タブ ;`。先頭数行の引用符外の出現数）・引用符／改行入りセル対応の純粋関数。
- `wbsColumns.ts`：見出し辞書（大文字小文字・全半角・空白・記号を無視した完全一致）。ツール名は判定しない。役割は同じ列に複数当たったとき `wbs`→`parent`→`level`→`id`→`name`…の順で取る。階層の既定：親列→WBS番号→レベル列→名前先頭の空白→なし。親の値がIDに一致しなければ一意な名前で解決（Asana の Parent task は親の名前）。
- 文字コード：`textDecode.decodeTextBytesStrict`（BOM→UTF-16、UTF-8 を fatal で試し、不正なら Shift_JIS）。既存 `decodeTextBytes` は「化けが1%以下なら UTF-8」の近似で先頭読み用のため、全文を読む取り込みでは使わない（日本語の少ない Shift_JIS CSV が化けたまま通る）。

### MSPDI の換算（根拠）
- PredecessorLink：Type 0=FF／1=FS／2=SF／3=SS。`LinkLag` は 1/10 分単位（MS の LinkLag 要素）。
- `LagFormat` は MS Project XML の DurationFormat と同じ列挙：3=m・4=em・5=h・6=eh・7=d・8=ed・9=w・10=ew・11=mo・12=emo・13=%・14=e%・15=null。見積り（estimated）版は 32 を足した値（35〜）。**偶数が経過時間（elapsed）**。経過時間系は 1日=1440分、それ以外は 1日=`Project/MinutesPerDay`（無ければ 480）。日数は四捨五入し、端数が出たら取り込み画面に警告。`%` 系（13・14）は先行の期間に対する割合で日数にできないため、ずらしなしで警告。
- 出典：learn.microsoft.com の office-project xml-data-interchange（DurationFormat・LinkLag）。公式スキーマの列挙表そのものは取得できず、検索結果の要約（3=分・4=経過分…8=経過日、見積りは35〜）とレガシー資料（LinkLag＝1/10分）に基づく。**実物の MS Project 書き出しでの突き合わせは未実施**（山本さんの手元確認事項）。
- 他：UID=0・IsNull=1・名前なしは除外。OutlineLevel と出現順で親。Start/Finish は先頭10文字。Milestone=1→マイルストーン。PercentComplete 100→完了、1〜99→進行中。Notes→メモ。担当者は Assignment の TaskUID・ResourceUID→Resource.Name（複数はカンマ区切りで既存の担当者照合 `resolveAssignees` に流す。照合できない名前は警告して外す＝従来の担当者列と同じ）。

### 画面（WbsImportModal）
- テンプレート以外では「一番上の段をグループにする」（既定ON）を表示。テンプレートで G がある場合は従来どおり G をグループにする（切替は出さない）。
- `table` のとき列の対応づけ（各列の役割セレクト＋先頭5行のプレビュー＋階層の取り方5種）。変更は即座に確認画面へ反映（`useMemo`）。
- 確認画面は階層を「N段目」、先行を「ID＋SS+2d」、状態を完了／進行中で表示。取り込み行数の上限 `MAX_IMPORT_ROWS`＝5000、ファイル 10MB は既存踏襲。
- モーダルは従来どおり lazy（s19）。新しい解析処理もモーダルのチャンクに入り、取り込まない利用者はダウンロードしない。

### 既知の限界
- 営業日ではなく暦日のラグに換算する（s89）。MS Project の稼働日ベースのラグは暦日へ近似されるため、日程が MS Project と数日ずれることがある。
- Jira の新しい書き出しで Parent が「親の Issue id（数値）」のとき、ID列が「Issue key」だと一致しない（警告して最上位）。その場合は ID 列を「Issue id」の列へ対応づけ直す。
- `.mpp` は読まない（XML で保存し直してもらう）。
