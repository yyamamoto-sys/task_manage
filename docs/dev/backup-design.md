# 日次バックアップ設計書（部署別スナップショット）

最終更新：2026-09-16 rev4（プラン＝Free 確定・二次保管は部署共有ライブラリで確定。実装未着手）
関連：[runbook.md](./runbook.md)（障害対応）／[data-model.md](./data-model.md)（テーブル定義）／`supabase/schema.sql`

> この文書は「何を・どこに・どれだけ・どう戻すか」の正本である。
> 実装前に本設計を確定させ、実装後は本文書と実物の差分が出た時点でこちらを直す。

---

## 0. 決定事項

| 論点 | 決定 | 決定日 |
|---|---|---|
| **本番 Supabase のプラン** | **Free（個人無料プラン）。自動バックアップ・PITR は存在しない** | 09-16 rev3 |
| バックアップ単位 | 1回の実行で「全体」と「部署別」の両方を出力する | 09-16 |
| スナップショットの取り方 | **DB 側の SQL 関数が範囲を絞った jsonb を返し、Edge Function はそれをそのまま保存する**（CPU を使わない） | 09-16 rev3 |
| 圧縮 | **初期実装では圧縮しない**（Edge Function の CPU 時間上限2秒を使い切らないため） | 09-16 rev3 |
| 実行頻度（一次） | 日次（JST 3:00）＋管理画面からの手動実行 | 09-16 rev2 |
| 保管先（一次） | Supabase Storage のプライベートバケット | 09-16 |
| 保管先（二次） | **部署の共有ライブラリ（SharePoint／Teams）へ日次**（管理者PCのタスクスケジューラ）。**具体的なサイト・ライブラリ・フォルダは未定**（§7） | 09-16 rev4 |
| 個人データ（personal_kr_* 等） | 部署別ファイルにも含める（ホーム部署で仕分け） | 09-16 |
| 復元 | Phase 1 では自動リストアを作らない。ダウンロード＋手順書まで | 09-16 |
| 保持 | 日次14／週次8／月次12／四半期8（GFS方式・世代数で管理） | 09-16 |
| 保持状態の管理 | Storage のメタデータではなく DB の `backup_objects` 表で管理し、削除も Edge Function が Storage API で行う | 09-16 rev2 |

### rev4 での変更（二次保管先の方針決定を受けて）

| # | 決定・変更 |
|---|---|
| 1 | 二次保管先は**部署の共有ライブラリ**で確定。個人 OneDrive 案は破棄（原則①を満たさないため）。**具体的なサイト・ライブラリ・フォルダ名は未定**で、後日決める |
| 2 | 置き場所が未定でも実装を止めないよう、**保存先パスをスクリプトに直書きせず設定値として外出し**する構成にした（§7） |
| 3 | **実装フェーズを「保存先に依存しない部分（1〜4）」と「依存する部分（5）」に分離**した。フェーズ1〜4は置き場所の決定を待たずに着手できる（§12） |
| 4 | SharePoint 固有の注意（同期遅延・バージョン履歴・ごみ箱・パス長・アクセス権）を §7 に追加。**「ローカルに保存できた」は「組織側に届いた」を意味しない** |

### rev3 での変更（プラン確定を受けた設計変更）

| # | 何が分かったか | 設計への影響 |
|---|---|---|
| 1 | **Free に自動バックアップ・PITR は無い**（一次確認済み） | 本設計が**唯一のバックアップ**になる。`runbook.md` の「PITR は Pro 以上で可能」は本番では使えない手段であり、訂正が必要（§12 フェーズ0） |
| 2 | **Edge Functions の CPU 時間上限は2秒**（wall clock は Free 150秒） | **圧縮をやめ、仕分けも DB 側へ寄せた。** Edge Function は「RPC の結果をそのまま Storage へ put する」だけにして CPU をほぼ使わない（§3） |
| 3 | **Pause 中に Storage / Edge Functions が使えるかは一次ソースで確認できず** | 一次保管ごと取り出せなくなる可能性を織り込み、**二次保管を週次→日次へ変更**（§7） |
| 4 | Free の pause 条件＝**7日間のDBアクティビティ不足**。1日数回のリクエストで回避可 | 日次バックアップ自体が pause 防止として働く可能性がある（§2.1・ただし保証はしない） |
| 5 | Free は**組織あたりアクティブ2プロジェクト**。dev と prod で上限に達している | 復元訓練用に3つ目を作れない。**dev の別スキーマへ復元する**方式に変更（§9） |
| 6 | 保管先の実測：**OneDrive のルートが3つあり、生きているのは末尾に全角スペースが付いた1つだけ**。SharePoint 共有ライブラリは未同期 | 保存先をパス文字列だけで指定しない。**マーカーファイル検証**を必須にした（§7） |

### rev2 での変更（初版のセルフレビュー）

| # | 初版の問題 | 修正 |
|---|---|---|
| 1 | Edge Function が PostgREST 経由で表ごとに SELECT。**既定1000行上限で黙って欠落する** | DB 側 SQL 関数で全件を jsonb 化（rev3 でさらに仕分けも DB 側へ） |
| 2 | 40回の SELECT が別トランザクション。親を読んだ後の子行が孤児になる | `REPEATABLE READ` の1トランザクション |
| 3 | 保持管理を Storage メタデータで行い、pg_cron の SQL で削除。**`storage.objects` を SQL で消しても実体は残る** | `backup_objects` 表で管理、Storage API で削除 |
| 4 | 二次保管の PC→サーバー報告経路が無く、監視が成立していなかった | `backup-export-ack` と `backup_exports` 表 |
| 5 | 復元手順に FK 順序・トリガー・スキーマ差分の扱いが無い | §9 に技術的注意の表を追加 |
| 6 | 四半期昇格の基準日が月次とずれていた | 1/4/7/10月1日の月次を昇格 |
| 7 | `grp-invite-*`（PJ招待用の合成部署）にも部署別ファイルを作っていた | スキップ |
| 8 | Storage への RLS と Edge Function 経由が二重 | クライアントからの Storage 直接アクセスは全面拒否 |
| 9 | 二次保管先を「OneDrive」とだけ書いた。**個人 OneDrive は退職でアカウントごと消える** | 共有ライブラリを推奨 |
| 10 | `tasks: 812` は根拠のない数字（実測328） | 実測値に差し替え |
| 11 | 整合性検証が無く、転送先での破損に気づけない | sha256 を保持・照合 |
| 12 | 手動実行が無い | super-admin JWT による手動起動を追加 |

---

## 1. 背景と要件

### なぜ必要か

本番 Supabase は **Free プラン**であり、**Supabase 側に自動バックアップも PITR も存在しない**（§2.1）。現在このアプリのデータは、**どこにも複製が無い状態で運用されている**。`runbook.md` の「データ誤削除・破損」節は「Supabase の Backups を確認」「PITR は Pro 以上のプランで可能」と書いているが、**本番では実行できない手順**である。

部署外展開（P2フェーズ）にあたり IT 部門から提示された条件のうち、**障害対応（連絡先・代替手段・復旧手順）**に直接該当する。

### 内製アプリ8原則との対応

