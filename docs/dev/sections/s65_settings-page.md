## 65. 設定画面（トップのカード一覧＋詳細ページ。v3.127で新設・v3.155で作り直し）

**設計の正本：[docs/dev/設計仕様_設定画面リニューアル_20261015.md](docs/dev/設計仕様_設定画面リニューアル_20261015.md)。** このセクションは現在の構造と守るルールの要点。

山本さんの要望（v3.127）：ダークモードや通知など、ユーザーごとの設定が増えた。「設定で困ったときはここを開けばわかる」画面にする。
v3.155：設定ページ（個人）と AdminView（管理）が別々に作られ、目次・見出し・保存・未保存確認をそれぞれ持っていたため、
トップをカード一覧にして構造・保存・見た目を揃えた（目次の二重・10〜12pxの文字・項目名の曖昧さ・保存方式のばらつきを解消）。

### 構成（v3.155）

歯車（PCはサイドバー「その他」、モバイルはヘッダー。ゲストには出さない）→ `MainLayout.tsx` の `adminOverlay`（`isAdminOpen`。
state名は既存のまま）→ **`src/components/settings/SettingsView.tsx`**。トップは見出し3つ（個人／部署の管理／アプリの管理）の下に
カード（`SettingsTop.tsx`。PCは `repeat(auto-fill, minmax(260px,1fr))`、モバイルは1列の行型）、カードを押すと詳細ページ。
階層は「トップ→詳細」の2段だけで、**目次・パンくずは置かない**。戻る手段は見出しバーの「← 設定」（モバイルは「‹ 設定」）の1つ。
見出しバー（← 設定／ページ名／？／✕）は SettingsView が持つ（右余白は `withBellReserve`）。詳細ページは離れるとアンマウントする。
**ブラウザの戻るには対応しない**（アプリは popstate を使わず、ガイド・ラボ・設定は画面内の状態で切り替える。山本さん決定）。
詳細から戻ったとき、トップのスクロール位置を復元する。

| 見出し | ページ（`SettingsPageId`） | 誰に出すか |
|---|---|---|
| 個人 | `profile`（表示名・短縮名・色）／`account`（メール・権限の表示・パスワード変更・ログアウト）／`display`／`notify`（通知の受け取り方）／`help` | 全員 |
| 部署の管理 | `okr`／`tf`／`pj`／`members`／`tags`／`groups`（部署）／`invites`／`ai_usage`／`messages`（お知らせの送信） | 部署の管理者（`canAccessAdminSection`。管理者不在のブートストラップを含む）。`messages` だけは `is_admin`／`is_super_admin`（ブートストラップを含まない。AdminView の既存の差を維持） |
| アプリの管理 | `tips`／`backup`／`reminders`（期限リマインドの実行状況）／`errors`（利用者の画面のエラー） | `is_super_admin` |

- **ページの唯一の定義は `src/lib/settings/settingsPages.ts`**（`SETTINGS_PAGES`・`SettingsPageId` 18値・`resolveSettingsAudience`／`canViewSettingsPage`／
  `buildSettingsCardGroups`／`resolveRequestedPage`）。権限の判定は既存の `canAccessAdminSection` をそのまま使い、新しい判定を作らない。
  名前・1行説明は i18n（`layout.settings.page.<id>.title／.desc`、ja・en）。件数バッジは現行ナビにあった6件（okr・tf・pj・members・tags・groups）だけ
  （`useAdminCounts`）。ゲストには設定を出さない（`(isAdminOpen && !isGuest)` を維持）。ゲストの個人ページは `isGuestMode()` 分岐（パスワード）を維持。
