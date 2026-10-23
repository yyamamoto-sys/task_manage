## 68. 管理者からのお知らせ配信（v3.131・2026-10-01）

山本さんの要望（2026-10-01）：管理者から部署メンバー（選択可）へ、super_admin からユーザーへ、メッセージを配信したい
（例：全員宛てに「アップデートを実施しました。Ctrl+Shift+R でスーパーリロードを行い、更新を適用してください。」）。
部署の管理者からも、チャットではなくアプリから「いつまでに担当分タスクを確認しなさい」と指示を送れるようにしたい。
Section 66・67 の通知の仕組み（ベル・Web Push・種類のレジストリ）に載せた。**v3.125 の再読み込み通知（MIN_CLIENT_VERSION）とは別物**（あちらは版の自動判定、こちらは人が送る連絡）。

### 送信者と宛先（🔴 範囲は DB の `send_admin_message` が強制する。UI だけで絞らない＝v3.109 の教訓）

| 送信者 | 宛先 |
|---|---|
| super_admin | 全員／部署を指定／個人を選択 |
| 部署の管理者（`members.is_admin`） | 自分の**ホーム部署**（`members.group_id`）のメンバー（全員または選択） |
| 一般メンバー | 送れない |

- 「部署のメンバー」＝ `group_id` がその部署、または `group_ids` にその部署を含む人（兼務で所属する人を含む）。送信者本人・削除済みは含めない。
- `current_member_is_admin()` は部署を区別しない（兼務先でも true）ため使わず、RPC の中で本人の行の `is_admin`・`group_id` を直接読む。送れる部署はホーム部署だけ（兼務先の部署には送れない）。
- 個人を選ぶ場合、範囲外・削除済みの人が**1人でも**含まれていたら全体を拒否する（黙って間引かない）。
- 送信画面の候補は `admin_message_candidates()`（同じ範囲。一般には0行）。プレビューの人数は `resolveRecipients()`（`_shared/adminMessageLogic.ts`。SQL の写し）。

### データ（`migrations/20261001e_admin_messages.sql`）

- `admin_messages`（送信者・送信者名のスナップショット・件名100字・本文2000字・宛先の種類・確認要否・期限・宛先数・Windows通知の送信記録）
- `admin_message_recipients`（message_id・member_id・delivered_at・read_at・acknowledged_at・reminded_at）
- `in_app_notifications.message_id`（お知らせへの参照）と kind `admin_message`（受信者）・`admin_message_ack`（送信者へのまとめ）
- RLS：宛先の表＝本人の行と super_admin、本体＝送信者・super_admin・宛先の本人。**SELECT のみ**（書き込みは全部 RPC）。🔴 宛先の表のポリシーは `admin_messages` を参照しない（本体のポリシーが宛先の表を参照するので、相互参照で無限再帰になる）。送信者が宛先ごとの状況を読むのは `admin_message_status()`。
- RPC：`send_admin_message`／`admin_message_candidates`／`mark_admin_message_read`／`acknowledge_admin_message`／`list_sent_admin_messages`（本人分・super_admin は全件）／`admin_message_status`（送信者と super_admin）／`claim_admin_message_reminders`（service_role のみ）。すべて SECURITY DEFINER・`SET search_path=''`・PUBLIC/anon から REVOKE。
- 乱用対策：1人1時間10通・24時間30通、個人選択は1通100人まで（全員宛て・部署宛ては上限なし）。本文はプレーンテキスト（画面は HTML を解釈しない。`linkifyPlainText` が http(s) の URL だけをリンクにする）。

### 届き方