| 原則 | 本設計がどう応えるか |
|---|---|
| ① 取り戻せる | データが管理者個人の環境・個人アカウントに依存せず、**組織が管理する場所（共有ライブラリ）**に日次で置かれる |
| ④ 止まっても止まらない | 誤削除・破損からの復旧手段が、作成者の記憶ではなく手順書として存在する |
| ⑦ 閉じていない | 部署別 JSON はそのまま「データの持ち出し」に使える。他ツールへの移行・廃止時にデータが人質にならない |

🔴 **本番 Supabase が個人アカウント保有の Free プロジェクトである以上、一次保管（Storage）は原則①を満たさない。原則①を担うのは二次保管（§7）である。二次保管は「予備」ではなく「組織側の正本」と位置づける。**

### 要件

1. 部署（`groups`）単位で、その部署の登録データだけを取り出せること
2. DB 全体が失われた場合にも復旧の起点があること
3. 実行の成否が人に見えること（**静かに失敗しないこと**）
4. 復元の手順が、作成者以外にも実行できる形で残っていること
5. 行数が増えても欠落しないこと
6. **Supabase プロジェクトごと使えなくなっても、組織側にデータが残っていること**（rev3 追加）

---

## 2. 現状（As-Is）

| 項目 | 実測（2026-09-16） |
|---|---|
| 本番 Supabase | プロジェクト `fyturlzvbtlnxpjhxyjz`（Sydney リージョン・**個人アカウント保有・Free プラン**） |
| データ規模 | **合計約1,921行（2026-09-16・本番で `backup_snapshot` により実測）。** 最大は `tasks` **928行**、次いで `ai_usage_logs` 706行、`task_forces` 34行、`todos` 32行。参考：2026-07-10のダンプでは `tasks` 328行・全体420KB |
| 部署の構成（本番・2026-09-16） | 4件。`grp-egg`（EGG）に業務データが集中（tasks 928 / projects 11 / ホームメンバー17）。`grp-1784716065248`（AID）はホームメンバー2・業務データ0。`grp-1782456952369`（"a"）は完全に空。残り1件は招待用部署（羅針盤フォーラム） |
| テーブル数 | 40 |
| 既存の定期実行 | pg_cron + pg_net が稼働中（`notify-deadlines-daily` UTC 23:30／`cleanup-admin-change-logs` UTC 03:00）。**Free プランでの利用可否は公式ドキュメントに明記が無いが、本番で現に稼働している（実機で実証済み）** |
| Edge Function | `ai-consult` / `notify-deadlines` の2本。`x-cron-secret` ヘッダ検証の型が確立済み |
| Storage 利用 | `admin-templates` バケットを管理画面が使用。クライアント側はゲストの storage アクセスを `client.ts` でブロック済み |
| バックアップ | **無し（Supabase 側の自動バックアップも無い）** |

### 🔴 1000行問題は「将来の懸念」ではなく、あと72行に迫っていた（2026-09-16 実測）

初版（rev1）は Edge Function が supabase-js で表ごとに `select()` する設計だったが、**PostgREST の既定上限は1000行**である。本番の `tasks` は **928行**で、上限まで残り72行しかなかった。2か月前（2026-07-10 時点で328行）から3倍近く増えているペースを踏まえると、**数週間から数か月で必ず踏んでいた**。

しかもこの欠落は**静かに起きる**：`row_counts` には1000と記録され、バックアップは「成功」として完了し、Teams 通知も出ない。**気づく手段が無いまま、1000行だけのバックアップが毎日積み上がる**ことになっていた。`ai_usage_logs`（706行）も同じ危険圏にある。

rev2 で DB 側関数に切り替えた判断は、この実測で裏付けられた。**取得方法を PostgREST 経由（supabase-js の `select()`）に戻してはならない。**

### 2.1 Free プランの制約と、本設計への影響

2026-09-16 に一次ソース（supabase.com/pricing・docs・terms）で確認した値。

| 項目 | Free の値 | 本設計への影響 |
|---|---|---|
| 日次自動バックアップ | **無し**（Pro は7日保持） | 本設計が唯一のバックアップ |
| PITR | **無し**（Pro 以上のアドオン。7日保持で月額約$100） | 「何時点へでも戻す」は不可能。**戻せるのは日次スナップショットの時点のみ** |
| プロジェクト一時停止 | **7日間のDBアクティビティ不足で pause**。1日数回のリクエストで回避可 | 日次バックアップが回避に寄与する可能性はあるが、**保証はしない**（下記） |
| pause からの復旧 | ダッシュボードから Resume。**停止後1年間は復元可能**、データ・設定は保持される | 1年以内なら pause 自体でデータは失われない |
| pause 1年超過後 | Resume が「停止直前の論理バックアップ＋全 Storage オブジェクトのダウンロード」に置き換わる | プロジェクトとしては復旧不可。ファイルの取り出しは可能 |
| **pause 中の Storage / Edge Functions** | **一次ソースに明記なし＝未確認** | **保守側に倒す。** 一次保管ごと取り出せない可能性を前提に、二次保管を日次にする |
| DB 容量 | 500MB | 現状 420KB。余裕あり |
| Storage 容量 | 1GB | 本設計の使用量は §6 で約40MB |
| Egress（転送量） | 5GB/月 | 二次保管の日次取得で月40MB程度。余裕あり |
| 組織あたりアクティブプロジェクト | **2**（停止中はカウントされない） | dev + prod で**上限に到達済み**。訓練用の3つ目を作れない（§9） |
| Edge Functions 呼び出し | 500,000回/月 | 日次＋手動で問題なし |
| Edge Functions wall clock | 150秒（有料は400秒） | 余裕あり |
| **Edge Functions CPU 時間** | **最大2秒**（プラン別の書き分けは公式に無し） | 🔴 **設計を規定する最大の制約。**§3 の構成はこれに合わせている |
| Edge Functions メモリ | 256MB | 1回の RPC 結果を持つだけなので問題なし |
| 商用利用 | 規約上、Free 限定の商用利用禁止条項は**無い**。ただし明示的な許可文言も無い | IT 部門への説明では「禁止されてはいないが、明示的に許可されてもいない」と正確に伝える |

**pause 防止について：** pause 判定は「DBアクティビティ」に基づく。日次の pg_cron → `net.http_post` → Edge Function → DB 書き込みという連鎖はアクティビティとして計上される見込みだが、**公式に保証された回避手段ではない**。アプリが平日に日常利用されていることが主たる回避要因であり、バックアップはその副次効果として期待するにとどめる。

**上限超過時の挙動（読み取り専用化か停止か）は一次ソースで確認できなかった。** 容量には十分な余裕があるため実害の想定は低いが、`backup_runs.bytes_written` の推移で監視する。

---

## 3. アーキテクチャ

**設計の中心にあるのは「Edge Function に仕事をさせない」こと。** CPU 時間上限が2秒しかないため、JSON の組み立て・仕分け・圧縮といった CPU を使う処理はすべて Postgres 側に置く。Edge Function は RPC の結果を受け取って Storage に置くだけの薄い層にする。

