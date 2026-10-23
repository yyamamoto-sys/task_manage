## 21. グランドルール：中央寄せモーダルは必ず画面内に収まる高さ上限を持つ（必須・v3.24、v3.64で中央寄せの手段を修正、v3.84でCSSアニメーション由来のtransform残留の再発防止を追加、v3.85で検出範囲を中央寄せ以外へ拡張）

**2026-08-06に発生した実際の不具合**：`ProjectCreateModal`（「過去のPJから新規PJを作る」）で、引き継ぎ元PJのタスク一覧が伸びるとモーダルが画面の上下を突き抜け、保存ボタンに到達できずPJを作成できなくなった。原因は「箱（モーダル本体）に `maxHeight` が無く、コンテンツの高さまで無制限に伸びていた」こと。オーバーレイにも `overflow` の指定が無かったため、はみ出した部分に到達する手段が無かった。

**🔴 2026-08-12に発生した2つ目の実際の不具合（田中さんからの業務停止報告）**：`maxHeight` 対策を入れた後も、縦の可視領域が狭い環境（Chrome拡大率100%超＋ブックマークバー2段表示で作業領域の縦が削られた状態）で、`QuickAddTaskModal`（FABから開くタスク追加モーダル）の**上端が画面外に切れ、一番上にあるタスク名の入力欄に到達できず、タスクを登録できない**という不具合が発生した（ウィンドウを大きくすると直る）。原因は `maxHeight` の有無ではなく、**中央寄せの手段そのもの**だった：`alignItems:"center"` で縦方向を中央寄せすると、箱がコンテナよりわずかでも大きくなった瞬間、**上側にはみ出した分だけスクロールで絶対に到達できない領域になる**（下側のはみ出しは `overflow:"auto"` で普通にスクロールして到達できるのに、上側だけ到達不能という非対称なCSSの既知の挙動）。つまり「`overflow:"auto"` を保険として持つ」という当初の記述は不正確で、**実際には下方向にしか効いていなかった**。ブラウザの拡大率・ズームの丸め誤差で `maxHeight:100%` の境界付近になった箱は、この非対称性の影響を受け続ける。**対策は `alignItems:"center"` をやめ、箱側の `margin:"auto"`（flexboxのautoマージンによる中央寄せ）に変更したこと。** auto マージンは空きがある間は中央に配置するが、空きが無くなった（箱がコンテナより大きい）瞬間に0へ縮退し、箱はコンテナの先頭（上端）にぴったり揃う——この状態は通常のブロック要素のオーバーフローと同じ扱いになり、`overflow:"auto"` で上から下まで普通にスクロールして到達できる。（`align-items: safe center` という代替もあるが、対応ブラウザにばらつきがあるため採用しなかった。`margin:"auto"` は全ブラウザで安定して同じ挙動になる。）**次に「中央寄せなら `alignItems:center` でよい」と戻さないこと**——今回のように、縦の可視領域が狭い環境でだけ再現し、通常の開発環境（大きなウィンドウ・100%ズーム）では気づけない不具合だったため、同じ判断が繰り返されやすい。

**🔴🔴 2026-08-20に発生した3つ目の実際の不具合（別経路での再発・業務停止の報告）**：v3.64でモーダルの中央寄せ手段を `margin:"auto"` に直したにもかかわらず、`QuickAddTaskModal` で**再び上端が画面外に切れ、タスク名の入力欄に到達できない**という不具合が発生した。今回の原因は `modalStyles.ts` 側ではなく、`src/styles/globals.css` の `@keyframes modalEnter`（`.animate-modalEnter`。QuickAddTaskModalの箱にのみ適用）が、旧 `position:fixed; top:50%; left:50%` 方式（画面中央に絶対配置し自分の幅・高さの半分だけ戻して中央寄せする手法）の名残で `transform: translate(-50%, -50%)` を終了状態に持っていたこと。`.animate-modalEnter` は `animation-fill-mode:both` のため、**アニメーションが終わった後もこの transform が永久に残る**。今のモーダルは `margin:"auto"` 方式（本節上部）で中央寄せしているため、この transform は純粋な「余計なズレ」になり、箱を自分の高さの半分だけ上・幅の半分だけ左へ動かしていた。表示上の上端＝V/2−H（V=可視高さ、H=箱の高さ）となり、**箱が可視領域の半分より高くなった瞬間に上端が画面外に出て、スクロールでも到達できなくなる**。

