# 引継ぎ入口（handover-start-here）

作成：2026-10-27（本番 v3.186 時点）。IT が最初に読む1枚。ここには「どこに何があるか」だけを書く。値・プロジェクト識別子・URL は書かない。

## 1. この文書の役割と、読む順序

役割は、AMP（このアプリ）の資料と情報の置き場所を示し、本番に影響する操作の事実を並べること。手順の本体は各文書にある。

読む順序は次のとおり。

1. `CLAUDE.md`（Claude Code が自動で読む。設計の正本と、節の目次）
2. 本書（置き場所・秘密の所在・本番に影響する操作）
3. `docs/dev/handover-checklist.md`（アカウント・権限・障害パターンの観点）
4. `docs/dev/status-and-open-items.md`（現況と未解決課題）
5. `docs/dev/runbook.md`（障害対応）
6. `docs/dev/lessons-learned.md`（ハマりどころと教訓）

## 2. 体制と連絡先

| 役割 | 担当 |
|---|---|
| 管理者 | 山本 勇気（AID／情報戦略本部） |
| 代行 | IT（管理用アドレス app_gantt@amita-net.co.jp） |

- Claude・Supabase・GitHub・Vercel の4サービスは、管理用アドレスで登録している。
- GitHub でのコミット・push は、管理用アカウントを共有して行う（2026-10-27 決定）。
- 管理用アドレスのメールは IT も受信できる。

## 3. 3つの置き場所

| 置き場所 | 読む人 | 置いているもの | 場所 |
|---|---|---|---|
| GitHub（このリポジトリ） | Claude Code と人 | コード・設計・運用手順・経緯・Claude 用の指示・スキル。Claude が読むものの正本 | このリポジトリ |
| 社内ネットワークドライブ | 人だけ | 提出物・計画書・手順書など、人が読む文書 | ＜IT が指定＞ |
| 秘密の保管場所 | 権限を持つ人だけ | パスワード・2段階認証の復旧コード・DB パスワード（パスワード付きファイル） | ＜IT が指定＞ |

- Claude Code はネットワークドライブを読まない運用が前提のため、Claude に必要な情報はリポジトリに置いている。
- ドライブの文書とリポジトリで内容が重なる場合、Claude が読む情報の正本はリポジトリである。

## 4. 秘密の所在

名称と、それがあるサービスの一覧。値はここにも他の文書にも書いていない。

| 名称 | あるサービス | 区分 |
|---|---|---|
| ANTHROPIC_API_KEY | Supabase（Edge Function secrets） | 秘密 |
| SUPABASE_SERVICE_ROLE_KEY | Supabase（Edge Function に自動注入） | 秘密 |
| REMINDER_CRON_SECRET | Supabase（Edge Function secrets と pg_cron のコマンド本文） | 秘密 |
| BACKUP_CRON_SECRET | Supabase（Edge Function secrets と pg_cron のコマンド本文） | 秘密 |
| BACKUP_EXPORT_SECRET | Supabase（Edge Function secrets） | 秘密 |
| VAPID_PRIVATE_KEY | Supabase（Edge Function secrets） | 秘密 |
| VITE_TEAMS_WEBHOOK_URL | Vercel（環境変数。ビルド時にバンドルへ埋め込まれる） | 秘密（URL 自体が認証情報） |
| VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY／VITE_VAPID_PUBLIC_KEY | Vercel（環境変数） | 公開値 |
| ALLOWED_ORIGINS／VAPID_SUBJECT ほか | Supabase（Edge Function secrets） | 設定 |

- 秘密の値は各サービスの中にだけあり、別の控えは持っていない。漏れた場合は、そのサービスで再発行する。
- 旧 NOTIFY_CRON_SECRET は過去のマイグレーションにだけ名前が残る。関数と cron は削除済み。
- `.env.local` は各 PC で、人が各サービスから値を取得して作る。`.gitignore` の対象でコミットされない。
- ログイン用のパスワード、2段階認証の復旧コード、DB パスワードは、3章の「秘密の保管場所」にある。
- 名称ごとの詳しい用途と、環境変数の確認場所は `handover-checklist.md` の「2. 環境変数とシークレット」にある。

## 5. 本番に影響する操作（事実の一覧）

どう扱うかは IT が判断する。

| 操作 | 事実 | 手順の所在 |
|---|---|---|
| main への push | Vercel が本番へ自動デプロイする | `lessons-learned.md` 1章、`runbook.md` 7章（デプロイ周り・Rollback） |
| マイグレーションの適用 | push では反映されない。Supabase 側へ別途適用する。適用前後の確認は `information_schema` で行っている | `supabase-migrations.md` |
| Edge Function の配備 | push では反映されない。Supabase 側で関数ごとにデプロイする | `status-and-open-items.md` 1章、`runbook.md` 4章（AI 障害） |
| 本番 DB への直接操作 | 本番と開発は別の DB。照会・復元は本番に直接作用しうる | `runbook.md` 9章、`restore-runbook.md`、`backup-design.md` |
| 外部クラウド CLI（Supabase CLI・`pg_dump` など） | 社内のセキュリティ監視（EDR）で検知され、ヘルプデスクから照会が来た実績がある。読み取りだけの照会も対象になった。現在は人が実行している | `runbook.md` 9.4、`lessons-learned.md` |

- 本番 Supabase は Free プランで、自動バックアップと PITR は無い。日次バックアップは自前の Edge Function（backup-daily）が取っている（`backup-design.md`）。

## 6. IT の PC で始めるとき

1. リポジトリを clone する。
2. `npm install` を実行する。
3. 次の3つが通ることを確認する。
   - `npx tsc --noEmit`
   - `npx vitest run`
   - `npm run build`
4. `.env.local` が必要な作業では、4章に従い人が値を取得して作る。

Claude Code まわりの事実は次のとおり。

- リポジトリの `.claude/skills/` にスキルが1本ある（taskmanage-dataviz-widget。グラフ・集計ウィジェットを追加する型）。
- 公開スキル（supabase-postgres-best-practices・vercel-react-best-practices）はリポジトリに含まれない。必要なら各 PC で導入する。
- CLAUDE.md 冒頭にある管理者の連絡用ファイルは、管理者の環境にだけある。無い環境では読まずに進めてよい。
- リポジトリに `.claude/settings.json` は無い。Claude Code に何を任せるか、権限をどう設定するかは IT の判断による。

## 7. 未決事項（IT が決めるもの）

- ネットワークドライブの AMP 用フォルダの場所と、閲覧できる人
- 秘密の保管場所（パスワード付きファイルの置き場所と閲覧者。ファイルのパスワードを2名で共有する経路）
- 2段階認証の復旧コード・DB パスワードの保管形と、取り出す手順
- IT の PC の準備可否（Git・Node.js・Claude Code・必要なら Supabase CLI の導入）
- IT が Claude Code に任せる範囲
- リポジトリのアクセス者の名簿と見直し
- DB バックアップ（`pg_dump` の出力）の保管先と閲覧者（全利用者のデータを含む）
- ドライブの文書の更新責任と見直し時期