```
pg_cron  'backup-daily'  UTC 18:00（= JST 翌3:00）
   │
   └─ net.http_post → Edge Function `backup-daily`
         ├─ 認証：x-cron-secret（BACKUP_CRON_SECRET）
         │        または super-admin の JWT（管理画面からの手動実行）
         ├─ 接続：SUPABASE_SERVICE_ROLE_KEY
         │
         ├─ [1] rpc('backup_begin')          → run_id と対象部署リストを受け取る
         ├─ [2] rpc('backup_snapshot', {scope:'full'})
         │        → Storage へ put（受け取った本文を加工せずそのまま）
         ├─ [3] 部署ごとにループ（1部署 = 1 RPC = 1 put）
         │        rpc('backup_snapshot', {scope:'group', group_id:'grp-egg'})
         │        → Storage へ put
         │        ※ 1部署が失敗しても他は続行し、status='partial' にする
         ├─ [4] rpc('backup_finalize', {run_id})
         │        → 保持ポリシー評価・削除対象パス一覧を受け取る
         ├─ [5] 削除対象を Storage API で remove し、
         │        🔴 成功したものは backup_objects.deleted_at を now() で更新する
         └─ [6] failed / partial のとき Teams 通知（§8）
```

### 3.1 DB 側関数

いずれも `SECURITY DEFINER`。`EXECUTE` は `public` / `anon` / `authenticated` から REVOKE し、service_role のみに許可する。

| 関数 | 役割 |
|---|---|
| `backup_begin(p_trigger DEFAULT 'cron', p_triggered_by DEFAULT NULL)` | `backup_runs` に running の行を作り、`run_id` と対象部署リスト（`is_invite_group = true` を除く）を返す |
| `backup_snapshot(p_scope, p_group_id, p_run_id)` | **本体。** 全表を**1つの SQL 文で**読み、scope に応じて絞り込んだ jsonb を1個返す。同時に行数・孤児件数を `backup_runs` に記録する（full 呼び出し時） |
| `backup_finalize(p_run_id, p_status DEFAULT 'success', p_error_message DEFAULT NULL)` | 実行結果を確定し、保持ポリシー（§6）を評価して削除すべきオブジェクトのパス一覧を返す |

`trigger` / `status` / `error_message` は DB 内では決定できず Edge Function 側の情報が要るため、引数で受け取る（デフォルト付きなので引数なしでも呼べる）。

🔴 **REPEATABLE READ は使えない（2026-09-16・dev で実測して確定）**

フェーズ1の実装者がリスクとして申告していた `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` は、dev での初回実行で実際に失敗した：

```
ERROR: 25001: SET TRANSACTION ISOLATION LEVEL must be called before any query
CONTEXT: PL/pgSQL function public.backup_snapshot(...) line 24 at EXECUTE
```

**Supabase SQL Editor も PostgREST 経由の RPC も、既にトランザクションを開始した状態でこの関数を呼ぶ**ため、関数の中から分離レベルを変更できない。関数の外から指定する手段も無い（PostgREST が各リクエストのトランザクションを自ら開始するため、呼び出し側から介入できない）。該当行は削除した。

**削除しても整合性は保たれる。** PostgreSQL は READ COMMITTED でも「1つの SQL 文」は文の開始時点の単一スナップショットを文全体で使う。full・group とも、テーブル群の取得を1文にまとめてあるため、その1文の中では全テーブルが同じ時点を見る。申告どおりフォールバックが機能した。

🔴 **この前提を壊さないこと**：テーブル群の取得を複数の SQL 文に分割すると、文と文の間で他トランザクションのコミットが見えるようになり、整合性が崩れる。分割が必要になったら（データ量が育って1文では重すぎる等）、**分離レベルではなく別の手段**（Storage へ順次書き出す設計への変更等）で整合性を確保すること。

`backup_snapshot` の要件：

- テーブル一覧は**ハードコードせず** `information_schema.tables WHERE table_schema='public'` から取り、除外リスト（`backup_runs` / `backup_objects` / `backup_exports` 自身）だけを持つ。新テーブルが追加されたとき黙って漏れないため
- `scope='full'` のとき、`information_schema.columns` 由来のスキーマ情報を `schema` キーに同梱する（§9 の復元で使う）
- `scope='group'` のとき、§4 の層A・層B の解決を CTE で行う。層C は含めない
- 返す jsonb は**そのまま保存できる完成形**にする。Edge Function 側でキーを足したり並べ替えたりしない

### 3.2 Edge Function 側の実装契約（フェーズ2で確定）

| 論点 | 決定 | 理由 |
|---|---|---|
| `backup_snapshot` の呼び方 | 🔴 **`supabase.rpc()` を使わず、PostgREST の `/rest/v1/rpc/backup_snapshot` へ直接 `fetch()` し、`res.text()` で文字列のまま受け取る**（`callRpcRaw()`） | `supabase.rpc()` は内部で `response.json()` を呼んで JS オブジェクトへパースするため、Storage へ書くときに `JSON.stringify()` が再び必要になる。**CPU 2秒の制約下で往復のパースを強いられる**ため避ける。受け取った文字列は一度も `JSON.parse` せず、そのまま put する |
| `backup_begin` / `backup_finalize` の呼び方 | 通常どおり `supabase.rpc()` | 戻り値が小さい構造化データ（run_id・部署配列・削除パス配列）で、パースのコストが問題にならない |
| `backup_objects.taken_at` | **この実行の開始時刻を1つ取り、全スナップショットで共通に使う** | JSON 内の `meta.taken_at`（DB 側の `now()`）を読むには本文をパースする必要があり、上記の方針に反する。⚠ **両者は数秒ずれる。** 実行が JST 3:00 で日付境界から3時間離れているため、§6の昇格判定（JSTの曜日・日付で判定）には影響しない。**実行時刻を 0:00 付近へ変更する場合はこの前提が崩れる** |
| `backup_objects.path` | `backups/full/YYYY-MM-DD.json` のように**バケット名を含む**表記で保存する。Storage API に渡すキーは `backups/` を除いた相対パス（`toStorageKey()` で変換を一本化） | 表の定義コメントに合わせた。2つの表現が混在するため、変換は必ず1関数を通す |
| **sha256 が2種類ある** | `meta.sha256`＝**tables 部だけ**のハッシュ（DB 側が計算）／`backup_objects.sha256`＝**ファイル全体**のハッシュ（Edge Function が計算） | §7の二次保管でダウンロードしたファイルと照合するには、ファイル本体のハッシュが要る。混同しないこと |
| ファイル名の日付 | 🔴 **JST 基準**（`jstDateStr()` が +9時間してから日付を取る） | pg_cron は UTC 18:00＝**JST 翌3:00** に動く。UTC 基準にすると「JST 9/17 のバックアップ」が `2026-09-16.json` になり、§6の昇格判定（JST基準）ともズレる。**両方を JST に揃えてある** |
| 🔴 `verify_jwt` | **`false` でデプロイする**（`supabase functions deploy backup-daily --no-verify-jwt`） | pg_cron からは `Authorization` ヘッダなしで呼ばれるため、Supabase 側の JWT 検証が有効だと **401 で必ず失敗する**（2026-09-17に実際に発生）。既存の `notify-deadlines` も `verify_jwt: false`。代わりに `x-cron-secret` を関数内で検証して守る。**このプロジェクトには `supabase/config.toml` が無いため設定で固定できず、デプロイのたびに `--no-verify-jwt` を付ける必要がある**（付け忘れると `true` に戻る）。`supabase functions list` で確認できる |

