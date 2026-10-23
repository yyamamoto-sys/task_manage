## 79. パスワードの再設定・変更（v3.150・2026-10-15）

**運用・Supabase 管理画面の設定・メール文面案は [docs/dev/account-recovery.md](docs/dev/account-recovery.md)。** 利用者が管理者に頼まずに、忘れたパスワードの再設定と、ログイン中のパスワード変更をできるようにした。マイグレーションなし・`MIN_CLIENT_VERSION` は上げない。

### ログイン画面の「パスワードをお忘れの方はこちら」（`LoginScreen.tsx` の mode `"forgot"`）
- `resetPasswordForEmail(email, { redirectTo })`（`auth.ts` の `requestPasswordResetMail`）。`redirectTo` は `origin + pathname`（`buildResetRedirectUrl`。クエリ・ハッシュは引き継がない＝招待コード等が戻り先に残らない）。
- 🔴 **結果の表示は登録の有無に関わらず同じ文言**（`auth.forgot.sent`）。Supabase は未登録のメールでもエラーを返さない（公式：Password-based Auth）。「未登録」「見つかりません」を示す語を文言に入れない（テストで固定）。
- 送信後はボタンを60秒止める（`resendRemainingSec`）。HTTP 429・`over_email_send_rate_limit`・文言に `rate limit`／`security purposes` を含むもの（`classifyResetMailError`＝rateLimited）も、**sent と同じ固定文言**を出す（待ち時間の表示の差で登録の有無を推測させない。画面側の60秒停止だけは同じ）。それ以外の失敗は `formatErrorForUser`（Section 15）。

### リンクから戻ってきたとき（🔴 URL のトークンの処理は自前・通常の起動処理を止める仕組み）
- 🔴 **`client.ts` の `createClient` は `auth: { detectSessionInUrl: false }`**（`flowType` は既定の implicit のまま）。既定のままだと auth-js がハッシュを処理したあと `location.hash = ''` で**履歴に新しい項目を積み**、トークン付きの URL が戻るボタンで復元できてしまう（`history.replaceState` で消しても効かない）。そのためハッシュの処理を自前にした。**切ると、再設定だけでなくサインアップ確認・招待・マジックリンク・メール変更のリンクも自前で取り込む必要がある**ため、全 type を漏れなく扱う：`parseAuthLink` はトークン（`access_token`＋`refresh_token`）が揃っていれば type を問わず `session`（`isRecovery` は `type=recovery` のときだけ true）、`error`／`error_code` は `error`。
- `src/lib/account/initialAuthLink.ts`（`main.tsx` の**最初の import**。順序を変えない＝テストで固定）が起動時に `captureAuthLink(window)`：URL を控え、**直ちに `history.replaceState`（push しない・`location.hash` へ代入しない）でトークン・エラーを消す**。そのあと `App.tsx` の起動 effect が `applyInitialAuthLink()`（`auth.ts`。結果は1度だけ作って使い回す＝StrictMode の二重実行でも `setSession` は1回）で `supabase.auth.setSession({ access_token, refresh_token })`。`type=signup` 等は通常のログインとして扱う（招待コードでの登録・確認メール→ログインの既存フローはここを通る）。取り込みに失敗（トークンが無効）したときは再設定画面を出さず、汎用の「リンクが無効か期限切れです」を出す。
- **再設定中の状態は state だけに持たない**：`recoveryActive`（`App.tsx`）の初期値は `resolveRecoveryOnStartup`（URL が再設定リンクなら true）。再設定リンクを取り込む**`setSession` の前**（`applyInitialAuthLink` が access_token の JWT の `sub` から user id を取り出して書く。署名は検証しない＝印は「強制する側」にしか働かず偽造しても害が無い。デコードできなければ印も `setSession` もせず無効リンク扱い。`detectSessionInUrl:false` では `PASSWORD_RECOVERY` が発火しないため、イベントには依存しない）で localStorage に**「再設定待ち」の印**（`recovery_pending_v1`＝`{userId, at}`。`src/lib/account/recoveryMarker.ts`）を書く。セッション確定時（起動時の `getSession`・`INITIAL_SESSION`・リンクの `SIGNED_IN`）に印を読み、**印の user id がセッションのそれと一致し24時間以内なら `recoveryActive` を立てる**（再読み込み・新しいタブでもパスワードを決めずにアプリへ入れない）。一致しない・古い・壊れた印・セッションが無い場合は印を消す。**印で強制するのは `INITIAL_SESSION`（再読み込み・新しいタブ）とリンクの `SIGNED_IN` だけ**（`shouldEnforceMarkerOnAuthEvent`）。パスワードでのログイン（`signIn`）中の `SIGNED_IN` では強制せず（`isPasswordLoginInFlight`）、成功したら印を消す（古いパスワードでログインし直して抜けられる）。**他のタブ**には、`setSession` より前に印が書かれる＋`storage` イベント（`App.tsx` が自分のセッションの user id と一致するときだけ `recoveryActive` を立てる）で、再設定前にアプリへ入れないようにする。パスワード設定の成功とログイン画面へ戻る（`signOut` 成功）で印を消す。🔴 `signOut` が通信エラーで失敗したら、`signOutLocal`（`scope:"local"`＝通信なし）でこの端末のセッションだけ破棄してログイン画面へ戻し、**印は消さない**（次回起動でセッションが無ければ上の規則で自動的に消える）。両方失敗したら再設定画面に留まってエラーを出す。localStorage が使えない環境では印を書けない（`writeRecoveryMarker` が false）＝その場の画面は守られるが、再読み込みすると印が無いので通常起動になる（`console.warn` のみ。既知の限界）。
- **`recoveryActive` が true の間は `if (recoveryActive) return <AccountRecoveryScreen …/>`**（`loading` の次・ゲスト／`LoginScreen`／`AuthenticatedApp` より前）。`AuthenticatedApp` が mount されないので、自動マッチ（autoMatch）・招待URLの受諾・SetupWizard・`AppDataProvider` のデータ読み込みは一切動かない。位置と条件式は `recoveryFlow.test.ts` がソース走査で固定（コメントを除去して走査。修正前の版に当てて赤くなることを確認済み）。
- 画面は新パスワード＋確認 → `updateOwnPassword`（`updateUser({ password })`）。成功したら「パスワードを変更しました」→ 印を消し `setAuthenticated(true)`・`setRecoveryActive(false)` で**通常どおり入る**。最小文字数は `auth.error.passwordTooShort`（6文字・`PASSWORD_MIN_LENGTH`）。失敗は `classifyUpdatePasswordError` で分ける：`reauth`（再認証が必要）→「セキュリティの設定により、このセッションではパスワードを変更できません。…ログイン画面の『パスワードをお忘れの方はこちら』からもう一度メールを送ってください」（Section 15 のエラー文つき）／`session_missing`（リンクが無効）→「再設定のリンクが無効か期限切れです」／`same_password`（今と同じ）→「今と同じパスワードは使えません」／その他は `formatErrorForUser`。
- **無効・期限切れの案内は汎用文言**（`auth.link.invalid`「このリンクは無効か期限切れです。パスワードの再設定の場合は…もう一度メールを送ってください」）。エラーの URL には `type` が付かないことが多く、再設定かサインアップ確認かを区別できないため。`shouldOpenResetFormOnError`：`type` がサインアップ確認・招待・マジックリンク・メール変更と分かる場合以外は、ログイン画面の再設定フォームを開く（分かる場合はログイン画面に案内だけ）。**すでにログイン済みで期限切れのリンクを開いた場合**は、アプリにそのまま入ったうえでトーストで案内する。

