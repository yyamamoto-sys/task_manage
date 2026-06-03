# 共通基盤：状態管理（stores）

> アプリ全データの単一の真実（zustand）。
> 全体像は [`docs/dev/module-map.md`](../../docs/dev/module-map.md)「データ基盤」。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `appStore.ts` | **全アプリデータの単一ストア**。各エンティティの `saveX`/`deleteX`（楽観更新→`lib/supabase/store` 呼び出し→失敗時 `handleSaveError` で reload 巻き戻し）。`applyRemoteChange`（Realtime反映） |
| `consultSessionStore.ts` | AI相談（B）の会話/提案/履歴のミラー（再マウントで会話が消えないための seed 元） |

## 改修・バグ探しの注意点
- コンポーネントは **`useAppStore(s => s.X)` の selector** で必要な分だけ購読する（全state購読しない）。
- 書き込みは「①`set()` で楽観更新 → ②`upsertX`/`softDeleteX` → ③失敗時 `handleSaveError`（トースト＋`load()`）」。
- **ゲスト（閲覧のみ）時の書き込みブロックは `lib/supabase/client.ts` で行う**（ここではなく client 層）。
- `store.ts` を直接書く外部経路（`lib/ai/applyProposal.ts` の insert）は **このストアの楽観更新を通らない**ので、反映後は呼び出し側で `reload()` する。
