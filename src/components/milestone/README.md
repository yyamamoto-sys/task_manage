# モジュール A（計画ビュー）：マイルストーン

> PJの節目（期日マーカー）。ガント上に ◆ で表示。名前・日付・**メモ/詳細**を持つ。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「A 計画ビュー」。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `MilestoneAddForm.tsx` | 追加フォーム共有部品（管理画面・PJカルテ・FABモーダルで再利用） |
| `MilestoneAddModal.tsx` | FAB（右下＋）から開く追加モーダル |
| `MilestoneEditModal.tsx` | **作成後の編集**（名前・日付・メモ詳細）／削除 |

## 改修・バグ探しの注意点
- 保存は `appStore.saveMilestone`（→ `upsertMilestone`／楽観ロック）。
- **`milestones.description`（メモ）列は migration `20260603_add_milestone_description.sql` で追加**。本番DBへ適用が必要（手動）。schema.sql 反映が遅れることがあるので実列は migrations を正とする。
- 編集の開き口：ガントの◆クリック／PJカルテの行／管理画面の◆一覧（メモ有りは `📝`）。
- データ型は `lib/localData/types.ts` の `Milestone`。