### 設計判断：なぜこの構成か

| 案 | 採否 | 理由 |
|---|---|---|
| Supabase マネージドバックアップ | **選べない** | Free には存在しない。Pro 化すれば併用できるが、Pro でも**部署単位の抽出はできない**ので本設計は不要にならない |
| GitHub Actions から `pg_dump` | 不採用 | 全体ダンプは作れるが部署別にならない。CI に DB 接続情報を置く必要がある。業務データを社外サービスに置く判断も要る |
| Edge Function が PostgREST で表ごとに SELECT（初版） | 不採用 | 1000行上限で黙って欠落する。トランザクション整合性も無い |
| Edge Function が全件を受け取って仕分け・圧縮（rev2） | 不採用 | **CPU 2秒**を使い切るリスク。データが増えるほど危険 |
| **DB 関数が絞り込み済み jsonb を返し、Edge Function は put するだけ** | **採用** | CPU をほぼ使わない。行数上限が無い。1部署の失敗が他に波及しない |

---

## 4. 部署の解決ルール

`group_id` を直接持つテーブルは40本中13本しかない。残りは親を辿って部署を決める。**この表が `backup_snapshot` の実装仕様そのものである。**

### 層A：`group_id` / `group_ids` を直接持つ

| テーブル | 使う列 | 備考 |
|---|---|---|
| `members` | `group_ids`（兼務含む） | 兼務メンバーは複数の部署ファイルに入る |
| `objectives` | `group_id` | |
| `key_results` | `group_id` | トリガー `sync_kr_group_id` が親から自動注入 |
| `quarterly_objectives` | `group_id` | |
| `task_forces` | `group_id` | トリガー `sync_tf_group_id` |
| `todos` | `group_id` | トリガー `sync_todo_group_id` |
| `projects` | `group_ids` | 複数部署アクセス対応 |
| `tasks` | `group_ids` | トリガー `sync_task_group_ids` が唯一の真実 |
| `task_dependencies` | `group_id`（NOT NULL） | |
| `kr_quarter_plans` | `group_id` | |
| `project_invites` | `invite_group_id` | |
| `groups` | `id` | 自分自身の1行を部署別ファイルにも入れる |

### 層B：親を辿って解決する

| テーブル | 親 | 解決キー |
|---|---|---|
| **`personal_krs`** | `members` | `member_id` → **ホーム部署 `group_id`**（下記🔴参照） |
| `personal_kr_months` / `_weeks` / `_memos` / `_outlooks` / `_review_drafts` | `personal_krs` | `personal_kr_id` |
| `personal_kr_week_tasks` | `personal_kr_weeks` | `week_id` |
| `personal_period_reviews` | `members` | `member_id` → **ホーム部署 `group_id`** |
| `member_widget_layouts` | `members` | `member_id` → **ホーム部署 `group_id`** |
| `kr_sessions` / `kr_meeting_notes` / `okr_analyses` / `kr_reports` | `key_results` | `kr_id`（`okr_analyses` は `objective_id` も見る） |
| `kr_declarations` | `kr_sessions` | `session_id` |
| `kr_note_tf_entries` | `kr_meeting_notes` | `note_id` |
| `milestones` / `project_analyses` | `projects` | `project_id` |
| `task_task_forces` / `task_projects` | `tasks` | `task_id` |
| `project_task_forces` | `projects` | `project_id` |
| `quarterly_kr_task_forces` | `quarterly_objectives` | `quarterly_objective_id` |
| `member_tag_members` | `members` | `member_id` → ホーム部署 |

### 層C：部署に属さない（全体ダンプにのみ含める）

`loading_tips`（全社共通）／`admin_change_logs`／`ai_usage_logs`／`guest_ai_usage_daily`／`guest_ai_usage_global_daily`／`member_tags`

### 対象とする部署

`groups` の全行のうち、**招待用の合成部署は部署別ファイルを作らない。** 招待で共有されたPJとタスクは `group_ids` に招待元の実部署も持つため、実部署のファイルに含まれる。招待用部署の行そのものは全体ダンプに残る。

**判定は `groups.is_invite_group = true` で行う**（`schema.sql:58`。ID が `grp-invite-` で始まるかどうかの文字列判定ではなく、実在する列を使う。命名規則が変わっても壊れないため）。

### 🔴 個人データの仕分けは「ホーム部署」を使う（`personal_krs` を含む）

`personal_krs` / `personal_kr_*` / `personal_period_reviews` / `member_widget_layouts` / `member_tag_members` は、**`members.group_ids`（兼務含む）ではなく `members.group_id`（ホーム部署）で仕分ける。**

理由：個人OKR と期末振り返りは**人事評価に直結する情報**であり、兼務先の部署管理者がダウンロードできる状態にしてはならない。

🔴 **`personal_krs` は `group_id`（NOT NULL）を持つが、仕分けには使わない**（2026-09-16・本番の実データで確認して是正）。この列は「そのKRが参照するグループKRの部署」を表すもので、**データの所有者を表さない**。実際、本番では次のように分裂していた：

| データ | `group_id` 基準だと | ホーム部署基準だと |
|---|---|---|
| `personal_krs` 7件 | AID | ← 所有者のホーム部署 |
| `personal_period_reviews` 2件 | （列を持たない） | grp-egg |

`personal_krs` だけを `group_id` で仕分けると、**同じ人の個人OKRが「KR本体は A部署のファイル」「期末振り返りは B部署のファイル」に分裂し、どちらの部署ファイルからも個人OKRを復元できない**状態になる。所有者（`member_id`）のホーム部署に統一することで、その人の個人データ一式が必ず1つのファイルに揃う。

`group_id` 列の値そのものはスナップショットにそのまま保存されるため、復元後のデータは変わらない（仕分けはあくまで「どのファイルに入れるか」の話）。

業務データ（`tasks` / `projects`）は逆に `group_ids` を使う。共有プロジェクトは両方の部署ファイルに重複して入るが、**どちらの部署からでも単独で復元できる**ことを優先する。

### 孤児データの扱い

親が見つからない行（`group_id` が NULL のまま残った行、削除済み親を参照する行）は、**どの部署ファイルにも入らず全体ダンプにのみ残る**。`backup_runs.orphan_counts`（jsonb）にテーブル別の件数を記録し、**0 でない場合は週次サマリに出す**。

---

## 5. 出力フォーマット

```jsonc
{
  "meta": {
    "app_version": "3.106",
    "taken_at": "2026-09-16T18:00:03Z",   // backup_snapshot() 内の now()
    "scope": "group",                      // "full" | "group"
    "group_id": "grp-egg",                 // scope=group のときのみ
    "table_count": 34,
    "row_counts": { "tasks": 328, "projects": 7, "members": 16 },
    "sha256": "…",                         // tables 部のハッシュ（転送後の照合用）
    "generator": "backup-daily@3"
  },
  "schema": {                              // full のみ
    "tasks": [ { "column": "id", "type": "text", "nullable": false } ]
  },
  "tables": {
    "tasks":    [ { "...行そのまま..." } ],
    "projects": [ {} ]
  }
}
```