### 設定ページ「👤 プロフィール」の「パスワードを変更」（`AccountSecurityRow.tsx`）
新パスワード＋確認 → 保存ボタンで `updateOwnPassword`（明示保存・Section 44。入力中は未保存編集レジストリ＝Section 46 に登録）。**ゲストには出さない**（`isGuestMode()`）。Supabase の再認証が必要な設定（Secure password change）などで拒否されたら、エラー文を Section 15 で出し、「一度ログアウトして『パスワードをお忘れの方』から再設定してください」を添える（`isReauthRequiredError`）。**この設定が本番でオンかは未確認**（docs/dev/account-recovery.md 1-4）。

### `auth.ts` の変更
`onAuthStateChange(callback(session, event))`：第2引数 `event` を足しただけで、既存の呼び出し元（`session` だけ使う）は無改修。`requestPasswordResetMail`・`updateOwnPassword`・`applyInitialAuthLink`（URL のトークンの `setSession`）・`signOutLocal` を追加。

### 🔴 ファイル名に「password」を含めない
開発環境の Read/Write 拒否ルール（`*password*`）に当たり、そのファイルを作れない・読めない。新規ファイルは `recoveryFlow.ts`／`AccountRecoveryScreen.tsx`／`AccountSecurityRow.tsx`／`account-recovery.md` と命名した（ファイルの中身・関数名・i18n キーに password を含めるのは問題ない）。

### 手順上の注意
- **Supabase 管理画面の設定が先**（Site URL・Redirect URLs・社用 SMTP）：標準の送信はプロジェクトのチーム宛てにしか送れず（1時間2通）、利用者にはメールが届かない。docs/dev/account-recovery.md に確かめた事実／未確認を区別して記載している。
- 実機確認は山本さんが行う（メールのリンク→設定画面→そのままアプリへ／古いリンク／未登録メールで同じ文言）。手順は同ドキュメントの 3。
- 戻りのフローは supabase-js の既定（implicit：ハッシュ `#access_token`）を前提にしている。PKCE（`?code=`）にした場合は未対応（`flowType` を変えるときは `parseAuthLink`・`applyInitialAuthLink` も作り直すこと）。
- 既知の限界：①最初に開いたトークン付き URL はブラウザの閲覧履歴（chrome://history）には残る（implicit フロー固有。根本解決は PKCE だが、PKCE は再設定を依頼したのと同じブラウザでしかリンクが使えないため採らない）。戻るボタンの履歴には残らない。②`setSession` 失敗・取り込み中の再読み込みではトークンを失い、メールの送り直しになる（安全側）。③別タブでパスワードログインした直後の SIGNED_IN が、印が消える前に届くと一瞬再設定画面になりうる（ログインし直せば抜けられる）。
- 既存フロー（サインアップ確認メール→ログイン、招待コードでの登録）は `applyInitialAuthLink` を通る。実機確認の観点は docs/dev/account-recovery.md の 3。

---
