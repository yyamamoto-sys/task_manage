// src/lib/guest/guestCapability.ts
//
// 【設計意図・2026-08-12】
// 「ゲスト（サンプル閲覧）に、この編集操作を出してよいか」の判定を1箇所に集約する。
// 従来は MainLayout.tsx・ProjectRowMenu.tsx 等に `isGuest` の生の真偽値チェックが
// 個別に散らばっており、開放範囲を変えるたびに複数ファイルを揃って直す必要があった
// （直し漏れが「押しても何も起きない」「例外で落ちる」のどちらかを生む）。
//
// 山本さんの明示選択（2026-08-12）で、ゲストに開放する編集操作は次の6種類に決まっている：
// タスクの追加・編集・削除・ステータス変更／カンバンD&D／ガントのバー操作／PJの作成・編集／
// マイルストーンの追加・編集・削除／AI提案の反映。設定画面（AdminView）配下は対象外のまま。
//
// 【使い方】非ゲストのときは常に true（呼び出し元の他の権限チェックに従うだけ）。ゲストの
// ときだけ GUEST_ALLOWED_EDIT_TARGETS を見る。新しい編集操作を追加するときは
// GuestEditTarget に1つ増やし、開放するかどうかをこのSetに反映すること
// （反映し忘れると既定で「非開放」になる＝安全側に倒れる）。

export type GuestEditTarget =
  | "task"          // タスクの追加・編集・削除・ステータス変更
  | "kanban"        // カンバンのドラッグ&ドロップ
  | "gantt"         // ガントのバー操作（期間変更・移動・依存追加）
  | "project"       // プロジェクトの作成・編集
  | "milestone"     // マイルストーンの追加・編集・削除
  | "aiApply"       // AI提案の「反映する」操作
  | "adminSettings"; // 設定画面（メンバー管理・OKR階層・部署管理）。ゲストには常に不可

const GUEST_ALLOWED_EDIT_TARGETS: ReadonlySet<GuestEditTarget> = new Set([
  "task", "kanban", "gantt", "project", "milestone", "aiApply",
]);

/**
 * ゲストにこの編集操作を見せて（実行させて）よいか。
 * @param isGuest 呼び出し元が isGuestMember(currentUser) 等で判定済みの真偽値
 * @param target  何の操作か（GuestEditTarget）
 */
export function canGuestEdit(isGuest: boolean, target: GuestEditTarget): boolean {
  if (!isGuest) return true;
  return GUEST_ALLOWED_EDIT_TARGETS.has(target);
}