なぜ既存の機械チェック（下記）をすり抜けたか：`modalStyles.test.ts` は「インラインstyleの中央寄せ手段」（オーバーレイの `alignItems:"center"`・箱の `margin:"auto"`）しか見ておらず、**CSSアニメーション由来のtransform残留**は検査対象に入っていなかった。`QuickAddTaskModal.tsx` は箱側で正しく `modalBoxStyle()`（`margin:"auto"`）を使っており、テキスト上は契約を満たしているように見えるため、この種のテストでは検出できなかった。

対応：①`@keyframes modalEnter` から `translate(-50%, ...)` を除去し、終了状態を `transform:none` にした（演出の量感は `panelSlideUp` に揃えた）。②`globals.css` の `@keyframes` 全定義・`.animate-*`/`.panel-*`/`.chat-*`/`.fab-*` 等のクラスを1つずつ確認したが、同型の残骸は `modalEnter` 以外に無かった。③新規 `src/components/common/__tests__/modalKeyframeTransform.test.ts` を追加し、`translate(-50%` を最終状態に持つ `@keyframes` を使うクラスが `modalBoxStyle()` の箱に適用されていないこと、箱の style に `transform` が直接指定されていないことを機械的に検査するようにした（詳細は下記「機械チェック」参照）。

### 契約（`src/components/common/modalStyles.ts` に集約）

- **オーバーレイ**（背景の暗幕）：`modalOverlayStyle(zIndex)` を使う。`position:fixed; inset:0` で画面いっぱいに広げ、`overflow:"auto"` を持つ（箱が想定外に大きくなっても背景側をスクロールして到達できるようにするため）。**中央寄せはオーバーレイ側では行わない**（`alignItems:"center"` / `justifyContent:"center"` は使わない。上記の不具合の原因のため）。
- **箱**（モーダル本体）：`modalBoxStyle(width)` を使う。**`maxHeight:"100%"`** で、オーバーレイの padding を除いた内側＝ビューポート内に必ず収まるようにする。**`margin:"auto"`** で中央寄せする（`alignItems:"center"` の代わり）。`display:flex; flexDirection:column; overflow:"hidden"` で、内側の本文だけにスクロールを担わせる。
- **本文**（ヘッダー・フッターに挟まれるスクロール領域）：`MODAL_BODY_STYLE`（`flex:1; minHeight:0; overflowY:"auto"`）を使う。**`minHeight:0` は必須。** フレックス子要素の既定 `min-height:auto` のせいで、箱の高さが制約されても本文が縮まずスクロールが発生しない、という典型的な罠がある。
- **フッター**（保存・キャンセル等の操作ボタン行）：`MODAL_FOOTER_STYLE`（`flexShrink:0`）を使う。コンテンツがどれだけ長くても、操作ボタンが押し縮められず常に見える状態を保つ。
- 背景の濃さ・角丸・padding・幅などの個別事情は、これらの spread の**後**に上書きしてよい（例：`{ ...modalOverlayStyle(300), background: "rgba(0,0,0,0.45)" }`）。**オーバーレイ側で `alignItems:"center"` / `justifyContent:"center"` を上書きしないこと**（2026-08-12の不具合が再発する）。

### このルールは新しいモーダル・ポップアップを追加するとき必ず確認する