- 行は**列を加工せず DB が返した JSON のまま**入れる。整形・リネームをすると復元時に元へ戻せなくなる
- `is_deleted = true` の論理削除行も**含める**（誤って論理削除されたものを戻すのが最も多いケース）
- **圧縮しない**（拡張子 `.json`）。CPU 時間上限2秒を JSON 処理に残すため。Storage 1GB・Egress 5GB に対して非圧縮でも十分収まる（§6）。将来データが育ち容量が問題になった時点で、`Content-Encoding` を使う形で再検討する
- 同名パスへの再実行は `upsert: true` で上書き（同日の手動実行・再実行に対する冪等性）

### 🔴 復旧には2点セットが必要

Free には物理バックアップが無いため、**このJSONだけでは DB を復元できない**。

**「GitHub の `supabase/schema.sql`（構造）」＋「本バックアップの JSON（データ）」の2点が揃って初めて復旧できる。** どちらか片方では戻せない。復旧手順書（§9）はこの前提で書く。`schema.sql` が常に本番と一致していることが復旧可能性の条件であり、`SchemaHealthBanner` による drift 検知はバックアップ体制の一部と位置づける。

---

## 6. 保持ポリシー（GFS）

| 世代 | 保持数 | 期間 | 根拠 |
|---|---|---|---|
| 日次 | 14 | 2週間 | 1週間の休暇を挟んでも気づける幅。誤操作の大半はここで戻る |
| 週次（月曜 3:00 の分を昇格） | 8 | 約2か月 | 月次レビューで初めて異常に気づくケースを拾う |
| 月次（毎月1日 3:00 の分を昇格＝**前月末の状態**） | 12 | 1年 | 年度をまたぐ。期初の状態に戻せる |
| 四半期（1/4/7/10月1日の月次を昇格＝**四半期末の状態**） | 8 | 2年 | OKR が四半期運用（FYは1月開始）。過去期の実績照会に耐える |

### 🔴 昇格判定は JST で行う

バックアップの起動は **UTC 18:00 ＝ JST 翌3:00** である。`taken_at` は UTC で保存されるため、そのまま `extract(isodow / day / month ...)` で曜日・日付を取ると、**JST の月曜が UTC の日曜として数えられ、週次・月次・四半期の昇格が1日ずれる。**

昇格判定は必ず `taken_at AT TIME ZONE 'Asia/Tokyo'` に変換してから行う。「月曜の分を週次に昇格」「1日の分を月次に昇格」はいずれも**日本時間での曜日・日付**を指す。

（フェーズ1の実装時に発見された。設計書の初版〜rev4 はこの点を書いておらず、実装側で補正された。）

### 管理方法

- **世代数で管理する**（日数ではない）。ジョブが数日止まっても、残っているものを消さない
- 保持状態は Storage のメタデータではなく **`backup_objects` 表**で持つ
- **`backup_objects` への行の記録は Edge Function が行う。** Storage への put が成功した後、service_role クライアントで直接 INSERT する（service_role は RLS を迂回するため専用の書き込み関数を作らない。既存の `consume_guest_ai_quota` 等と同じ流儀）。`backup_finalize` はその記録を読んで保持ポリシーを評価し、削除すべきパス一覧を返すだけ

```sql
CREATE TABLE IF NOT EXISTS backup_objects (
  path        text PRIMARY KEY,               -- backups/full/2026-09-16.json
  run_id      bigint REFERENCES backup_runs(id),
  scope       text NOT NULL CHECK (scope IN ('full','group')),
  group_id    text,
  taken_at    timestamptz NOT NULL,
  bytes       bigint NOT NULL,
  sha256      text NOT NULL,
  retention   text[] NOT NULL,                -- {'daily'} / {'daily','weekly','monthly','quarterly'}
  deleted_at  timestamptz                     -- Storage から削除した時刻（行は履歴として残す）
);
```

- 削除は `backup_finalize` が返したパス一覧に対し、Edge Function が **Storage API（`storage.from('backups').remove()`）**で行う。`storage.objects` を SQL で直接消さない（実体ファイルが残る）
- 削除対象＝「全タグについて保持数を超えた」オブジェクト。1つでも有効なタグがあれば残す
- 🔴 **Storage からの削除に成功したら、Edge Function が `backup_objects.deleted_at` を `now()` で更新する。** `backup_finalize` はこの列を更新しない（削除の成否を知らないため）。**更新を忘れると、同じパスが毎日削除対象として返り続け、`backup_finalize` の世代判定（`deleted_at IS NULL` で母集団を作る）に実体の無いオブジェクトが残り続ける。** 運用開始から2週間後（日次14世代を超えた時点）に初めて表面化するため、初回の動作確認では検出できない
- 🔴 **`backup_objects` を INSERT するとき、`retention` には `{'daily'}` を入れる。** `backup_finalize` の昇格処理は `'daily'` を必ず足す作りなので空配列でも動くが、「毎日取ったものは日次世代である」という意味を INSERT 時点で明示する

### 容量試算（2026-09-17・本番の実測値に更新）

🔴 **実測（2026-09-17・本番の初回保存時に `backup_objects.bytes` で計測）**

| ファイル | 実測サイズ |
|---|---|
| `full/2026-09-17.json` | **1,522,897 bytes（1.52MB）** |
| `by-group/grp-egg/2026-09-17.json` | 1,274,305 bytes（1.27MB） |
| `by-group/grp-1784716065248/2026-09-17.json`（AID） | 29,118 bytes（29KB） |
| **1日あたり合計** | **2,826,320 bytes（約2.83MB）** |

当初の見積もり（全体600KB）の2.5倍だった。`grp-egg` が全業務データを持つため全体とほぼ同サイズになり、業務データを持たない AID は2桁小さい。

- 重複を除いた実質保持世代（30前後）で **約90MB**。Storage 1GB に対して **9%**
- 二次保管の日次取得による転送量は **月90MB程度**。Egress 5GB の **1.8%**
- Edge Function のメモリ上限 256MB に対しても余裕がある（1回の RPC 結果を持つだけ）

**データが10倍に育っても（全体15MB／30世代で900MB）Storage 1GB をわずかに超える程度**。その時点で、①圧縮を入れる ②保持世代を減らす ③Pro 化する、のいずれかを検討する。判断材料は `backup_runs.bytes_written` の推移（§8の週次サマリで見る）。

---

## 7. 二次保管：共有ライブラリへ日次

Supabase Storage は**個人アカウント保有の Free プロジェクト内**にあり、プロジェクトの一時停止・削除・アカウント停止・保有者の離任に耐えられない。**pause 中に Storage からファイルを取り出せるかは公式に確認できていない**（§2.1）。したがって、組織が管理する場所へ**日次で**複製を置く。

🔴 **これが原則①「取り戻せる」の担い手であり、「予備」ではない。** 週次から日次へ変更したのは、一次保管が突然使えなくなる可能性を織り込んだため。