- **AdminView は `page` を受けて1ページだけを描画する**（`AdminView({ currentUser, page })`）。左ナビ・ヘッダー・文字サイズ（小中大）・注意書きバッジ・
  初見ヒントの常時帯・モバイルのセレクト・最後に開いたタブの記憶（`admin_last_tab`）・タブ切替時の独自の確認ダイアログは廃止。
  各セクション本体（約3,500行）は触っていない。編集対象の部署の判定は `src/hooks/useAdminScope.ts`（`resolveAdminGroupId`・Section 1.6）。
  部署に依存する7ページ（okr・tf・pj・members・tags・invites・ai_usage）は詳細ヘッダーに「編集対象：◯◯」、部署の管理の見出し行に注意書きを出す
  （表示部署が2つ以上のときだけ名前を併記）。初見ヒントは `okr`・`pj` の0件時の空状態（`FirstStepHint`）へ移した。
- **直接ジャンプは `openSettings(pageId?)` の1つ**（`MainLayout.tsx`。権限の無い・不明な ID は `SettingsView` がトップにする）。
  歯車＝トップ／ベル・ダッシュボードの「通知設定」（`app:open-settings` の detail）＝`notify`／`/?open=admin-errors`＝`errors`／
  `admin-backup`＝`backup`／`admin-sent`＝`messages`／オンボーディングの CTA（`OnboardingHome.onOpenAdmin(page)`）＝`okr`／`pj`（呼び出し元が明示）。
  `/?open=admin-message&mid=…` は設定を開かずお知らせの詳細だけを重ねる（従来どおり）。旧 `initialTab`／`initialSection` は撤去済み。
- **文字サイズ切替（小・中・大）は廃止**（山本さん決定）。代わりに設定画面全体の文字を一回り大きくした（最小12px）。`KEYS.ADMIN_FONT_SIZE`／`ADMIN_LAST_TAB`
  はもう読まない（定数だけ残し、`DISPLAY_SETTING_KEYS` からは外した。過去の保存値がブラウザに残っても無害）。
- **テーマは MainLayout から `theme`/`onToggleTheme` を受け取る。** `useTheme()` は `useState`（呼んだ側ごとの別状態）のため、
  設定で `useTheme()` を呼ぶとサイドバーの表示と食い違う。言語は zustand（`langStore`）なので直接使う。
- **プロフィールの保存は `appStore.saveMember`（choke point・楽観ロック）。** 送る行は `buildProfileUpdate()`
  （`src/lib/settings/profileUpdate.ts`）が「自分の行のコピー＋表示名・短縮名・色（color_bg/color_text）だけ差し替え」で作る。
  initials は表示名から機械的に決める（AdminView MembersSection と同じ規則）。`is_admin`/`is_super_admin`/`group_id`/
  `group_ids`/`email`/`notify_pref` は自分の行の値のまま送る（テストで固定）。
- 🔴 **DB側の権限昇格ガード（2026-10-01 確認）**：`members_write_update` は同部署なら他人の行も UPDATE できるが、
  `guard_member_privilege_columns` トリガー（20260818版・schema.sql と一致）が `is_admin`/`is_super_admin`/`group_id`/
  `group_ids`/`email`/`is_deleted` を一般メンバーからの変更では静かに差し戻す（ブートストラップ猶予を除く）。
  プロフィール画面が権限を送らないのは UI 側の保証であり、DB 側の保証はこのトリガー。表示名・色・通知方法は
  同部署の他人の行でも書き換えられる（権限昇格ではないが改ざんは可能＝既知。v3.137 で他人の行の書き込みはホーム部署の管理者のみに絞った＝Section 70）。

### 保存の見せ方（v3.155・`src/components/common/saveUi.tsx`）

- **基準は「入力の途中状態が生まれるか」**。生まれない（トグル・選択肢・色）→ **即時保存**：成功は操作した欄の横に「✓ 保存しました」を1.5秒
  （`SavedFlash`／`useSavedFlash`）、失敗は値を操作前に戻してトースト。生まれる（文字・数値・日付・複数欄・パスワード）→ **保存ボタン**（`SaveButton`）：
  状態は3つに固定（未変更＝「✓ 保存済み」disabled／変更あり＝「保存」＋左に「未保存の変更があります」／保存中＝「保存中…」cursor wait）。
  成功はトースト1つ、失敗はフォーム直下の永続のエラー帯（`SaveErrorBand`・Section 15・45）で入力は保持。追加フォームの文言は「追加」（`mode="add"`）。
  設定値を持たない操作（削除・取り消し・送信・初期化・バックアップ実行・テスト送信・ログアウト）は「実行」（確認ダイアログまたは結果のトースト）。
