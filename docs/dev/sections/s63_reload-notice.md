## 63. 再読み込みが必要な更新だけを利用者に促す（v3.125・2026-10-01）

山本さんの依頼：Ctrl+Shift+Rが必要なアップデートが実装されたが、利用者が再読み込みできて
いない、というときに再読み込みを促す通知を出したい。**ただし再読み込みが必要ない更新では
通知しない**（明示的な念押し）。

### 設計：`MIN_CLIENT_VERSION` という別の定数を立てる

`src/lib/version.ts` の `APP_VERSION`（画面隅の表示用・毎リリースで必ず上がる）とは別に、
**`MIN_CLIENT_VERSION`**（この版より古い画面は使い続けると不具合が出る、という最低版数）を
新設した。初期値は導入リリースの版（v3.125）＝「この仕組みが無い旧版からは誰にも通知が
出ない」という当然の初期状態。

🔴 **`MIN_CLIENT_VERSION` を上げる基準（これ以外では上げない）**：
- DBの列の削除・改名
- RLSの変更で旧フロントの書き込み・読み取りが失敗するようになる
- Edge Functionの入出力（リクエスト・レスポンスの形）の非互換な変更
- localStorageのキー・値の形式変更（旧形式を読んだ画面が壊れる場合）

**機能追加・見た目の変更だけでは上げない**（通常のリリースのたびに通知を出すと「また
出た」で無視されるようになり、本当に必要なときに効かなくなる）。

### 上げ方（4点セットと同時に行う）

`src/lib/version.ts` の `MIN_CLIENT_VERSION` を、APP_VERSION と一緒にそのリリースの版へ
1行変更するだけ（Section 11の4点セット・バージョンを上げる手順に追加したチェック項目）。
他のファイルを触る必要はない（dist/version.json はビルド時に自動生成されるため）。

### 実装：dist/version.json を定期取得して判定する

- **ビルド時の書き出し**：`vite.config.ts` の `versionManifestPlugin`（`chunk-size-manifest`
  プラグインと同じ「ビルド実行時に実測・抽出する」流儀）が `src/lib/version.ts` を読み、
  正規表現で `APP_VERSION`／`MIN_CLIENT_VERSION` を抜き出して
  `dist/version.json`（`{ version, minClientVersion, buildTime }`）として書き出す。**値を
  二重管理しない**（version.ts が唯一の正本）。
- **取得側**：`src/components/common/ReloadNoticeBanner.tsx`。起動時・10分ごと
  （`setInterval`）・タブが前面に戻ったとき（`visibilitychange`）に
  `fetch("/version.json?t=" + Date.now(), { cache: "no-store" })`で取得する（クエリと
  `no-store` の両方でキャッシュを避ける二重の対策。Vercel側も `vercel.json` に
  `/version.json` 専用の `Cache-Control: no-store` ヘッダーを追加した）。
- 🔴 **判定は純粋関数に切り出してテストする**：`src/lib/reloadNotice.ts` の
  `shouldShowReloadNotice(currentVersion, minClientVersion)` が「実行中の `APP_VERSION` が
  サーバーの `minClientVersion` より古いときだけ」`true` を返す。**サーバーの `version`
  （通常のリリースで必ず上がる値）は一切見ない**——これが「再読み込みが必要ない更新では
  通知しない」という念押しの実装そのもの。版の比較は `compareVersions()`（"." 区切りの
  セグメントを `Number()` で数値化して比較する純粋関数）で行い、"3.9" と "3.10" を文字列
  比較の罠（"3.10" < "3.9" になる）に落ちずに正しく比較する。不正な値（数値化できない
  セグメント）は例外を投げず `0` として扱う（総関数にして「出すべきときに出ない」事故の芽を
  減らすため）。
- **取得失敗は無視**：fetch自体の失敗・非2xx・JSON崩れは `console.warn` のみに留め、
  バナーの表示状態（出ている／出ていない）を変えない。`shouldShowReloadNotice()` に
  `minClientVersion: null` を渡すことで「取得失敗では出さない」を表現する。
- **開発時は動かさない**：`import.meta.env.DEV` のとき useEffect の先頭で即 return する
  （vite devサーバーは `dist/version.json` を書き出さないため）。
- **バナー**：既存の `partialLoadWarning` バナー（`App.tsx`・v3.122・M41是正時に新設）と全く同じ
  構造（固定表示・warningトーン・右側にボタン1つ）を再利用し、新しい見た目の部品は作って
  いない。文言は「アプリが更新されました。このまま使うと保存に失敗するおそれがあります。
  再読み込みしてください」＋「再読み込み」ボタン。**自動では再読み込みしない**（編集中の
  内容が消えるため、ボタンを押したときだけ `window.location.reload()` する）。**閉じる
  ボタンは付けない**（必須の更新のため）。i18n（`src/i18n/layout.ja.ts`／`layout.en.ts`）に
  `layout.app.reloadNotice.body`／`.reload` を追加した。