- [ ] `modalStyles.ts` の共有スタイルを使っているか？（新規実装で毎回コピペし直すと必ずどこかで漏れる）
- [ ] 箱に `maxHeight` が付いているか？（無いとコンテンツの高さまで無制限に伸びて画面外に突き抜ける）
- [ ] 中央寄せは箱側の `margin:"auto"` で行っているか？（オーバーレイ側の `alignItems:"center"` だと、縦の可視領域が狭い環境で上端が到達不能になる）
- [ ] 本文に `minHeight:0` が付いているか？（無いとフレックスの既定 `min-height:auto` でスクロールしなくなる）
- [ ] 保存・キャンセル等の操作ボタンはフッターに置き `flexShrink:0` にしているか？
- [ ] 箱に CSS アニメーション由来を含め `transform` が残っていないか？（`animation-fill-mode:both` の `@keyframes` が `translate(-50%,...)` 等を終了状態に持つと、`margin:"auto"` による中央寄せが崩れる。2026-08-20にQuickAddTaskModalで実際に発生）

### 対象外

- **横からのドロワー・サイドパネル**（AI相談・`TaskSidePanel`・`MemberDetailPanel`・OKRラボの右ドロワー3つ等）。画面の高さいっぱいに出るのが正しい設計で、この契約の対象ではない。
- Section 20 の全画面ラボビュー（体制図・カレンダー・マイページ・関係性グラフ）も対象外（別の契約＝position:fixedを使わずメインエリア内にflexで収める、に従う）。
- **モーダルはサイドバーを避けない**（Section 20 とは別の話。モーダルは画面中央のままでよい）。

**🔴🔴 2026-08-20に発生した4つ目の実際の不具合（中央寄せではないモーダルの保険漏れ）**：`TaskEditModal.tsx`（タスク詳細・編集モーダル）はPC＝上寄せ・モバイル＝下シートという意図的なアンカー方式（`alignItems: isMobile ? "flex-end" : "flex-start"`）を採っており、中央寄せではないためSection 21の主契約（`modalStyles.ts`）の対象外自体は正しい判断だった。しかしオーバーレイに `overflow:"auto"` が無く、箱が想定より大きくなった場合に背景側からスクロールして到達する保険が無いまま残っていた（2026-08-20の横断監査で発覚。現状の数値では計算上まだ破綻していないため実際の操作不能は未確認だが、保険としてoverflow:"auto"を1行追加した。アンカー自体・`maxHeight`の数値は変更していない）。

なぜ既存の機械チェックをすり抜けたか：`modalStyles.test.ts` の検出（`hasCenteredFixedOverlay`）は `alignItems:"center"` のリテラル一致を要求しており、三項演算子で `"flex-start"`/`"flex-end"` になりうるアンカー方式はそもそも「対象外」と判定されて検査自体が走っていなかった（対象外の判断は正しいが、対象外でも最低限の保険は必要という論点自体が検査に入っていなかった）。

### 機械チェック