- **`useFormSave`**（二重実行の防止・成功トースト・失敗のエラー文）と **`useSnapshotDirty(value, key)`**（key が変わった最初の値を基準にした未変更判定）が
  保存ボタン方式のフォームの定型。管理ページの追加・編集フォーム（Objective・KR・TF・ToDo・PJ・メンバー・部署・タグ・ローディングのヒント）とプロフィール・パスワードが使う。
  単一行入力の Enter と Ctrl/Cmd+Enter で保存（`SaveKeyScope`・`shouldSaveOnKey`。IME 変換確定の Enter は無視・子要素が preventDefault 済みなら何もしない。Section 44 と同じ二段構え）。
- 🚫（`cursor: not-allowed`）は使わない（Section 48）。**機械チェック**：`src/components/settings/__tests__/savePolicy.test.ts`（設定・管理系ファイルに
  `not-allowed`・手書きの「保存」「保存する」「追加する」ボタン・`alertDialog` での保存失敗表示が無いこと）と `minFontSize.test.ts`（12px 未満の `fontSize` が無いこと。許可リストは現在空＝増やさない）。
  どちらもコメント除去のソース走査（Section 59。わざと壊して赤を確認済み）。
- 例外・未適用：管理者の「利用者の画面のエラー」の解決済み切替はトースト1つのまま（切替自体が画面に見える即時操作）。管理ページ内の各セクションの本文の余白は
  文字サイズの引き上げ（10→12、11→12、12→13、13→14）に合わせて広がっただけで、行ごとの余白の再設計はしていない。

### 未保存確認（Section 46 に一本化）

`useUnsavedEditor(isDirty)`（`src/hooks/useUnsavedEditor.ts`）が登録・解除をまとめる。プロフィール・パスワード・AdminView のルート（各セクションの
`onDirtyChange` を受ける `isDirty`）が使う。設定内の遷移（カード→詳細／← 設定）は `SettingsView` の `guardedSwitch`（`PersonalOkrView` と同型）だけを通し、
✕・ナビ・ログアウトは既存の `guardedNavigate`／`handleLogout` が受ける。**設定内の `setPage` は `guardedSwitch` 経由に限る**
（`guardedNavigateCoverage.test.ts` の対象に SettingsView を追加して固定）。文言と安全側の既定（背景クリック＝編集に戻る）は Section 47 のまま。

### 設定画面の残課題（段階3・今回は未着手）

AdminView の `admin/pages/*` への分割（挙動不変）・検索欄・ブラウザの戻る・ガイド記事の全面書き直し。`memberInGroupUsage.test` の走査対象は分割時に同じ変更で更新する
（今は `AdminView.tsx` と `hooks/useAdminScope.ts`）。カードが20枚を超える、または「探せない」という声が出たら検索欄を再評価する。

### 🔴 ルール：個人の設定を足すときはこの設定画面に置く

ユーザーごとの設定（localStorage でも DB の自分の行でも）を新しく足すときは、**機能の画面だけに置かず、
この設定画面の該当ページ（表示／通知の受け取り方）にも入口を置くこと。** 「設定で困ったらここを開けばわかる」が目的のため、
入口が散らばると目的が崩れる。置き場所に迷ったら 🎨表示（見え方）か 🔔通知の受け取り方（知らせ方）に置く。

### 🔴 ルール：「表示の設定を初期化」はホワイトリスト方式。新しい表示設定キーを足したら一覧も更新する