```
毎日 09:00（Windows タスクスケジューラ・管理者PC）
  ※「スケジュール開始時刻を過ぎた場合、すぐにタスクを開始する」を有効にする
  └─ scripts/backup_to_onedrive.ps1
       ├─ [0] 保存先の健全性チェック（下記）。失敗したら以降を実行しない
       ├─ [1] Edge Function `backup-export-urls` を呼ぶ（BACKUP_EXPORT_SECRET で認証）
       │       → 直近の full ＋ 全部署分の署名URL（5分）と sha256 の一覧
       ├─ [2] ダウンロードし、sha256 を照合（不一致は失敗扱い・保存しない）
       ├─ [3] 保存先へ配置。ローカル側は 30 世代を保持し、古いものを削除
       └─ [4] Edge Function `backup-export-ack` を呼び、成功／失敗と件数を報告
               → backup_exports 表に記録（§8 のバナーと週次サマリの材料）
```

### 保存先：部署の共有ライブラリ（確定・具体的な場所は未定）

**保存先は部署の共有ライブラリ（SharePoint サイト／Teams チームの文書ライブラリ）とする。** 管理者個人の OneDrive は、アカウント削除後に消えるため採用しない。共有ライブラリは部署が存続する限り残り、所有権が部署にあることが明確なので、**原則①「取り戻せる」を満たす唯一の選択肢**である。

**どのサイト・どのライブラリ・どのフォルダに置くかは未定**（2026-09-16時点）。決定したら本節と管理者申告フォームの「格納場所」欄に記入する。決定までの間も、**フェーズ1〜4（一次バックアップ側）は保存先に依存しないので先行して実装できる**（§12）。

### 🔴 保存先はパスを直書きせず、マーカーで検証する

置き場所が後から決まること、および下記の実測事実から、**パス文字列をスクリプトに直書きしない**設計にする。

2026-09-16 の実測で、このPCには**紛らわしいルートフォルダが3つ**存在した。

| パス | 状態 |
|---|---|
| `C:\Users\yyamamoto\OneDrive` | 空（残骸） |
| `C:\Users\yyamamoto\OneDrive - アミタホールディングス　株式会社` | **空（残骸）** |
| `C:\Users\yyamamoto\OneDrive - アミタホールディングス　株式会社␣`（**末尾に全角スペース**） | 稼働中（63件） |

末尾の全角スペース1文字だけが違う同名フォルダが並んでいる。共有ライブラリを同期すると**さらに別のルートフォルダが増える**（通常 `C:\Users\yyamamoto\アミタホールディングス株式会社\<サイト名> - <ライブラリ名>` の形）ため、紛らわしさはむしろ増す。パスを設定ファイルやスクリプトに書くと、エディタや PowerShell の `Trim()`、コピー&ペーストで末尾スペースが落ち、**残骸フォルダや別のライブラリに書き込む**事故が起きる。その場合ファイルはローカルに溜まるだけで**同期されず、スクリプトは成功を報告する**——最も危険な失敗の仕方になる。

**対策（必須）**：
1. 保存先フォルダに **`.backup-destination-marker` という空ファイルを人手で1つ置く**
2. スクリプトは保存先を設定値（`scripts/backup_export.config.json` など・git 管理外）から読み、**起動時にマーカーの存在を確認する。無ければ何も書かずに失敗として `backup-export-ack` へ報告する**
3. 保存先が変わったときは、設定値の変更と新しい場所へのマーカー配置だけで移行できる

### SharePoint 共有ライブラリ固有の注意

| 論点 | 内容 | 対処 |
|---|---|---|
| **同期の遅延** | ローカルの同期フォルダへ書いた直後は、まだクラウドに上がっていない。PC がすぐ休止・シャットダウンされると同期されないまま残る。**「ローカルに保存できた」は「組織側に届いた」を意味しない** | `backup-export-ack` に「今回の保存」だけでなく**「前回保存したファイルが今も存在するか」**を含めて報告する。恒常的に同期できていない状態を翌日に検出できる |
| **バージョン履歴** | 既定で有効。同名ファイルを上書きすると旧版が履歴として残り容量を消費する | 日付入りのファイル名を使い**上書きしない**運用にする（`2026-09-16_full.json`）。世代削除は削除として行う |
| **ごみ箱** | 削除後93日間はごみ箱に残る（SharePoint 既定） | 世代削除してもすぐには容量が減らない。**誤削除の保険としては有利**。容量が問題になるまで放置してよい |
| **パス長・禁則文字** | SharePoint は約400文字、同期フォルダ側は環境により260文字制限。`grp-` で始まる ID をそのままフォルダ名に使うので実害は想定しにくいが、深い階層に置かない | 保存先は浅い階層にする |
| **アクセス権** | **そのライブラリを閲覧できる全員がバックアップを読める。** 中身には個人OKR・氏名・メールアドレスが含まれる | 専用フォルダを作り、**閲覧権限を部署管理者に絞る**。ライブラリ全体が部署員に開放されている場合、そのままバックアップを置かない |
| **ファイルオンデマンド** | 同期フォルダのファイルが「クラウドのみ」になり、ローカルに実体を持たないことがある | 書き込みには影響しない。読み取り（世代削除の判定）はメタデータだけで行い、ファイル本体を開かない |

### 認証の設計

- **`service_role` キーをローカルPCに置かない。** `backup-export-urls` は `BACKUP_EXPORT_SECRET` で認証し、短命の署名URLだけを返す。このシークレットが漏れても**バックアップの読み取り以外は何もできない**
- ローカル側のシークレットは平文ファイルにせず、**Windows 資格情報マネージャー**または DPAPI（`ConvertFrom-SecureString`）でユーザーアカウントに束縛して保存する。`env_b_setup/` に平文シークレットが残り `git add -A` で誤ステージしかけた事故の再発防止

### 🔴 残存リスク（設計上、解消できていない）

この二次保管は**管理者PCが起動していることに依存する**。8原則④を完全には満たさない。異動・退職・長期休暇でこのPCが動かなくなれば、オフサイト複製は静かに止まる。

緩和策：
- タスクスケジューラで「開始時刻を過ぎたらすぐ実行」を有効にし、PC が数日止まっても次回起動時に追いつく
- `backup_exports` の最終成功が**3日以上前**なら管理画面バナーで警告（日次化に合わせて週次時代の8日から短縮）
- 週次サマリに「二次保管の最終取得日」を必ず載せる
- 管理者申告フォームの「引き継ぎ時の手続き」にこのタスクスケジューラの移管を明記する
- 将来は PC 非依存の経路（GitHub Actions 等）へ移す。ただし**業務データ（氏名・メールアドレス・個人OKR）を社外サービスへ置く判断**が必要なため、本設計では採用しない

---

## 8. 監視

バックアップは「失敗に気づく仕組み」とセットでなければ、無いのと同じである。

```sql
CREATE TABLE IF NOT EXISTS backup_runs (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  trigger       text NOT NULL CHECK (trigger IN ('cron','manual')),
  triggered_by  text,                                 -- manual のとき member id
  status        text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  group_count   integer,
  row_counts    jsonb NOT NULL DEFAULT '{}'::jsonb,
  orphan_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  bytes_written bigint,
  duration_ms   integer,
  deleted_count integer,
  error_message text
);

CREATE TABLE IF NOT EXISTS backup_exports (           -- 二次保管の報告（§7 [4]）
  id            bigserial PRIMARY KEY,
  reported_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL CHECK (status IN ('success','failed')),
  destination   text NOT NULL,                        -- 保存先の識別（末端フォルダ名程度。フルパスは不要）
  object_count  integer,
  error_message text
);
```