- `src/components/common/__tests__/modalStyles.test.ts` が、`position:"fixed"` かつ `inset:0` で中央寄せ（`alignItems:"center"` + `justifyContent:"center"`）しているオーバーレイを持つ全 `.tsx` ファイルを検出し、`modalStyles.ts` を import しているか自前で `maxHeight` を持っているかを機械的に検査する（widgetContract.test.ts と同じソース走査方式）。ドロワー・サイドパネル等は明示的な除外リスト（`EXCLUDED_FILES`）に理由付きで列挙してある（v3.33：全画面ラボビュー4ファイルは `position:fixed` を一切使わなくなり検出パターンにそもそも一致しなくなったため除外リストから外した。将来の逆行を見逃さないための対応）。
- **（v3.64で追加）** 同じテストファイル内に、`modalStyles.ts` 自身のソースを読み、`modalOverlayStyle()` が `alignItems`/`justifyContent` を一切使っていないこと・`modalBoxStyle()` が `margin:"auto"` を持っていることを検査するテストを追加した。共有関数側で `alignItems:"center"` に戻されると、20箇所全ての利用先（`ConfirmModal`／`AdminFormModal`／`TodoDecomposeModal`／`MilestoneAddModal`／`MilestoneEditModal`／`WidgetConfigModal`／`DashboardView`／`ProjectKarte`／`ChangeHistoryModal`／`ConfirmationDialogModal`／`MyPageView`／`MainLayout`（2箇所）／`OkrModeIntroModal`／`PersonalKrFormModal`／`WeekTaskLinkModal`／`ProjectCreateModal`／`ProjectSettingsModal`／`QuickAddTaskModal`）に一括で再発するため、利用先ではなく共有関数側を直接検査する。加えて、`modalStyles.ts` を使わず同型のパターンを自前実装していた9ファイル（`AdminFormModal`／`MilestoneAddModal`／`MilestoneEditModal`／`TodoDecomposeModal`／`WidgetConfigModal`／`DashboardView`／`ProjectKarte`／`ChangeHistoryModal`／`ConfirmationDialogModal`）を共有関数へ移行し、`modalOverlayStyle()` の利用者全員が箱側で `margin:"auto"`（`modalBoxStyle()` 経由または手書き）を併用していることを検査するテストも追加した（`ConfirmModal.tsx`・`MainLayout.tsx`の2箇所は箱側の中央寄せが欠けていたため同時に修正）。
- **（v3.84で追加）** `modalStyles.test.ts` はインラインstyleの中央寄せ手段しか見ておらず、CSSアニメーション由来のtransform残留（2026-08-20の3つ目の実際の不具合）を検出できなかった穴を、新規 `src/components/common/__tests__/modalKeyframeTransform.test.ts` で塞いだ。①`globals.css` を読み、`@keyframes` の中で `translate(-50%` を含む宣言を持つアニメーション名を洗い出し、そのアニメーション名を使う `.animate-*` クラスが、`.tsx` 側で `modalBoxStyle()` を使うモーダルの箱に適用されていないことを検査する（許可リスト方式。許可する場合は「このアニメーションは top:50%/left:50% 方式専用」等の理由コメントを `ALLOWED_CENTERING_RESIDUE_USAGE` に書く）。②`modalBoxStyle()` を使っている箱の要素に `transform` が直接指定されていないことも検査する。`modalStyles.test.ts`／`widgetContract.test.ts` と同じソース走査方式。実装時に、修正前の（旧）`globals.css` と実際の `QuickAddTaskModal.tsx` に対して検出ロジックを単体で走らせ、`animate-modalEnter` が `modalBoxStyle()` の箱に適用されていることを実際に検出できることを確認した（修正後は残骸ゼロで通過する）。
- **（v3.85で追加）** `modalStyles.test.ts` の中央寄せ専用チェックは`alignItems:"center"`のリテラル一致しか見ておらず、`TaskEditModal.tsx`のようなアンカー方式（中央寄せでない、Section 21の主契約の対象外）のオーバーレイに`overflow:"auto"`が無いことを検出できなかった。同じテストファイル末尾に、検出対象を「`position:"fixed"`かつ`inset:0`の全画面オーバーレイ全般」（中央寄せに限らない）へ広げた別のdescribeブロックを追加し、`modalOverlayStyle()`を使っているか、自前なら`overflow:"auto"`（保険のスクロール手段）を持っているかを検査するようにした（既存の厳密な中央寄せ契約は変更せず維持したまま、別の安全網として追加）。`EXCLUDED_FILES`は両方のテストで共有し、ドロワー・全画面認証画面に加えて「子を持たない透明スクリムのみの要素」（`ErrorBar.tsx`）・「Section 20のモバイル全画面ラップ用ヘルパー」（`MainLayout.tsx`のMobileFullscreenOverlay）・「アーカイブ済みで実際には描画されない旧コード」（`GroupOkrDashboardArchived.tsx`）・「右ドロワー型の取込パネル」（`PersonalOkrImportModal.tsx`）を理由付きで追加した。あわせて、Section 20（v3.33）の変更で`position:"fixed"`を一切使わなくなっていた`KrReportPanel.tsx`／`KrQuarterPlanPanel.tsx`／`KrWhyPanel.tsx`が除外リストに古い理由のまま残っていたのを発見し、素通しに戻した（GraphView等4ファイルは既に同じ理由で除外リストから外れていたのにこの3ファイルだけ取り残されていた）。修正前の`TaskEditModal.tsx`に対して検出ロジックを単体で走らせ、実際に検出できる（`overflow:"auto"`追加後は検出されない）ことを確認した。

---
