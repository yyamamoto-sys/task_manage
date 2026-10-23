## 20. グランドルール：全画面ラボ系ビューは position:fixed を使わずメインエリア内に収める（必須・v3.23、v3.33で方式を全面変更、v3.34で単一state化、v3.35でchoke point化）

### 用語（今後この2語で呼び分ける）

- **サイドバー**：左のメニュー領域（`MainLayout.tsx` の `Sidebar` コンポーネント。展開時は既定160px・140〜420pxの範囲でドラッグ可変（v3.115で196px・160〜から変更）／折りたたみ時48px固定／モバイルでは非表示）。折りたたみ時の幅は`SIDEBAR_WIDTH_COLLAPSED`定数（Sidebar自身の width にのみ使う）。展開時の幅は可変のため定数ではなくstate（`sidebarWidth`）で持つ（v3.66・Section 30参照）。
- **メインエリア**：サイドバーの右側の作業領域（`MainLayout.tsx` の `mainContent` 変数が描画している領域）。

### 【v3.23〜v3.32の旧方式（廃止）とその欠陥】

体制図・カレンダー・マイページ・関係性グラフ・OKRレポート／クォーター計画／なぜなぜ分析（右ドロワー）などの全画面ラボ系ビューは、当初「`position: fixed; top:0; right:0; bottom:0; left: var(--app-sidebar-w, 0px)`（サイドバー幅ぶんだけ左端をずらす）」という方式でサイドバーを覆わないようにしていた。

これは2026-08-06時点では正しく機能していたが、v3.23〜v3.24で導入された「アプリ外枠（`body { padding: 8px }` ＋ `#root { border-radius: var(--radius-lg); overflow: hidden; }` で作る角丸カード。`src/styles/globals.css`）」と根本的に相性が悪いことが判明した。

- `position: fixed` は**ビューポート基準**で描画される。`#root` の `overflow: hidden` は通常のDOM子要素（position指定を持たない要素）しかクリップできず、`position: fixed` な要素は `#root` の存在ごと無視して描画される。
- その結果、ラボ系ビューは外周8pxの余白まで塗りつぶし、角丸カードの外へはみ出していた。角も直角のままで丸縁が消えていた。
- さらに `left: var(--app-sidebar-w, 0px)` の基準もビューポートそのものであり、角丸カード自体が `body` の8px paddingぶん右にずれて浮いているため、**サイドバーを避けているつもりが、実際はサイドバー右端8pxに重なっていた**。

山本さんの指摘（2026-08-07）：「メニューバーに被らないように上からレイヤーをかぶせているみたいで、元々の丸縁の枠に収まっていないのが嫌。すべてアプリの丸縁エリアに収まるようにしてほしい」。

### 新しい契約（v3.33〜）

**全画面ラボ系ビューは `position: fixed` を使わず、メインエリア内に `flex: 1` で収める。**

- ビュー本体（GraphView・CalendarLabView・ProjectStructureView・MyPageView・KrReportPanel・KrQuarterPlanPanel・KrWhyPanelの非inline時）の root は、`position`/`top`/`right`/`bottom`/`left`/`zIndex` を一切持たない「位置指定のない flex 子要素」にする（`{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", ... }`。内部の `display`/`flexDirection`/`alignItems`/`justifyContent`（中央寄せカード型・右ドロワー型などビューごとの内部構成）はそのまま維持する）。**どこに置くかは親（呼び出し側）が決める**——これが今回の設計の要。
- **PC**：`MainLayout.tsx` の `labOverlay`（`mainContent` 内、`isGuideOpen ? guideOverlay : (isAdminOpen && !isGuest) ? adminOverlay : labOverlay ? labOverlay : appMode === "okr" ? ... : ...` の優先順位＝**ガイド＞設定＞ラボ系7ビュー＞通常のOKR/計画ビュー**）に埋め込む。`#root` の `overflow: hidden` が効くのは「position指定を持たない通常のDOM子孫」だけなので、これでようやく丸縁の内側に正しくクリップされる。ラボ系ビュー同士は `closeLabViews()` により通常同時に開かないが、万一同時にtrueでも `labOverlay` の分岐順（Graph→Calendar→Structure→MyPage→KrReport→KrWhy）で一意に決まる。
- **モバイル**：`body { padding: 0 }` で角丸カード自体が存在しないため、従来どおり全画面表示を維持する。呼び出し側（`MainLayout.tsx` のモバイル分岐）が薄い `MobileFullscreenOverlay`（`position: "fixed", inset: 0`）でビュー本体を包む。zIndexは各ビューが旧方式で持っていた値をそのまま踏襲する。
- **既に理想形の実例**：設定画面（`adminOverlay`。`MainLayout.tsx`）。`position: fixed` を使わず `flex: 1` でメインエリア内に収めているため、最初から丸縁の内側・サイドバーが見えたままになっている。今回の変更は他の全画面ラボ系ビューをこの形に揃えたもの。
- **例外（対象外）**：一時的なモーダル・ダイアログ（タスク編集・クイック追加・ガイド・確認ダイアログ・コマンドパレット・OKR取込・PJカルテ・AdminFormModal・MyPageViewの「＋ウィジェットを追加」等）は、Section 21の契約（`modalStyles.ts`）に従う限り引き続き `position: fixed` のままでよい。一時的な操作であり、丸縁の外にはみ出す・サイドバーが隠れる、のどちらも実害が小さい（Section 21はそもそも角丸カードの内外を問題にしていない）。

