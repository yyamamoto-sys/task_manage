## 47. `guardedNavigate`の網羅化＋機械チェックの新設（必須・v3.90・2026-08-20）

Section 46（v3.89）は`viewMode`/`appMode`/部署切替・ログアウトのみを対象にした。統括の指摘（「無言で消える経路を一部でも残すと今回の改修は目的を達成しない」）を受け、v3.90で**編集画面（`TaskEditModal`/`TaskSidePanel`）をアンマウントしうる遷移起点を全て洗い出し**、`guardedNavigate`で網羅した。

### 洗い出しの方法

`MainLayout.tsx`の`mainContent`の描画を決める変数（`isGuideOpen`／`isAdminOpen`／`activeLabView`（`labOverlay`）／`appMode`／`viewMode`）を起点に、それぞれの状態を変更する`set*`関数の**全呼び出し箇所**を`grep`で洗い出し、1つずつ「編集画面を含みうる領域を差し替えるか」「既に`guardedNavigate`を経由しているか」を判定した。

| 遷移起点 | ソース走査での出現数（MainLayoutInner・コメント除く） | 判定 | 対応 |
|---|---|---|---|
| `setViewMode(`（viewMode） | 6件 | 危険（`key={viewMode}`の差し替え） | 5件を`guardedNavigate`で包んだ／1件（`Sidebar`内の`onClick={() => setViewMode(view)}`）はスコープ外（別コンポーネントの別変数。下記「対応しなかった経路」参照） |
| `setAppMode(`（appMode） | 8件（呼び出しのみ・定義行は`setAppMode = (`のため不一致） | 危険（`key="okr"`⇄`key={viewMode}`の差し替え） | 全て`guardedNavigate`で包んだ。加えて`setAppMode`自身の内部（`closeLabViews()`呼び出し）も自己ガード化（多層防御） |
| `closeLabViews(`（ラボ系ビュー＋graph/calendar/mypage/aiのTaskEditModal） | 5件 | 危険 | 全て`guardedNavigate`で包んだ（`setAppMode`・`navSetViewMode`・`handleSelectProject`・`handleSelectKr`・`handleSelectGroupNav`の内部） |
| `openLabView(`（ラボ系ビューを開く） | 9件（定義1件＋呼び出し8件） | 危険（viewMode系ビュー全体・または別のラボ系ビューを差し替え） | **定義自体を自己ガード化**（`openLabView`の内部で`guardedNavigate`を呼ぶ）。呼び出し側は元のまま（自己ガードのため個別に包む必要が無い） |
| `setIsAdminOpen(true)`（管理画面を開く） | 4件 | 危険 | 全て`guardedNavigate`で包んだ（`setIsAdminOpen(false)`＝閉じる側は対象外。閉じると下の画面が現れるだけで何もアンマウントしないため） |
| `setIsGuideOpen(true)`（ガイドを開く） | 1件 | 危険 | `guardedNavigate`で包んだ（閉じる側3箇所は同上の理由で対象外） |
| `handleSelectProject`（PJ選択） | 内部で`closeLabViews()`を呼ぶ設計だった | 危険と判明（監査で発覚。当初は「PJ切替自体は安全」としか確認していなかった） | **`closeLabViews()`を呼ぶことに気づいていなかった。** 定義自体を自己ガード化 |
| `handleSelectKr`（KR選択） | 同上（`handleSelectProject`とペアの関数） | 同上 | 同上 |
| `handleSelectGroupNav`（部署切替） | 1件 | 危険（super-adminのみ実害。Section 46参照） | 既にv3.89で自己ガード化済み（変更なし） |
| ツアーの`tour:action`イベント（`open-dashboard-pj-analysis`） | 1件（`setViewMode("dashboard")`を直接呼んでいた） | 危険 | `guardedNavigate`で包んだ（監査で発覚。ツアーによる自動遷移は見落としやすい） |

### 対応しなかった経路（コードで裏取りした理由込み）

- **`Sidebar`コンポーネント内の`onClick={() => setViewMode(view)}`**：`Sidebar`はpropとして受け取った`setViewMode`（実体は`MainLayoutInner`側で`navSetViewMode`を渡している）を呼ぶだけで、`MainLayoutInner`自身の生の`setViewMode`とは別の変数（同名の別スコープ）。呼び出し元（`navSetViewMode`）が既に自己ガード済みのため対象外。
- **`isGuideOpen`/`isAdminOpen`を`false`にする（閉じる）呼び出し**：閉じると下にある画面（`labOverlay`/`appMode`のビュー/`viewMode`のビュー）が現れるだけで、何もアンマウントしない。ガイド・管理画面自体は編集中のdirty状態を持たない（レジストリに登録されるのは`TaskEditModal`/`TaskSidePanel`のみ）。
- **`App.tsx`の`onAuthStateChange`購読によるセッション喪失（トークン失効・ネットワーク切断等）**：`setAuthenticated(!!session)`/`setCurrentUserState(null)`が即座に呼ばれ`MainLayout`全体がアンマウントされる。**これは確認ダイアログで守れない**：セッションは既に失効しており、ユーザーに選ばせる余地（保存するか破棄するか）自体が無い（保存しようとしてもDBへの書き込みが既に認証エラーになる）。ユーザー起点の操作ではなく、背景で発生する involuntary なイベントのため、`guardedNavigate`の対象外とし、報告のみに留める。
- **ブラウザのタブを閉じる・リロードする（`beforeunload`）**：このリポジトリでは意図的に未使用（既存の設計判断）。SPA内の状態遷移とは別次元の問題であり、対応するには新たに`beforeunload`ハンドラを追加する設計判断が必要になるため、今回のスコープには含めない。
- **App.tsxの招待URL自動受諾（`!currentUser`のときだけ動く経路）**：コードで確認済み（`if (loading || currentUser) return;`）。`currentUser`が未確定の間しか動かないため、`MainLayout`（＝`TaskEditModal`/`TaskSidePanel`）が存在しえない状態でしか発火しない。対象外。