- 3表とも **RLS を有効化し、SELECT は super-admin のみ、書き込みは service_role のみ**
- `backup_runs` / `backup_exports` は90日で削除（`cleanup-admin-change-logs` と同型の pg_cron）。`backup_objects` は履歴として残す
- 新表3本と新関数3本は `schema.sql` と `SchemaHealthBanner` の検査対象に追加する（追加漏れは dev/prod ドリフトとして見えなくなる）

### 通知

| 事象 | 通知 |
|---|---|
| `failed` | **即時 Teams 通知**。`notify-deadlines` と同じ Power Automate 経路・同じ JSON 構造で送る |
| `partial`（一部の部署だけ失敗） | 即時 Teams 通知 |
| 一次バックアップの最終成功が24時間以上前 | 管理画面に赤バナー |
| 二次保管の最終成功が3日以上前 | 管理画面に黄バナー |
| 週次サマリ | 月曜に1通。成功回数・容量・孤児件数・削除数・二次保管の最終取得日 |

**成功時に何も出さない設計にはしない。** 通知が来ないことが「正常」なのか「ジョブごと死んでいる」のか区別できなくなるため、週次サマリを必ず出す。

**注意：Teams 通知経路そのものが設定者個人の Power Automate 接続に依存している**（[deadline-notifications.md](./deadline-notifications.md)）。Teams が届かなくなる障害とバックアップが止まる障害は同時に起こりうる。**管理画面バナーは Teams に依存しない経路として必ず実装する。**

---

## 9. 復元設計

### Phase 1 では自動リストアを作らない

管理画面からできるのは「**部署 × 日付を選んでダウンロード**」までとする。復元は手順書に沿って人が実行する。

理由：復元の誤爆は削除より被害が大きい。ボタン1つで全部署を過去状態に戻せる機能は、それ自体が最大のリスクになる。Human-in-the-loop 方針に従う。

### 復元手順の骨子（詳細は restore-runbook.md へ）

1. **更新を止める**：Vercel のデプロイをロック、関係者へ「使用停止」を即時連絡
2. **直前の状態を取る**：`backup-daily` を手動実行し、壊れた状態も1世代残す（復元をやり直せるようにする）
3. **影響範囲を確定する**：いつ・どのテーブルの・何件が壊れたか。`admin_change_logs` と `backup_runs` を突き合わせる
4. **戻す範囲を決めて宣言する**：「grp-egg の tasks のみ、9月15日 3:00 時点へ」。**このとき失われる更新（最終バックアップ以降・最大24時間）を先に明示して合意を取る。Free には PITR が無いため、任意時点への復元はできない**
5. **dev で先に試す**：本番へ直接流さない。dev はスキーマドリフトがある（2026-08-27時点で9表未適用）ため、**先に dev のスキーマを prod と揃える**
6. **本番へ適用**：トランザクション内で、対象テーブルのみ
7. **関係者へ報告**：何が起き、何を復旧し、何が失われたか

### プロジェクトごと失われた場合の復旧

Free には物理バックアップが無いため、**新しい Supabase プロジェクトを作り、`schema.sql` で構造を作ってから JSON を流し込む**ことになる。

1. 新規プロジェクト作成（**Free は組織あたり2プロジェクトまで**。既に dev/prod で埋まっているため、停止中プロジェクトの整理か、一時的な有料化が必要になる場合がある）
2. `supabase/schema.sql` を適用（＝構造）
3. 二次保管の最新 full JSON を §9 の技術的注意に従って流し込む（＝データ）
4. Edge Function・secrets・pg_cron を再設定（`supabase/functions/` と migrations にある）
5. Vercel の環境変数を新プロジェクトの URL / anon key に差し替え

**この手順が机上のものにならないよう、四半期の訓練では「新規プロジェクトを作る」ところまでは行わないが、スキーマ適用＋データ流し込みは実際に行う。**

### 🔴 復元時の技術的注意（runbook に必ず書く）

| 論点 | 何が起きるか | 対処 |
|---|---|---|
| **トリガー** | `sync_*_group_id(s)` が親から `group_id` を再計算し、`updated_at` トリガーが復元時刻で上書きする | 復元セッションで `SET session_replication_role = replica;` を使いトリガーを止める。終了後に戻す。止めた場合 `tasks.group_ids` 等はスナップショット当時の値がそのまま入る（意図どおり） |
| **FK の順序** | 🔴 **2026-09-17の訓練で、この記述は誤りだと判明した。** 同一テーブル内の自己参照（`tasks.parent_task_id`）は、**1つの INSERT 文で親子を同時に入れるなら順序を気にしなくてよい**（PostgreSQL の FK は行ごとではなく**文の終わり**に検証されるため。子を先に並べた INSERT を実際に流して成功を確認した） | **テーブルをまたぐ FK は別**で、必然的に文が分かれるため順序が要る：`groups` → `members` → `objectives` → `key_results` → `task_forces` → `todos` → `projects` → `tasks` → 中間表・層B。`task_dependencies` は `tasks` の後 |
| **既存行との衝突** | 主キー重複で INSERT が失敗する | 原則は `INSERT ... ON CONFLICT (id) DO UPDATE`（上書き復元）。「消えた行だけ戻す」なら `DO NOTHING` |
| **スキーマ差分** | 古いスナップショットに無い NOT NULL 列がある／今は無い列がある | `meta.schema` と現行 `information_schema.columns` を突き合わせて差分列を列挙する。無い列は DEFAULT に任せ、消えた列は落とす。**差分がある復元は必ず dev で先に流す** |
| **投入方法** | JSON から表へ | `INSERT INTO tasks SELECT * FROM jsonb_populate_recordset(NULL::tasks, $1::jsonb)`。列が一致しない場合は `jsonb_to_recordset` で列を明示 |
| **楽観ロック** | 復元後、開いていた画面で `ConflictError` が出る | 復元後は全員に再読み込みを依頼する（手順1で使用停止しているため実害は限定的） |

### 四半期ごとの復元訓練

**四半期に1回、実際に復元する。** 復元を試したことがないバックアップは、あるとは言えない。

✅ **第1回を 2026-09-17 に dev で実施した。手順は [restore-runbook.md](./restore-runbook.md) に記録済み。**

3ケース（①物理削除からの復元 ②上書き事故からの復元 ③親子構造の復元）がすべて成功し、次が実証された。

- `alter table ... disable trigger user` は Supabase の SQL Editor で**権限エラーなく通る**（`session_replication_role` は不要）
- それでも **FK 制約は生きている**（存在しない親を参照する更新は 23503 で弾かれた）
- トリガーを止めれば `updated_at` と `group_ids` が保持される。ただし上書き復元では `updated_at = excluded.updated_at` の明示が必要
- 🔴 **上記の「FK の順序」に関する当初の記述は誤りだった**（1文なら順序不要）。**実機で試さなければ、存在しない問題への対策を手順書に書き続けていた**

未検証で残ったもの（次回の訓練で潰す）：部署別ファイルからの復元／テーブルをまたぐ復元の順序／スキーマ差分がある状態での復元／プロジェクトごと失われた場合の復旧。