### 機械チェック

`src/components/__tests__/labViewContainment.test.ts` が、①`src/` 配下のどのファイルにも `var(--app-sidebar-w` という文字列が現れないこと（旧方式の手法自体が廃止されたことの固定）、②対象7ビューのファイルが、そのビュー本体（`export function <ファイル名と同じ名前>` の関数本体。中央寄せモーダル等の別関数は対象外）の中で `position:"fixed"` を使っていないこと、を機械的に検査する（`modalStyles.test.ts`/`widgetContract.test.ts` と同じソース走査方式）。

### サイドバーのナビ操作をしたら、開いているラボ系ビューを閉じる

サイドバーが常に見える設計になったことで、ラボ系ビューを開いたままサイドバーのナビ（ビュー切替・モード切替・PJ/KR/部署選択）を操作できてしまう。これを許すと「見えないメインエリアの表示だけが裏で切り替わる」混乱が起きるため、`MainLayout.tsx` の `closeLabViews()` を対象操作の入口（`setAppMode` / `handleSelectProject` / `handleSelectKr` / `handleSelectGroupNav` / Sidebarへ渡す `navSetViewMode`）で必ず呼ぶ。ツアー機能の内部遷移など、ユーザーのナビ操作ではない `setViewMode` 呼び出しには通さない（`closeLabViews` を挟むとその呼び出し元のuseEffectのexhaustive-depsで警告が出るため。原因は本文の実装コミット参照）。

### ラボ系ビューは同時に1つだけ開く（重ねるのではなく切り替える。v3.34）

**山本さんの指摘（2026-08-07）**：「ラボの各種機能を押すと、レイヤーが上から重なるように挙動する。Aを押した後にBを押して、その後またAを見ようとAを押しても、Bの下に隠れてAが見えない。重ねるのではなく画面が切り替わるようにしてほしい」。

**原因**：v3.33までは `MainLayout.tsx` がラボ機能ごとに独立した真偽値 state（`isGraphOpen` / `isCalendarOpen` / `isStructureOpen` / `isMyPageOpen` / `isKrReportOpen` / `isKrWhyOpen`）を持っていた。Bを開いてもAが閉じないため両方 `true` になり得て、`labOverlay` の分岐が**宣言順で先勝ち**（Graph→Calendar→Structure→MyPage→KrReport→KrWhy）に1つ選んでいた。押した機能が宣言順で後ろだと画面が変わらず、さらに押し直しても既に `true` なので何も起きない、という不具合だった。

**対策**：真偽値を並べる方式をやめ、`LabViewId`（v3.34時点は `"graph" | "calendar" | "structure" | "mypage" | "kr-report" | "kr-why" | "kr-session"`。**2026-08-10のOKRモード グループ側アーカイブに伴い `"kr-report"` / `"kr-why"` / `"kr-session"` を撤去し、現在は `"graph" | "calendar" | "structure" | "mypage"` の4値**（`src/components/okr/ARCHIVED.md`参照。以下の記述はv3.34〜v3.35当時の設計判断の記録として残す）1つを保持する単一state `activeLabView: LabViewId | null` に一本化した。ラボ機能を開く操作は必ず `setActiveLabView("<id>")` の1行で、前に開いていたものは自動的に閉じる——**2つ同時に開くこと自体が型レベルで不可能**になるのがこの設計の要。`closeLabViews()` は `setActiveLabView(null)` の1行になった。

