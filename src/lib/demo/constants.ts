// src/lib/demo/constants.ts
//
// ゲスト（サンプル閲覧）モード専用の定数。データ本体（dataset.ts）とは分離し、
// appStore.ts など「動的importさせたくない側」からも安全に静的importできるようにする
// （このファイルにデータ本体を置かないこと。中身がデータだと Section 19 のダウンロード
// 量最小化に反する）。

/** サンプルデータ専用のグループID。実部署のgroup_id（grp-egg等）と絶対に衝突しない値。 */
export const DEMO_GROUP_ID = "grp-demo";

/**
 * ゲスト自身の担当に付け替えるタスクのid（dataset.ts で定義）。
 * dataset.ts と guestPersona.ts の両方から参照するため、データ本体を持たないこの
 * ファイルに置く（guestPersona.ts が dataset.ts を静的importせずに済むようにするため）。
 */
export const GUEST_ASSIGNED_TASK_IDS = ["demo-task-guest-1", "demo-task-guest-2", "demo-task-guest-3"];