**Free は組織あたり2プロジェクトが上限で、dev/prod で埋まっている。** 訓練用プロジェクトは作れないため、**dev プロジェクト内に `restore_drill` スキーマを作り、そこへ `schema.sql` ＋ JSON を流す**方式で行う。dev の開発用データを壊さずに済み、`search_path` を切り替えるだけで検証できる。訓練結果（所要時間・つまずいた点・スキーマ差分の有無）を restore-runbook.md へ追記する。

---

## 10. セキュリティ

| 項目 | 設計 |
|---|---|
| バケット | プライベート（`public = false`）。バケット名 `backups` |
| クライアントからの Storage アクセス | **全面拒否**（`storage.objects` にクライアント向けポリシーを作らない）。ダウンロードは Edge Function が super-admin を検証して署名URLを返す経路に一本化 |
| 署名URL | 有効期限5分 |
| DB 関数3本 | `SECURITY DEFINER`。`EXECUTE` を `public` / `anon` / `authenticated` から REVOKE し service_role のみ |
| `service_role` キー | Edge Function secrets のみ。クライアント・ローカルPCには置かない |
| シークレット | `BACKUP_CRON_SECRET`（起動用）／`BACKUP_EXPORT_SECRET`（二次保管取得用）を分ける。git には実値を置かない（`20260702_schedule_notify_deadlines.sql` と同じくプレースホルダーで記録）。ローカルPC側は資格情報マネージャー／DPAPI |
| 中身の機密区分 | **氏名・メールアドレス・業務内容・個人OKR（評価に直結）を含む。** 内製アプリ申告フォームの「格納データ種別と機密区分」「格納場所」に明記が必要 |
| 保管先の可視範囲 | **共有ライブラリを閲覧できる全員がバックアップを読める。** 専用フォルダを作り閲覧権限を部署管理者に絞る。**権限設計が済むまでバックアップを置かない**（置き場所の決定には権限の決定が含まれる） |

---

## 11. 未決事項・残存リスク

| # | 論点 | 状態 |
|---|---|---|
| 1 | ~~本番 Supabase のプラン~~ | ✅ **解決：Free。**自動バックアップ・PITR は無く、本設計が唯一のバックアップ |
| 2 | ~~二次保管先の方針~~ | ✅ **解決：部署の共有ライブラリ。** 個人 OneDrive 案は破棄 |
| 2b | 共有ライブラリの**具体的な場所と権限** | 🟡 **未定（後日決定）。** どのサイト・ライブラリ・フォルダに置き、誰に閲覧権限を与えるか。**フェーズ5の着手条件**であり、フェーズ1〜4はこれを待たずに進められる |
| 3 | 部署管理者（`is_admin`）に自部署ぶんのダウンロードを許可するか | 未決。許可すれば「持ち出せる」（原則⑦）に効くが、個人OKRを含むため権限設計が重くなる。Phase 1 は super-admin のみで開始 |
| 4 | 二次保管のPC依存 | **解消できていない。**§7 の残存リスク参照 |
| 5 | pause 中に Storage からファイルを取り出せるか | **一次ソースで確認できず。** 取り出せない前提で設計している（二次保管の日次化）。Supabase サポートへの確認、または pause を実際に経験した時点で追記する |
| 6 | Free の上限超過時の挙動（読み取り専用化か停止か） | **一次ソースで確認できず。** 容量に余裕があるため実害の想定は低い。`bytes_written` の推移で監視 |
| 7 | Free プランの商用利用 | 規約上、明示的な禁止条項は無いが、明示的な許可文言も無い。**IT 部門への説明ではこの通り正確に伝える**（「商用利用可」と断定しない） |
| 8 | データが数千行規模に育った場合 | `backup_snapshot` の CTE と jsonb 構築は Postgres 側なので CPU 2秒制限の外にあるが、Edge Function の wall clock 150秒と メモリ 256MB には効く。`duration_ms` と `bytes_written` の推移を週次サマリで見て、部署ごとの分割起動へ切り替える時期を判断する |
| 9 | Sydney リージョン | データ所在地が国外。バックアップの保管先（Storage）も同リージョン。二次保管は国内（SharePoint/OneDrive の既定に従う）。展開時の説明事項 |

---

## 12. 実装フェーズ

| # | 内容 | 成果物 | 完了条件 |
|---|---|---|---|
| **0** | `runbook.md` の「Supabase の Backups を確認」「PITR は Pro 以上で可能」を、**本番（Free）では実行できない手段**であると訂正し、本設計書へ誘導する | `docs/dev/runbook.md` 修正 | 現行 runbook を読んだ人が、存在しないバックアップを探しに行かない |
| 1 | `backup_begin` / `backup_snapshot` / `backup_finalize` ／`backup_runs` `backup_objects` `backup_exports` 表／RLS／Storage バケット | `migrations/2026xxxx_add_backup.sql`・`schema.sql` 追記・`SchemaHealthBanner` 対象追加 | dev で関数が全表を返し、行数が `SELECT count(*)` と一致する |
| 2 | Edge Function `backup-daily`（RPC を呼んで put するだけの薄い層） | `supabase/functions/backup-daily/index.ts` | dev で手動実行し、full と by-group の行数が整合。**1000行超の表を dev に作って欠落しないことを確認する**。`duration_ms` を記録し CPU 余裕を確認 |
| 3 | pg_cron 登録（日次） | `migrations/2026xxxx_schedule_backup.sql` | 翌朝 `backup_runs` に success が入る |
| 4 | Teams 通知・管理画面バナー（赤／黄）・手動実行ボタン・ダウンロードUI | `AdminView` 配下・Edge Function `backup-export-urls` | **わざと失敗させて通知とバナーが出ることを確認する** |
| **5 前提** | ①共有ライブラリの場所と権限を決定 ②ライブラリを同期 ③保存先フォルダに `.backup-destination-marker` を配置 | — | マーカーがエクスプローラから見え、権限が部署管理者に絞られている |
| 5 | 二次保管スクリプト＋タスクスケジューラ＋`backup-export-ack` | `scripts/backup_export.ps1`・`backup_export.config.json`（git 管理外） | 翌日 `backup_exports` に success が入り、保存先に sha256 一致のファイルがある。**マーカーを消すと失敗として報告されることも確認する** |
| 6 | `restore-runbook.md` ＋ dev の `restore_drill` スキーマへの復元訓練1回 | `docs/dev/restore-runbook.md` | dev で1部署を1日前に戻し、画面で確認できる |

### 着手順と依存関係

**フェーズ0〜4は保存先の決定を待たない。** 依存するのはフェーズ5だけである。

```
フェーズ0 → 1 → 2 → 3 → 4  （一次バックアップ・監視。保存先に依存しない）
                              ↓
        [共有ライブラリの場所・権限の決定] → フェーズ5 → 6
```

フェーズ3の完了時点で「日次バックアップが取れている」、フェーズ4までで「失敗に気づける」、フェーズ5までで「組織側に複製がある」、フェーズ6までで「戻せることを確認した」状態になる。

🔴 **フェーズ4までの状態は「Supabase が生きている限り戻せる」にすぎない。** 個人アカウントの Free プロジェクト内にしか複製が無いため、**フェーズ5を完了するまで原則①「取り戻せる」は満たされない。** 置き場所の決定を長く保留しないこと。

🔴 **フェーズ6を完了するまでは、IT部門への回答で「復旧手順がある」とは言わない。**