### 併せて対応した近接の経路

- **App.tsxのログイン済み招待URL受諾フロー**（`if (!currentUser || inviteUrlPromptChecked) return;`＝`currentUser`確定後も動く）：`window.location.reload()`の前に`confirmDiscardUnsavedEdits()`を追加した。稀なケース（ログイン中に招待URLを踏む）だが、`handleLogout`と同じreloadパターンのため統一した。

### 機械チェック（(a)を採用）

`src/components/layout/__tests__/guardedNavigateCoverage.test.ts`を新設。`labViewChokePoint.test.ts`（既存・`setActiveLabView(`が`openLabView`/`closeLabViews`の中だけにあることを検査）と同じ「ソース走査で出現回数を突き合わせる」方式を、複数の`guardedNavigate(`呼び出し全体に一般化した：

- `MainLayoutInner`のソース（`function Sidebar(`より前の部分。理由は上記の`Sidebar`対象外の説明と同じ）から、コメント（`//`以降）を除去したテキストを対象にする。
- `guardedNavigate(`の全呼び出しについて、対応する閉じ括弧までを括弧の深さで抽出し、それらを連結した「ガード済み領域」を作る。
- 「危険な生の状態変更」（`setViewMode(`・`setAppMode(`・`closeLabViews(`・`setIsAdminOpen(true)`・`setIsGuideOpen(true)`）それぞれについて、ソース全体での出現回数とガード済み領域内での出現回数が一致することを検証する。
- **実装時に実際にこの機械チェックが不具合を検出した**：`setAppMode`の定義が自分自身の内部で`closeLabViews()`を呼んでいたが、`setAppMode`自体は自己ガード化していなかったため「`closeLabViews(`の出現5件のうちガード済みは4件」で実際に落ちた。これを機に`setAppMode`自身を自己ガード化して解消した（本文中の表・多層防御の記述参照）。
- **v3.90直前（v3.89 commit `f587541`）のコードに対してこの検出ロジックを実際に走らせ**、`setViewMode(`（6件中5件）・`closeLabViews(`（5件中2件）・`setIsAdminOpen(true)`（4件中0件）・`setIsGuideOpen(true)`（1件中0件）の4パターンで実際に不一致（＝赤くなる）ことを確認した。`setAppMode(`は当時8件中8件で一致していた（v3.89時点で既に全呼び出しがガード済みだったため。ただしその内部が`closeLabViews`を未ガードで呼んでいた点は当時のこの検査方式では検出できなかった＝上記「実装時に検出」の指摘とは別の切り口）。

### 文言の見直し（嘘の警告にしない）

`confirmDiscardUnsavedEdits()`は`viewMode`/`appMode`/部署/PJ/KR切替・ラボ系ビューの開閉・管理画面/ガイドの開閉など、**性質の異なる多数の画面遷移から共通で呼ばれる**。遷移の種類によっては（例：super-admin以外の部署切替）実際には編集画面が閉じず下書きが消えない場合があり、「破棄されます」「消えます」と断定すると、消えないケースで嘘の警告になる。

- 旧文言：「保存していない変更が残っています。破棄して切り替えますか？」／confirmLabel「破棄して切り替える」／cancelLabel「このまま編集を続ける」
- 新文言：「保存していない変更があります。今のままでは保存されません。このまま切り替えますか？」／confirmLabel「切り替える」／cancelLabel「編集に戻る」

新文言は「今のままでは保存されていない」という**常に真である事実**と、「切り替えるか・編集に戻るか」という選択だけを述べ、その先に何が起きるか（実際に画面が閉じるか・下書きが消えるか）は断定しない。安全側のデフォルト（背景クリック＝cancel＝「編集に戻る」）は変更していない。

他の5箇所の確認ダイアログ（`TaskEditModal`/`TaskSidePanel`の`handleClose`×2・2-5の上書き確認×2・v3.88のタスク切替確認）は見直し対象にしなかった：これらは「ユーザーがそのボタンを押した瞬間に、述べられている結果（閉じる・上書きする・次のタスクへ移動する）が100%確実に起きる」設計であり、断定しても嘘にならないため。

---