- **アプリ内は送信と同じトランザクションで全宛先に作る（本人の設定を見ない＝オフにできない）。** レジストリの種類 `admin_message` は `inappLocked: true`。`isKindEnabled(…, "admin_message", "inapp")` は全体スイッチ・個別設定に関わらず true。設定画面ではアプリ内のチェックを固定表示（変更不可）。
- **Windows は本人が選べる**（全体スイッチ `push_enabled` AND 種類 `admin_message` の push）。
- **即時送信の経路＝push-reminders に `mode:"admin_message"` を足した**（新しい Edge Function にしない＝送信・失効処理・CORS・JWT 検証を二重に持たない）。画面は RPC で送信した直後に `{ mode:"admin_message", messageId }` を呼ぶ。Edge Function は JWT から本人を特定し、**そのお知らせの送信者本人でなければ 403**。🔴 宛先はクライアントから受け取らず、`admin_message_recipients` に記録済みの人だけへ送る。`push_dispatched_at` を「空なら今」に更新できたときだけ送る（1通1回）。
- **代行送信**：送信直後の呼び出しが届かなかった（画面を閉じた・通信失敗）お知らせは、cron（平日30分ごと）が作成から2分以上・**5日以内**で `push_dispatched_at` が空のものを代わりに送る（独立レビュー指摘・中。cron は平日 JST 7:00〜19:30 のみのため、24時間窓だと金曜夜の送信を月曜朝が拾えなかった）。
- ベル：📣 の印とオレンジ（warning）の色（🛡 管理者向けの紫とは別）。確認ボタンありで未確認のものは一覧の上に「未確認の指示」として固定表示（最大5件。期限の有無を問わない。指示に期限が無くても見落とさせないため）。行から直接「確認しました」を押せる。行をクリックすると詳細（`AdminMessageDialog`。本文全文・送信者・期限・確認ボタン）が開き、そこで既読になる。クリック先 URL は `/?open=admin-message&mid=<id>`（Windows通知のクリックも同じ）。送信履歴の「既読」＝詳細を開いた（または確認した）こと。ベルの「すべて既読」はベルの行だけを既読にし、宛先の既読には数えない。詳細は画面を切り替えず上に重ねる（guardedNavigate を通さない）。

### 「確認しました」と送信者へのまとめ通知

- 送信者がお知らせごとに付ける／付けないを選ぶ。付けたときだけ期限（任意）を付けられる（CHECK 制約と RPC の両方）。
- `acknowledge_admin_message` は本人の行の `acknowledged_at` が空のときだけ更新する（2回目は何もせず最初の日時を返し、送信者へも通知しない）。🔴 存在しない `message_id`・自分が宛先でない・`requires_ack=false`（確認不要）の3通りは同じ文言「お知らせが見つからないか、確認は不要です」を返す（独立レビュー指摘・軽。任意の id の存在や requires_ack を推測できないようにする。本人の宛先行の有無を先に見てから本体を読む）。
- 🔴 **送信者へのまとめ通知は「送信者×お知らせ」で1行**（部分一意インデックス `uq_in_app_notifications_ack_summary` ＋ `ON CONFLICT … DO UPDATE`）。確認が増えるたびに同じ行の文面を差し替える（「『◯◯』を5人が確認しました」「残り2人（宛先7人）」／全員そろえば「全員（7人）が確認しました」）。
  **未読に戻す（ベルに再び出す）のは「まだ未読のまま」「全員が確認した」「前回ベルに出してから1時間以上たった」のどれかのときだけ**（確認1件ごとに未読バッジが点くのを避ける）。それ以外は文面だけ更新して既読のまま。文面と規則は `buildAckSummary`／`shouldResurfaceAckNotice`（TS）と SQL の両方にあり、テストが照合する。クリック先は送信履歴（`/?open=admin-sent`）。
- 送信履歴（設定 → 部署の管理 → 連絡 →「📣 お知らせを送る」の下）：既読・確認の件数、開くと宛先ごとの既読・確認・再通知の日時。
- **v3.135（v3.133 の再適用）：ベルの「📣 送信済み」タブ**（送れる人＝部署の管理者・super_admin だけ）：自分が送ったお知らせ（`list_sent_admin_messages` を `ownSentMessages()` で送信者＝自分に絞る。super_admin も既定は自分の分のみで、全件は下部のリンクから設定の送信履歴へ）の件名・送信日時・宛先数・既読数・確認数・期限。選ぶと `admin_message_status` で宛先ごとに「確認済み／既読・未確認／既読／未読」。送信の成功直後に `requestBellRefresh()` で取り直す。