- **ゲストモードでも動く**：`ReloadNoticeBanner` はSupabaseに一切接続しない純粋なfetch＋
  表示コンポーネントのため、`App.tsx` の `guestActive` 分岐（Section 23）・通常ログイン
  （`AuthenticatedApp`）の両方にマウントした。

### 自動更新（v3.152・2026-10-15）

Supabase の Disk IO 対策。Realtime の購読を張り直す旧版（v3.145 以前）の画面を開いたままにしている人を減らすため、**操作が無いときに黙って最新の版へ切り替える**。同じ版で `MIN_CLIENT_VERSION` も 3.152 へ上げた（旧版にはこれまでどおりバナーが出る）。

- **取得**：`ReloadNoticeBanner` の version.json 取得（起動時・10分ごと・タブが前面に戻ったとき）で、`version`（`minClientVersion` ではない）を保持する。条件の再評価は取得直後と1分おき。タイマー・リスナーは effect のクリーンアップで必ず解除。DEV では動かさない。
- **判定**：純粋関数 `src/lib/autoUpdate.ts` の `shouldAutoReload`。次を**すべて**満たしたときだけ `window.location.reload()`。
  - サーバーの版が実行中の `APP_VERSION` より新しい（`compareVersions`）
  - 最後の操作（pointerdown・keydown・wheel・touchstart・input）から **10分以上**（ちょうど10分は可・タブが裏でも数える）
  - 未保存の編集が無い（`hasUnsavedEditors()`・Section 46）
  - 入力欄（input・textarea・select・contenteditable）にフォーカスが無い（`isInputFocused`）
  - モーダルが開いていない（`isModalOpen`：DOM に `[role="dialog"]`・`[aria-modal="true"]`・`modalOverlayStyle` の `inset: 0` がある。独自モーダルも `modalOverlayStyle` を使えば検出される）
  - AI相談（`ConsultationPanel`）・OKR の AI パネルが「開いている・会話が1ターン以上ある・返答待ち」のいずれでもない（各パネルが `setAutoUpdateAiBlock` で登録。会話が再読み込みで消えるため）
  - ゲスト（`isGuestMode()`）ではない（ゲストの編集はメモリにしか無い）
- **ループ防止**：同じサーバー版への自動再読み込みは `sessionStorage`（`auto_reload_v1`＝版・時刻）に記録し、**30分に1回まで**（CDN の反映遅れで再読み込み後も古い版が返っても連続 reload しない）。記録を書けない環境では reload しない。
- **バナーは変えない**：`MIN_CLIENT_VERSION` 以上で普通に新しい版のときはバナーを出さず、自動更新だけが働く。
- テスト：`src/lib/__tests__/autoUpdate.test.ts`（境界・各条件の否定・ループ防止）。

### v3.163：全体バナーは MIN_CLIENT_VERSION 判定のときだけ（2026-10-16）

山本さんの要望：「新しい版が公開されるたびにリロードしないと使えないのは不便。スーパーリロードが必要なレベルのものだけ最上部に促すバーを出し、リロードしないとアプリが使えない仕様は廃止」。

- **バーを出す条件は `versionOutdated`（`MIN_CLIENT_VERSION` による判定）だけ。** チャンクの読み込み失敗（旧 `CHUNK_LOAD_FAILED_EVENT`）ではバーを出さない（イベントごと撤去）。文言は「重要な更新があります。このまま使うと保存に失敗するおそれがあります。再読み込みしてください」（`layout.app.reloadNotice.body`）。閉じるボタンは付けない（必須更新のため）。
- **バーが出ていてもアプリ操作はブロックしない。** バーは `position:fixed` で上部を覆うため、出している間は `ReloadNoticeBanner` が自分の高さを `--reload-bar-h`（`documentElement`）に書き、`globals.css` の `body` の `padding-top`（PC は `8px + var(--reload-bar-h)`・モバイルは `var(--reload-bar-h)`）で本体を押し下げる。PC の右上ベル（`MainLayout`）と右上のヘルスバナー（Schema／Reminder）は `marginTop: var(--reload-bar-h, 0px)` で一緒に下がる。消えれば変数を外して元に戻る。
- チャンク取得失敗時の扱いは Section 76 の 2（先読み・黙った再読み込み・その画面だけの案内）。
- **v3.152 の「操作が10分以上無いときの黙った自動更新」は変更なし。** `MIN_CLIENT_VERSION` は上げていない（互換破壊なし）。

### テスト

`src/lib/__tests__/reloadNotice.test.ts`：`compareVersions`（"3.9"<"3.10"・同値・桁数違い・
不正値）と `shouldShowReloadNotice`（minClientVersionが新しければ出す／同じ・以下なら
出さない／サーバーのversion自体が新しくても出さない／取得失敗（null）では出さない）を
純粋関数として検証する。

### やらないこと

- `MIN_CLIENT_VERSION` が実際に古いと判定されたときにDBスキーマを自動修正する機能は作って
  いない（Section 22と同じくHuman in the loop＝知らせるだけ）。
- Service Worker等によるキャッシュ強制更新は導入していない（ポーリング＋手動ボタンのみ）。

---