`src/lib/settings/displaySettingsReset.ts` の `DISPLAY_SETTING_KEYS` に**列挙したキーだけ**を消し、再読み込みする。
プレフィックス一致・KEYS 全部のような消し方はしない（Supabase の認証トークン `sb-*` まで消してログアウトさせる等の事故を防ぐ）。

- **消すもの**：サイドバー（幅・折りたたみ・各セクションの開閉・自分のPJのみ・完了/アーカイブも表示）、パネル幅
  （AI相談・OKR AIパネル・タスク詳細サイドパネル `KEYS.TASK_SIDE_PANEL_WIDTH`）、AI相談の次の候補の開閉、
  ガント `GANTT_*` 全9キー、一覧 `list_view_settings`、ダッシュボードの
  リマインダー日数・停滞日数、カレンダー `CAL_*`（管理画面の最後のタブ・文字サイズは v3.155 で廃止したため一覧から外した）。
- **消さないもの**：テーマ・言語（「表示」ページでいつでも切り替えられ、表示崩れの原因にならない。英語利用者の言語を
  初期化で戻すと直後の画面が読めなくなる）、`sb-*`（認証）、AI相談履歴、期限通知の二重防止、チャンクDL承認、
  OKR紹介承認、表示部署（`sidebarCurrentGroup`）、現在のビュー／モード、保留中の招待、エラー履歴、ツアー既読、
  カレンダーのメモ・体制図などの利用者データ。
- **localStorage に表示の好みを保存するキーを新しく足したら、`DISPLAY_SETTING_KEYS` にも足すこと**（足さないと
  初期化しても戻らない＝「困ったとき」が効かない）。逆に、認証・データ・承認の記憶は絶対に足さないこと。
  `src/lib/settings/__tests__/settings.test.ts` が「`sb-*` と保護キーを含まないこと」を検査する。

### やらないこと・既知の小問題

- Web Push の本実装（`docs/dev/web-push-reminder-design.md`）はこの後に行う。設計書の「通知設定モーダル」は
  このページの通知タブに置き換える。
- ~~ツアー既読 `tour_completed_v1` はメンバーIDで分かれていない（同じブラウザの別アカウントで共有）。直さず
  `docs/REFACTORING.md` M47 に記録した。~~ → **v3.138（2026-10-08）で解消。** 下記「ツアー既読のメンバーID別化」参照。
- `MIN_CLIENT_VERSION` は上げていない（DB・RLS・Edge Function・localStorage の形式に非互換な変更は無い）。

### ツアー既読のメンバーID別化（v3.138・2026-10-08・M47）

- キーは `tour_completed_v1:<memberId>`、ゲストは固定の `tour_completed_v1:guest`。判定と移行は `src/components/tour/tourCompletion.ts`（純粋関数。localStorage はテスト環境に無いため、読み書きは引数で受け取る）。`TourProvider` は `memberId` prop（必須）を受け取り、`MainLayout` が `currentUser.id` を渡す。
- **旧キーの移行**：あるメンバーの新キーが無く旧キー `tour_completed_v1` があるときだけ、旧キーの内容をそのメンバーの新キーへ写してから旧キーを削除する（更新後に最初に開いた人だけが引き継ぐ＝自分専用PCの既存利用者に再表示しない／共用PCの2人目以降には初回ツアーが出る）。ゲストは引き継がない（実利用者の既読を奪わないため）。
- **memberId が未確定の間**は既読扱い（自動開始しない）・既読を書かない。localStorage が例外を投げる環境でも既読扱い。
- 「ツアーをやり直す」（本ページ「困ったとき」）は `tour.start()` を呼ぶだけでキーに依存しない。既読はデータ扱いのまま `DISPLAY_SETTING_KEYS` に入れない（`settings.test.ts` の保護キーに新キー2形式を追加）。
- `MIN_CLIENT_VERSION` は上げていない：開いたままの旧画面は旧キーが消えても「未読」と読むだけで壊れない（MainLayout が再マウントされたときに案内がもう一度出る程度）。

---