### 期限前日の再通知

- 期限つき・確認ボタンありのお知らせを、**期限の「直前の平日」**（期限当日より前で土日・祝日でない最も近い日。期限が月曜なら金曜、前日が祝日ならその前の平日）の朝に、未確認の人にだけ再通知する。🔴「前日が休日なら直前の平日」に倒した（休日に送っても見られず、期限当日の朝では遅いため）。
- push-reminders の cron の中で、休日スキップの**後**に判定する（平日だけ）。7:00 の最初の実行が拾う＝朝。判定は `shouldRemindToday`（JST・`japanese-holidays` は既存の `isHolidayJst`）：今日が再通知日以降かつ期限当日より前、かつ再通知日より前に送ったお知らせだけ（再通知日当日以降に送ったものは届いたばかりなので送らない）。cron が再通知日に丸1日止まっても期限前の平日なら翌日に送る。
- **1人1回**は `claim_admin_message_reminders` が `reminded_at` で確定する（未確認・未再通知の人だけ）。アプリ内は必ず作り、Windows は本人の設定どおり。期限リマインドの1人1日1回（reminder_send_log）とは別枠。失敗は `reminder_runs` を partial にして `error_summary` に残す。

### 送信画面（設定 → 部署の管理 → 連絡 →「📣 お知らせを送る」・`AdminMessageSection.tsx`）

部署の管理者と super_admin に出す（管理者不在のブートストラップ状態の一般メンバーには出さない）。件名・本文（文字数カウンタ）・宛先（super_admin：全員／部署を指定／メンバーを選ぶ、部署の管理者：部署の全員／メンバーを選ぶ）・確認ボタンの有無・期限・プレビュー（受け取る人の見え方と宛先の名前）・確認ダイアログ（`confirmDialog` tone neutral）。入力途中は `onDirtyChange` でタブ切替の警告に乗る。

### 適用の順序（🔴 逆にするとベルが「読み込めません」になる＝一覧の select が message_id を含むため）

1. マイグレ `20261001e_admin_messages.sql`（dev → prod）
2. `supabase functions deploy push-reminders --no-verify-jwt --project-ref <ref>`（即時送信・代行送信・期限前日の再通知）
3. フロントを main へ（Vercel が再ビルド）

pg_cron の追加は不要（既存の push-reminders の cron に乗る）。

### MIN_CLIENT_VERSION を上げない理由（Section 63）

テーブル・列の追加と CHECK 制約の拡張だけで、旧画面の読み書き・Edge Function の既存の入出力は壊れない。旧画面のベルにもお知らせは普通の行として出る（件名と本文の先頭200字）。旧画面からは「確認しました」を押せないが、再読み込みすれば押せる（不具合ではなく機能の未到達）。

### やらないこと

- お知らせの取り消し・編集・削除（送信後は変えない。誤送信は追って訂正のお知らせを送る）。
- Teams への転送・メール送信。
- 送信者へのまとめ通知の Windows 通知（アプリ内のみ）。

### 独立レビュー対応（`feat/admin-messages` ブランチ・2026-10-02・DB未適用・バージョンは v3.131 のまま）

指摘5件を反映。

- **【中】代行送信の対象窓を24時間→5日**：`push-reminders/index.ts` の `ADMIN_MESSAGE_BACKLOG_WINDOW_MS`。cron は平日 JST 7:00〜19:30 のみのため、24時間窓だと金曜夜の送信を月曜朝（72時間以上経過）が拾えなかった。`push_dispatched_at IS NULL` の1通1回保証は変えていない。
- **【中】送信頻度チェックの前にアドバイザリロック**：`send_admin_message` に `pg_advisory_xact_lock(hashtext('admin_msg:' || v_member::text))` を追加（件数の読み取りと判定の前）。同じ人が同時に複数リクエストを送っても「1時間10通」を超えない。
- **【軽】`acknowledge_admin_message` の情報漏れを解消**：本人の宛先行（`admin_message_recipients`）の有無を先に確認し、存在しない `message_id`・自分が宛先でない・`requires_ack=false` のすべてを同じ文言「お知らせが見つからないか、確認は不要です」で返す。他の RPC（`mark_admin_message_read` 等）は例外を投げず件数・空行を返すだけで同種の漏れは無いことを確認済み。
- **【軽】即時送信を `allowRate`（1分6回）から除外**：`mode:"admin_message"` は送信 RPC 側で1時間10通・24時間30通に制限済みのため、`push-reminders` のテスト送信・手動実行向けの連打防止からは外した。
- **【軽】`dispatchAdminMessagePush` の `push_succeeded` 更新エラーを記録**：無視せず `console.error` に出し、送信記録（`failure`）にも残す。送信自体は既存の `sendPushToMembers`（`_shared/concurrencyPool.ts`・同時10件）で並列化済みだったため変更なし。

