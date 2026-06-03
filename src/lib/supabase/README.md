# 共通基盤：データ永続化（lib/supabase）

> Supabaseクライアント・低レベルCRUD・楽観ロック・Realtime・エンティティ別store。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「データ基盤」。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `client.ts` | Supabaseクライアント生成。**ゲスト時は from(table).insert/update/upsert/delete をProxyでブロック**（[[guestMode]]） |
| `store.ts` | 低レベルCRUD。`saveWithLock`（楽観ロック）＋`ConflictError`、各 `upsertX`/`softDeleteX`、`fetchAllData` |
| `realtime.ts` | tasks/projects等の変更購読（1チャンネル相乗り） |
| `auth.ts` | セッション取得・匿名認証 |
| `krSessionStore` `krMeetingNoteStore` `krReportStore` `okrAnalysisStore` `projectAnalysisStore` `quarterPlanStore` | OKR/分析系のエンティティ別store |

## 改修・バグ探しの注意点（落とし穴）
- **UI型とDB列名のズレに注意**：`upsertTask` は UI専用 `todo_ids`（複数）→ DB列 `todo_id`（単数）に変換する。
  `store.ts` を介さず `supabase` を直接書く箇所（例：`lib/ai/applyProposal.ts`）は**DB列名で書く**こと。
- `saveWithLock`：BEFORE UPDATEトリガーが `updated_at=NOW()` で上書きするため、戻り値は `.select()` の実値を使う（詳細はファイル冒頭コメント／`CLAUDE.md` Section 5）。
- **schema.sql は drift しがち**（手動マイグレ運用）。例：`tasks.parent_task_id`/`display_order`（migration 20260527）、`milestones.description`（20260603）は **DBにあるが schema.sql 反映が遅れることがある**。実列は `supabase/migrations/` を正とする。
- 回帰テスト：`__tests__/store.test.ts`（多人数ロック）。
