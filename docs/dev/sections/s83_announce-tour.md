## 83. お知らせツアー（新機能の紹介）の仕組みと「アプリ内から要望を送れるようになりました」（v3.159・2026-10-15）

**手順の正本は [docs/dev/tour-guidelines.md](docs/dev/tour-guidelines.md) §13。** 新機能のたびに「ツアー定義を1本書いて `tours/announcements.ts` に1行足す」だけで、①公開後に各自が次にアプリを開いたとき自動で1回 ②お知らせ（ベル）の詳細の「ツアーで見る」ボタン ③ガイドの「ほかのツアー」から届けられる。DB・RLS・Edge Function の変更なし（マイグレーションなし・`MIN_CLIENT_VERSION` は上げない）。

### 試作は管理者だけに公開（audience）
最初の1本 `feedback-intro`（`tours/feedback-intro.ts`・4ステップ）は `audience: "super_admin"` で出す（山本さんの指示：まず自分の画面で確認する）。**全員へ広げるときは `announcements.ts` の `audience` を `"all"` に変える1行**。管理者以外には自動開始・ガイドの一覧・お知らせのボタン・ディープリンクのどれも出さない（`buildTours({isGuest, isSuperAdmin})` が `tours` から登録ごと外すので `start()` が通らない。ゲストには audience に関わらず出さない）。`announcements.test.ts` が一般アカウント・ゲスト・管理者の3通りで固定している。

### TourStep の追加（`tours/types.ts`）
- `advanceOn: { appears }`：その `data-tour-id` の要素が現れたら次へ。この段は「次へ」「戻る」を出さず、Enter・矢印キーでも進まない（`isGatedStep`）。
- `whileVisible: { id, onLost: "back" | "end" }`：その要素が消えたら前へ戻る／終了。判定は `tourStepGate.ts` の純関数 `evaluateStepGate`（**advanceOn が whileVisible より先**＝パネル内のボタンを押した瞬間に「パネルが閉じた」と「モーダルが開いた」が同時に起きても進む）。`TourProvider` が 150ms ごとに DOM を見る（イベント連携ではなく DOM 判定＝ベル・モーダル側にツアー用の配線を足さない）。
- `skipLabel`・`nextLabel`・`keepFocus`（背後の入力欄のフォーカスを奪わない）・`raiseSpotlight`（枠線を吹き出しと同じ z-index へ。ベルのパネルが z-index 9999 で、通常の枠線 9991 では隠れるため）。
- **暗幕の穴**：暗幕は元々対象を避けた4枚の DimBox（9990）で、対象の部分は覆わないのでクリックは対象に届く（変更なし）。ベルのパネル（9999）は暗幕より手前・フィードバックのモーダル（610）は暗幕より奥だが、穴から対象が見えて押せる。

### feedback-intro の流れ（途中で閉じたとき）
1. 画面中央「要望を送れるようになりました」（「あとで」＝既読扱いで閉じる／「見てみる →」）
2. ベルを光らせ「ベルを押してください」→ パネル（`notification-panel`）が開いたら次へ
3. パネル内「💬 ご意見を送る」（`bell-feedback-entry`）→ モーダル（`feedback-modal`）が開いたら次へ
4. モーダルの入力欄（`feedback-textarea`）を光らせ「一言書いて Ctrl+Enter で送れます。画面の状況も自動で付きます」→ 完了（送らなくても終われる）
- **3段目でパネルを閉じる**（暗幕・パネル外のクリックで閉じる含む）と **2段目へ戻る**。**4段目でモーダルを閉じる**（送信・キャンセル・Esc）と**終了（既読）**。「あとで」「やめる」「✕」「Esc」は既読扱い。
- PC・モバイル（ベルはヘッダー）とも同じ `data-tour-id` を使う。

### 自動開始（`pickAutoStartAnnouncement`・MainLayout の3秒ごとの見直し）
ログイン済み・ゲスト以外・初回ツアー既読（かつ招待ダイアログなし）・そのお知らせが未読・他のツアー中でない・モーダル（`isModalOpen`）・入力欄フォーカス・未保存編集・ガイド／設定／ラボ／登録ダイアログ等が無いとき1回。既読はメンバーID別（`tourCompletion.ts`・`unmarkTourCompleted` を追加）。「あとで」も既読（自動では二度と出ない・ガイドから再生できる）。

### お知らせからの再生
記法 `amp://tour/<id>`（`tours/tourLinks.ts`：`extractTourIds`／`stripTourLinks`／`attachTourLink`）。詳細ダイアログは本文から記法を取り除き、`tourTitleOf(id)`（この人の `tours` にあるものだけ）で「▶ ツアーで見る」ボタンを出す。押すとダイアログを閉じてツアー開始（画面遷移ではないので `guardedNavigate` は通さない）。ベルの行も記法を取り除いて表示する（旧画面ではただの文字）。送信画面には「ツアーを添付（任意）」（その人に見えるお知らせツアーだけ）。ディープリンク `/?open=tour&id=<id>`（`deepLink.ts` の `extractTourId`。形が合わなければ無視。読んだら `id` も消す）はベル・Windows通知のクリック先に使える。
**既知の限界**：Windows通知・ベルの文面はサーバーが本文の先頭を切って作るため、短い本文だと通知の文面に記法が見えることがある（ベルの行は取り除く。Windows通知は取り除かない）。

### 管理者の確かめ方
ガイドの「ほかのツアー」から何度でも再生できる。その行の「自動表示をもう一度試す（既読を消す）」（super_admin にだけ表示）で既読を消してガイドを閉じ、数秒後に自動開始を再評価する（再読み込み不要）。

### テスト
`announcements.test.ts`（登録表の整合・公開範囲3通り・自動開始の判定・feedback-intro の進み方と閉じたときの扱い）・`tourLinks.test.ts`（記法・添付・ディープリンク）・`announcementWiring.test.ts`（ソース走査・コメント除去＝Section 59。TourProvider の判定と gated、定義が指す data-tour-id の実在、MainLayout の公開範囲・自動開始・再生口。**audience を "all" に・gated の `if (gated) return` を外す・`isSuperAdmin: tourIsSuperAdmin` を true にする、の3か所をわざと壊して赤くなること、戻して緑になることを確認済み**）。描画テスト基盤が無いため、実際のクリック・暗幕の穴・PC／モバイルの見え方は実機確認が要る（`miniDom` は `document.querySelector`・`getBoundingClientRect`・`ResizeObserver` を持たず TourProvider を描画できない）。

---