検証：`npx tsc --noEmit`・`npx vitest run`（198ファイル・2407件）・変更ファイルの eslint・`npm run build`。5日窓・`allowRate` 除外・`acknowledge_admin_message` の文言統一の3点は、修正前のコード（`git show HEAD:<path>`）だと追加したテストが赤くなることを確認済み。

### 送信者本人も宛先に選べるようにする（v3.132・2026-10-02）

山本さん（super_admin）が自分宛てに試しに送ろうとしたところ、宛先の候補に自分の名前が無かった。`admin_message_candidates` が候補一覧から本人を除外し、`send_admin_message` も 'all'／'group'／'members' のどの宛先でも本人を取り除いていたため。

- **マイグレ `20261002_admin_messages_allow_self.sql`**：両 RPC を `CREATE OR REPLACE` で差し替え、`m.id <> v_member` / `x <> v_member`（本人除外）を外しただけ。関数本体は 20261001e（独立レビュー反映後）をそのままコピーしており、それ以外の行は1文字も変えていない：部署の管理者はホーム部署のみ・全員宛ては super_admin のみ・個人選択は範囲外または削除済みが1人でもいれば全体拒否・送信頻度の advisory lock（`pg_advisory_xact_lock`）・件名100字／本文2000字の検査・SECURITY DEFINER／`search_path=''`／REVOKE・GRANT はすべて無改修。**削除済みメンバーは引き続き宛先に含めない**（除外したのは本人除外だけ）。`schema.sql` を同期。末尾に `pg_get_functiondef()` で advisory lock・範囲検査の文言が残っていること、本人除外の文言が無いことを確かめる確認クエリを付けた。
- **`supabase/functions/_shared/adminMessageLogic.ts` の `resolveRecipients`（画面プレビュー用の写し）も同様に本人除外を外した。** RPC と同じ範囲になるよう揃えた（プレビューと実際の送信結果が食い違わないようにするため）。
- **画面（`AdminMessageSection.tsx`）**：候補一覧・プレビューの宛先名に自分だけ「（自分）」を付けて表示する。「全員」「部署全員」の説明文に「自分も宛先に含まれます」を明記した（RPC 側の展開と揃える。UI 側で個別に除外し直すことはしない）。
- **送信者へのまとめ通知（確認ボタンあり・自分宛てに送って自分で「確認しました」を押す場合）**：追加の実装は不要だった。`acknowledge_admin_message` は sender_id・member_id のどちらが誰であっても同じ処理（本人の宛先行を更新→`admin_message_ack` を「送信者×お知らせ」の1行へ upsert）であり、sender_id = member_id（自分自身）でも通常どおり1行に収まることをコードレビューで確認済み。
- **テスト**：`src/lib/adminMessages/__tests__/adminMessageLogic.test.ts`（TS の `resolveRecipients`。本人を含む宛先の期待値に更新＋本人1人だけを選ぶケースを追加）・`adminMessageMigration.test.ts`（`SEND`/`CANDIDATES` の参照元を 20261002 に切替。本人除外の不在・既存の範囲検査/advisory lockが残っていること・schema.sql 同期・新マイグレのBEGIN/COMMIT と確認クエリの存在を検証）。
- **MIN_CLIENT_VERSION は上げていない**（旧画面は単に自分を宛先候補として選べないだけで、読み書き自体は壊れない）。

---