`labOverlay`（`MainLayout.tsx`）は `activeLabView` に対する `switch` で分岐し、`default` 節で `LabViewId` を `never` 型の変数に代入することで、**新しいラボ機能を追加するときに `LabViewId` へ id を1つ足したのに分岐を書き忘れると型エラーで気づける**（テストを書く必要がない・型レベルの網羅性チェック）。新しいラボ機能を足すときは「`LabViewId` に1つ足す」「`labOverlay` の switch に1本分岐を足す」の2箇所で完結する。

**仕様として意図的な点**：同じ機能のボタンをもう一度押しても閉じない（開いたまま）。サイドバーのビュー切替ナビ（NAV_ITEMS）と同じ挙動に揃えるための意図的な仕様。

**KrJointSessionFlow（OKRの「セッション記録」）もこの対象に含めた**。旧方式では `position:fixed` を使わない設計のため Section 20 の v3.33 対応（position:fixed撤去）の対象外だったが、`isKrSessionOpen` 単独の真偽値でPCでは `mainContent` の**兄弟**として描画されており、開くとメインエリアの横に並んで表示され他のラボ機能と挙動が揃っていなかった。`activeLabView === "kr-session"` として統合し、他と同じく `labOverlay` 経由でメインエリア内に描画するようにした。ただしこのコンポーネント自身のrootは `minHeight:0` を持たない（他のラボビューは持つ）ため、`labOverlay` 側で `{flex:1, minWidth:0, minHeight:0, overflow:"hidden", ...}` のラッパーで包み、契約に合わせている。

サイドバーのラボサブメニュー（`Sidebar` コンポーネント）は `activeLabView` を props で受け取り、現在開いている項目を既存の `NavItem` の `active` プロップ（NAV_ITEMSと同じスタイルトークン）でハイライトする。「画面が切り替わる」ことをユーザーが視覚的に確認できるようにするため。

**ラボビューの開閉は必ず choke point のヘルパー（`openLabView(id)` / `closeLabViews()`）を通し、そのビューに紐づく一時state（編集モーダル等）を切替時にクリアする（v3.35）。** `setActiveLabView` を直接呼ぶ箇所を増やさないこと。理由は次の項目を参照。

### ビューを跨いだ「浮遊モーダル」を防ぐ（v3.35）

v3.34で単一state化した直後は、`activeLabView` が切り替わっても `graphEditTaskId`/`calendarEditTaskId`/`calendarQuickAddDate`/`myPageEditTaskId`（各ビューの「タスク編集モーダルを開く」ための一時state）をクリアしていなかった。これはv3.33までは実害が無かった（2つのラボビューを同時に開けなかったため「ビューAからビューBへ切り替える」操作自体が存在せず、この経路で一時stateが取り残される事象も起こり得なかった）が、**v3.34の単一state化によって切り替えが可能になったことで、初めて到達可能になった不具合**だった（例：GraphViewでタスクを開いて`graphEditTaskId`をセット→閉じずにCalendarへ切り替える→GraphViewは閉じたのに、そこから開いたタスク編集モーダルだけがCalendarの上に残る）。

対策として `MainLayout.tsx` に `openLabView(id: LabViewId)` を新設し、`setActiveLabView` を直接呼ぶ箇所を `openLabView` と `closeLabViews` の2つだけに限定した（choke point化）。`openLabView` は「前と違うidに変わるときだけ」上記4つの一時stateをまとめてクリアする（同じビューを開いたまま行う通常操作——例：MyPage表示中に`onOpenTask`で`myPageEditTaskId`をセットする操作——まで巻き込まないため）。`closeLabViews`はビューを閉じるときに常に4つともクリアする。**新しいラボビューを追加し、そのビューが独自の「編集モーダルを開く一時state」を持つ場合は、この2つのヘルパーに同様のクリア処理を足すこと。**

### 機械チェック（choke point）

`src/components/__tests__/labViewChokePoint.test.ts` が、`MainLayout.tsx` 内の `setActiveLabView(` 呼び出しが `openLabView`/`closeLabViews` の関数本体の外に無いことをソース走査で検査する（`labViewContainment.test.ts` と同じ方式）。

---
